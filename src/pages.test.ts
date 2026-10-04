import assert from "node:assert/strict";
import { test } from "node:test";

import { escapeHtml, loginPage, logsPath, logsPage, previewPage, statusPage } from "./pages.ts";
import type { Preview } from "./previews.ts";

const preview: Preview = {
    slug: "acme-demo-main",
    ref: { org: "acme", repo: "demo", branch: "main" },
    urls: [],
    status: "running",
    lastAccessAt: Date.now(),
};

test("html is escaped", () => {
    assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
});

test("nothing a project or a visitor controls ends up as markup", () => {
    const payload = `"><script>alert(1)</script>`;
    const pages = [
        loginPage(payload, payload),
        previewPage({
            preview: { ...preview, urls: [{ name: payload, url: "https://x" }], status: "failed", error: payload },
            fallbackUrl: "https://x",
        }),
        statusPage({ rows: [{ preview }], form: { org: payload }, formError: payload }),
        logsPage({ preview, startLog: payload, containerLog: payload, services: [], tail: 200, sinceLastStart: false }),
    ];
    for (const page of pages) {
        assert.ok(!page.includes("<script>alert(1)"), page);
    }
});

test("the detail page offers what fits the status", () => {
    const buttons = (status: Preview["status"]) =>
        [...previewPage({ preview: { ...preview, status }, fallbackUrl: "https://x" }).matchAll(/<button[^>]*>([^<]+)</g)].map((match) => match[1]);
    assert.deepEqual(buttons("running"), ["Restart", "Stop"]);
    assert.deepEqual(buttons("stopped"), ["Start", "Delete"]);
    assert.deepEqual(buttons("failed"), ["Start"]);
    assert.deepEqual(buttons("starting"), []);
});

test("the logs page calls out failing services", () => {
    const page = logsPage({
        preview,
        startLog: "",
        containerLog: "",
        services: [
            { name: "api", status: "failed", detail: "exited (1)" },
            { name: "web", status: "running", detail: "running" },
        ],
        tail: 200,
        sinceLastStart: true,
    });
    assert.match(page, /One container is not running: api \(exited \(1\)\)/);
    assert.match(page, /http-equiv="refresh"/);
    assert.equal(logsPath("a b", "api"), "/previews/a%20b/logs?service=api");
});
