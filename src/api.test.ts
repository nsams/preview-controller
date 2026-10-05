import assert from "node:assert/strict";
import { test } from "node:test";

import { createApi } from "./api.ts";
import type { Config } from "./config.ts";
import { PreviewRegistry } from "./previews.ts";

// A registry that never looked at docker or the disk, so it knows no previews. Everything below
// is answered before anything would be started.
const api = createApi(new PreviewRegistry({ scheme: "http", port: 9000, baseDomain: "preview.example.com", dataDir: "/nonexistent" } as Config));

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
    const response = await api.request(path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: { "content-type": "application/json" },
    });
    return { status: response.status, json: await response.json() };
}

test("no previews are known yet", async () => {
    assert.deepEqual(await call("GET", "/previews"), { status: 200, json: [] });
});

test("starting needs a valid organization, repository and branch", async () => {
    assert.deepEqual(await call("GET", "/previews/start?org=acme&repo=demo"), { status: 400, json: { error: "org, repo and branch are required" } });
    assert.deepEqual(await call("GET", "/previews/start?org=acme&repo=demo&branch=..%2Fetc"), {
        status: 400,
        json: { error: 'Invalid branch "../etc"' },
    });
    assert.deepEqual(await call("POST", "/previews", { org: "-acme", repo: "demo", branch: "main" }), {
        status: 400,
        json: { error: 'Invalid organization "-acme"' },
    });
});

test("unknown previews are answered with 404", async () => {
    const error = { error: 'Unknown preview "nothing"' };
    for (const [method, path] of [
        ["GET", "/previews/nothing"],
        ["POST", "/previews/nothing/start"],
        ["POST", "/previews/nothing/restart"],
        ["POST", "/previews/nothing/stop"],
        ["DELETE", "/previews/nothing"],
        ["GET", "/previews/nothing/services"],
        ["GET", "/previews/nothing/logs"],
    ]) {
        assert.deepEqual(await call(method, path), { status: 404, json: error }, `${method} ${path}`);
    }
    assert.deepEqual(await call("GET", "/nothing"), { status: 404, json: { error: "Not found" } });
});
