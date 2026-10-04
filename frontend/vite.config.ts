import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const repositoryRoot = new URL("..", import.meta.url).pathname;

export default defineConfig(({ mode }) => {
    // The same .env files the controller reads, so that the dev server finds it on its port.
    const env = {
        ...loadEnv(mode, repositoryRoot, "PREVIEW_CONTROLLER_"),
        ...process.env,
    };
    // The string shorthand of a proxy target rewrites the host header, which has to stay as it is.
    const controller = { target: `http://127.0.0.1:${env.PREVIEW_CONTROLLER_PORT ?? 9000}`, changeOrigin: false };

    return {
        root: new URL(".", import.meta.url).pathname,
        plugins: [react()],
        build: {
            outDir: "dist",
            emptyOutDir: true,
            // Mostly mui. An internal tool on a fast connection, so one chunk is fine.
            chunkSizeWarningLimit: 800,
        },
        server: {
            // Opened as http://<base domain>:5173/ - the session cookie is set on the base
            // domain and cookies ignore the port, so the dev server shares the controller session.
            // The host header is passed on unchanged, which is how the controller knows the
            // requests are meant for itself and not for a preview.
            port: 5173,
            strictPort: true,
            allowedHosts: [env.PREVIEW_CONTROLLER_BASE_DOMAIN ?? "preview.localhost"],
            proxy: {
                "/api": controller,
                "/__preview-controller": controller,
            },
        },
    };
});
