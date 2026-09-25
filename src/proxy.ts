import { request as httpRequest } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";

import { stripSessionCookie } from "./auth.ts";

export type ProxyTarget = {
    port: number;
    scheme: "http" | "https";
};

/**
 * Pipes a request to the preview running on the given local port. The Host header is passed
 * through unchanged, because the reverse proxy inside the preview routes by host name.
 */
export function proxyToPreview(incoming: IncomingMessage, outgoing: ServerResponse, target: ProxyTarget): void {
    const headers: IncomingHttpHeaders = { ...incoming.headers };
    const cookie = stripSessionCookie(incoming.headers.cookie);
    if (cookie) {
        headers.cookie = cookie;
    } else {
        delete headers.cookie;
    }
    headers["x-forwarded-proto"] = target.scheme;
    headers["x-forwarded-host"] = incoming.headers.host;

    const upstream = httpRequest(
        {
            host: "127.0.0.1",
            port: target.port,
            method: incoming.method,
            path: incoming.url,
            headers,
        },
        (response) => {
            outgoing.writeHead(response.statusCode ?? 502, response.headers);
            response.pipe(outgoing);
        },
    );

    upstream.on("error", (error) => {
        if (!outgoing.headersSent) {
            outgoing.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        }
        outgoing.end(`Preview is not reachable: ${error.message}`);
    });

    incoming.on("aborted", () => upstream.destroy());
    incoming.pipe(upstream);
}
