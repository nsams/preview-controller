import { execFile } from "node:child_process";
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

/**
 * Runs a command without a shell, so no argument can ever be interpreted as one.
 */
export async function run(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
    const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        timeout: options.timeoutMs ?? 20 * 60 * 1000,
        maxBuffer: 32 * 1024 * 1024,
    });
    return { stdout: redact(stdout.toString()), stderr: redact(stderr.toString()) };
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
