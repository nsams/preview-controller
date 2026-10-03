import { execFile, spawn, type ChildProcess } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const supportDir = dirname(fileURLToPath(import.meta.url));
const projectDir = join(supportDir, "..", "..");
const fixtureProjectDir = join(supportDir, "..", "fixture-project");

export const password = "e2e-test-password";
export const baseDomain = "preview.localhost";

/** A file of the fixture project as every new branch starts out with it. */
export function fixtureFile(name: string): Promise<string> {
    return readFile(join(fixtureProjectDir, name), "utf8");
}

/** Identity for the commits of the fixture repositories, independent of the git config of the host. */
const gitEnv = {
    GIT_AUTHOR_NAME: "e2e",
    GIT_AUTHOR_EMAIL: "e2e@example.com",
    GIT_COMMITTER_NAME: "e2e",
    GIT_COMMITTER_EMAIL: "e2e@example.com",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
};

async function git(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", args, { cwd, env: { ...process.env, ...gitEnv } });
    return stdout.trim();
}

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
        });
    });
}

export type Response = {
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
};

/**
 * Talks http to the controller. Subdomains of localhost resolve in browsers but not necessarily
 * in node, so this connects to 127.0.0.1 and only puts the host of the url into the Host header.
 */
export class Client {
    cookie: string | undefined;
    private readonly port: number;

    constructor(port: number) {
        this.port = port;
    }

    request(url: string, options: { method?: string; form?: Record<string, string>; headers?: Record<string, string> } = {}): Promise<Response> {
        const target = new URL(url);
        const body = options.form ? new URLSearchParams(options.form).toString() : undefined;
        const headers: Record<string, string> = { host: target.host, ...options.headers };
        if (body !== undefined) {
            headers["content-type"] = "application/x-www-form-urlencoded";
            headers["content-length"] = String(Buffer.byteLength(body));
        }
        if (this.cookie) {
            headers.cookie = headers.cookie ? `${headers.cookie}; ${this.cookie}` : this.cookie;
        }
        return new Promise((resolve, reject) => {
            const outgoing = httpRequest(
                { host: "127.0.0.1", port: this.port, method: options.method ?? "GET", path: `${target.pathname}${target.search}`, headers },
                (incoming) => {
                    let text = "";
                    incoming.setEncoding("utf8");
                    incoming.on("data", (chunk: string) => (text += chunk));
                    incoming.on("end", () => resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body: text }));
                },
            );
            outgoing.on("error", reject);
            outgoing.end(body);
        });
    }

    async login(): Promise<Response> {
        const response = await this.request(`http://${baseDomain}/__preview-controller/login`, { method: "POST", form: { password } });
        const setCookie = response.headers["set-cookie"]?.[0];
        if (response.status !== 303 || !setCookie) {
            throw new Error(`Signing in failed with ${response.status}: ${response.body}`);
        }
        this.cookie = setCookie.split(";")[0];
        return response;
    }
}

/**
 * A repository on the fake GitHub: a bare repository on disk, which the controller reaches as
 * https://github.com/<org>/<repo>.git through a git url rewrite in its environment.
 */
export class FixtureRepository {
    readonly org: string;
    readonly repo: string;
    private readonly workDir: string;

    private constructor(org: string, repo: string, workDir: string) {
        this.org = org;
        this.repo = repo;
        this.workDir = workDir;
    }

    static async create(reposDir: string, org: string, repo: string): Promise<FixtureRepository> {
        const bareDir = join(reposDir, org, `${repo}.git`);
        const workDir = join(reposDir, "work", org, repo);
        await mkdir(bareDir, { recursive: true });
        await git(bareDir, ["init", "--bare", "--quiet", "--initial-branch", "main"]);
        await mkdir(workDir, { recursive: true });
        await git(workDir, ["init", "--quiet", "--initial-branch", "template"]);
        await git(workDir, ["remote", "add", "origin", bareDir]);
        await cp(fixtureProjectDir, workDir, { recursive: true });
        await git(workDir, ["add", "--all"]);
        await git(workDir, ["commit", "--quiet", "--message", "Fixture project"]);
        const repository = new FixtureRepository(org, repo, workDir);
        await repository.push("main");
        return repository;
    }

    /**
     * Commits the given files on top of a branch and pushes it. A branch that does not exist yet
     * starts from the fixture project. Returns the short hash, as the controller shows it.
     */
    async push(branch: string, files: Record<string, string> = {}): Promise<string> {
        const exists = (await git(this.workDir, ["ls-remote", "--heads", "origin", branch])).length > 0;
        if (exists) {
            await git(this.workDir, ["fetch", "--quiet", "origin", branch]);
        }
        await git(this.workDir, ["checkout", "--quiet", "--force", "-B", branch, exists ? "FETCH_HEAD" : "template"]);
        for (const [name, content] of Object.entries(files)) {
            await writeFile(join(this.workDir, name), content);
            if (name.endsWith(".sh")) {
                await chmod(join(this.workDir, name), 0o755);
            }
        }
        await git(this.workDir, ["add", "--all"]);
        await git(this.workDir, ["commit", "--quiet", "--allow-empty", "--message", `Update ${branch}`]);
        await git(this.workDir, ["push", "--quiet", "--force", "origin", `HEAD:refs/heads/${branch}`]);
        return git(this.workDir, ["rev-parse", "--short", "HEAD"]);
    }
}

export type PreviewJson = {
    slug: string;
    ref?: { org: string; repo: string; branch: string };
    commit?: string;
    urls: { name: string; url: string }[];
    port?: number;
    status: "stopped" | "starting" | "running" | "failed";
    error?: string;
    url: string;
};

/**
 * One controller process with everything it talks to replaced: docker by fake-docker.ts, GitHub
 * by bare repositories on disk. Each test worker gets its own, so they can run in parallel.
 */
export class Controller {
    readonly port: number;
    readonly url: string;
    readonly dataDir: string;
    readonly reposDir: string;
    private readonly rootDir: string;
    private readonly env: NodeJS.ProcessEnv;
    private process: ChildProcess | undefined;
    private output = "";

    private constructor(rootDir: string, port: number, previewPorts: { from: number; to: number }) {
        this.rootDir = rootDir;
        this.port = port;
        this.url = `http://${baseDomain}:${port}`;
        this.dataDir = join(rootDir, "data");
        this.reposDir = join(rootDir, "repos");
        this.env = {
            ...process.env,
            PATH: `${join(supportDir, "bin")}:${process.env.PATH ?? ""}`,
            FAKE_DOCKER_DIR: join(rootDir, "docker"),
            PREVIEW_CONTROLLER_PORT: String(port),
            PREVIEW_CONTROLLER_BASE_DOMAIN: baseDomain,
            PREVIEW_CONTROLLER_SCHEME: "http",
            PREVIEW_CONTROLLER_PASSWORD: password,
            PREVIEW_CONTROLLER_PORT_RANGE: `${previewPorts.from}-${previewPorts.to}`,
            PREVIEW_CONTROLLER_DATA_DIR: this.dataDir,
            PREVIEW_CONTROLLER_GITHUB_TOKEN: "",
            // Clones and fetches of https://github.com/<org>/<repo>.git end up in the bare repositories.
            GIT_CONFIG_COUNT: "1",
            GIT_CONFIG_KEY_0: `url.file://${this.reposDir}/.insteadOf`,
            GIT_CONFIG_VALUE_0: "https://github.com/",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_TERMINAL_PROMPT: "0",
        };
    }

    static async start(workerIndex: number): Promise<Controller> {
        const rootDir = await mkdtemp(join(tmpdir(), "preview-controller-e2e-"));
        // Separate ranges per worker, so that parallel controllers do not hand out the same port.
        const from = 32000 + workerIndex * 50;
        const controller = new Controller(rootDir, await freePort(), { from, to: from + 49 });
        await mkdir(controller.reposDir, { recursive: true });
        await controller.launch();
        return controller;
    }

    /** The output of the controller so far, which is what a failing test wants to see. */
    get log(): string {
        return this.output;
    }

    async launch(): Promise<void> {
        const child = spawn(process.execPath, ["--no-warnings", join(projectDir, "src", "index.ts")], {
            cwd: projectDir,
            env: this.env,
            stdio: ["ignore", "pipe", "pipe"],
        });
        this.process = child;
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error(`The controller did not come up:\n${this.output}`)), 15_000);
            const onData = (chunk: Buffer) => {
                this.output += chunk.toString();
                if (this.output.includes("preview-controller listening")) {
                    clearTimeout(timeout);
                    resolve();
                }
            };
            child.stdout?.on("data", onData);
            child.stderr?.on("data", onData);
            child.once("exit", (code) => {
                clearTimeout(timeout);
                reject(new Error(`The controller exited with ${String(code)}:\n${this.output}`));
            });
        });
    }

    /** Stops the controller process only, the previews and their checkouts stay. */
    async kill(): Promise<void> {
        const child = this.process;
        if (!child || child.exitCode !== null) {
            return;
        }
        await new Promise<void>((resolve) => {
            child.once("exit", () => resolve());
            child.kill("SIGTERM");
        });
    }

    async dispose(): Promise<void> {
        await this.kill();
        // No fixture app may outlive the tests.
        await this.docker(["__kill-all"]).catch(() => undefined);
        await rm(this.rootDir, { recursive: true, force: true });
    }

    /** Runs the fake docker the controller sees, to change things behind its back. */
    async docker(args: string[]): Promise<string> {
        const { stdout } = await execFileAsync(join(supportDir, "bin", "docker"), args, { env: this.env });
        return stdout;
    }

    client(): Client {
        return new Client(this.port);
    }

    previewUrl(slug: string, name?: string): string {
        return `http://${name ? `${name}--` : ""}${slug}.${baseDomain}:${this.port}`;
    }

    createRepository(org: string, repo: string): Promise<FixtureRepository> {
        return FixtureRepository.create(this.reposDir, org, repo);
    }
}
