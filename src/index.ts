import { serve } from "@hono/node-server";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import type { Context } from "hono";

import { createSessionCookie, isPasswordCorrect, isSessionValid, safeRedirectTarget } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { readUsageByComposeProject, type ContainerUsage } from "./docker.ts";
import { describeError, registerSecret } from "./exec.ts";
import { failedPage, loginPage, startingPage, unknownHostPage } from "./pages.ts";
import { PreviewError, PreviewRegistry, type Preview } from "./previews.ts";
import { proxyToPreview } from "./proxy.ts";

const config = loadConfig();
registerSecret(config.githubToken);

const registry = new PreviewRegistry(config);
await registry.init();

type Env = { Bindings: HttpBindings };

const app = new Hono<Env>();

function hostName(header: string | undefined): string {
    return (header ?? "").toLowerCase().split(":")[0];
}

/** What separates the name of an additional host of a preview from its slug. */
const hostSeparator = "--";

const defaultPort = config.scheme === "https" ? 443 : 80;
const controllerUrl = `${config.scheme}://${config.baseDomain}${config.port === defaultPort ? "" : `:${config.port}`}`;

/**
 * Every host of a preview is one label under the base domain, so that a single wildcard
 * certificate covers all of them: the preview itself is <slug>, everything else it serves is
 * <name>--<slug>. A slug never contains "--", so the part behind the last one is the slug.
 */
function slugForHost(host: string): string | undefined {
    if (!host.endsWith(`.${config.baseDomain}`)) {
        return undefined;
    }
    // Reading the last label keeps the older <name>.<slug>.<baseDomain> spelling working, which
    // is fine over http and is what a project that has not been migrated yet still serves.
    const labels = host.slice(0, -(config.baseDomain.length + 1)).split(".");
    const label = labels[labels.length - 1];
    const separator = label.lastIndexOf(hostSeparator);
    return (separator === -1 ? label : label.slice(separator + hostSeparator.length)) || undefined;
}

// Reachable without a session, on every host, so that signing in works from a preview url too.
app.post("/__preview-controller/login", async (c) => {
    const form = await c.req.parseBody();
    const redirectTo = safeRedirectTarget(typeof form.redirectTo === "string" ? form.redirectTo : undefined);
    if (typeof form.password !== "string" || !isPasswordCorrect(config, form.password)) {
        return c.html(loginPage(redirectTo, "Wrong password"), 401);
    }
    c.header("set-cookie", createSessionCookie(config));
    return c.redirect(redirectTo, 303);
});

app.use("*", async (c, next) => {
    if (isSessionValid(config, c.req.header("cookie"))) {
        return next();
    }
    return c.html(loginPage(safeRedirectTarget(c.req.path)), 401);
});

// Everything that is not the controller host itself belongs to a preview and is handled here.
app.use("*", async (c, next) => {
    const host = hostName(c.req.header("host"));
    if (host === config.baseDomain) {
        return next();
    }

    const slug = slugForHost(host);
    const preview = slug ? registry.get(slug) : undefined;
    if (!preview) {
        return c.html(unknownHostPage(host), 404);
    }

    registry.touch(preview.slug);

    if (preview.status === "running") {
        if (preview.port) {
            proxyToPreview(c.env.incoming, c.env.outgoing, { port: preview.port, scheme: config.scheme });
            return RESPONSE_ALREADY_SENT;
        }
    }
    if (preview.status === "failed") {
        return c.html(failedPage(preview, controllerUrl), 503);
    }
    if (preview.status === "stopped") {
        registry.resumeInBackground(preview);
    }
    c.header("retry-after", "5");
    return c.html(startingPage(preview, controllerUrl), 503);
});

/** A preview as the api answers it, with the url it should be opened at. */
function toJson(preview: Preview) {
    return { ...preview, url: registry.primaryUrlOf(preview) };
}

function errorResponse(c: Context, error: unknown) {
    return c.json({ error: describeError(error) }, error instanceof PreviewError ? 404 : 500);
}

app.get("/api/previews", (c) => {
    return c.json(registry.list().map(toJson));
});

/** What the start form of the frontend submits. */
app.post("/api/previews", async (c) => {
    const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
    const field = (name: string) => (typeof body[name] === "string" ? body[name].trim() : "");
    try {
        const preview = await registry.request({ org: field("org"), repo: field("repo"), branch: field("branch") });
        return c.json(toJson(preview));
    } catch (error) {
        if (error instanceof PreviewError) {
            return c.json({ error: error.message }, 400);
        }
        throw error;
    }
});

// For scripts, which is why it is a get. Registered before /api/previews/:slug, which it would
// otherwise be taken for.
app.get("/api/previews/start", async (c) => {
    const org = c.req.query("org");
    const repo = c.req.query("repo");
    const branch = c.req.query("branch");
    if (!org || !repo || !branch) {
        return c.json({ error: "org, repo and branch are required" }, 400);
    }
    try {
        const preview = await registry.request({ org, repo, branch });
        return c.json(toJson(preview));
    } catch (error) {
        if (error instanceof PreviewError) {
            return c.json({ error: error.message }, 400);
        }
        throw error;
    }
});

/** Cpu and memory of every running preview by slug. Separate, because docker stats takes a moment. */
app.get("/api/usage", async (c) => {
    try {
        const byProject = await readUsageByComposeProject();
        const bySlug: Record<string, ContainerUsage> = {};
        for (const preview of registry.list()) {
            const usage = byProject.get(registry.composeProject(preview));
            if (usage) {
                bySlug[preview.slug] = usage;
            }
        }
        return c.json(bySlug);
    } catch (error) {
        return c.json({ error: `Could not read container usage: ${describeError(error)}` }, 500);
    }
});

app.get("/api/previews/:slug", (c) => {
    const preview = registry.get(c.req.param("slug"));
    if (!preview) {
        return c.json({ error: `Unknown preview "${c.req.param("slug")}"` }, 404);
    }
    return c.json({
        ...toJson(preview),
        // A project that has not reported any urls yet is still reachable on its own host.
        links: preview.urls.length > 0 ? preview.urls : [{ name: "Preview", url: registry.urlOf(preview) }],
        // Whether the container logs start at the last start, which is what the logs page has to say.
        containerLogsSinceLastStart: registry.secondsSinceStartAttempt(preview.slug) !== undefined,
    });
});

/**
 * Starting a stopped preview and restarting a running one are the same operation: fetch the
 * branch, rebuild and bring the project up - which is why a restart is also how a preview picks
 * up new commits. It runs in the background, so the answer comes right away and the detail page
 * shows how far it got. A failed preview is never picked up again on its own, so this is the way
 * out of it.
 */
function bringUp(c: Context<Env, "/api/previews/:slug/*">, { shouldRestart }: { shouldRestart: boolean }) {
    const preview = registry.get(c.req.param("slug"));
    if (!preview) {
        return c.json({ error: `Unknown preview "${c.req.param("slug")}"` }, 404);
    }
    registry.resumeInBackground(preview, { shouldRestart });
    return c.json({ ok: true });
}

app.post("/api/previews/:slug/start", (c) => bringUp(c, { shouldRestart: false }));
app.post("/api/previews/:slug/restart", (c) => bringUp(c, { shouldRestart: true }));

app.post("/api/previews/:slug/stop", async (c) => {
    try {
        await registry.stop(c.req.param("slug"));
        return c.json({ ok: true });
    } catch (error) {
        return errorResponse(c, error);
    }
});

app.delete("/api/previews/:slug", async (c) => {
    try {
        await registry.remove(c.req.param("slug"));
        return c.json({ ok: true });
    } catch (error) {
        return errorResponse(c, error);
    }
});

app.get("/api/previews/:slug/services", async (c) => {
    const slug = c.req.param("slug");
    if (!registry.get(slug)) {
        return c.json({ error: `Unknown preview "${slug}"` }, 404);
    }
    return c.json(await registry.listServices(slug).catch(() => []));
});

const servicePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;

app.get("/api/previews/:slug/logs", async (c) => {
    const slug = c.req.param("slug");
    if (!registry.get(slug)) {
        return c.json({ error: `Unknown preview "${slug}"` }, 404);
    }
    const service = c.req.query("service");
    const tail = Number(c.req.query("tail") ?? 200);
    const options = {
        tail: Number.isInteger(tail) && tail > 0 && tail <= 5000 ? tail : 200,
        service: service && servicePattern.test(service) ? service : undefined,
    };
    const source = c.req.query("source") ?? "containers";
    try {
        const body = source === "start" ? await registry.readStartLog(slug) : await registry.readContainerLogs(slug, options);
        return c.text(body);
    } catch (error) {
        return c.json({ error: describeError(error) }, 500);
    }
});

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

/** Where `npm run build` puts the frontend, relative to the working directory like serveStatic wants it. */
const frontendDir = "frontend/dist";

// The react frontend is the whole ui of the controller host. It is a single page app, so every
// path that is not a built file gets its index.html and the frontend routes it.
app.use("*", serveStatic({ root: frontendDir }));
app.get("*", async (c) => {
    const index = await readFile(`${frontendDir}/index.html`, "utf8").catch(() => undefined);
    return index ? c.html(index) : c.text("The frontend has not been built, run npm run build.", 404);
});

const idleSweep = setInterval(async () => {
    await registry.refresh();
    await registry.stopIdlePreviews();
    await registry.removeExpiredPreviews();
}, 60_000);

const server = serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
    console.log(`preview-controller listening on ${config.scheme}://${config.baseDomain}:${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
        clearInterval(idleSweep);
        server.close(() => process.exit(0));
    });
}
