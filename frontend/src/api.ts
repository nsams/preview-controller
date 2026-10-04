// Mirrors what GET /api/previews answers, see src/previews.ts of the controller.

export type PreviewStatus = "stopped" | "starting" | "running" | "failed";

export type PreviewUrl = {
    name: string;
    url: string;
};

export type Preview = {
    slug: string;
    ref?: { org: string; repo: string; branch: string };
    commit?: string;
    urls: PreviewUrl[];
    port?: number;
    status: PreviewStatus;
    error?: string;
    createdAt?: number;
    startedAt?: number;
    stoppedAt?: number;
    lastAccessAt: number;
    /** Where the preview is opened, the first url the project reported. */
    url: string;
};

/** The session cookie is missing or expired, the user has to sign in again. */
export class UnauthorizedError extends Error {}

async function getJson<T>(path: string): Promise<T> {
    const response = await fetch(path, {
        headers: { accept: "application/json" },
    });
    if (response.status === 401) {
        throw new UnauthorizedError("Not signed in");
    }
    if (!response.ok) {
        const body = await response.json().catch(() => undefined);
        throw new Error(body?.error ?? `${path} answered ${response.status}`);
    }
    return response.json();
}

export function fetchPreviews(): Promise<Preview[]> {
    return getJson("/api/previews");
}

export function describeRef(preview: Preview): string {
    return preview.ref ? `${preview.ref.org}/${preview.ref.repo} @ ${preview.ref.branch}` : "repository unknown";
}

export function previewPath(slug: string): string {
    return `/previews/${encodeURIComponent(slug)}`;
}

export function logsPath(slug: string): string {
    return `${previewPath(slug)}/logs`;
}
