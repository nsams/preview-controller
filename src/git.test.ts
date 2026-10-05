import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { findStartProblem, readCheckout } from "./git.ts";

/** A checkout like the controller leaves behind, without asking github for it. */
function checkout(origin: string, branch: string): string {
    const directory = mkdtempSync(join(tmpdir(), "git-test-"));
    const git = (...args: string[]) =>
        execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: directory });
    git("init", "--quiet", "--initial-branch", branch);
    git("commit", "--quiet", "--allow-empty", "--message", "initial");
    git("remote", "add", "origin", origin);
    return directory;
}

test("a checkout tells which repository and branch it holds", async () => {
    const result = await readCheckout(checkout("https://github.com/acme/demo.git", "feature/x"));
    assert.deepEqual(result?.ref, { org: "acme", repo: "demo", branch: "feature/x" });
    assert.match(result?.commit ?? "", /^[0-9a-f]{7,}$/);
});

test("ssh remotes are understood as well", async () => {
    for (const origin of ["git@github.com:acme/demo.git", "ssh://git@github.com/acme/demo"]) {
        assert.deepEqual((await readCheckout(checkout(origin, "main")))?.ref, { org: "acme", repo: "demo", branch: "main" }, origin);
    }
});

test("anything that is not a valid github checkout is ignored", async () => {
    assert.equal(await readCheckout(checkout("https://gitlab.com/acme/demo.git", "main")), undefined);
    assert.equal(await readCheckout(checkout("https://github.com/-acme/demo.git", "main")), undefined);
    assert.equal(await readCheckout(mkdtempSync(join(tmpdir(), "git-test-"))), undefined);
});

/** A bare repository with a "main" branch that holds the given files, by path and whether they are executable. */
function repository(files: Record<string, boolean>): string {
    const work = mkdtempSync(join(tmpdir(), "git-test-"));
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: work });
    git("init", "--quiet", "--initial-branch", "main");
    for (const [path, isExecutable] of Object.entries(files)) {
        mkdirSync(join(work, path, ".."), { recursive: true });
        writeFileSync(join(work, path), "#!/bin/sh\n");
        chmodSync(join(work, path), isExecutable ? 0o755 : 0o644);
    }
    git("add", "--all");
    git("commit", "--quiet", "--allow-empty", "--message", "initial");
    const bare = mkdtempSync(join(tmpdir(), "git-test-"));
    git("clone", "--quiet", "--bare", work, bare);
    return `file://${bare}`;
}

test("a branch with an executable start script can be started", async () => {
    const url = repository({ "start-preview.sh": true, "example/start-preview.sh": true });
    assert.equal(await findStartProblem(url, "main", "start-preview.sh"), undefined);
    assert.equal(await findStartProblem(url, "main", "example/start-preview.sh"), undefined);
});

test("what keeps a branch from starting is reported", async () => {
    const url = repository({ "start-preview.sh": false, "example/start.sh": true });
    assert.match((await findStartProblem(url, "main", "start-preview.sh")) ?? "", /is not executable/);
    assert.match((await findStartProblem(url, "main", "missing.sh")) ?? "", /"missing.sh" does not exist on main/);
    assert.match((await findStartProblem(url, "main", "example")) ?? "", /is not a file/);
    assert.match((await findStartProblem(url, "feature", "start-preview.sh")) ?? "", /Branch "feature" does not exist/);
    const missing = `file://${mkdtempSync(join(tmpdir(), "git-test-"))}/missing.git`;
    assert.match((await findStartProblem(missing, "main", "start-preview.sh")) ?? "", /Repository not found or not accessible/);
});
