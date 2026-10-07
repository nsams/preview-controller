import { defineConfig } from "dev-process-manager";

export default defineConfig({
    scripts: [
        {
            name: "auth-provider",
            script: "npm run dev:auth-provider",
        },
        {
            name: "auth-proxy",
            script: "npm run dev:auth-proxy",
            // oauth2-proxy reads the discovery document of the provider when it starts.
            waitOn: ["tcp:8080"],
        },
        {
            name: "backend",
            script: "npm run dev:backend",
        },
        {
            name: "frontend",
            script: "npm run dev:frontend",
        },
    ],
});
