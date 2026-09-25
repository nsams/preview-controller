import { createHash } from "node:crypto";

export type RepositoryRef = {
    org: string;
    repo: string;
    branch: string;
};

// Deliberately narrow: these values end up on a git command line, in a directory name and in a
// host name. GitHub itself is stricter than this, so nothing valid is rejected.
const orgPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const repoPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const branchPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

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
 * A readable dns label for org, repo and branch. Values that do not survive normalization get a
 * suffix, so two different references can never end up on the same preview.
 */
export function createSlug(ref: RepositoryRef): string {
    const normalized = [ref.org, ref.repo, ref.branch].map(normalizeLabel).join("-");
    const isLossless = normalized === `${ref.org}-${ref.repo}-${ref.branch}`.toLowerCase() && normalized.length <= maxSlugLength;
    if (isLossless) {
        return normalized;
    }
    const hash = createHash("sha256").update(`${ref.org}/${ref.repo}/${ref.branch}`).digest("hex").slice(0, 6);
    return `${normalized.slice(0, maxSlugLength).replace(/-+$/g, "")}-${hash}`;
}
