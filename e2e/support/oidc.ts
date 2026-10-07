import { createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export const oidcClient = { id: "preview-controller", secret: "e2e-client-secret" };
export const oidcUser = { sub: "e2e-user", email: "e2e@example.com" };

function base64url(value: string | Buffer): string {
    return Buffer.from(value).toString("base64url");
}

/**
 * A minimal OpenID Connect provider for oauth2-proxy to sign in with. Its authorization endpoint
 * signs everyone in as oidcUser right away and sends the browser back with a code, which the
 * token endpoint exchanges for a signed id token. It remembers the redirect_uri of every sign-in,
 * so that the tests can see where oauth2-proxy asked to be called back.
 */
export class OidcProvider {
    readonly signIns: { redirectUri: string }[] = [];
    private readonly keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    private readonly nonces = new Map<string, string | undefined>();
    private server: Server | undefined;
    issuer = "";

    async start(): Promise<void> {
        this.server = createServer((request, response) => {
            const url = new URL(request.url ?? "/", this.issuer);
            const json = (body: unknown) => response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
            if (url.pathname === "/.well-known/openid-configuration") {
                return json({
                    issuer: this.issuer,
                    authorization_endpoint: `${this.issuer}/authorize`,
                    token_endpoint: `${this.issuer}/token`,
                    userinfo_endpoint: `${this.issuer}/userinfo`,
                    jwks_uri: `${this.issuer}/jwks`,
                    response_types_supported: ["code"],
                    subject_types_supported: ["public"],
                    id_token_signing_alg_values_supported: ["RS256"],
                });
            }
            if (url.pathname === "/jwks") {
                return json({ keys: [{ ...this.keys.publicKey.export({ format: "jwk" }), kid: "e2e", alg: "RS256", use: "sig" }] });
            }
            if (url.pathname === "/userinfo") {
                return json({ ...oidcUser, email_verified: true });
            }
            if (url.pathname === "/authorize") {
                const redirectUri = url.searchParams.get("redirect_uri") ?? "";
                this.signIns.push({ redirectUri });
                const code = randomBytes(16).toString("hex");
                this.nonces.set(code, url.searchParams.get("nonce") ?? undefined);
                const target = new URL(redirectUri);
                target.searchParams.set("code", code);
                target.searchParams.set("state", url.searchParams.get("state") ?? "");
                return response.writeHead(302, { location: target.toString() }).end();
            }
            if (url.pathname === "/token" && request.method === "POST") {
                let body = "";
                request.on("data", (chunk: Buffer) => (body += chunk.toString()));
                request.on("end", () => {
                    const code = new URLSearchParams(body).get("code") ?? "";
                    if (!this.nonces.has(code)) {
                        return response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "invalid_grant" }));
                    }
                    const nonce = this.nonces.get(code);
                    this.nonces.delete(code);
                    json({ access_token: randomBytes(16).toString("hex"), token_type: "Bearer", expires_in: 3600, id_token: this.idToken(nonce) });
                });
                return;
            }
            response.writeHead(404).end();
        });
        const server = this.server;
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        this.issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }

    private idToken(nonce: string | undefined): string {
        const now = Math.floor(Date.now() / 1000);
        const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "e2e" }));
        const payload = base64url(
            JSON.stringify({ iss: this.issuer, aud: oidcClient.id, iat: now, exp: now + 3600, ...oidcUser, email_verified: true, nonce }),
        );
        const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(this.keys.privateKey);
        return `${header}.${payload}.${base64url(signature)}`;
    }

    async stop(): Promise<void> {
        await new Promise((resolve) => this.server?.close(resolve));
    }
}
