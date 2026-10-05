import { appendFile, mkdir, open, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";

import type { Config } from "./config.ts";
import { composeDown, composeLogs, composeRestart, composeServiceStates, composeStart, composeStop, discoverComposeProjects } from "./docker.ts";
import type { ComposeProjectState, ServiceState } from "./docker.ts";
import { describeError, runStreaming } from "./exec.ts";
import { checkoutBranch, readCheckout, type Checkout } from "./git.ts";
import { createSlug, defaultStartScript, normalizeScript, repositoryUrl, validateRepositoryRef, type RepositoryRef } from "./repository.ts";

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
    return preview.ref ? formatRef(preview.ref) : "repository unknown";
}

function formatRef(ref: RepositoryRef): string {
    return `${ref.org}/${ref.repo} @ ${ref.branch}${ref.script ? ` (${ref.script})` : ""}`;
}

const composeProjectPrefix = "preview-";

/**
 * The start script of a preview that does not use the default one. Git knows repository and branch
 * of a checkout, but not this, so it is kept next to it - untracked like the files below, which is
 * what lets it survive a restart of the controller.
 */
const scriptFileName = ".preview-script";

/** Written by the start script of a project, read back on every discovery. */
const urlsFileName = ".preview-urls";

/**
 * The commit the start script last ran through for. Written after it succeeded, next to the urls
 * it reported, and left alone by `git checkout --force` like every other untracked file - which is
 * what lets a later start tell whether the containers really belong to the checkout it sees.
 */
const startedCommitFileName = ".preview-commit";
const maxUrls = 20;

/**
 * Stops tsconfig lookups of a checkout at the checkout directory. Tools like ts-node search upwards
 * from the current directory, so a project without its own root tsconfig.json would otherwise pick
 * up the one of the preview controller and fail on its compiler options. CommonJS matches what such
 * a project would get from the compiler defaults anyway; projects that bring their own tsconfig.json
 * never reach this one.
 */
const checkoutBoundaryTsConfig = { compilerOptions: { module: "CommonJS" } };

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
    /** When the current attempt began, which is where the container logs are cut off. */
    startAttemptAt?: number;
};

type StartOptions = {
    ref: RepositoryRef;
    /** Whether the containers of an unchanged branch are restarted rather than only started. */
    shouldRestart: boolean;
    /** Builds even though the branch has not moved, which is what a failed attempt needs. */
    forceBuild: boolean;
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
    /** One chain per preview, so that streamed output stays in the order it arrived in. */
    private readonly logWrites = new Map<string, Promise<void>>();
    private readonly checkoutDir: string;

    constructor(config: Config) {
        this.config = config;
        this.logDir = join(config.dataDir, "logs");
        this.checkoutDir = join(config.dataDir, "checkouts");
    }

    async init(): Promise<void> {
        await mkdir(this.logDir, { recursive: true });
        await mkdir(this.checkoutDir, { recursive: true });
        await writeFile(join(this.checkoutDir, "tsconfig.json"), `${JSON.stringify(checkoutBoundaryTsConfig, null, 4)}\n`);
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
                        const [urls, script, stats] = await Promise.all([
                            readUrls(join(directory, urlsFileName)),
                            readFile(join(directory, scriptFileName), "utf8").then(normalizeScript, () => undefined),
                            stat(directory).catch(() => undefined),
                        ]);
                        const ref = { ...checkout.ref, script };
                        // A script file that has been tampered with would no longer belong to this slug.
                        if (script && (validateRepositoryRef(ref) || createSlug(ref) !== entry.name)) {
                            return;
                        }
                        checkouts.set(entry.name, { ...checkout, ref, urls, updatedAt: stats?.mtimeMs });
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
            // The one a start was requested for is the more recent, the script file of a fresh clone
            // is only written once the clone is through.
            ref: runtime?.ref ?? checkout?.ref,
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
        ref = { ...ref, script: normalizeScript(ref.script) };
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

    /**
     * Starts a preview unless it is already running or starting. Never throws - a failure ends up
     * in the status of the preview and in its log. A restart goes through the same path while the
     * preview is running, because fetching and rebuilding is exactly what it is for.
     */
    startInBackground(preview: Preview, { shouldRestart = false } = {}): void {
        const runtime = this.runtimeFor(preview.slug);
        const ref = preview.ref ?? runtime.ref;
        if ((preview.status === "running" && !shouldRestart) || this.pending.has(preview.slug) || !ref) {
            return;
        }
        // Nothing in git has changed since a start failed, so only forcing the build lets the step
        // that did not get through run again.
        const forceBuild = preview.status === "failed";
        runtime.failure = undefined;
        runtime.startAttemptAt = Date.now();
        const task = this.start(preview.slug, { ref, shouldRestart, forceBuild })
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

    private async start(slug: string, { ref, shouldRestart, forceBuild }: StartOptions): Promise<void> {
        const directory = join(this.checkoutDir, slug);
        const runtime = this.runtimeFor(slug);
        // Keeping the port of containers that already exist, so that a restart does not recreate
        // them somewhere else.
        runtime.port ??= this.projects.get(composeProject(slug))?.port ?? (await this.allocatePort());

        await this.resetLog(slug);
        await this.log(slug, `--- starting ${slug} (${formatRef(ref)}) ---`);

        await this.log(slug, "checking out...");
        const commit = await checkoutBranch(repositoryUrl(ref), ref.branch, directory, this.config.githubToken);
        if (ref.script) {
            await writeFile(join(directory, scriptFileName), `${ref.script}\n`);
        }

        // Building is what makes a start take minutes, and there is nothing to build when the
        // containers that are still there were built from exactly this commit: those are only
        // started again, which takes seconds. Anything else - a commit the start script never ran
        // through for, containers that are gone, an attempt that failed - runs the script, which
        // is also what reports the urls of the preview back and would otherwise go stale.
        const shouldBuild = forceBuild || (await this.startedCommit(slug)) !== commit || !this.projects.has(composeProject(slug));
        if (!shouldBuild) {
            await this.log(slug, `${ref.branch} is still at ${commit}, starting the containers it was built from...`);
            await (shouldRestart ? composeRestart : composeStart)(composeProject(slug));
        } else {
            // Everything project specific lives in that script. All the controller asks for is a
            // compose project of the given name that publishes the given port. Its output goes into
            // the log while it runs - pulling and building the images takes minutes, and until the
            // first container exists there is nothing else to look at.
            // Run from its own directory, which is where a script kept below the root expects its
            // compose file and everything else it brings along.
            const script = join(directory, ref.script ?? defaultStartScript);
            await this.log(slug, `running ${ref.script ?? defaultStartScript}...`);
            await runStreaming(script, [], {
                cwd: dirname(script),
                env: this.startEnv(slug, runtime.port),
                onLine: (line) => void this.write(slug, `${line}\n`),
            });
            await writeFile(join(directory, startedCommitFileName), `${commit}\n`);
        }

        runtime.lastAccessAt = Date.now();
        await this.log(slug, `--- ${slug} is up on port ${runtime.port} ---`);
    }

    /** The commit the start script of this preview last succeeded for, if it ever did. */
    private async startedCommit(slug: string): Promise<string | undefined> {
        return readFile(join(this.checkoutDir, slug, startedCommitFileName), "utf8").then(
            (content) => content.trim() || undefined,
            () => undefined,
        );
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
        await rm(join(this.logDir, `${slug}.log`), { force: true }).catch(() => undefined);
        this.runtime.delete(slug);
        this.logWrites.delete(slug);
        await this.refresh();
    }

    /**
     * Brings a preview up on the current state of its branch: fetch, rebuild, start. That is the
     * same path as a first start, so a preview never comes back showing code that has been pushed
     * over in the meantime, and it is why a restart of a running preview is also how it picks up
     * new commits - compose recreates only the containers that actually changed. Containers that
     * were already built from the commit the fetch leaves behind skip the build and are only
     * started, so waking such a preview takes seconds, while new commits cost the build they
     * invalidate - which is the point.
     * Only a preview whose checkout is gone is brought up the cheap way, from the containers docker
     * still has, because there is nothing left to build from.
     */
    resumeInBackground(preview: Preview, { shouldRestart = false } = {}): void {
        if ((preview.status === "running" && !shouldRestart) || this.pending.has(preview.slug)) {
            return;
        }
        const runtime = this.runtimeFor(preview.slug);
        if (preview.ref ?? runtime.ref) {
            this.startInBackground(preview, { shouldRestart });
            return;
        }

        runtime.failure = undefined;
        runtime.startAttemptAt = Date.now();
        const task = (shouldRestart ? composeRestart : composeStart)(composeProject(preview.slug))
            .then(async () => {
                runtime.lastAccessAt = Date.now();
                await this.log(preview.slug, `--- ${preview.slug} brought up without its checkout, code unchanged ---`);
            })
            .catch(async (error: unknown) => {
                runtime.failure = describeError(error);
                console.error(`Bringing ${preview.slug} up failed: ${runtime.failure}`);
                await this.log(preview.slug, `FAILED: ${runtime.failure}`);
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

    /**
     * The output of the containers of a preview, cut off at the start it belongs to. Compose only
     * recreates the containers that actually changed, so the ones it leaves alone would otherwise
     * still carry the output of the run before - which is exactly what a restart is meant to get
     * rid of. A preview the controller has not started itself has no cut-off and shows everything.
     */
    async readContainerLogs(slug: string, options: { tail: number; service?: string }): Promise<string> {
        this.require(slug);
        return composeLogs(composeProject(slug), { ...options, sinceSeconds: this.secondsSinceStartAttempt(slug) });
    }

    /** Undefined for a preview that was already running when the controller came up. */
    secondsSinceStartAttempt(slug: string): number | undefined {
        const startAttemptAt = this.runtime.get(slug)?.startAttemptAt;
        // Rounded up and never zero, so that output written in the same second still shows.
        return startAttemptAt === undefined ? undefined : Math.max(1, Math.ceil((Date.now() - startAttemptAt) / 1000));
    }

    async listServices(slug: string): Promise<ServiceState[]> {
        return this.get(slug) ? composeServiceStates(composeProject(slug)) : [];
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
        await this.write(slug, `[${new Date().toISOString()}] ${message}\n`);
    }

    /** Appends to the start log of a preview, one write after the other. */
    private write(slug: string, text: string): Promise<void> {
        const pending = (this.logWrites.get(slug) ?? Promise.resolve()).then(() =>
            appendFile(join(this.logDir, `${slug}.log`), text).catch(() => undefined),
        );
        this.logWrites.set(slug, pending);
        return pending;
    }

    /**
     * Drops what the previous start wrote, so that the log of a preview always shows its latest
     * run only. Queued like the writes themselves, so that output still in flight cannot end up
     * in the fresh log.
     */
    private resetLog(slug: string): Promise<void> {
        const pending = (this.logWrites.get(slug) ?? Promise.resolve()).then(() =>
            rm(join(this.logDir, `${slug}.log`), { force: true }).catch(() => undefined),
        );
        this.logWrites.set(slug, pending);
        return pending;
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
