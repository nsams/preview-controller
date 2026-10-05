import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describeError, run } from "./exec.ts";
import { type RepositoryRef, validateRepositoryRef } from "./repository.ts";

export type Checkout = {
    ref: RepositoryRef;
    commit: string;
};

async function exists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

/**
 * Passes a token to git without putting it into the command line, where other users of the
 * machine could read it in "ps", and without writing it to disk. The environment of a process
 * is only readable by its own user.
 */
function authEnv(token: string | undefined): Record<string, string> {
    if (!token) {
        return {};
    }
    const authorization = Buffer.from(`x-access-token:${token}`).toString("base64");
    return {
        // Overrides GIT_CONFIG_COUNT of the surrounding environment, which the controller does not use.
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
        GIT_CONFIG_VALUE_0: `Authorization: Basic ${authorization}`,
    };
}

/**
 * Creates or updates a shallow checkout of one branch. The checkout is only used as a docker
 * build context, so its history is irrelevant. It stays on a named branch, so that readCheckout
 * can tell afterwards which branch it holds. Without a token, authentication is left to the git
 * configuration of the host.
 */
export async function checkoutBranch(repositoryUrl: string, branch: string, directory: string, token?: string): Promise<string> {
    const env = authEnv(token);
    if (await exists(join(directory, ".git"))) {
        await run("git", ["-C", directory, "fetch", "--depth", "1", "origin", branch], { env });
        await run("git", ["-C", directory, "checkout", "--force", "-B", branch, "FETCH_HEAD"]);
    } else {
        await run("git", ["clone", "--depth", "1", "--branch", branch, "--", repositoryUrl, directory], { env });
    }
    const { stdout } = await run("git", ["-C", directory, "rev-parse", "--short", "HEAD"]);
    return stdout.trim();
}

/** A check is meant to answer while the form waits, a full clone may take as long as it needs. */
const checkTimeoutMs = 60 * 1000;

/**
 * Checks, without a checkout, that the repository and the branch exist and that the branch has an
 * executable start script - what a start would otherwise only find out after a preview has been
 * created for it. Only the trees of the tip of the branch are fetched, no file contents, so this
 * takes about as long as a single request. Returns what is wrong, or undefined.
 */
export async function findStartProblem(repositoryUrl: string, branch: string, script: string, token?: string): Promise<string | undefined> {
    // Asking for credentials on a terminal would leave the request hanging instead of failing.
    const env = { ...authEnv(token), GIT_TERMINAL_PROMPT: "0" };
    const options = { env, timeoutMs: checkTimeoutMs };
    try {
        const { stdout } = await run("git", ["ls-remote", "--heads", "--", repositoryUrl, `refs/heads/${branch}`], options);
        if (stdout.trim() === "") {
            return `Branch "${branch}" does not exist`;
        }
    } catch (error) {
        return `Repository not found or not accessible: ${describeError(error)}`;
    }

    const directory = await mkdtemp(join(tmpdir(), "preview-check-"));
    try {
        await run("git", ["init", "--quiet", "--bare", directory]);
        await run(
            "git",
            ["-C", directory, "fetch", "--quiet", "--depth", "1", "--filter=blob:none", "--", repositoryUrl, `refs/heads/${branch}`],
            options,
        );
        // "<mode> <type> <object>\t<path>", nothing at all for a path that does not exist.
        const { stdout } = await run("git", ["-C", directory, "ls-tree", "FETCH_HEAD", "--", script]);
        const [mode, type] = stdout.trim().split(/\s+/);
        if (!mode) {
            return `Start script "${script}" does not exist on ${branch}`;
        }
        if (type !== "blob") {
            return `Start script "${script}" is not a file`;
        }
        // A symlink (120000) is left to the start itself, which is where it can be followed.
        return mode === "100644" ? `Start script "${script}" is not executable` : undefined;
    } catch (error) {
        return `Could not check ${branch}: ${describeError(error)}`;
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

// Both forms are accepted, because a host may rewrite https to ssh to authenticate.
const githubUrlPatterns = [/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/, /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/];

function parseGithubUrl(url: string): { org: string; repo: string } | undefined {
    for (const pattern of githubUrlPatterns) {
        const match = pattern.exec(url.trim());
        if (match) {
            return { org: match[1], repo: match[2] };
        }
    }
    return undefined;
}

/**
 * Reads back which repository and branch a checkout holds. This is what makes the checkouts,
 * together with docker, the source of truth - there is no separate state file.
 */
export async function readCheckout(directory: string): Promise<Checkout | undefined> {
    if (!(await exists(join(directory, ".git")))) {
        return undefined;
    }
    try {
        const [origin, branch, commit] = await Promise.all([
            // "remote get-url" would apply insteadOf rewrites, this returns what is configured.
            run("git", ["-C", directory, "config", "--get", "remote.origin.url"]),
            run("git", ["-C", directory, "rev-parse", "--abbrev-ref", "HEAD"]),
            run("git", ["-C", directory, "rev-parse", "--short", "HEAD"]),
        ]);
        const repository = parseGithubUrl(origin.stdout);
        if (!repository) {
            return undefined;
        }
        const ref = { ...repository, branch: branch.stdout.trim() };
        return validateRepositoryRef(ref) ? undefined : { ref, commit: commit.stdout.trim() };
    } catch {
        // A half finished clone is not a checkout.
        return undefined;
    }
}
