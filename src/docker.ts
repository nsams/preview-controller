import { run, runStreaming } from "./exec.ts";

export type ContainerUsage = {
    containers: number;
    cpuPercent: number;
    memoryBytes: number;
};

const composeProjectLabel = "com.docker.compose.project";
const composeServiceLabel = "com.docker.compose.service";

/**
 * Once a preview is up, compose can address its project by name alone - it reconstructs
 * everything it needs from the labels of the containers. The controller therefore never needs
 * to know which compose file the project was started from.
 */
async function compose(project: string, args: string[], timeoutMs = 5 * 60 * 1000): Promise<string> {
    const { stdout, stderr } = await run("docker", ["compose", "-p", project, ...args], { timeoutMs });
    return stdout + stderr;
}

export async function composeStart(project: string): Promise<void> {
    await compose(project, ["start"]);
}

export async function composeStop(project: string): Promise<void> {
    await compose(project, ["stop"]);
}

export async function composeRestart(project: string): Promise<void> {
    await compose(project, ["restart"]);
}

export async function composeDown(project: string): Promise<void> {
    // --rmi local also drops the images that were built for this preview, which is where
    // most of the disk space of a preview sits.
    await compose(project, ["down", "--volumes", "--remove-orphans", "--rmi", "local"]);
}

type LogOptions = { tail: number; service?: string; sinceSeconds?: number };

function logArgs(options: LogOptions, { shouldFollow = false } = {}): string[] {
    const args = ["logs", "--no-color", "--timestamps", "--tail", String(options.tail), ...(shouldFollow ? ["--follow"] : [])];
    // Relative and not a timestamp: docker resolves it against its own clock, so the window does
    // not shift when the daemon runs in a vm whose clock drifts from the host - as on docker
    // desktop. It has to come before the service, which is positional.
    if (options.sinceSeconds !== undefined) {
        args.push("--since", `${options.sinceSeconds}s`);
    }
    if (options.service) {
        args.push(options.service);
    }
    return args;
}

export async function composeLogs(project: string, options: LogOptions): Promise<string> {
    return compose(project, logArgs(options), 60_000);
}

/**
 * The same as composeLogs, followed until the containers are gone or the signal aborts. Compose
 * ends it on its own once no container of the project is running anymore. Without a timeout, a
 * log page can stay open for as long as someone keeps reading it.
 */
export async function followComposeLogs(
    project: string,
    options: LogOptions & { onLine: (line: string) => void; signal: AbortSignal },
): Promise<void> {
    await runStreaming("docker", ["compose", "-p", project, ...logArgs(options, { shouldFollow: true })], {
        onLine: options.onLine,
        signal: options.signal,
        timeoutMs: 0,
    });
}

/** How a service of a preview is doing, as far as someone reading its logs cares. */
type ServiceStatus = "running" | "starting" | "stopped" | "failed";

export type ServiceState = {
    name: string;
    status: ServiceStatus;
    /** Short enough to sit in a chip, e.g. "restarting (exit 1)", "exited (1)", "unhealthy". */
    detail: string;
};

/** Which state wins when a service has several containers: the worst one describes the service. */
const statusSeverity: Record<ServiceStatus, number> = { failed: 3, starting: 2, running: 1, stopped: 0 };

/**
 * A crash looping container is the case worth catching. Compose restarts it, so the project stays
 * "up" while one of its services never comes out of its restart loop - which is why "restarting"
 * counts as failed here and not as "on its way up".
 */
function containerState(state: string, exitCode: number, health: string): { status: ServiceStatus; detail: string } {
    if (health === "unhealthy") {
        return { status: "failed", detail: "unhealthy" };
    }
    switch (state) {
        case "running":
            return health === "starting" ? { status: "starting", detail: "starting" } : { status: "running", detail: "running" };
        case "created":
            return { status: "starting", detail: "created" };
        case "restarting":
            return { status: "failed", detail: exitCode === 0 ? "restarting" : `restarting (exit ${exitCode})` };
        case "dead":
            return { status: "failed", detail: "dead" };
        case "exited":
        case "removing":
            return exitCode === 0 ? { status: "stopped", detail: "exited (0)" } : { status: "failed", detail: `exited (${exitCode})` };
        default:
            return { status: "stopped", detail: state || "unknown" };
    }
}

/**
 * The services of one project together with the state of their containers. Like
 * discoverComposeProjects this goes through the container labels rather than `compose ps`, because
 * the states it needs - the exit code and the health - are only in the container itself.
 */
export async function composeServiceStates(project: string): Promise<ServiceState[]> {
    const { stdout: ids } = await run("docker", ["ps", "--all", "--quiet", "--filter", `label=${composeProjectLabel}=${project}`], {
        timeoutMs: 30_000,
    });
    const containerIds = ids.split("\n").filter((id) => id.trim().length > 0);
    if (containerIds.length === 0) {
        return [];
    }

    const format = [
        `{{index .Config.Labels "${composeServiceLabel}"}}`,
        "{{.State.Status}}",
        "{{.State.ExitCode}}",
        // Containers without a health check have no Health object at all.
        "{{if .State.Health}}{{.State.Health.Status}}{{end}}",
    ].join("\t");
    const { stdout } = await run("docker", ["inspect", "--format", format, ...containerIds], { timeoutMs: 60_000 });

    const services = new Map<string, ServiceState>();
    for (const line of stdout.split("\n")) {
        const [name, state, exitCode, health] = line.split("\t");
        if (!name) {
            continue;
        }
        const { status, detail } = containerState(state ?? "", Number(exitCode) || 0, health ?? "");
        const current = services.get(name);
        if (!current || statusSeverity[status] > statusSeverity[current.status]) {
            services.set(name, { name, status, detail });
        }
    }
    return [...services.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type ComposeProjectState = {
    project: string;
    isRunning: boolean;
    port?: number;
    createdAt?: number;
    startedAt?: number;
    /** When the last container of a stopped project exited. */
    stoppedAt?: number;
};

function parseTimestamp(value: string): number | undefined {
    const time = Date.parse(value);
    // Docker writes a zero date for containers that were never started.
    return Number.isFinite(time) && time > 0 ? time : undefined;
}

function parsePublishedPort(portBindings: string): number | undefined {
    for (const bindings of Object.values(JSON.parse(portBindings || "{}") as Record<string, { HostPort?: string }[] | null>)) {
        for (const binding of bindings ?? []) {
            const port = Number(binding.HostPort);
            if (Number.isInteger(port) && port > 0) {
                return port;
            }
        }
    }
    return undefined;
}

/**
 * Everything docker knows about the compose projects whose name starts with the given prefix,
 * including the ones that are currently stopped.
 */
export async function discoverComposeProjects(prefix: string): Promise<Map<string, ComposeProjectState>> {
    const { stdout: ids } = await run("docker", ["ps", "--all", "--quiet", "--filter", `label=${composeProjectLabel}`], { timeoutMs: 30_000 });
    const containerIds = ids.split("\n").filter((id) => id.trim().length > 0);
    if (containerIds.length === 0) {
        return new Map();
    }

    const format = [
        `{{index .Config.Labels "${composeProjectLabel}"}}`,
        "{{.State.Status}}",
        "{{.Created}}",
        "{{.State.StartedAt}}",
        "{{.State.FinishedAt}}",
        "{{json .HostConfig.PortBindings}}",
    ].join("\t");
    const { stdout } = await run("docker", ["inspect", "--format", format, ...containerIds], { timeoutMs: 60_000 });

    const projects = new Map<string, ComposeProjectState>();
    for (const line of stdout.split("\n")) {
        const [project, state, created, started, finished, portBindings] = line.split("\t");
        if (!project?.startsWith(prefix)) {
            continue;
        }
        const current = projects.get(project) ?? { project, isRunning: false };
        current.isRunning ||= state === "running";
        current.port ??= parsePublishedPort(portBindings ?? "");

        const createdAt = parseTimestamp(created ?? "");
        if (createdAt && (!current.createdAt || createdAt < current.createdAt)) {
            current.createdAt = createdAt;
        }
        const startedAt = state === "running" ? parseTimestamp(started ?? "") : undefined;
        if (startedAt && (!current.startedAt || startedAt < current.startedAt)) {
            current.startedAt = startedAt;
        }
        // The project counts as stopped since its last container went away.
        const stoppedAt = parseTimestamp(finished ?? "");
        if (stoppedAt && (!current.stoppedAt || stoppedAt > current.stoppedAt)) {
            current.stoppedAt = stoppedAt;
        }
        projects.set(project, current);
    }
    return projects;
}

function parseMemory(value: string): number {
    const match = /^([\d.]+)\s*([A-Za-z]*)$/.exec(value.trim());
    if (!match) {
        return 0;
    }
    const factors: Record<string, number> = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3 };
    return Number(match[1]) * (factors[match[2].toLowerCase()] ?? 1);
}

/**
 * Current cpu and memory usage per compose project. Docker reports this per container, so the
 * container ids first have to be mapped to their compose project.
 */
export async function readUsageByComposeProject(): Promise<Map<string, ContainerUsage>> {
    const [containers, stats] = await Promise.all([
        run("docker", ["ps", "--format", `{{.ID}}\t{{.Label "${composeProjectLabel}"}}`], { timeoutMs: 30_000 }),
        run("docker", ["stats", "--no-stream", "--format", "{{.ID}}\t{{.CPUPerc}}\t{{.MemUsage}}"], { timeoutMs: 60_000 }),
    ]);

    const projectByContainer = new Map<string, string>();
    for (const line of containers.stdout.split("\n")) {
        const [id, project] = line.split("\t");
        if (id && project) {
            projectByContainer.set(id.trim(), project.trim());
        }
    }

    const usage = new Map<string, ContainerUsage>();
    for (const line of stats.stdout.split("\n")) {
        const [id, cpu, memory] = line.split("\t");
        if (!id) {
            continue;
        }
        const project = projectByContainer.get(id.trim());
        if (!project) {
            continue;
        }
        const current = usage.get(project) ?? { containers: 0, cpuPercent: 0, memoryBytes: 0 };
        current.containers += 1;
        current.cpuPercent += Number.parseFloat(cpu?.replace("%", "") ?? "0") || 0;
        current.memoryBytes += parseMemory(memory?.split("/")[0] ?? "0");
        usage.set(project, current);
    }
    return usage;
}
