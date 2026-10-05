import assert from "node:assert/strict";
import { test } from "node:test";

import { describeError, registerSecret, run, runStreaming } from "./exec.ts";

test("arguments are never interpreted by a shell", async () => {
    const { stdout } = await run("echo", ["$HOME; rm -rf /"]);
    assert.equal(stdout, "$HOME; rm -rf /\n");
});

test("streamed output arrives line by line, stdout and stderr each in order", async () => {
    const lines: string[] = [];
    await runStreaming("sh", ["-c", "echo one; echo two >&2; printf three"], { onLine: (line) => lines.push(line) });
    assert.deepEqual(lines.toSorted(), ["one", "three", "two"]);
});

test("a failing command reports its last lines", async () => {
    const error = await runStreaming("sh", ["-c", "echo first; echo boom >&2; exit 3"], { onLine: () => {} }).catch((caught: unknown) => caught);
    assert.match((error as Error).message, /exited with code 3/);
    assert.equal(describeError(error), "first\nboom");
});

test("registered secrets are masked in everything handed back", async () => {
    registerSecret("s3cret-token");
    const lines: string[] = [];
    await runStreaming("echo", ["https://x:s3cret-token@github.com"], { onLine: (line) => lines.push(line) });
    assert.deepEqual(lines, ["https://x:***@github.com"]);
    assert.equal((await run("echo", ["s3cret-token"])).stdout, "***\n");
    assert.equal(describeError(new Error("failed with s3cret-token")), "failed with ***");
});
