/**
 * Stands in for the docker cli during the end-to-end tests, so that they need neither a docker
 * daemon nor images. It knows exactly the commands the controller and the fixture project use.
 * A "container" is a local process, started through a small shim that writes its output with
 * timestamps to a log file and its exit code to a file once it ends, which is all that
 * `compose logs` and `inspect` need. Everything else lives in one state file in $FAKE_DOCKER_DIR.
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join, resolve } from "node:path";

type Container = {
    id: string;
    project: string;
    service: string;
    command: string[];
    cwd: string;
    environment: Record<string, string>;
    port?: number;
    /** Pid of the shim, which leads the process group of the container. */
    pid?: number;
    /** What the container was last told to be, see inspectState for what it actually is. */
    status: "created" | "running" | "exited";
    exitCode: number;
    createdAt: string;
    startedAt?: string;
    finishedAt?: string;
};

type State = { containers: Container[] };

type ComposeFile = {
    services: Record<string, { command: string[]; environment?: Record<string, string>; port?: string }>;
};

const composeProjectLabel = "com.docker.compose.project";
const zeroDate = "0001-01-01T00:00:00Z";

const stateDir = resolve(process.env.FAKE_DOCKER_DIR ?? fail("FAKE_DOCKER_DIR is not set"));
const stateFile = join(stateDir, "state.json");
const lockDir = join(stateDir, "lock");

function fail(message: string): never {
    process.stderr.write(`fake docker: ${message}\n`);
    process.exit(1);
}

function readState(): State {
    return existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, "utf8")) as State) : { containers: [] };
}

function writeState(state: State): void {
    const temporary = `${stateFile}.${process.pid}`;
    writeFileSync(temporary, JSON.stringify(state, null, 2));
    renameSync(temporary, stateFile);
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Several commands run at once - the controller polls while a start script runs compose. */
async function withLock<T>(task: (state: State) => Promise<T>): Promise<T> {
    mkdirSync(stateDir, { recursive: true });
    for (let attempt = 0; ; attempt++) {
        try {
            mkdirSync(lockDir);
            break;
        } catch {
            if (attempt > 600) {
                fail("could not acquire the state lock");
            }
            await sleep(50);
        }
    }
    try {
        const state = readState();
        const result = await task(state);
        writeState(state);
        return result;
    } finally {
        rmSync(lockDir, { recursive: true, force: true });
    }
}

function logFile(id: string): string {
    return join(stateDir, "logs", `${id}.log`);
}

function exitFile(id: string): string {
    return join(stateDir, "exits", `${id}.json`);
}

function hasExited(id: string): boolean {
    return existsSync(exitFile(id));
}

function isAlive(pid: number | undefined): boolean {
    if (!pid) {
        return false;
    }
    try {
        // An orphaned shim may never be reaped - not every container init does that - and a zombie
        // still answers to signal 0.
        if (readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.startsWith("Z")) {
            return false;
        }
    } catch {
        // No procfs, signal 0 has to do.
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/** What docker would report: a container whose process ended on its own has exited. */
function inspectState(container: Container): Container {
    if (container.status !== "running" || (!hasExited(container.id) && isAlive(container.pid))) {
        return container;
    }
    const exit = existsSync(exitFile(container.id))
        ? (JSON.parse(readFileSync(exitFile(container.id), "utf8")) as { code: number; at: string })
        : { code: 137, at: new Date().toISOString() };
    return { ...container, status: "exited", exitCode: exit.code, finishedAt: exit.at };
}

async function waitForPort(port: number, container: Container): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !hasExited(container.id) && isAlive(container.pid)) {
        const isOpen = await new Promise<boolean>((done) => {
            const socket = connect(port, "127.0.0.1");
            socket.once("connect", () => {
                socket.end();
                done(true);
            });
            socket.once("error", () => done(false));
        });
        if (isOpen) {
            return;
        }
        await sleep(50);
    }
}

async function startContainer(container: Container): Promise<void> {
    mkdirSync(join(stateDir, "logs"), { recursive: true });
    mkdirSync(join(stateDir, "exits"), { recursive: true });
    rmSync(exitFile(container.id), { force: true });
    const shim = spawn(process.execPath, [process.argv[1], "__shim", container.id], {
        detached: true,
        stdio: "ignore",
        env: { ...process.env },
    });
    shim.unref();
    container.pid = shim.pid;
    container.status = "running";
    container.exitCode = 0;
    container.startedAt = new Date().toISOString();
    container.finishedAt = undefined;
    // Stands in for a health check, so that a preview is reachable once compose returns.
    if (container.port) {
        await waitForPort(container.port, container);
    }
}

async function stopContainer(container: Container): Promise<void> {
    const current = inspectState(container);
    if (current.status === "running" && container.pid) {
        try {
            process.kill(-container.pid, "SIGTERM");
        } catch {
            // Already gone.
        }
        for (let attempt = 0; attempt < 100 && !hasExited(container.id) && isAlive(container.pid); attempt++) {
            await sleep(50);
        }
        Object.assign(container, { status: "exited", exitCode: 0, finishedAt: new Date().toISOString() });
    } else if (current.status === "exited") {
        Object.assign(container, { status: "exited", exitCode: current.exitCode, finishedAt: current.finishedAt });
    }
    container.pid = undefined;
}

/** Runs the command of a container, see startContainer. */
function runShim(id: string): void {
    const container = readState().containers.find((candidate) => candidate.id === id) ?? fail(`no container ${id}`);
    const child = spawn(container.command[0], container.command.slice(1), {
        cwd: container.cwd,
        env: { PATH: process.env.PATH ?? "", ...container.environment },
        stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr]) {
        let rest = "";
        stream.setEncoding("utf8");
        stream.on("data", (chunk: string) => {
            const lines = (rest + chunk).split("\n");
            rest = lines.pop() ?? "";
            appendFileSync(logFile(id), lines.map((line) => `${new Date().toISOString()} ${line}\n`).join(""));
        });
    }
    const finish = (code: number) => {
        writeFileSync(exitFile(id), JSON.stringify({ code, at: new Date().toISOString() }));
        process.exit(code);
    };
    child.on("error", (error) => {
        appendFileSync(logFile(id), `${new Date().toISOString()} ${error.message}\n`);
        finish(127);
    });
    child.on("close", (code) => finish(code ?? 1));
    process.on("SIGTERM", () => child.kill("SIGTERM"));
}

function substitute(value: string, environment: NodeJS.ProcessEnv): string {
    return value.replace(/\$\{(\w+)\}/g, (_, name: string) => environment[name] ?? "");
}

function newId(): string {
    return [...crypto.getRandomValues(new Uint8Array(6))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** `compose up` reads compose.json from the current directory instead of a real compose file. */
async function composeUp(project: string): Promise<void> {
    const file = JSON.parse(readFileSync("compose.json", "utf8")) as ComposeFile;
    await withLock(async (state) => {
        for (const container of state.containers.filter((candidate) => candidate.project === project)) {
            await stopContainer(container);
        }
        state.containers = state.containers.filter((candidate) => candidate.project !== project);
        for (const [service, definition] of Object.entries(file.services)) {
            const container: Container = {
                id: newId(),
                project,
                service,
                command: definition.command,
                cwd: process.cwd(),
                environment: Object.fromEntries(
                    Object.entries(definition.environment ?? {}).map(([name, value]) => [name, substitute(value, process.env)]),
                ),
                port: definition.port ? Number(substitute(definition.port, process.env)) : undefined,
                status: "created",
                exitCode: 0,
                createdAt: new Date().toISOString(),
            };
            state.containers.push(container);
            writeState(state);
            await startContainer(container);
        }
    });
}

function readLogs(container: Container, options: { tail: number; sinceSeconds?: number }): { at: string; line: string }[] {
    const content = existsSync(logFile(container.id)) ? readFileSync(logFile(container.id), "utf8") : "";
    const since = options.sinceSeconds === undefined ? 0 : Date.now() - options.sinceSeconds * 1000;
    return content
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => ({ at: line.slice(0, line.indexOf(" ")), line: line.slice(line.indexOf(" ") + 1) }))
        .filter((entry) => Date.parse(entry.at) >= since)
        .slice(-options.tail);
}

function option(args: string[], name: string): string | undefined {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
}

async function compose(args: string[]): Promise<void> {
    const projectIndex = args.indexOf("-p");
    const project = projectIndex === -1 ? process.env.COMPOSE_PROJECT_NAME : args[projectIndex + 1];
    if (!project) {
        fail("compose needs a project name");
    }
    const rest = projectIndex === -1 ? args : [...args.slice(0, projectIndex), ...args.slice(projectIndex + 2)];
    const [command, ...commandArgs] = rest;
    const ofProject = (state: State) => state.containers.filter((container) => container.project === project);

    switch (command) {
        case "up":
            return composeUp(project);
        case "start":
            return withLock(async (state) => {
                for (const container of ofProject(state)) {
                    if (inspectState(container).status !== "running") {
                        await startContainer(container);
                    }
                }
            });
        case "restart":
            return withLock(async (state) => {
                for (const container of ofProject(state)) {
                    await stopContainer(container);
                    await startContainer(container);
                }
            });
        case "stop":
            return withLock(async (state) => {
                for (const container of ofProject(state)) {
                    await stopContainer(container);
                }
            });
        case "down":
            return withLock(async (state) => {
                for (const container of ofProject(state)) {
                    await stopContainer(container);
                    rmSync(logFile(container.id), { force: true });
                    rmSync(exitFile(container.id), { force: true });
                }
                state.containers = state.containers.filter((container) => container.project !== project);
            });
        case "logs": {
            const tail = Number(option(commandArgs, "--tail") ?? 1000);
            const since = option(commandArgs, "--since");
            const sinceSeconds = since ? Number(since.replace(/s$/, "")) : undefined;
            const valueOptions = new Set(["--tail", "--since"]);
            const service = commandArgs.find((arg, index) => !arg.startsWith("-") && !valueOptions.has(commandArgs[index - 1]));
            const entries = ofProject(readState())
                .filter((container) => !service || container.service === service)
                .flatMap((container) => readLogs(container, { tail, sinceSeconds }).map((entry) => ({ ...entry, service: container.service })))
                .sort((a, b) => a.at.localeCompare(b.at));
            process.stdout.write(entries.map(({ at, line, service: name }) => `${name}-1  | ${at} ${line}\n`).join(""));
            return;
        }
        default:
            fail(`unsupported compose command "${command}"`);
    }
}

function containersMatching(args: string[]): Container[] {
    const filter = option(args, "--filter");
    const all = readState().containers.map(inspectState);
    const containers = args.includes("--all") ? all : all.filter((container) => container.status === "running");
    if (!filter) {
        return containers;
    }
    const [label, value] = filter.replace(/^label=/, "").split("=");
    if (label !== composeProjectLabel) {
        fail(`unsupported filter "${filter}"`);
    }
    return containers.filter((container) => value === undefined || container.project === value);
}

function inspect(args: string[]): void {
    const format = option(args, "--format") ?? fail("inspect needs --format");
    const ids = args.filter((arg, index) => arg !== "--format" && args[index - 1] !== "--format");
    const containers = readState().containers.map(inspectState);
    const lines = ids.map((id) => {
        const container = containers.find((candidate) => candidate.id === id) ?? fail(`no such container ${id}`);
        const status = container.status;
        // The controller asks with two formats, one for the discovery and one for the service states.
        if (format.includes("PortBindings")) {
            const bindings = container.port ? { "80/tcp": [{ HostIp: "", HostPort: String(container.port) }] } : {};
            return [
                container.project,
                status,
                container.createdAt,
                container.startedAt ?? zeroDate,
                container.finishedAt ?? zeroDate,
                JSON.stringify(bindings),
            ].join("\t");
        }
        return [container.service, status, String(container.exitCode), ""].join("\t");
    });
    process.stdout.write(lines.map((line) => `${line}\n`).join(""));
}

async function main(args: string[]): Promise<void> {
    const [command, ...rest] = args;
    switch (command) {
        case "__shim":
            return runShim(rest[0]);
        case "__kill-all":
            // Used by the tests to clean up, so that no fixture process outlives them.
            return withLock(async (state) => {
                for (const container of state.containers) {
                    await stopContainer(container);
                }
            });
        case "compose":
            return compose(rest);
        case "ps": {
            const containers = containersMatching(rest);
            const format = option(rest, "--format");
            const lines = format
                ? containers.map((container) => `${container.id}\t${container.project}`)
                : containers.map((container) => container.id);
            process.stdout.write(lines.map((line) => `${line}\n`).join(""));
            return;
        }
        case "inspect":
            return inspect(rest);
        case "stats": {
            const running = readState()
                .containers.map(inspectState)
                .filter((container) => container.status === "running");
            process.stdout.write(running.map((container) => `${container.id}\t0.50%\t16MiB / 1GiB\n`).join(""));
            return;
        }
        default:
            fail(`unsupported command "${args.join(" ")}"`);
    }
}

await main(process.argv.slice(2));
