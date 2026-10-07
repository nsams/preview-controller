import { resolve } from "node:path";

export type Config = {
    port: number;
    baseDomain: string;
    scheme: "http" | "https";
    /** The oauth2-proxy every request is checked against, see auth.ts. */
    oauth2ProxyUrl: string;
    idleTimeoutMinutes: number;
    removeAfterDays: number;
    portRange: { from: number; to: number };
    dataDir: string;
    githubToken?: string;
    /** Set by `npm run dev`: the controller passes the frontend on to vite there instead of serving the build. */
    frontendDevServerPort?: number;
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

function readNumber(name: string, fallback: number): number;
function readNumber(name: string, fallback?: number): number | undefined;
function readNumber(name: string, fallback?: number): number | undefined {
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

    const oauth2ProxyUrl = readString("OAUTH2_PROXY_URL").replace(/\/+$/, "");
    if (!/^http:\/\/[^/]+$/.test(oauth2ProxyUrl)) {
        fail(`${prefix}OAUTH2_PROXY_URL must be an http url without a path, like "http://127.0.0.1:4180"`);
    }

    const removeAfterDays = Number(process.env[`${prefix}REMOVE_AFTER_DAYS`] ?? 7);
    if (!Number.isInteger(removeAfterDays) || removeAfterDays < 0) {
        fail(`${prefix}REMOVE_AFTER_DAYS must be a non-negative integer, 0 switches the cleanup off`);
    }

    return {
        port: readNumber("PORT", 9000),
        baseDomain: readString("BASE_DOMAIN").toLowerCase(),
        scheme,
        oauth2ProxyUrl,
        idleTimeoutMinutes: readNumber("IDLE_TIMEOUT_MINUTES", 60),
        removeAfterDays,
        portRange: readPortRange(),
        dataDir: resolve(readString("DATA_DIR", "./data")),
        githubToken: process.env[`${prefix}GITHUB_TOKEN`]?.trim() || undefined,
        frontendDevServerPort: readNumber("FRONTEND_DEV_SERVER_PORT"),
    };
}
