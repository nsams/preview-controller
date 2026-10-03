import { fixtureFile } from "./support/environment.ts";
import { expect, getPreview, test, waitForStatus } from "./support/fixtures.ts";

const failingStartScript = `#!/bin/sh
echo "installing dependencies"
echo "boom: dependency not found" >&2
exit 1
`;

// Up long enough for `compose up --wait` to see it running, then gone for good.
const crashingWorker = `${await fixtureFile("compose.yml")}
    worker:
        build: .
        command: ["node", "-e", "setTimeout(() => { console.error('worker crashed'); process.exit(3); }, 3000)"]
`;

test.describe("failures", () => {
    test("a failing start script marks the preview as failed", async ({ page, controller, api, repository, branch, slug }) => {
        await repository.push(branch, { "start-preview.sh": failingStartScript });
        await api.request(`${controller.url}/api/previews/start?org=acme&repo=demo&branch=${branch}`);

        const preview = await waitForStatus(api, controller, slug, "failed");
        expect(preview.error).toContain("boom: dependency not found");

        const log = await api.request(`${controller.url}/api/previews/${slug}/logs?source=start`);
        expect(log.body).toContain("installing dependencies");
        expect(log.body).toContain("FAILED: ");

        // Opening it shows the error, but does not start it again.
        const opened = await api.request(controller.previewUrl(slug));
        expect(opened.status).toBe(503);
        expect(opened.body).toContain("The preview could not be started");
        expect(opened.body).toContain("boom: dependency not found");
        expect((await getPreview(api, controller, slug))?.status).toBe("failed");

        await page.goto(`${controller.url}/previews/${slug}`);
        await expect(page.locator(".facts .badge")).toHaveText("failed");
        await expect(page.locator(".card > .error")).toContainText("boom: dependency not found");
        await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
    });

    test("a failed preview starts again from its detail page once it is fixed", async ({ page, controller, api, repository, branch, slug }) => {
        await repository.push(branch, { "start-preview.sh": failingStartScript });
        await api.request(`${controller.url}/api/previews/start?org=acme&repo=demo&branch=${branch}`);
        await waitForStatus(api, controller, slug, "failed");

        await repository.push(branch, { "start-preview.sh": await fixtureFile("start-preview.sh") });
        await page.goto(`${controller.url}/previews/${slug}`);
        await page.getByRole("button", { name: "Start" }).click();

        await waitForStatus(api, controller, slug, "running");
        expect((await api.request(controller.previewUrl(slug))).status).toBe(200);
    });

    test("a failed start is retried with a build even without new commits", async ({ controller, api, repository, branch, slug }) => {
        // Fails on the first run only, the way a flaky download would.
        const flakyStartScript = `#!/bin/sh
set -eu
if [ ! -e ../${slug}.attempted ]; then
    touch ../${slug}.attempted
    echo "download failed" >&2
    exit 1
fi
exec ./start-preview.real.sh
`;
        await repository.push(branch, { "start-preview.real.sh": await fixtureFile("start-preview.sh"), "start-preview.sh": flakyStartScript });
        await api.request(`${controller.url}/api/previews/start?org=acme&repo=demo&branch=${branch}`);
        await waitForStatus(api, controller, slug, "failed");

        await api.request(`${controller.url}/previews/${slug}/start`, { method: "POST", form: { redirectTo: "/" } });
        await waitForStatus(api, controller, slug, "running");
        const log = await api.request(`${controller.url}/api/previews/${slug}/logs?source=start`);
        expect(log.body).toContain("running start-preview.sh...");
    });

    test("a crashing service is called out on the logs page", async ({ page, controller, api, repository, branch, slug }) => {
        await repository.push(branch, { "compose.yml": crashingWorker });
        await api.request(`${controller.url}/api/previews/start?org=acme&repo=demo&branch=${branch}`);
        // The preview as a whole is running, only one of its services is not.
        await waitForStatus(api, controller, slug, "running");

        await page.goto(`${controller.url}/previews/${slug}/logs`);
        // The logs page reloads itself only once a container failed.
        await expect(async () => {
            await page.reload();
            await expect(page.locator(".filters a.chip-failed")).toBeVisible({ timeout: 500 });
        }).toPass({ timeout: 30_000 });
        await expect(page.locator(".card > .error")).toContainText("One container is not running: worker (exited (3)).");
        await expect(page.locator(".filters a.chip-failed")).toHaveText("workerexited (3)");
        await expect(page.locator(".filters a.chip-running")).toHaveText("web");

        await page.locator(".filters a.chip-failed").click();
        await expect(page).toHaveURL(`${controller.url}/previews/${slug}/logs?service=worker`);
        await expect(page.locator("pre").last()).toContainText("worker crashed");
        await expect(page.locator("pre").last()).not.toContainText("fixture app");
    });
});
