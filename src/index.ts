import { readFile } from "node:fs/promises";

import { type HttpBindings, serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { Hono } from "hono";

import { createApi } from "./api.ts";
import { hasSession, oauth2ProxyPrefix, signInUrl } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { registerSecret } from "./exec.ts";
import { cannotOpenPage, failedPage, startingPage, unknownHostPage } from "./pages.ts";
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

const oauth2Proxy = new URL(config.oauth2ProxyUrl);

// Sign-in, callback and sign-out of oauth2-proxy, reachable without a session on every host.
// The sign-in is only ever sent to the base domain, see signInUrl.
app.all(`${oauth2ProxyPrefix}/*`, (c) => {
    proxyToPreview(c.env.incoming, c.env.outgoing, {
        host: oauth2Proxy.hostname,
        port: Number(oauth2Proxy.port) || (oauth2Proxy.protocol === "https:" ? 443 : 80),
        scheme: config.scheme,
        shouldKeepAuthCookies: true,
    });
    return RESPONSE_ALREADY_SENT;
});

// Every other request, on every host, needs a session of oauth2-proxy. A browser without one
// is sent to the sign-in and comes back to exactly where it was, previews included. The api
// answers 401 instead, which is what the frontend reacts to - a fetch cannot follow a
// redirect to the provider anyway.
app.use("*", async (c, next) => {
    if (await hasSession(config, c.req.header("cookie"))) {
        return next();
    }
    const isController = hostName(c.req.header("host")) === config.baseDomain;
    if ((isController && c.req.path.startsWith("/api/")) || (c.req.method !== "GET" && c.req.method !== "HEAD")) {
        return c.json({ error: "Not signed in" }, 401);
    }
    return c.redirect(signInUrl(controllerUrl, `${config.scheme}://${c.req.header("host")}${c.env.incoming.url}`), 302);
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

// The link the status of the github action points to (see github-action/action.yml): starts the preview of a
// branch unless it already runs, and sends the browser to it. The branch is the rest of the path,
// slashes included.
app.get("/open/:org/:repo/:branch{.+}", async (c) => {
    try {
        const preview = await registry.request({ org: c.req.param("org"), repo: c.req.param("repo"), branch: c.req.param("branch") });
        return c.redirect(registry.primaryUrlOf(preview), 302);
    } catch (error) {
        if (error instanceof PreviewError) {
            return c.html(cannotOpenPage(error.message), 400);
        }
        throw error;
    }
});

app.route("/api", createApi(registry));

/** Where `npm run build` puts the frontend, relative to the working directory like serveStatic wants it. */
const frontendDir = "frontend/dist";

if (config.frontendDevServerPort) {
    // `npm run dev`: vite serves the frontend with hot reloading, the controller stays the one url
    // to open. The hot reload websocket goes to vite directly, see frontend/vite.config.ts.
    const port = config.frontendDevServerPort;
    app.get("*", (c) => {
        proxyToPreview(c.env.incoming, c.env.outgoing, { port, scheme: config.scheme });
        return RESPONSE_ALREADY_SENT;
    });
} else {
    // The react frontend is the whole ui of the controller host. It is a single page app, so every
    // path that is not a built file gets its index.html and the frontend routes it.
    app.use("*", serveStatic({ root: frontendDir }));
    app.get("*", async (c) => {
        const index = await readFile(`${frontendDir}/index.html`, "utf8").catch(() => undefined);
        return index ? c.html(index) : c.text("The frontend has not been built, run npm run build.", 404);
    });
}

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
