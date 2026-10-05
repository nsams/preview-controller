import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const secrets = new Set<string>();

/** Values registered here are masked in everything this module hands back. */
export function registerSecret(value: string | undefined): void {
    if (value) {
        secrets.add(value);
    }
}

function redact(text: string): string {
    let result = text;
    for (const secret of secrets) {
        result = result.replaceAll(secret, "***");
    }
    return result;
}

export type RunOptions = {
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
};

export type RunResult = {
    stdout: string;
    stderr: string;
};

const defaultTimeoutMs = 20 * 60 * 1000;

/** How much of the output of a failed command is kept for its error message. */
const errorTailLines = 20;

/**
 * Runs a command without a shell, so no argument can ever be interpreted as one.
 */
export async function run(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
    const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        timeout: options.timeoutMs ?? defaultTimeoutMs,
        maxBuffer: 32 * 1024 * 1024,
    });
    return { stdout: redact(stdout.toString()), stderr: redact(stderr.toString()) };
}

export type StreamOptions = RunOptions & {
    /** Called with every finished line, without its line break, while the command is still running. */
    onLine: (line: string) => void;
    /** Kills the command, which then rejects with an AbortError. */
    signal?: AbortSignal;
};

/**
 * Like run, but hands the output over line by line while the command is still running. A start
 * script that builds and pulls docker images has nothing to show for minutes otherwise, and its
 * output can outgrow any buffer worth keeping in memory.
 */
export function runStreaming(command: string, args: string[], options: StreamOptions): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env ? { ...process.env, ...options.env } : process.env,
            timeout: options.timeoutMs ?? defaultTimeoutMs,
            stdio: ["ignore", "pipe", "pipe"],
            signal: options.signal,
        });

        // The last lines stand in for the stderr that run reports on a failure.
        const lastLines: string[] = [];
        const emit = (line: string) => {
            const text = redact(line);
            lastLines.push(text);
            if (lastLines.length > errorTailLines) {
                lastLines.shift();
            }
            options.onLine(text);
        };

        // stdout and stderr are buffered separately, so that a half written line of one of them
        // cannot end up glued to a line of the other.
        for (const stream of [child.stdout, child.stderr]) {
            let rest = "";
            stream.setEncoding("utf8");
            stream.on("data", (chunk: string) => {
                const lines = (rest + chunk).split("\n");
                rest = lines.pop() ?? "";
                for (const line of lines) {
                    emit(line);
                }
            });
            stream.on("end", () => {
                if (rest.length > 0) {
                    emit(rest);
                    rest = "";
                }
            });
        }

        child.on("error", reject);
        child.on("close", (code, signal) => {
            if (code === 0) {
                resolve();
                return;
            }
            const reason = signal ? `was killed with ${signal}` : `exited with code ${String(code)}`;
            reject(Object.assign(new Error(`${command} ${reason}`), { stderr: lastLines.join("\n") }));
        });
    });
}

export function describeError(error: unknown): string {
    if (error && typeof error === "object" && "stderr" in error) {
        const stderr = String((error as { stderr: unknown }).stderr).trim();
        if (stderr.length > 0) {
            return redact(stderr.split("\n").slice(-20).join("\n"));
        }
    }
    return redact(error instanceof Error ? error.message : String(error));
}
