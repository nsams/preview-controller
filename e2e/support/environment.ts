import { execFile, spawn, type ChildProcess } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const projectDir = join(import.meta.dirname, "..", "..");

export const password = "e2e-test-password";
export const baseDomain = "preview.localhost";
const port = 9123;

export type Preview = {
    slug: string;
    ref?: { org: string; repo: string; branch: string };
    commit?: string;
    urls: { name: string; url: string }[];
    status: "stopped" | "starting" | "running" | "failed";
    error?: string;
    url: string;
};

/** The url of a preview, or of one of its other hosts like admin--<slug>. */
export function previewUrl(slug: string, name?: string): string {
    return `http://${name ? `${name}--` : ""}${slug}.${baseDomain}:${port}`;
}

/**
 * Talks http to the controller. Browsers resolve subdomains of localhost, node does not
 * everywhere, so this connects to 127.0.0.1 and puts the host only into the Host header.
 */
export class Client {
    readonly url = `http://${baseDomain}:${port}`;
    cookie: string | undefined;

    /** Takes a full url, or a path on the controller. */
    request(url: string, options: { method?: string; form?: Record<string, string>; headers?: Record<string, string> } = {}) {
        const target = new URL(url, this.url);
        const body = options.form && new URLSearchParams(options.form).toString();
        const headers: Record<string, string> = { host: target.host, ...options.headers };
        if (body !== undefined) {
            headers["content-type"] = "application/x-www-form-urlencoded";
        }
        if (this.cookie) {
            headers.cookie = [headers.cookie, this.cookie].filter(Boolean).join("; ");
        }
        const path = target.pathname + target.search;
        return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
            const outgoing = httpRequest({ host: "127.0.0.1", port, method: options.method ?? "GET", path, headers }, (incoming) => {
                let text = "";
                incoming.setEncoding("utf8");
                incoming.on("data", (chunk: string) => (text += chunk));
                incoming.on("end", () => resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body: text }));
            });
            outgoing.on("error", reject);
            outgoing.end(body);
        });
    }

    async login(): Promise<void> {
        const response = await this.request("/__preview-controller/login", { method: "POST", form: { password } });
        this.cookie = String(response.headers["set-cookie"]).split(";")[0];
    }

    async previews(): Promise<Preview[]> {
        return JSON.parse((await this.request("/api/previews")).body) as Preview[];
    }

    async preview(slug: string): Promise<Preview | undefined> {
        return (await this.previews()).find((preview) => preview.slug === slug);
    }

    async startLog(slug: string): Promise<string> {
        return (await this.request(`/api/previews/${slug}/logs?source=start`)).body;
    }
}

/**
 * The repository the tests preview. Instead of GitHub, the controller clones it from a bare
 * repository on disk, see the git url rewrite in Controller.
 */
export class Repository {
    private readonly workDir: string;

    constructor(workDir: string) {
        this.workDir = workDir;
    }

    private async git(args: string[]): Promise<string> {
        const { stdout } = await execFileAsync("git", ["-c", "user.name=e2e", "-c", "user.email=e2e@example.com", ...args], { cwd: this.workDir });
        return stdout.trim();
    }

    async init(bareDir: string): Promise<void> {
        await mkdir(bareDir, { recursive: true });
        await execFileAsync("git", ["init", "--quiet", "--bare", bareDir]);
        await cp(join(import.meta.dirname, "..", "fixture-project"), this.workDir, { recursive: true });
        await this.git(["init", "--quiet", "--initial-branch", "template"]);
        await this.git(["add", "--all"]);
        await this.git(["commit", "--quiet", "--message", "Fixture project"]);
        await this.git(["remote", "add", "origin", bareDir]);
    }

    /** Commits the files on top of the branch - or of the fixture project for a new one - and pushes it. */
    async push(branch: string, files: Record<string, string> = {}): Promise<string> {
        const exists = (await this.git(["branch", "--list", branch])) !== "";
        await this.git(["checkout", "--quiet", exists ? branch : "-b", ...(exists ? [] : [branch, "template"])]);
        for (const [name, content] of Object.entries(files)) {
            await writeFile(join(this.workDir, name), content);
        }
        await this.git(["add", "--all"]);
        await this.git(["commit", "--quiet", "--allow-empty", "--message", `Update ${branch}`]);
        await this.git(["push", "--quiet", "origin", branch]);
        return this.git(["rev-parse", "--short", "HEAD"]);
    }
}

/** The real controller on the docker daemon of the machine, with acme/demo cloned from disk. */
export class Controller {
    readonly dataDir: string;
    readonly repository: Repository;
    private readonly rootDir: string;
    private process: ChildProcess | undefined;

    private constructor(rootDir: string) {
        this.rootDir = rootDir;
        this.dataDir = join(rootDir, "data");
        this.repository = new Repository(join(rootDir, "work"));
    }

    static async start(): Promise<Controller> {
        const controller = new Controller(await mkdtemp(join(tmpdir(), "preview-controller-e2e-")));
        await controller.repository.init(join(controller.rootDir, "github", "acme", "demo.git"));
        await controller.launch();
        return controller;
    }

    async launch(): Promise<void> {
        const child = spawn(process.execPath, ["src/index.ts"], {
            cwd: projectDir,
            stdio: ["ignore", "pipe", "inherit"],
            env: {
                ...process.env,
                PREVIEW_CONTROLLER_PORT: String(port),
                PREVIEW_CONTROLLER_BASE_DOMAIN: baseDomain,
                PREVIEW_CONTROLLER_PASSWORD: password,
                PREVIEW_CONTROLLER_PORT_RANGE: "32000-32099",
                PREVIEW_CONTROLLER_DATA_DIR: this.dataDir,
                // The daemon may run previews of other controllers, which must never be removed.
                PREVIEW_CONTROLLER_REMOVE_AFTER_DAYS: "0",
                // https://github.com/<org>/<repo>.git is cloned from <rootDir>/github/<org>/<repo>.git.
                GIT_CONFIG_COUNT: "1",
                GIT_CONFIG_KEY_0: `url.file://${join(this.rootDir, "github")}/.insteadOf`,
                GIT_CONFIG_VALUE_0: "https://github.com/",
            },
        });
        this.process = child;
        await new Promise<void>((resolve, reject) => {
            child.stdout?.on("data", (chunk: Buffer) => chunk.toString().includes("listening") && resolve());
            child.once("exit", (code) => reject(new Error(`The controller exited with ${String(code)}`)));
        });
    }

    async stop(): Promise<void> {
        const child = this.process;
        if (child && child.exitCode === null && child.signalCode === null) {
            await new Promise((resolve) => child.once("exit", resolve).kill());
        }
    }

    async dispose(): Promise<void> {
        await this.stop();
        await rm(this.rootDir, { recursive: true, force: true });
    }
}
