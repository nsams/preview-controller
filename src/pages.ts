import type { ContainerUsage } from "./docker.ts";
import { describeRef, type Preview } from "./previews.ts";

export function escapeHtml(value: string): string {
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
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); white-space: nowrap; }
    th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); font-weight: 600; }
    tr:last-child td { border-bottom: 0; }
    td.wrap { white-space: normal; word-break: break-word; }
    a { color: var(--accent); }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
    .badge-running { background: #1f8a4c22; color: #1f8a4c; }
    .badge-starting { background: #b4790022; color: #b47900; }
    .badge-stopped { background: #6b728022; color: var(--muted); }
    .badge-failed { background: #c0392b22; color: #c0392b; }
    form { display: flex; gap: 8px; }
    .start-form { display: grid; grid-template-columns: 1fr 1fr 1.2fr auto; gap: 12px; align-items: end; }
    .start-form label { display: flex; flex-direction: column; gap: 6px; font-size: 12px;
        text-transform: uppercase; letter-spacing: .04em; color: var(--muted); font-weight: 600; }
    @media (max-width: 640px) { .start-form { grid-template-columns: 1fr; } }
    .cards { display: flex; flex-direction: column; gap: 16px; }
    input { flex: 1; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px;
        background: var(--bg); color: var(--fg); font: inherit; }
    button { padding: 10px 18px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
    .error { margin: 0 0 16px; padding: 10px 12px; border-radius: 8px; background: #c0392b22; color: #c0392b; font-size: 14px; }
    .spinner { width: 28px; height: 28px; margin-bottom: 16px; border: 3px solid var(--border);
        border-top-color: var(--accent); border-radius: 50%; animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
    pre { margin: 0; padding: 14px; border-radius: 8px; background: var(--bg); border: 1px solid var(--border);
        overflow-x: auto; max-height: 60vh; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.45; }
    h2 { font-size: 15px; margin: 24px 0 8px; }
    h2:first-child { margin-top: 0; }
    .filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 12px; font-size: 13px; }
    .filters a { padding: 3px 10px; border: 1px solid var(--border); border-radius: 999px; text-decoration: none; }
    .filters a[aria-current] { border-color: var(--accent); font-weight: 600; }
    .links { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 4px; font-size: 12px; }
    .links a { color: var(--muted); }
    .link-buttons { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; }
    .link-buttons a { padding: 11px 20px; border: 1px solid var(--border); border-radius: 8px;
        background: var(--bg); text-decoration: none; font-weight: 600; }
    .link-buttons a:first-child { border-color: var(--accent); }
    .facts { display: grid; grid-template-columns: max-content 1fr; gap: 6px 20px; margin: 0; font-size: 14px; }
    .facts dt { color: var(--muted); }
    .facts dd { margin: 0; }
    .starting { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; color: var(--muted); font-size: 14px; }
    .starting .spinner { margin: 0; flex: none; }
    .row-actions { display: flex; gap: 12px; align-items: baseline; }
    .row-actions form { display: inline; }
    button.link { padding: 0; border: 0; background: none; color: var(--accent); font: inherit; cursor: pointer; }
    .actions { display: flex; gap: 10px; margin-top: 20px; }
    .actions button { background: none; border: 1px solid var(--border); color: var(--fg); font-weight: 600; }
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

/** Stopping changes something, so it is a post and never a link. */
function stopForm(slug: string, redirectTo: string, label: string, className = ""): string {
    return `<form method="post" action="${previewPath(slug)}/stop">
        <input type="hidden" name="redirectTo" value="${escapeHtml(redirectTo)}" />
        <button type="submit"${className ? ` class="${className}"` : ""}>${escapeHtml(label)}</button>
    </form>`;
}

function previewLinks(preview: Preview): string {
    if (preview.urls.length === 0) {
        return "";
    }
    return `<div class="links">${preview.urls.map((link) => `<a href="${escapeHtml(link.url)}">${escapeHtml(link.name)}</a>`).join("")}</div>`;
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
            <p>This page reloads on its own. The first start builds the images and can take a few minutes.</p>
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
                Reloading this page starts another attempt.
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

export type StatusRow = {
    preview: Preview;
    url: string;
    usage?: ContainerUsage;
};

function formatDuration(from: number | undefined): string {
    if (!from) {
        return "-";
    }
    const minutes = Math.floor((Date.now() - from) / 60000);
    if (minutes < 60) {
        return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 48) {
        return `${hours}h ${minutes % 60}m`;
    }
    return `${Math.floor(hours / 24)}d`;
}

function formatMemory(bytes: number | undefined): string {
    if (!bytes) {
        return "-";
    }
    return `${(bytes / 1024 ** 2).toFixed(0)} MiB`;
}

export type StatusPageData = {
    rows: StatusRow[];
    form?: { org?: string; repo?: string; branch?: string };
    formError?: string;
    usageError?: string;
};

function startForm(form: StatusPageData["form"], error?: string): string {
    const field = (name: "org" | "repo" | "branch", label: string, placeholder: string, autofocus = false) => `
        <label>
            ${label}
            <input name="${name}" value="${escapeHtml(form?.[name] ?? "")}" placeholder="${placeholder}"
                required spellcheck="false" autocapitalize="off" autocomplete="off"${autofocus ? " autofocus" : ""} />
        </label>`;

    return `<div class="card">
        <h2>Start a preview</h2>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
        <form class="start-form" method="post" action="/previews/start">
            ${field("org", "Organization", "vivid-planet")}
            ${field("repo", "Repository", "dextinity-starter")}
            ${field("branch", "Branch", "main", true)}
            <button type="submit">Start</button>
        </form>
    </div>`;
}

export function statusPage({ rows, form, formError, usageError }: StatusPageData): string {
    const table = rows.length
        ? `<table>
            <thead>
                <tr>
                    <th>Preview</th><th>Repository</th><th>Status</th><th>Port</th>
                    <th>Uptime</th><th>Idle</th><th>CPU</th><th>Memory</th><th></th>
                </tr>
            </thead>
            <tbody>
                ${rows
                    .map(
                        ({ preview, url, usage }) => `<tr>
                    <td class="wrap"><a href="${previewPath(preview.slug)}">${escapeHtml(preview.slug)}</a>${previewLinks(preview)}</td>
                    <td class="wrap">${escapeHtml(describeRef(preview))}</td>
                    <td><span class="badge badge-${preview.status}">${preview.status}</span></td>
                    <td>${preview.port ?? "-"}</td>
                    <td>${formatDuration(preview.startedAt)}</td>
                    <td>${formatDuration(preview.lastAccessAt)}</td>
                    <td>${usage ? `${usage.cpuPercent.toFixed(1)} %` : "-"}</td>
                    <td>${formatMemory(usage?.memoryBytes)}</td>
                    <td>
                        <div class="row-actions">
                            <a href="${logsPath(preview.slug)}">logs</a>
                            ${preview.status === "running" ? stopForm(preview.slug, "/", "stop", "link") : ""}
                        </div>
                    </td>
                </tr>`,
                    )
                    .join("\n")}
            </tbody>
        </table>`
        : `<p>No previews yet.</p>`;

    return layout(
        "Previews",
        `<h1>Previews</h1>
        <p class="lead">Every preview is one branch of one GitHub repository</p>
        <div class="cards">
            ${startForm(form, formError)}
            ${usageError ? `<p class="error">${escapeHtml(usageError)}</p>` : ""}
            <div class="card">${table}</div>
        </div>
        <script>
            // Keep the table fresh, but never throw away what someone is typing into the form.
            (function () {
                var form = document.querySelector(".start-form");
                var timer = setTimeout(function () { location.reload(); }, 10000);
                form.addEventListener("focusin", function () { clearTimeout(timer); });
                form.addEventListener("input", function () { clearTimeout(timer); });
            })();
        </script>`,
    );
}

export function previewPath(slug: string): string {
    return `/previews/${encodeURIComponent(slug)}`;
}

export function logsPath(slug: string, service?: string): string {
    return service
        ? `/previews/${encodeURIComponent(slug)}/logs?service=${encodeURIComponent(service)}`
        : `/previews/${encodeURIComponent(slug)}/logs`;
}

export type LogsPageData = {
    preview: Preview;
    startLog: string;
    containerLog: string;
    containerLogError?: string;
    services: string[];
    service?: string;
    tail: number;
};

export function logsPage({ preview, startLog, containerLog, containerLogError, services, service, tail }: LogsPageData): string {
    const filters = [
        `<a href="${logsPath(preview.slug)}"${service ? "" : ' aria-current="page"'}>all services</a>`,
        ...services.map(
            (name) => `<a href="${logsPath(preview.slug, name)}"${service === name ? ' aria-current="page"' : ""}>${escapeHtml(name)}</a>`,
        ),
    ].join("");

    return layout(
        `Logs of ${preview.slug}`,
        `<h1>Logs</h1>
        <p class="lead">
            <a href="/">all previews</a> &middot;
            <a href="${previewPath(preview.slug)}">${escapeHtml(preview.slug)}</a> &middot;
            ${escapeHtml(describeRef(preview))} &middot;
            <span class="badge badge-${preview.status}">${preview.status}</span>
        </p>
        <div class="card">
            <h2>Start log</h2>
            <pre>${escapeHtml(startLog.trim() || "The controller has not started this preview yet.")}</pre>
            <h2>Containers (last ${tail} lines)</h2>
            <div class="filters">${filters}</div>
            ${containerLogError ? `<p class="error">${escapeHtml(containerLogError)}</p>` : ""}
            <pre>${escapeHtml(containerLog.trim() || "No container output.")}</pre>
        </div>`,
        // While a preview is starting the interesting output is still coming in.
        preview.status === "starting" ? `<meta http-equiv="refresh" content="10" />` : "",
    );
}

export type PreviewPageData = {
    preview: Preview;
    /** Shown when the project has not reported any urls yet. */
    fallbackUrl: string;
    usage?: ContainerUsage;
    actionError?: string;
};

export function previewPage({ preview, fallbackUrl, usage, actionError }: PreviewPageData): string {
    const links = preview.urls.length > 0 ? preview.urls : [{ name: "Preview", url: fallbackUrl }];

    const facts = [
        ["Status", `<span class="badge badge-${preview.status}">${preview.status}</span>`],
        ["Repository", escapeHtml(describeRef(preview))],
        ["Commit", preview.commit ? `<code>${escapeHtml(preview.commit)}</code>` : "-"],
        ["Port", preview.port ? String(preview.port) : "-"],
        ["Uptime", formatDuration(preview.startedAt)],
        ["Stopped", formatDuration(preview.stoppedAt)],
        ["Last request", formatDuration(preview.lastAccessAt)],
        ["CPU", usage ? `${usage.cpuPercent.toFixed(1)} %` : "-"],
        ["Memory", formatMemory(usage?.memoryBytes)],
    ];

    return layout(
        preview.slug,
        `<h1>${escapeHtml(preview.slug)}</h1>
        <p class="lead"><a href="/">all previews</a> &middot; <a href="${logsPath(preview.slug)}">logs</a></p>
        <div class="card">
            ${
                preview.status === "starting"
                    ? `<div class="starting"><div class="spinner"></div>
                        <span>Starting. The first start builds the images and can take a few minutes -
                        this page reloads on its own, and the links already work.</span></div>`
                    : ""
            }
            ${preview.status === "failed" ? `<p class="error">${escapeHtml(preview.error ?? "Unknown error")}</p>` : ""}
            ${actionError ? `<p class="error">${escapeHtml(actionError)}</p>` : ""}
            <div class="link-buttons">
                ${links.map((link) => `<a href="${escapeHtml(link.url)}">${escapeHtml(link.name)}</a>`).join("")}
            </div>
            <dl class="facts">
                ${facts.map(([term, value]) => `<dt>${term}</dt><dd>${value}</dd>`).join("")}
            </dl>
            ${preview.status === "running" ? `<div class="actions">${stopForm(preview.slug, previewPath(preview.slug), "Stop")}</div>` : ""}
        </div>`,
        preview.status === "starting" ? `<meta http-equiv="refresh" content="5" />` : "",
    );
}
