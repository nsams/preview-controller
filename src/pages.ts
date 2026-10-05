import { describeRef, type Preview } from "./previews.ts";

// The controller host itself is the react frontend in frontend/. What is left here are the pages
// shown on the hosts of a preview in its place - which is where no frontend of the controller runs -
// and the login, which has to work on all of them.

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => {
        const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
        return entities[character];
    });
}

const styles = `
    :root { color-scheme: light dark; --bg: #f6f7f9; --fg: #1b1d21; --muted: #6b7280; --card: #ffffff; --border: #e3e5e9; --accent: #2f6feb; }
    @media (prefers-color-scheme: dark) {
        :root { --bg: #16181d; --fg: #e8eaed; --muted: #9aa1ab; --card: #1e2128; --border: #2d313a; --accent: #6b9bff; }
    }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px 16px; background: var(--bg); color: var(--fg);
        font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
    main { max-width: 960px; margin: 0 auto; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    p.lead { margin: 0 0 24px; color: var(--muted); }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 20px; }
    a { color: var(--accent); }
    form { display: flex; gap: 8px; }
    input { flex: 1; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px;
        background: var(--bg); color: var(--fg); font: inherit; }
    button { padding: 10px 18px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
    .error { margin: 0 0 16px; padding: 10px 12px; border-radius: 8px; background: #c0392b22; color: #c0392b; font-size: 14px; }
    .spinner { width: 28px; height: 28px; margin-bottom: 16px; border: 3px solid var(--border);
        border-top-color: var(--accent); border-radius: 50%; animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
`;

function layout(title: string, body: string, head = ""): string {
    return `<!doctype html>
<html lang="en">
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(title)}</title>
        <style>${styles}</style>
        ${head}
    </head>
    <body><main>${body}</main></body>
</html>
`;
}

export function loginPage(redirectTo: string, error?: string): string {
    return layout(
        "Preview login",
        `<h1>Preview</h1>
        <p class="lead">This environment is password protected.</p>
        <div class="card">
            ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
            <form method="post" action="/__preview-controller/login">
                <input type="hidden" name="redirectTo" value="${escapeHtml(redirectTo)}" />
                <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password" />
                <button type="submit">Sign in</button>
            </form>
        </div>`,
    );
}

export function startingPage(preview: Preview, controllerUrl: string): string {
    return layout(
        `Starting ${preview.slug}`,
        `<h1>Starting the preview</h1>
        <p class="lead">
            <a href="${escapeHtml(controllerUrl)}">all previews</a> &middot;
            <a href="${escapeHtml(controllerUrl)}${logsPath(preview.slug)}">logs</a> &middot;
            ${escapeHtml(describeRef(preview))}
        </p>
        <div class="card">
            <div class="spinner"></div>
            <p>This page reloads on its own. Every start fetches the branch and rebuilds the images, which can take a few minutes.</p>
        </div>`,
        `<meta http-equiv="refresh" content="5" />`,
    );
}

export function failedPage(preview: Preview, controllerUrl: string): string {
    return layout(
        `${preview.slug} failed`,
        `<h1>The preview could not be started</h1>
        <p class="lead">
            <a href="${escapeHtml(controllerUrl)}">all previews</a> &middot;
            ${escapeHtml(describeRef(preview))}
        </p>
        <div class="card">
            <p class="error">${escapeHtml(preview.error ?? "Unknown error")}</p>
            <p>
                <a href="${escapeHtml(controllerUrl)}${logsPath(preview.slug)}">Show the full log</a>.
                Reloading this page changes nothing - a failed preview is only started again from its
                <a href="${escapeHtml(controllerUrl)}${previewPath(preview.slug)}">detail page</a>.
            </p>
        </div>`,
    );
}

export function unknownHostPage(host: string): string {
    return layout(
        "Unknown preview",
        `<h1>No preview for this host</h1>
        <p class="lead"><code>${escapeHtml(host)}</code></p>
        <div class="card"><p>Start it with <code>/api/previews/start?org=&lt;org&gt;&amp;repo=&lt;repo&gt;&amp;branch=&lt;branch&gt;</code>.</p></div>`,
    );
}

/** Routes of the frontend, linked from the pages above. */
function previewPath(slug: string): string {
    return `/previews/${encodeURIComponent(slug)}`;
}

function logsPath(slug: string): string {
    return `/previews/${encodeURIComponent(slug)}/logs`;
}
