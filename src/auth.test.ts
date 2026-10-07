import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { hasSession, signInUrl, stripAuthCookies } from "./auth.ts";
import type { Config } from "./config.ts";

/** Stands in for oauth2-proxy, answering its auth endpoint with the given status. */
async function withOauth2Proxy(status: number, run: (config: Config, received: IncomingHttpHeaders[]) => Promise<void>) {
    const received: IncomingHttpHeaders[] = [];
    const server = createServer((request, response) => {
        received.push({ ...request.headers, path: request.url });
        response.writeHead(status).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        const { port } = server.address() as AddressInfo;
        await run({ oauth2ProxyUrl: `http://127.0.0.1:${port}` } as Config, received);
    } finally {
        server.close();
    }
}

test("a session is what the auth endpoint of oauth2-proxy says it is", async () => {
    await withOauth2Proxy(202, async (config, received) => {
        assert.equal(await hasSession(config, "_oauth2_proxy=abc"), true);
        assert.deepEqual(
            received.map(({ path, cookie }) => ({ path, cookie })),
            [{ path: "/__oauth2/auth", cookie: "_oauth2_proxy=abc" }],
        );
    });
    await withOauth2Proxy(401, async (config) => assert.equal(await hasSession(config, undefined), false));
});

test("anything but a clear answer of oauth2-proxy lets nothing through", async () => {
    for (const status of [200, 302, 403, 500]) {
        await withOauth2Proxy(status, async (config) => {
            await assert.rejects(hasSession(config, "_oauth2_proxy=abc"), new RegExp(`answered ${status}`));
        });
    }
});

test("the sign-in happens on the base domain and leads back to the full url", () => {
    assert.equal(
        signInUrl("https://preview.example.com", "https://admin--acme-demo-main.preview.example.com/a?b=1"),
        "https://preview.example.com/__oauth2/start?rd=https%3A%2F%2Fadmin--acme-demo-main.preview.example.com%2Fa%3Fb%3D1",
    );
});

test("the cookies of oauth2-proxy are stripped before a request reaches a preview", () => {
    assert.equal(stripAuthCookies("a=1; _oauth2_proxy=secret; b=2"), "a=1; b=2");
    assert.equal(stripAuthCookies("_oauth2_proxy_0=x; _oauth2_proxy_1=y; _oauth2_proxy_abc_csrf=z"), undefined);
    assert.equal(stripAuthCookies("_oauth2_proxyish=1; my_oauth2_proxy=2"), "_oauth2_proxyish=1; my_oauth2_proxy=2");
    assert.equal(stripAuthCookies(undefined), undefined);
});
