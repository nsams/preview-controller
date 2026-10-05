import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { readCheckout } from "./git.ts";

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
