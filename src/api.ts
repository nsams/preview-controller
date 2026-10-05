import { Hono } from "hono";
import { type SSEStreamingApi, streamSSE } from "hono/streaming";
import { validator } from "hono/validator";

import { type ContainerUsage, readUsageByComposeProject } from "./docker.ts";
import { describeError } from "./exec.ts";
import { type Preview, PreviewError, type PreviewRegistry } from "./previews.ts";

const servicePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;

/**
 * Everything is optional, which is what makes it optional for the typed client too. Invalid values
 * are dropped, the route fills in the defaults.
 */
function parseLogQuery(value: Record<string, string | string[]>): { source?: "start" | "containers"; tail?: number; service?: string } {
    const tail = Number(value.tail);
    const service = readString(value.service);
    return {
        source: value.source === "start" ? "start" : undefined,
        tail: Number.isInteger(tail) && tail > 0 && tail <= 5000 ? tail : undefined,
        service: servicePattern.test(service) ? service : undefined,
    };
}

/** Often enough that no proxy in between closes a log nobody has written to for a while. */
const keepAliveMs = 20_000;

/**
 * Sends the events one after the other, in the order they were handed over, without the caller
 * having to wait for each of them. The data is json, so that line breaks and blank lines survive.
 */
function createSender(stream: SSEStreamingApi) {
    let queue = Promise.resolve();
    return {
        send(event: "reset" | "append" | "end", text = ""): void {
            queue = queue.then(() => stream.writeSSE({ event, data: JSON.stringify(text) })).catch(() => undefined);
        },
        /** Waits for everything sent so far, before the stream is closed. */
        flush: () => queue,
    };
}

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

/** The start script is optional, an empty one means the default. */
function readRef(value: Record<string, unknown>): { org: string; repo: string; branch: string; script?: string } {
    return {
        org: readString(value.org),
        repo: readString(value.repo),
        branch: readString(value.branch),
        script: readString(value.script) || undefined,
    };
}

/**
 * The json api below /api, used by the frontend and by scripts. The routes are chained on purpose:
 * that is what lets hono infer ApiType, from which the frontend gets a typed client - see
 * frontend/src/api.ts. A route added as a separate statement would be missing from it.
 */
export function createApi(registry: PreviewRegistry) {
    /** A preview as the api answers it, with the url it should be opened at. */
    const toJson = (preview: Preview) => ({ ...preview, url: registry.primaryUrlOf(preview) });
    const unknown = (slug: string) => ({ error: `Unknown preview "${slug}"` });
    const describe = (error: unknown) => ({ error: describeError(error) });

    async function request(ref: { org: string; repo: string; branch: string; script?: string }) {
        try {
            return { preview: toJson(await registry.request(ref)) };
        } catch (error) {
            if (error instanceof PreviewError) {
                return { error: error.message };
            }
            throw error;
        }
    }

    /**
     * Starting a stopped preview and restarting a running one are the same operation: fetch the
     * branch, rebuild and bring the project up - which is why a restart is also how a preview picks
     * up new commits. It runs in the background, so the answer comes right away and the detail page
     * shows how far it got. A failed preview is never picked up again on its own, so start is the
     * way out of it. False for an unknown preview.
     */
    function bringUp(slug: string, { shouldRestart }: { shouldRestart: boolean }): boolean {
        const preview = registry.get(slug);
        if (preview) {
            registry.resumeInBackground(preview, { shouldRestart });
        }
        return preview !== undefined;
    }

    return (
        new Hono()
            .get("/previews", (c) => {
                return c.json(registry.list().map(toJson));
            })

            /** What the start form of the frontend submits. */
            .post(
                "/previews",
                validator("json", (value) => readRef(value)),
                async (c) => {
                    const result = await request(c.req.valid("json"));
                    return result.preview ? c.json(result.preview, 200) : c.json({ error: result.error }, 400);
                },
            )

            // For scripts, which is why it is a get. Registered before /previews/:slug, which it
            // would otherwise be taken for.
            .get(
                "/previews/start",
                validator("query", (value) => readRef(value)),
                async (c) => {
                    const ref = c.req.valid("query");
                    if (!ref.org || !ref.repo || !ref.branch) {
                        return c.json({ error: "org, repo and branch are required" }, 400);
                    }
                    const result = await request(ref);
                    return result.preview ? c.json(result.preview, 200) : c.json({ error: result.error }, 400);
                },
            )

            /** Cpu and memory of every running preview by slug. Separate, because docker stats takes a moment. */
            .get("/usage", async (c) => {
                try {
                    const byProject = await readUsageByComposeProject();
                    const bySlug: Record<string, ContainerUsage> = {};
                    for (const preview of registry.list()) {
                        const usage = byProject.get(registry.composeProject(preview));
                        if (usage) {
                            bySlug[preview.slug] = usage;
                        }
                    }
                    return c.json(bySlug, 200);
                } catch (error) {
                    return c.json({ error: `Could not read container usage: ${describeError(error)}` }, 500);
                }
            })

            .get("/previews/:slug", (c) => {
                const preview = registry.get(c.req.param("slug"));
                if (!preview) {
                    return c.json(unknown(c.req.param("slug")), 404);
                }
                return c.json(
                    {
                        ...toJson(preview),
                        // A project that has not reported any urls yet is still reachable on its own host.
                        links: preview.urls.length > 0 ? preview.urls : [{ name: "Preview", url: registry.urlOf(preview) }],
                        // Whether the container logs start at the last start, which is what the logs page has to say.
                        containerLogsSinceLastStart: registry.secondsSinceStartAttempt(preview.slug) !== undefined,
                    },
                    200,
                );
            })

            .post("/previews/:slug/start", (c) => {
                const slug = c.req.param("slug");
                return bringUp(slug, { shouldRestart: false }) ? c.json({ ok: true }, 200) : c.json(unknown(slug), 404);
            })
            .post("/previews/:slug/restart", (c) => {
                const slug = c.req.param("slug");
                return bringUp(slug, { shouldRestart: true }) ? c.json({ ok: true }, 200) : c.json(unknown(slug), 404);
            })

            .post("/previews/:slug/stop", async (c) => {
                try {
                    await registry.stop(c.req.param("slug"));
                    return c.json({ ok: true }, 200);
                } catch (error) {
                    return c.json(describe(error), error instanceof PreviewError ? 404 : 500);
                }
            })

            .delete("/previews/:slug", async (c) => {
                try {
                    await registry.remove(c.req.param("slug"));
                    return c.json({ ok: true }, 200);
                } catch (error) {
                    return c.json(describe(error), error instanceof PreviewError ? 404 : 500);
                }
            })

            .get("/previews/:slug/services", async (c) => {
                const slug = c.req.param("slug");
                if (!registry.get(slug)) {
                    return c.json(unknown(slug), 404);
                }
                return c.json(await registry.listServices(slug).catch(() => []), 200);
            })

            .get(
                "/previews/:slug/logs",
                validator("query", (value) => parseLogQuery(value)),
                async (c) => {
                    const slug = c.req.param("slug");
                    if (!registry.get(slug)) {
                        return c.json(unknown(slug), 404);
                    }
                    const { source = "containers", tail = 200, service } = c.req.valid("query");
                    try {
                        return c.text(
                            source === "start" ? await registry.readStartLog(slug) : await registry.readContainerLogs(slug, { tail, service }),
                            200,
                        );
                    } catch (error) {
                        return c.json(describe(error), 500);
                    }
                },
            )

            /**
             * The same logs as server-sent events, kept open and written to while they grow. Both
             * begin with a reset that carries what is there already, followed by an append per new
             * piece of output - the start log also sends a reset with nothing when a new start
             * clears it. The container log ends with an end event once compose stops following,
             * which is when no container is running anymore.
             */
            .get(
                "/previews/:slug/logs/stream",
                validator("query", (value) => parseLogQuery(value)),
                (c) => {
                    const slug = c.req.param("slug");
                    if (!registry.get(slug)) {
                        return c.json(unknown(slug), 404);
                    }
                    const { source = "containers", tail = 200, service } = c.req.valid("query");
                    return streamSSE(c, async (stream) => {
                        const { send, flush } = createSender(stream);
                        const aborted = new AbortController();
                        stream.onAbort(() => aborted.abort());
                        const keepAlive = setInterval(() => void stream.write(": keep-alive\n\n").catch(() => undefined), keepAliveMs);
                        try {
                            if (source === "start") {
                                const unfollow = await registry.followStartLog(slug, {
                                    onReset: (text) => send("reset", text),
                                    onAppend: (text) => send("append", text),
                                });
                                // The client may already be gone by the time the log is followed.
                                if (!aborted.signal.aborted) {
                                    await new Promise((resolve) => aborted.signal.addEventListener("abort", resolve, { once: true }));
                                }
                                unfollow();
                                return;
                            }
                            send("reset");
                            await registry
                                .followContainerLogs(slug, { tail, service, signal: aborted.signal, onLine: (line) => send("append", `${line}\n`) })
                                .catch((error: unknown) => {
                                    if (!aborted.signal.aborted) {
                                        send("append", `${describeError(error)}\n`);
                                    }
                                });
                            send("end");
                        } finally {
                            clearInterval(keepAlive);
                            await flush();
                        }
                    });
                },
            )

            .all("*", (c) => c.json({ error: "Not found" }, 404))
    );
}

export type ApiType = ReturnType<typeof createApi>;
