// Mirrors the json api of the controller, see src/index.ts and src/previews.ts.

export type PreviewStatus = "stopped" | "starting" | "running" | "failed";

export type PreviewUrl = {
    name: string;
    url: string;
};

export type Preview = {
    slug: string;
    /** Undefined when docker knows the preview but its checkout is gone. */
    ref?: { org: string; repo: string; branch: string };
    commit?: string;
    /** What the project reported about itself, empty until it has been started once. */
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

export type PreviewDetails = Preview & {
    /** The reported urls, or the host of the preview while the project has not reported any. */
    links: PreviewUrl[];
    /** Whether the container logs begin at the last start instead of showing everything. */
    containerLogsSinceLastStart: boolean;
};

export type ContainerUsage = {
    containers: number;
    cpuPercent: number;
    memoryBytes: number;
};

export type ServiceState = {
    name: string;
    status: "running" | "starting" | "stopped" | "failed";
    /** Short enough to sit in a chip, e.g. "restarting (exit 1)", "exited (1)", "unhealthy". */
    detail: string;
};

/** The session cookie is missing or expired, the user has to sign in again. */
export class UnauthorizedError extends Error {}

async function request(path: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(path, init);
    if (response.status === 401) {
        throw new UnauthorizedError("Not signed in");
    }
    if (!response.ok) {
        const body = await response.json().catch(() => undefined);
        throw new Error(body?.error ?? `${path} answered ${response.status}`);
    }
    return response;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    return (await request(path, { ...init, headers: { accept: "application/json", ...init?.headers } })).json();
}

const previewApi = (slug: string) => `/api/previews/${encodeURIComponent(slug)}`;

export function fetchPreviews(): Promise<Preview[]> {
    return requestJson("/api/previews");
}

export function fetchPreview(slug: string): Promise<PreviewDetails> {
    return requestJson(previewApi(slug));
}

export function fetchUsage(): Promise<Record<string, ContainerUsage>> {
    return requestJson("/api/usage");
}

export function fetchServices(slug: string): Promise<ServiceState[]> {
    return requestJson(`${previewApi(slug)}/services`);
}

export async function fetchStartLog(slug: string): Promise<string> {
    return (await request(`${previewApi(slug)}/logs?source=start`)).text();
}

export async function fetchContainerLog(slug: string, { tail, service }: { tail: number; service?: string }): Promise<string> {
    const query = new URLSearchParams({ tail: String(tail), ...(service ? { service } : {}) });
    return (await request(`${previewApi(slug)}/logs?${query}`)).text();
}

/** Creates the preview if necessary and starts it in the background. */
export function startPreview(ref: { org: string; repo: string; branch: string }): Promise<Preview> {
    return requestJson("/api/previews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ref) });
}

export type PreviewAction = "start" | "restart" | "stop" | "delete";

export async function runAction(slug: string, action: PreviewAction): Promise<void> {
    await request(action === "delete" ? previewApi(slug) : `${previewApi(slug)}/${action}`, { method: action === "delete" ? "DELETE" : "POST" });
}

export function describeRef(preview: Preview): string {
    return preview.ref ? `${preview.ref.org}/${preview.ref.repo} @ ${preview.ref.branch}` : "repository unknown";
}

export function previewPath(slug: string): string {
    return `/previews/${encodeURIComponent(slug)}`;
}

export function logsPath(slug: string, service?: string): string {
    return service ? `${previewPath(slug)}/logs?service=${encodeURIComponent(service)}` : `${previewPath(slug)}/logs`;
}
