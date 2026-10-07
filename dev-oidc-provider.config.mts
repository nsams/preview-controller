import { defineConfig } from "dev-oidc-provider";

// The identity provider of local development, started by `npm run dev:auth-provider` with the
// environment of oauth2-proxy/dev.env. It knows nothing but these users, and the sign-in page lets
// you pick one of them - no passwords.
const users = [
    { id: "4d3c8a43-6e0b-4c55-9a3e-2f1d2a6b7c01", name: "Developer", email: "developer@vivid-planet.com" },
    { id: "9f5e2b17-1c4a-4f0e-8d6b-7a3c5e9b2d02", name: "Another Developer", email: "another-developer@vivid-planet.com" },
];

export default defineConfig({
    port: Number(process.env.IDP_PORT),
    listUsers: () => users,
    client: {
        client_id: process.env.IDP_CLIENT_ID,
        client_secret: process.env.IDP_CLIENT_SECRET,
        redirect_uris: [process.env.OAUTH2_PROXY_REDIRECT_URL ?? ""],
    },
});
