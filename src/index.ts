import { serve } from "@hono/node-server";
import type { HttpBindings } from "@hono/node-server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { Hono } from "hono";

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

const defaultPort = config.scheme === "https" ? 443 : 80;
const controllerUrl = `${config.scheme}://${config.baseDomain}${config.port === defaultPort ? "" : `:${config.port}`}`;

/** The slug is the last label before the base domain, so that admin.<slug> also resolves. */
function slugForHost(host: string): string | undefined {
    if (!host.endsWith(`.${config.baseDomain}`)) {
        return undefined;
    }
    const labels = host.slice(0, -(config.baseDomain.length + 1)).split(".");
    return labels[labels.length - 1] || undefined;
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
    const rows: StatusRow[] = previews.map((preview) => ({ preview, url: registry.primaryUrlOf(preview) }));
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

app.post("/previews/:slug/stop", async (c) => {
    const slug = c.req.param("slug");
    const body = await c.req.parseBody();
    const redirectTo = safeRedirectTarget(typeof body.redirectTo === "string" ? body.redirectTo : undefined);
    try {
        await registry.stop(slug);
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

    return c.html(logsPage({ preview, startLog, containerLog, containerLogError, services, service, tail }));
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
