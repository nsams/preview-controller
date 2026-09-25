import { run } from "./exec.ts";

export type ContainerUsage = {
    containers: number;
    cpuPercent: number;
    memoryBytes: number;
};

const composeProjectLabel = "com.docker.compose.project";

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

export async function composeDown(project: string): Promise<void> {
    // --rmi local also drops the images that were built for this preview, which is where
    // most of the disk space of a preview sits.
    await compose(project, ["down", "--volumes", "--remove-orphans", "--rmi", "local"]);
}

export async function composeLogs(project: string, options: { tail: number; service?: string }): Promise<string> {
    const args = ["logs", "--no-color", "--timestamps", "--tail", String(options.tail)];
    if (options.service) {
        args.push(options.service);
    }
    return compose(project, args, 60_000);
}

export async function composeServices(project: string): Promise<string[]> {
    const output = await compose(project, ["ps", "--all", "--services"], 30_000);
    return output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .sort();
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
