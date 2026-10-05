import { createHash } from "node:crypto";

export type RepositoryRef = {
    org: string;
    repo: string;
    branch: string;
    /**
     * The start script, relative to the root of the repository, for repositories that keep their
     * preview setup - or several of them - somewhere else. Undefined means the default.
     */
    script?: string;
};

// Deliberately narrow: these values end up on a git command line, in a directory name and in a
// host name. GitHub itself is stricter than this, so nothing valid is rejected.
const orgPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const repoPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const branchPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
/** What a repository provides when nothing else is asked for, see the readme. */
export const defaultStartScript = "start-preview.sh";

// Relative, slash separated, no "." or ".." segments - it is joined onto the checkout directory.
const scriptPattern = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const maxScriptLength = 100;

const unsafeCharacters = /[^a-z0-9]+/g;
const maxSlugLength = 50;

export function validateRepositoryRef(ref: RepositoryRef): string | undefined {
    if (!orgPattern.test(ref.org)) {
        return `Invalid organization "${ref.org}"`;
    }
    if (!repoPattern.test(ref.repo) || ref.repo.includes("..")) {
        return `Invalid repository "${ref.repo}"`;
    }
    if (!branchPattern.test(ref.branch) || ref.branch.includes("..")) {
        return `Invalid branch "${ref.branch}"`;
    }
    if (
        ref.script !== undefined &&
        (ref.script.length > maxScriptLength ||
            !scriptPattern.test(ref.script) ||
            ref.script.split("/").some((segment) => segment === "." || segment === ".."))
    ) {
        return `Invalid start script "${ref.script}"`;
    }
    return undefined;
}

export function repositoryUrl(ref: RepositoryRef): string {
    return `https://github.com/${ref.org}/${ref.repo}.git`;
}

function normalizeLabel(value: string): string {
    return value
        .toLowerCase()
        .replace(unsafeCharacters, "-")
        .replace(/^-+|-+$/g, "");
}

/**
 * Reads a start script as it comes from a form, a query or a file: a leading "/" or "./" is
 * dropped, and an empty one - or the default spelled out - means the default, so that it ends up
 * on the same preview.
 */
export function normalizeScript(script: string | undefined): string | undefined {
    const trimmed = script?.trim().replace(/^(?:\.?\/)+/, "");
    return trimmed && trimmed !== defaultStartScript ? trimmed : undefined;
}

/**
 * A readable dns label for org, repo, branch and start script. Values that do not survive normalization
 * get a suffix, so two different references can never end up on the same preview. Runs of unsafe
 * characters collapse into a single dash, which is what keeps "--" out of a slug - the additional
 * hosts of a preview are named <name>--<slug> and are split on it again.
 * A preview with the default start script keeps the slug it had before scripts could be chosen.
 * One with another script always gets the suffix, because "main" with "example/start-preview.sh"
 * would otherwise read like a branch of that name.
 */
export function createSlug(ref: RepositoryRef): string {
    const parts = [ref.org, ref.repo, ref.branch];
    if (ref.script) {
        // Only for reading, the hash below covers the script as it is. Of a script with the default
        // name, its directory says all there is to say.
        const directory = ref.script.endsWith(`/${defaultStartScript}`) ? ref.script.slice(0, -defaultStartScript.length - 1) : undefined;
        parts.push(directory ?? ref.script.replace(/\.sh$/, ""));
    }
    const normalized = parts.map(normalizeLabel).join("-");
    const isLossless = !ref.script && normalized === parts.join("-").toLowerCase() && normalized.length <= maxSlugLength;
    if (isLossless) {
        return normalized;
    }
    const hash = createHash("sha256")
        .update(`${ref.org}/${ref.repo}/${ref.branch}${ref.script ? `:${ref.script}` : ""}`)
        .digest("hex")
        .slice(0, 6);
    return `${normalized.slice(0, maxSlugLength).replace(/-+$/g, "")}-${hash}`;
}
