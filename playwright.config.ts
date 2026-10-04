import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "e2e",
    // Every preview builds an image, which takes a few seconds, more when the base image is pulled.
    timeout: 180_000,
    // One controller on one docker daemon, see e2e/support/environment.ts.
    workers: 1,
    forbidOnly: !!process.env.CI,
    use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://preview.localhost:9123",
        trace: "retain-on-failure",
        // For machines with a preinstalled chromium instead of the one of `playwright install`.
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined },
    },
});
