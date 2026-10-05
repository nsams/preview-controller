import { DetailedError, hc, parseResponse, type ClientResponse } from "hono/client";

// Only the type crosses over, nothing of the server ends up in the bundle.
import type { ApiType } from "../../src/api.ts";

/** Typed client of the controller api, see src/api.ts. */
const client = hc<ApiType>("/api");

/** The session cookie is missing or expired, the user has to sign in again. */
export class UnauthorizedError extends Error {}

/**
 * Waits for a response of the client and returns its body, typed by what the route answers on
 * success. Everything else is thrown: an UnauthorizedError for a missing session, otherwise an
 * error with the message the api sent along.
 */
async function call<T extends ClientResponse<unknown>>(response: Promise<T>) {
    try {
        return await parseResponse(response);
    } catch (error) {
        if (error instanceof DetailedError) {
            if (error.statusCode === 401) {
                throw new UnauthorizedError("Not signed in");
            }
            throw new Error(error.detail?.data?.error ?? error.message);
        }
        throw error;
    }
}

export function fetchPreviews() {
    return call(client.previews.$get());
}

export function fetchPreview(slug: string) {
    return call(client.previews[":slug"].$get({ param: { slug } }));
}

export function fetchUsage() {
    return call(client.usage.$get());
}

export function fetchServices(slug: string) {
    return call(client.previews[":slug"].services.$get({ param: { slug } }));
}

export function fetchStartLog(slug: string) {
    return call(client.previews[":slug"].logs.$get({ param: { slug }, query: { source: "start" } }));
}

export function fetchContainerLog(slug: string, { tail, service }: { tail: number; service?: string }) {
    return call(client.previews[":slug"].logs.$get({ param: { slug }, query: { tail, service } }));
}

/** Creates the preview if necessary and starts it in the background. */
export function startPreview(ref: { org: string; repo: string; branch: string; script?: string }) {
    return call(client.previews.$post({ json: ref }));
}

export type PreviewAction = "start" | "restart" | "stop" | "delete";

export async function runAction(slug: string, action: PreviewAction): Promise<void> {
    const preview = client.previews[":slug"];
    const param = { param: { slug } };
    await call(action === "delete" ? preview.$delete(param) : preview[action].$post(param));
}

// What the pages work with, derived from the responses so that they follow the api.
export type Preview = Awaited<ReturnType<typeof fetchPreviews>>[number];
export type PreviewDetails = Awaited<ReturnType<typeof fetchPreview>>;
export type PreviewStatus = Preview["status"];
export type ContainerUsage = Awaited<ReturnType<typeof fetchUsage>>[string];
export type ServiceState = Awaited<ReturnType<typeof fetchServices>>[number];

export function describeRef(preview: Preview): string {
    if (!preview.ref) {
        return "repository unknown";
    }
    const { org, repo, branch, script } = preview.ref;
    return `${org}/${repo} @ ${branch}${script ? ` (${script})` : ""}`;
}

export function previewPath(slug: string): string {
    return `/previews/${encodeURIComponent(slug)}`;
}

export function logsPath(slug: string, service?: string): string {
    return service ? `${previewPath(slug)}/logs?service=${encodeURIComponent(service)}` : `${previewPath(slug)}/logs`;
}
