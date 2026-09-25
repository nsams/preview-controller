import { access } from "node:fs/promises";
import { join } from "node:path";

import { run } from "./exec.ts";
import { validateRepositoryRef, type RepositoryRef } from "./repository.ts";

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
