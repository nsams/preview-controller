import { defineConfig } from "dev-process-manager";

export default defineConfig({
    scripts: [
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
