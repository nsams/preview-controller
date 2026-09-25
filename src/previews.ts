import { appendFile, mkdir, open, readdir, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";

import type { Config } from "./config.ts";
import { composeDown, composeLogs, composeServices, composeStart, composeStop, discoverComposeProjects } from "./docker.ts";
import type { ComposeProjectState } from "./docker.ts";
import { describeError, run } from "./exec.ts";
import { checkoutBranch, readCheckout, type Checkout } from "./git.ts";
import { createSlug, repositoryUrl, validateRepositoryRef, type RepositoryRef } from "./repository.ts";

export type PreviewStatus = "stopped" | "starting" | "running" | "failed";

export type PreviewUrl = {
    name: string;
    url: string;
};

export type Preview = {
    slug: string;
    /** Undefined when docker knows the preview but its checkout is gone. */
    ref?: RepositoryRef;
    commit?: string;
    /** What the project reported about itself, empty until it has been started once. */
    urls: PreviewUrl[];
    port?: number;
    status: PreviewStatus;
    error?: string;
    createdAt?: number;
    startedAt?: number;
    /** Since when the preview is stopped, which is what the cleanup goes by. */
    stoppedAt?: number;
    lastAccessAt: number;
};

export class PreviewError extends Error {}

export function describeRef(preview: Preview): string {
    return preview.ref ? `${preview.ref.org}/${preview.ref.repo} @ ${preview.ref.branch}` : "repository unknown";
}

const composeProjectPrefix = "preview-";

/** The script a repository has to provide, see the readme. */
const startScriptName = "start-preview.sh";

/** Written by the start script of a project, read back on every discovery. */
const urlsFileName = ".preview-urls";
const maxUrls = 20;

/**
 * The little bit of state that neither docker nor a checkout can answer: when a preview was last
 * requested, what a failed start said, and the port of a preview that has no containers yet.
 * It is deliberately not persisted - after a restart every running preview simply gets a fresh
 * idle period, which is cheaper than wrongly stopping everything.
 */
type RuntimeState = {
    lastAccessAt: number;
    ref?: RepositoryRef;
    port?: number;
    failure?: string;
};

export class PreviewRegistry {
    private readonly config: Config;
    private readonly runtime = new Map<string, RuntimeState>();
    private readonly pending = new Map<string, Promise<void>>();
    private projects = new Map<string, ComposeProjectState>();
    /** False while docker could not be reached, which must not be read as "nothing is running". */
    private projectsKnown = false;
    private checkouts = new Map<string, DiscoveredCheckout>();
    private readonly logDir: string;
    private readonly checkoutDir: string;

    constructor(config: Config) {
        this.config = config;
        this.logDir = join(config.dataDir, "logs");
        this.checkoutDir = join(config.dataDir, "checkouts");
    }

    async init(): Promise<void> {
        await mkdir(this.logDir, { recursive: true });
        await mkdir(this.checkoutDir, { recursive: true });
        await this.refresh();
    }

    /** Re-reads what docker and the checkouts say. Everything else is derived from that. */
    async refresh(): Promise<void> {
        const [projects, checkouts] = await Promise.all([
            discoverComposeProjects(composeProjectPrefix).catch((error: unknown) => {
                console.error(`Could not read compose projects: ${describeError(error)}`);
                return undefined;
            }),
            this.readCheckouts(),
        ]);
        if (projects) {
            this.projects = projects;
            this.projectsKnown = true;
        }
        this.checkouts = checkouts;
    }

    private async readCheckouts(): Promise<Map<string, DiscoveredCheckout>> {
        const checkouts = new Map<string, DiscoveredCheckout>();
        const entries = await readdir(this.checkoutDir, { withFileTypes: true }).catch(() => []);
        await Promise.all(
            entries
                .filter((entry) => entry.isDirectory())
                .map(async (entry) => {
                    const directory = join(this.checkoutDir, entry.name);
                    const checkout = await readCheckout(directory);
                    if (checkout) {
                        const [urls, stats] = await Promise.all([readUrls(join(directory, urlsFileName)), stat(directory).catch(() => undefined)]);
                        checkouts.set(entry.name, { ...checkout, urls, updatedAt: stats?.mtimeMs });
                    }
                }),
        );
        return checkouts;
    }

    private slugs(): Set<string> {
        return new Set([
            ...[...this.projects.keys()].map((project) => project.slice(composeProjectPrefix.length)),
            ...this.checkouts.keys(),
            ...this.runtime.keys(),
        ]);
    }

    private build(slug: string): Preview {
        const runtime = this.runtime.get(slug);
        const checkout = this.checkouts.get(slug);
        const project = this.projects.get(`${composeProjectPrefix}${slug}`);

        let status: PreviewStatus = "stopped";
        if (this.pending.has(slug)) {
            status = "starting";
        } else if (runtime?.failure) {
            status = "failed";
        } else if (project?.isRunning) {
            status = "running";
        }

        return {
            slug,
            ref: checkout?.ref ?? runtime?.ref,
            commit: checkout?.commit,
            urls: checkout?.urls ?? [],
            port: project?.port ?? runtime?.port,
            status,
            error: runtime?.failure,
            createdAt: project?.createdAt,
            startedAt: status === "running" ? project?.startedAt : undefined,
            // A preview that never got as far as creating containers falls back to its checkout.
            stoppedAt: status === "stopped" ? (project?.stoppedAt ?? checkout?.updatedAt) : undefined,
            lastAccessAt: this.runtimeFor(slug).lastAccessAt,
        };
    }

    /** Previews discovered for the first time count as accessed now, not as idle forever. */
    private runtimeFor(slug: string): RuntimeState {
        let runtime = this.runtime.get(slug);
        if (!runtime) {
            runtime = { lastAccessAt: Date.now() };
            this.runtime.set(slug, runtime);
        }
        return runtime;
    }

    list(): Preview[] {
        return [...this.slugs()].map((slug) => this.build(slug)).sort((a, b) => a.slug.localeCompare(b.slug));
    }

    get(slug: string): Preview | undefined {
        return this.slugs().has(slug) ? this.build(slug) : undefined;
    }

    urlOf(preview: Preview): string {
        return `${this.config.scheme}://${this.hostOf(preview)}`;
    }

    hostOf(preview: Preview): string {
        const needsPort = (this.config.scheme === "http" && this.config.port !== 80) || (this.config.scheme === "https" && this.config.port !== 443);
        return needsPort ? `${preview.slug}.${this.config.baseDomain}:${this.config.port}` : `${preview.slug}.${this.config.baseDomain}`;
    }

    touch(slug: string): void {
        this.runtimeFor(slug).lastAccessAt = Date.now();
    }

    /**
     * Returns the preview for a repository and branch, creating and starting it if necessary.
     * Starting happens in the background - the caller gets the record right away.
     */
    async request(ref: RepositoryRef): Promise<Preview> {
        const problem = validateRepositoryRef(ref);
        if (problem) {
            throw new PreviewError(problem);
        }

        const slug = createSlug(ref);
        const runtime = this.runtimeFor(slug);
        runtime.ref = ref;
        runtime.lastAccessAt = Date.now();
        runtime.port ??= this.projects.get(`${composeProjectPrefix}${slug}`)?.port ?? (await this.allocatePort());

        this.startInBackground(this.build(slug));
        return this.build(slug);
    }

    /** Starts a preview unless it is already running or starting. Never throws. */
    startInBackground(preview: Preview): void {
        const runtime = this.runtimeFor(preview.slug);
        const ref = preview.ref ?? runtime.ref;
        if (preview.status === "running" || this.pending.has(preview.slug) || !ref) {
            return;
        }
        runtime.failure = undefined;
        const task = this.start(preview.slug, ref)
            .catch(async (error: unknown) => {
                runtime.failure = describeError(error);
                console.error(`Starting ${preview.slug} failed: ${runtime.failure}`);
                await this.log(preview.slug, `FAILED: ${runtime.failure}`);
            })
            .finally(async () => {
                this.pending.delete(preview.slug);
                await this.refresh();
            });
        this.pending.set(preview.slug, task);
    }

    private async start(slug: string, ref: RepositoryRef): Promise<void> {
        const directory = join(this.checkoutDir, slug);
        const runtime = this.runtimeFor(slug);
        runtime.port ??= await this.allocatePort();

        await this.log(slug, `--- starting ${slug} (${ref.org}/${ref.repo} @ ${ref.branch}) ---`);

        await this.log(slug, "checking out...");
        await checkoutBranch(repositoryUrl(ref), ref.branch, directory, this.config.githubToken);

        // Everything project specific lives in that script. All the controller asks for is a
        // compose project of the given name that publishes the given port.
        await this.log(slug, `running ${startScriptName}...`);
        const { stdout, stderr } = await run(join(directory, startScriptName), [], {
            cwd: directory,
            env: this.startEnv(slug, runtime.port),
        });
        await this.log(slug, `${stdout}${stderr}`.trim());

        runtime.lastAccessAt = Date.now();
        await this.log(slug, `--- ${slug} is up on port ${runtime.port} ---`);
    }

    async stop(slug: string): Promise<void> {
        this.require(slug);
        await this.pending.get(slug)?.catch(() => undefined);
        await composeStop(composeProject(slug));
        await this.refresh();
    }

    async remove(slug: string): Promise<void> {
        this.require(slug);
        await this.pending.get(slug)?.catch(() => undefined);
        await composeDown(composeProject(slug)).catch((error: unknown) => {
            console.error(`Could not remove containers of ${slug}: ${describeError(error)}`);
        });
        await rm(join(this.checkoutDir, slug), { recursive: true, force: true });
        this.runtime.delete(slug);
        await this.refresh();
    }

    /** Resumes a stopped preview. Much faster than a full start, because the images exist. */
    resumeInBackground(preview: Preview): void {
        if (preview.status === "running" || this.pending.has(preview.slug)) {
            return;
        }
        const task = composeStart(composeProject(preview.slug))
            .then(async () => {
                this.runtimeFor(preview.slug).lastAccessAt = Date.now();
                await this.log(preview.slug, `--- ${preview.slug} resumed ---`);
            })
            .catch(async (error: unknown) => {
                // The containers may be gone, so fall back to a full start.
                console.error(`Resuming ${preview.slug} failed, starting from scratch: ${describeError(error)}`);
                this.pending.delete(preview.slug);
                await this.refresh();
                this.startInBackground(this.build(preview.slug));
            })
            .finally(async () => {
                this.pending.delete(preview.slug);
                await this.refresh();
            });
        this.pending.set(preview.slug, task);
    }

    async stopIdlePreviews(): Promise<void> {
        const deadline = Date.now() - this.config.idleTimeoutMinutes * 60 * 1000;
        for (const preview of this.list()) {
            if (preview.status !== "running" || preview.lastAccessAt > deadline) {
                continue;
            }
            console.log(`Stopping ${preview.slug} after ${this.config.idleTimeoutMinutes} minutes without a request`);
            await this.stop(preview.slug).catch((error: unknown) => {
                console.error(`Could not stop ${preview.slug}: ${describeError(error)}`);
            });
        }
    }

    /**
     * Removes previews that have been stopped for too long, which is what frees the disk space
     * their images, volumes and checkout take. Skipped entirely while docker is unreachable,
     * because then everything only looks stopped.
     */
    async removeExpiredPreviews(): Promise<void> {
        if (this.config.removeAfterDays === 0 || !this.projectsKnown) {
            return;
        }
        const deadline = Date.now() - this.config.removeAfterDays * 24 * 60 * 60 * 1000;
        for (const preview of this.list()) {
            if (preview.status !== "stopped" || !preview.stoppedAt || preview.stoppedAt > deadline) {
                continue;
            }
            console.log(`Removing ${preview.slug} after ${this.config.removeAfterDays} days without being started`);
            await this.remove(preview.slug).catch((error: unknown) => {
                console.error(`Could not remove ${preview.slug}: ${describeError(error)}`);
            });
        }
    }

    /** The steps the controller logged while checking out, building and starting a preview. */
    async readStartLog(slug: string, maxBytes = 64 * 1024): Promise<string> {
        return tail(join(this.logDir, `${slug}.log`), maxBytes);
    }

    /** The output of the containers of a preview. */
    async readContainerLogs(slug: string, options: { tail: number; service?: string }): Promise<string> {
        this.require(slug);
        return composeLogs(composeProject(slug), options);
    }

    async listServices(slug: string): Promise<string[]> {
        return this.get(slug) ? composeServices(composeProject(slug)) : [];
    }

    composeProject(preview: Preview): string {
        return composeProject(preview.slug);
    }

    private require(slug: string): Preview {
        const preview = this.get(slug);
        if (!preview) {
            throw new PreviewError(`Unknown preview "${slug}"`);
        }
        return preview;
    }

    /** The url a preview should be opened at, which the project may override. */
    primaryUrlOf(preview: Preview): string {
        return preview.urls[0]?.url ?? this.urlOf(preview);
    }

    /** What the start script of a project gets to work with. */
    private startEnv(slug: string, port: number): Record<string, string> {
        return {
            COMPOSE_PROJECT_NAME: composeProject(slug),
            PREVIEW_SLUG: slug,
            PREVIEW_URLS: join(this.checkoutDir, slug, urlsFileName),
            PREVIEW_PORT: String(port),
            PREVIEW_DOMAIN: `${slug}.${this.config.baseDomain}`,
            PREVIEW_HOST: this.hostOf({ slug } as Preview),
            PREVIEW_SCHEME: this.config.scheme,
        };
    }

    private async allocatePort(): Promise<number> {
        const taken = new Set([
            ...[...this.projects.values()].map((project) => project.port),
            ...[...this.runtime.values()].map((runtime) => runtime.port),
        ]);
        for (let port = this.config.portRange.from; port <= this.config.portRange.to; port++) {
            if (!taken.has(port) && (await isPortFree(port))) {
                return port;
            }
        }
        throw new PreviewError("No free port left in the configured range");
    }

    private async log(slug: string, message: string): Promise<void> {
        await appendFile(join(this.logDir, `${slug}.log`), `[${new Date().toISOString()}] ${message}\n`).catch(() => undefined);
    }
}

type DiscoveredCheckout = Checkout & { urls: PreviewUrl[]; updatedAt?: number };

function composeProject(slug: string): string {
    return `${composeProjectPrefix}${slug}`;
}

/**
 * Reads the "<name>=<url>" lines a project wrote about itself. The urls end up in href
 * attributes, so only http and https are accepted.
 */
async function readUrls(path: string): Promise<PreviewUrl[]> {
    const content = await readFile(path, "utf8").catch(() => "");
    const urls: PreviewUrl[] = [];
    for (const line of content.split("\n")) {
        const separator = line.indexOf("=");
        if (separator <= 0 || urls.length >= maxUrls) {
            continue;
        }
        const name = line.slice(0, separator).trim().slice(0, 40);
        const url = line.slice(separator + 1).trim();
        if (name && /^https?:\/\/[^\s]+$/.test(url)) {
            urls.push({ name, url });
        }
    }
    return urls;
}

/** Reads the last bytes of a file, so a long running preview cannot blow up the response. */
async function tail(path: string, maxBytes: number): Promise<string> {
    let handle;
    try {
        handle = await open(path, "r");
    } catch {
        return "";
    }
    try {
        const { size } = await handle.stat();
        const start = Math.max(0, size - maxBytes);
        const buffer = Buffer.alloc(size - start);
        await handle.read(buffer, 0, buffer.length, start);
        const content = buffer.toString("utf8");
        return start > 0 ? content.slice(content.indexOf("\n") + 1) : content;
    } finally {
        await handle.close();
    }
}

function isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = createServer();
        server.once("error", () => resolve(false));
        server.once("listening", () => server.close(() => resolve(true)));
        server.listen(port, "127.0.0.1");
    });
}
