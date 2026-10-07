import { type IncomingHttpHeaders, type IncomingMessage, request as httpRequest, type ServerResponse } from "node:http";

import { stripAuthCookies } from "./auth.ts";

export type ProxyTarget = {
    /** 127.0.0.1 unless given. */
    host?: string;
    port: number;
    scheme: "http" | "https";
    /** Only for oauth2-proxy itself, every other target never sees its cookies. */
    shouldKeepAuthCookies?: boolean;
};

/**
 * Pipes a request to the preview running on the given local port - or, in dev, to vite, or to
 * oauth2-proxy. The Host header is passed through unchanged, because the reverse proxy inside the
 * preview routes by host name, and oauth2-proxy picks the domain of its cookies by it.
 */
export function proxyToPreview(incoming: IncomingMessage, outgoing: ServerResponse, target: ProxyTarget): void {
    const headers: IncomingHttpHeaders = { ...incoming.headers };
    const cookie = target.shouldKeepAuthCookies ? incoming.headers.cookie : stripAuthCookies(incoming.headers.cookie);
    if (cookie) {
        headers.cookie = cookie;
    } else {
        delete headers.cookie;
    }
    headers["x-forwarded-proto"] = target.scheme;
    headers["x-forwarded-host"] = incoming.headers.host;

    const upstream = httpRequest(
        {
            host: target.host ?? "127.0.0.1",
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
        outgoing.end(`Not reachable: ${error.message}`);
    });

    incoming.on("aborted", () => upstream.destroy());
    incoming.pipe(upstream);
}
