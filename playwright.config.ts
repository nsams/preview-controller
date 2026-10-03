import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "e2e",
    timeout: 60_000,
    expect: { timeout: 10_000 },
    forbidOnly: !!process.env.CI,
    retries: 0,
    reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
    use: {
        trace: "retain-on-failure",
    },
    projects: [
        {
            name: "chromium",
            use: {
                ...devices["Desktop Chrome"],
                // For machines with a preinstalled chromium instead of the one of `playwright install`.
                launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined },
            },
        },
    ],
});
