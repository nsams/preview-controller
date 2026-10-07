import assert from "node:assert/strict";
import { test } from "node:test";

import { cannotOpenPage, failedPage, startingPage, unknownHostPage } from "./pages.ts";
import type { Preview } from "./previews.ts";

const payload = `"><script>alert(1)</script>`;

const preview: Preview = {
    slug: "acme-demo-main",
    ref: { org: "acme", repo: "demo", branch: payload },
    urls: [],
    status: "failed",
    error: payload,
    lastAccessAt: Date.now(),
};

test("nothing a project or a visitor controls ends up as markup", () => {
    const pages = [startingPage(preview, "http://x"), failedPage(preview, "http://x"), unknownHostPage(payload), cannotOpenPage(payload)];
    for (const page of pages) {
        assert.ok(!page.includes("<script>alert(1)"), page);
        assert.ok(page.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), page);
    }
});

test("the starting page reloads itself, the failed page does not", () => {
    assert.match(startingPage(preview, "http://x"), /http-equiv="refresh"/);
    assert.doesNotMatch(failedPage(preview, "http://x"), /http-equiv="refresh"/);
});

test("the pages of a preview host link to the frontend on the controller", () => {
    assert.match(startingPage(preview, "http://controller"), /href="http:\/\/controller\/previews\/acme-demo-main"/);
    assert.match(failedPage(preview, "http://controller"), /href="http:\/\/controller\/previews\/acme-demo-main"/);
});
