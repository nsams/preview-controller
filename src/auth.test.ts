import assert from "node:assert/strict";
import { test } from "node:test";

import { createSessionCookie, isPasswordCorrect, isSessionValid, safeRedirectTarget, stripSessionCookie } from "./auth.ts";
import type { Config } from "./config.ts";

const config = { password: "correct-password", baseDomain: "preview.example.com", scheme: "https" } as Config;

const [cookieName] = createSessionCookie(config).split("=");

function sessionValue(cookie: string): string {
    return cookie.split(";")[0].slice(cookieName.length + 1);
}

test("only the configured password is correct", () => {
    assert.equal(isPasswordCorrect(config, "correct-password"), true);
    assert.equal(isPasswordCorrect(config, "correct-passwor"), false);
    assert.equal(isPasswordCorrect(config, ""), false);
});

test("the session cookie covers the base domain and is secure over https", () => {
    const cookie = createSessionCookie(config);
    assert.match(cookie, /; Domain=preview\.example\.com;/);
    assert.match(cookie, /; HttpOnly;/);
    assert.match(cookie, /; SameSite=Lax;/);
    assert.match(cookie, /; Secure$/);
    assert.doesNotMatch(createSessionCookie({ ...config, scheme: "http" }), /Secure/);
});

test("a session is valid until it expires, and only with its own signature", () => {
    const value = sessionValue(createSessionCookie(config));
    const [expiresAt, signature] = value.split(".");

    assert.equal(isSessionValid(config, `other=1; ${cookieName}=${value}`), true);
    assert.equal(isSessionValid({ ...config, password: "another-password" }, `${cookieName}=${value}`), false);
    assert.equal(isSessionValid(config, `${cookieName}=${Number(expiresAt) + 1}.${signature}`), false);
    assert.equal(isSessionValid(config, `${cookieName}=${expiresAt}.`), false);
    assert.equal(isSessionValid(config, `${cookieName}=garbage`), false);
    assert.equal(isSessionValid(config, undefined), false);
});

test("an expired session is not valid", (t) => {
    const value = sessionValue(createSessionCookie(config));
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 8 * 24 * 60 * 60 * 1000 });
    assert.equal(isSessionValid(config, `${cookieName}=${value}`), false);
});

test("the session cookie is stripped before a request reaches a preview", () => {
    assert.equal(stripSessionCookie(`a=1; ${cookieName}=secret; b=2`), "a=1; b=2");
    assert.equal(stripSessionCookie(`${cookieName}=secret`), undefined);
    assert.equal(stripSessionCookie(undefined), undefined);
});

test("only local paths are redirect targets", () => {
    assert.equal(safeRedirectTarget("/previews/x?y=1"), "/previews/x?y=1");
    for (const target of ["//evil.example.com", "/\\evil.example.com", "https://evil.example.com", "", undefined]) {
        assert.equal(safeRedirectTarget(target), "/", String(target));
    }
});
