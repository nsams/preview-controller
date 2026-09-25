import { resolve } from "node:path";

export type Config = {
    port: number;
    baseDomain: string;
    scheme: "http" | "https";
    password: string;
    idleTimeoutMinutes: number;
    removeAfterDays: number;
    portRange: { from: number; to: number };
    dataDir: string;
    githubToken?: string;
};

const prefix = "PREVIEW_CONTROLLER_";

function fail(message: string): never {
    throw new Error(`Invalid configuration: ${message}`);
}

function readString(name: string, fallback?: string): string {
    const value = process.env[`${prefix}${name}`]?.trim() || fallback;
    if (!value) {
        fail(`${prefix}${name} is not set`);
    }
    return value;
}

function readNumber(name: string, fallback: number): number {
    const raw = process.env[`${prefix}${name}`]?.trim();
    if (!raw) {
        return fallback;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        fail(`${prefix}${name} must be a positive integer`);
    }
    return value;
}

function readPortRange(): { from: number; to: number } {
    const raw = readString("PORT_RANGE", "31000-31099");
    const match = /^(\d+)-(\d+)$/.exec(raw);
    if (!match) {
        fail(`${prefix}PORT_RANGE must look like "31000-31099"`);
    }
    const from = Number(match[1]);
    const to = Number(match[2]);
    if (from <= 0 || to < from) {
        fail(`${prefix}PORT_RANGE must be an ascending range of positive ports`);
    }
    return { from, to };
}

/** Everything comes from the environment, see .env and .env.secrets. */
export function loadConfig(): Config {
    const scheme = readString("SCHEME", "http");
    if (scheme !== "http" && scheme !== "https") {
        fail(`${prefix}SCHEME must be "http" or "https"`);
    }

    const password = readString("PASSWORD");
    if (password.length < 8) {
        fail(`${prefix}PASSWORD must be at least 8 characters`);
    }

    const removeAfterDays = Number(process.env[`${prefix}REMOVE_AFTER_DAYS`] ?? 7);
    if (!Number.isInteger(removeAfterDays) || removeAfterDays < 0) {
        fail(`${prefix}REMOVE_AFTER_DAYS must be a non-negative integer, 0 switches the cleanup off`);
    }

    return {
        port: readNumber("PORT", 9000),
        baseDomain: readString("BASE_DOMAIN").toLowerCase(),
        scheme,
        password,
        idleTimeoutMinutes: readNumber("IDLE_TIMEOUT_MINUTES", 60),
        removeAfterDays,
        portRange: readPortRange(),
        dataDir: resolve(readString("DATA_DIR", "./data")),
        githubToken: process.env[`${prefix}GITHUB_TOKEN`]?.trim() || undefined,
    };
}
