import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { Config } from "./config.ts";

export const cookieName = "preview_controller_auth";
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;

function equals(a: string, b: string): boolean {
    // Hashing first keeps the comparison constant time even for different lengths.
    return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

function sign(config: Config, expiresAt: number): string {
    return createHmac("sha256", config.password).update(String(expiresAt)).digest("hex");
}

export function isPasswordCorrect(config: Config, password: string): boolean {
    return equals(config.password, password);
}

export function createSessionCookie(config: Config): string {
    const expiresAt = Date.now() + sessionLifetimeMs;
    const value = `${expiresAt}.${sign(config, expiresAt)}`;
    const attributes = [
        `${cookieName}=${value}`,
        `Domain=${config.baseDomain}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${Math.floor(sessionLifetimeMs / 1000)}`,
    ];
    if (config.scheme === "https") {
        attributes.push("Secure");
    }
    return attributes.join("; ");
}

export function isSessionValid(config: Config, cookieHeader: string | undefined): boolean {
    const value = readCookie(cookieHeader, cookieName);
    if (!value) {
        return false;
    }
    const [expiresAtRaw, signature] = value.split(".");
    const expiresAt = Number(expiresAtRaw);
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now() || !signature) {
        return false;
    }
    return equals(sign(config, expiresAt), signature);
}

export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
    for (const part of cookieHeader?.split(";") ?? []) {
        const [key, ...rest] = part.trim().split("=");
        if (key === name) {
            return rest.join("=");
        }
    }
    return undefined;
}

/** Removes the controller cookie before a request is handed to a preview. */
export function stripSessionCookie(cookieHeader: string | undefined): string | undefined {
    if (!cookieHeader) {
        return undefined;
    }
    const remaining = cookieHeader
        .split(";")
        .map((part) => part.trim())
        .filter((part) => !part.startsWith(`${cookieName}=`));
    return remaining.length > 0 ? remaining.join("; ") : undefined;
}

/** Only same-origin paths are accepted, so the login form cannot be used as an open redirect. */
export function safeRedirectTarget(value: string | undefined): string {
    return value && /^\/[^/\\]/.test(value) ? value : "/";
}
