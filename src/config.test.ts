import assert from "node:assert/strict";
import { resolve } from "node:path";
import { beforeEach, test } from "node:test";

import { loadConfig } from "./config.ts";

/** Leaves only the two values that have no default. */
function resetEnvironment(): void {
    for (const name of Object.keys(process.env).filter((key) => key.startsWith("PREVIEW_CONTROLLER_"))) {
        delete process.env[name];
    }
    process.env.PREVIEW_CONTROLLER_PASSWORD = "a-long-password";
    process.env.PREVIEW_CONTROLLER_BASE_DOMAIN = "Preview.Example.com";
}

beforeEach(resetEnvironment);

test("everything but the password and the base domain has a default", () => {
    assert.deepEqual(loadConfig(), {
        port: 9000,
        baseDomain: "preview.example.com",
        scheme: "http",
        password: "a-long-password",
        idleTimeoutMinutes: 60,
        removeAfterDays: 7,
        portRange: { from: 31000, to: 31099 },
        dataDir: resolve("./data"),
        githubToken: undefined,
    });
});

test("values from the environment win", () => {
    Object.assign(process.env, {
        PREVIEW_CONTROLLER_PORT: "8080",
        PREVIEW_CONTROLLER_SCHEME: "https",
        PREVIEW_CONTROLLER_REMOVE_AFTER_DAYS: "0",
        PREVIEW_CONTROLLER_PORT_RANGE: "32000-32010",
        PREVIEW_CONTROLLER_GITHUB_TOKEN: " token ",
    });
    assert.deepEqual(
        { ...loadConfig(), dataDir: undefined },
        {
            port: 8080,
            baseDomain: "preview.example.com",
            scheme: "https",
            password: "a-long-password",
            idleTimeoutMinutes: 60,
            removeAfterDays: 0,
            portRange: { from: 32000, to: 32010 },
            dataDir: undefined,
            githubToken: "token",
        },
    );
});

test("invalid values are refused", () => {
    for (const [name, value, message] of [
        ["PASSWORD", "", /PASSWORD is not set/],
        ["PASSWORD", "short", /at least 8 characters/],
        ["BASE_DOMAIN", "", /BASE_DOMAIN is not set/],
        ["SCHEME", "ftp", /"http" or "https"/],
        ["PORT", "-1", /PORT must be a positive integer/],
        ["PORT_RANGE", "31099-31000", /ascending range/],
        ["PORT_RANGE", "31000", /must look like/],
        ["REMOVE_AFTER_DAYS", "-1", /non-negative integer/],
    ]) {
        resetEnvironment();
        process.env[`PREVIEW_CONTROLLER_${name}`] = value as string;
        assert.throws(() => loadConfig(), message as RegExp, `${name}=${value}`);
    }
});
