import type { Config } from "./config.ts";

/**
 * Where oauth2-proxy serves its own endpoints, on every host the controller answers for. It has to
 * match `proxy_prefix` of oauth2-proxy, see oauth2-proxy/oauth2-proxy.cfg. Not the default /oauth2,
 * because the previews are passed everything else, and a project may well have an /oauth2 of its own.
 */
export const oauth2ProxyPrefix = "/__oauth2";

/**
 * The name oauth2-proxy gives its cookies by default. A large session is split into
 * _oauth2_proxy_0, _oauth2_proxy_1, ..., and the csrf cookie of a sign-in is _oauth2_proxy_..._csrf.
 */
const cookieName = "_oauth2_proxy";

/**
 * Whether the cookies carry a valid session, asked of the auth endpoint of oauth2-proxy, which
 * answers 202 or 401. Anything else is a broken setup and thrown, so that it never lets a request
 * through.
 */
export async function hasSession(config: Config & { oauth2ProxyUrl: string }, cookieHeader: string | undefined): Promise<boolean> {
    const response = await fetch(`${config.oauth2ProxyUrl}${oauth2ProxyPrefix}/auth`, {
        headers: cookieHeader ? { cookie: cookieHeader } : {},
        redirect: "manual",
    });
    await response.body?.cancel();
    if (response.status === 202) {
        return true;
    }
    if (response.status === 401) {
        return false;
    }
    throw new Error(`oauth2-proxy answered ${response.status} to the session check`);
}

/**
 * Where a browser without a session is sent: the sign-in of oauth2-proxy on the base domain, which
 * is the only host whose callback is registered with the provider. The way back is the full url,
 * host included - left to itself, oauth2-proxy would only remember the path, and a sign-in that
 * started on a preview would end up on the controller. oauth2-proxy only follows it to hosts of
 * its whitelist_domains, so the base domain and the hosts below it.
 */
export function signInUrl(controllerUrl: string, returnTo: string): string {
    return `${controllerUrl}${oauth2ProxyPrefix}/start?${new URLSearchParams({ rd: returnTo })}`;
}

/** Removes the cookies of oauth2-proxy before a request is handed to a preview. */
export function stripAuthCookies(cookieHeader: string | undefined): string | undefined {
    if (!cookieHeader) {
        return undefined;
    }
    const remaining = cookieHeader
        .split(";")
        .map((part) => part.trim())
        .filter((part) => {
            const name = part.split("=")[0];
            return part !== "" && name !== cookieName && !name.startsWith(`${cookieName}_`);
        });
    return remaining.length > 0 ? remaining.join("; ") : undefined;
}
