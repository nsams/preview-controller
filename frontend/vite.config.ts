import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const repositoryRoot = new URL("..", import.meta.url).pathname;

export default defineConfig(({ mode }) => {
    // The same .env files the controller reads, for the base domain.
    const env = {
        ...loadEnv(mode, repositoryRoot, "PREVIEW_CONTROLLER_"),
        ...process.env,
    };

    return {
        root: new URL(".", import.meta.url).pathname,
        plugins: [react()],
        build: {
            outDir: "dist",
            emptyOutDir: true,
            // Mostly mui, and the data grid and date pickers the Dextinity theme styles. An internal tool on a
            // fast connection, so one chunk is fine.
            chunkSizeWarningLimit: 1000,
        },
        server: {
            // Not opened directly: `npm run dev` starts the controller with
            // PREVIEW_CONTROLLER_FRONTEND_DEV_SERVER_PORT=5173, and the controller passes every
            // request for the frontend on to here, with the host header unchanged.
            port: 5173,
            strictPort: true,
            allowedHosts: [env.PREVIEW_CONTROLLER_BASE_DOMAIN ?? "preview.localhost"],
            // The controller only passes plain requests on, the hot reload websocket connects to vite itself.
            hmr: { clientPort: 5173 },
        },
    };
});
