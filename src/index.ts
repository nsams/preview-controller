import { serve } from "@hono/node-server";
import type { HttpBindings } from "@hono/node-server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { Hono } from "hono";
import type { Context } from "hono";

import { createSessionCookie, isPasswordCorrect, isSessionValid, safeRedirectTarget } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { readUsageByComposeProject } from "./docker.ts";
import { describeError, registerSecret } from "./exec.ts";
import {
    failedPage,
    loginPage,
    logsPage,
    previewPage,
    previewPath,
    startingPage,
    statusPage,
    unknownHostPage,
    type StatusPageData,
    type StatusRow,
} from "./pages.ts";
import { PreviewError, PreviewRegistry } from "./previews.ts";
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

async function buildStatusPage(data: Pick<StatusPageData, "form" | "formError"> = {}): Promise<string> {
    const previews = registry.list();
    const rows: StatusRow[] = previews.map((preview) => ({ preview }));
    let usageError: string | undefined;
    try {
        const usage = await readUsageByComposeProject();
        for (const row of rows) {
            row.usage = usage.get(registry.composeProject(row.preview));
        }
    } catch (error) {
        usageError = `Could not read container usage: ${describeError(error)}`;
    }

    // Prefill with the repository that was used last, because the branch is usually the only
    // thing that changes between two previews.
    const latest = previews.reduce<(typeof previews)[number] | undefined>(
        (newest, preview) => (preview.ref && (!newest || (preview.createdAt ?? 0) > (newest.createdAt ?? 0)) ? preview : newest),
        undefined,
    );
    const form = data.form ?? (latest?.ref ? { org: latest.ref.org, repo: latest.ref.repo } : undefined);

    return statusPage({ rows, form, formError: data.formError, usageError });
}

app.get("/", async (c) => {
    return c.html(await buildStatusPage());
});

app.post("/previews/start", async (c) => {
    const body = await c.req.parseBody();
    const form = {
        org: typeof body.org === "string" ? body.org.trim() : "",
        repo: typeof body.repo === "string" ? body.repo.trim() : "",
        branch: typeof body.branch === "string" ? body.branch.trim() : "",
    };
    try {
        const preview = await registry.request(form);
        return c.redirect(previewPath(preview.slug), 303);
    } catch (error) {
        if (error instanceof PreviewError) {
            return c.html(await buildStatusPage({ form, formError: error.message }), 400);
        }
        throw error;
    }
});

const servicePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;

function logQuery(c: { req: { query: (key: string) => string | undefined } }): { tail: number; service?: string } {
    const service = c.req.query("service");
    const tail = Number(c.req.query("tail") ?? 200);
    return {
        tail: Number.isInteger(tail) && tail > 0 && tail <= 5000 ? tail : 200,
        service: service && servicePattern.test(service) ? service : undefined,
    };
}

async function buildPreviewPage(slug: string, actionError?: string): Promise<string | undefined> {
    const preview = registry.get(slug);
    if (!preview) {
        return undefined;
    }
    const usage = await readUsageByComposeProject()
        .then((byProject) => byProject.get(registry.composeProject(preview)))
        .catch(() => undefined);

    return previewPage({ preview, fallbackUrl: registry.urlOf(preview), usage, actionError });
}

/** Where an action form wants to go afterwards, ignoring anything that does not stay local. */
async function redirectTargetOf(c: Context): Promise<string> {
    const body = await c.req.parseBody();
    return safeRedirectTarget(typeof body.redirectTo === "string" ? body.redirectTo : undefined);
}

/**
 * Starting a stopped preview and restarting a running one are the same operation: fetch the
 * branch, rebuild and bring the project up - which is why a restart is also how a preview picks
 * up new commits. It runs in the background, so the answer comes right away and the detail page
 * shows how far it got.
 */
async function bringUp(c: Context<Env, "/previews/:slug">, { shouldRestart }: { shouldRestart: boolean }): Promise<Response> {
    const slug = c.req.param("slug");
    const redirectTo = await redirectTargetOf(c);
    const preview = registry.get(slug);
    if (!preview) {
        return c.html(unknownHostPage(slug), 404);
    }
    registry.resumeInBackground(preview, { shouldRestart });
    return c.redirect(redirectTo, 303);
}

app.post("/previews/:slug/start", (c) => bringUp(c, { shouldRestart: false }));
app.post("/previews/:slug/restart", (c) => bringUp(c, { shouldRestart: true }));

app.post("/previews/:slug/stop", async (c) => {
    const slug = c.req.param("slug");
    const redirectTo = await redirectTargetOf(c);
    try {
        await registry.stop(slug);
        return c.redirect(redirectTo, 303);
    } catch (error) {
        const page = await buildPreviewPage(slug, describeError(error));
        return page ? c.html(page, 500) : c.html(unknownHostPage(slug), 404);
    }
});

// Deleting is offered on the detail page of a stopped preview. Everything it removes - containers,
// volumes, checkout - is rebuilt by the next start, so a running preview has to be stopped first.
app.post("/previews/:slug/delete", async (c) => {
    const slug = c.req.param("slug");
    const redirectTo = await redirectTargetOf(c);
    const preview = registry.get(slug);
    if (!preview) {
        return c.html(unknownHostPage(slug), 404);
    }
    if (preview.status !== "stopped") {
        const page = await buildPreviewPage(slug, `Only a stopped preview can be deleted, ${slug} is ${preview.status}.`);
        return page ? c.html(page, 409) : c.html(unknownHostPage(slug), 404);
    }
    try {
        await registry.remove(slug);
        return c.redirect(redirectTo, 303);
    } catch (error) {
        const page = await buildPreviewPage(slug, describeError(error));
        return page ? c.html(page, 500) : c.html(unknownHostPage(slug), 404);
    }
});

app.get("/previews/:slug", async (c) => {
    const page = await buildPreviewPage(c.req.param("slug"));
    return page ? c.html(page) : c.html(unknownHostPage(c.req.param("slug")), 404);
});

app.get("/previews/:slug/logs", async (c) => {
    const slug = c.req.param("slug");
    const preview = registry.get(slug);
    if (!preview) {
        return c.html(unknownHostPage(slug), 404);
    }
    const { tail, service } = logQuery(c);

    const [startLog, services] = await Promise.all([registry.readStartLog(slug), registry.listServices(slug).catch(() => [])]);
    let containerLog = "";
    let containerLogError: string | undefined;
    try {
        containerLog = await registry.readContainerLogs(slug, { tail, service });
    } catch (error) {
        containerLogError = describeError(error);
    }

    const sinceLastStart = registry.secondsSinceStartAttempt(slug) !== undefined;
    return c.html(logsPage({ preview, startLog, containerLog, containerLogError, services, service, tail, sinceLastStart }));
});

app.get("/api/previews/:slug/logs", async (c) => {
    const slug = c.req.param("slug");
    if (!registry.get(slug)) {
        return c.json({ error: `Unknown preview "${slug}"` }, 404);
    }
    const { tail, service } = logQuery(c);
    const source = c.req.query("source") ?? "containers";
    try {
        const body = source === "start" ? await registry.readStartLog(slug) : await registry.readContainerLogs(slug, { tail, service });
        return c.text(body);
    } catch (error) {
        return c.json({ error: describeError(error) }, 500);
    }
});

app.get("/api/previews", (c) => {
    return c.json(registry.list().map((preview) => ({ ...preview, url: registry.primaryUrlOf(preview) })));
});

app.get("/api/previews/start", async (c) => {
    const org = c.req.query("org");
    const repo = c.req.query("repo");
    const branch = c.req.query("branch");
    if (!org || !repo || !branch) {
        return c.json({ error: "org, repo and branch are required" }, 400);
    }
    try {
        const preview = await registry.request({ org, repo, branch });
        return c.json({ ...preview, url: registry.primaryUrlOf(preview) });
    } catch (error) {
        if (error instanceof PreviewError) {
            return c.json({ error: error.message }, 400);
        }
        throw error;
    }
});

app.post("/api/previews/:slug/stop", async (c) => {
    try {
        await registry.stop(c.req.param("slug"));
        return c.json({ ok: true });
    } catch (error) {
        return c.json({ error: describeError(error) }, error instanceof PreviewError ? 404 : 500);
    }
});

app.delete("/api/previews/:slug", async (c) => {
    try {
        await registry.remove(c.req.param("slug"));
        return c.json({ ok: true });
    } catch (error) {
        return c.json({ error: describeError(error) }, error instanceof PreviewError ? 404 : 500);
    }
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
