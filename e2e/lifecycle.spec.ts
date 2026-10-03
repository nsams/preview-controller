import { access } from "node:fs/promises";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { expect, getPreview, startPreview, test } from "./support/fixtures.ts";

/** The detail page reloads itself while a preview starts, this only saves waiting for that. */
async function expectStatus(page: Page, status: string): Promise<void> {
    await expect(async () => {
        await page.reload();
        await expect(page.locator(".facts .badge")).toHaveText(status, { timeout: 500 });
    }).toPass({ timeout: 90_000 });
}

test.describe("status and detail page", () => {
    test("starts a preview from the form and opens it", async ({ page, controller, repository, branch, slug }) => {
        const commit = await repository.push(branch);

        await page.getByPlaceholder("vivid-planet").fill("acme");
        await page.locator('input[name="repo"]').fill("demo");
        await page.locator('input[name="branch"]').fill(branch);
        await page.getByRole("button", { name: "Start" }).click();

        await expect(page).toHaveURL(`${controller.url}/previews/${slug}`);
        await expect(page.getByRole("heading", { name: slug })).toBeVisible();
        await expectStatus(page, "running");

        await expect(page.locator(".facts")).toContainText(`acme/demo @ ${branch}`);
        await expect(page.locator(".facts code")).toHaveText(commit);
        await expect(page.locator(".link-buttons a")).toHaveText(["Site", "Admin"]);
        await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);

        await page.getByRole("link", { name: "Site" }).click();
        await expect(page).toHaveURL(`${controller.previewUrl(slug)}/`);
        await expect(page.locator("body")).toContainText('"version":"v1"');
    });

    test("lists previews and prefills the form with the last repository", async ({ page, controller, api, repository, branch, slug }) => {
        await repository.push(branch);
        await startPreview(api, controller, repository, branch);

        await page.goto(controller.url);
        const row = page.locator("tr", { has: page.getByRole("link", { name: `acme/demo @ ${branch}` }) });
        await expect(row).toContainText("running");
        await expect(page.locator('input[name="org"]')).toHaveValue("acme");
        await expect(page.locator('input[name="repo"]')).toHaveValue("demo");
        await expect(page.locator('input[name="branch"]')).toHaveValue("");

        await row.getByRole("link", { name: "logs" }).click();
        await expect(page).toHaveURL(`${controller.url}/previews/${slug}/logs`);
        await expect(page.getByRole("heading", { name: "Logs" })).toBeVisible();
        await expect(page.locator("pre").first()).toContainText("running start-preview.sh...");
        await expect(page.locator("pre").last()).toContainText("fixture app v1 listening");
    });

    test("an invalid branch is reported in the form", async ({ page }) => {
        await page.locator('input[name="org"]').fill("acme");
        await page.locator('input[name="repo"]').fill("demo");
        await page.locator('input[name="branch"]').fill("-not-a-branch");
        await page.getByRole("button", { name: "Start" }).click();

        await expect(page.locator(".error")).toHaveText('Invalid branch "-not-a-branch"');
        await expect(page.locator('input[name="branch"]')).toHaveValue("-not-a-branch");
    });

    test("a stopped preview starts again when it is opened", async ({ page, controller, api, repository, branch, slug }) => {
        await repository.push(branch);
        await startPreview(api, controller, repository, branch);

        await page.goto(`${controller.url}/previews/${slug}`);
        await page.getByRole("button", { name: "Stop" }).click();
        await expect(page.locator(".facts .badge")).toHaveText("stopped");
        await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Restart" })).toHaveCount(0);
        expect((await api.request(controller.previewUrl(slug))).status).toBe(503);

        // The starting page reloads itself until the preview is back.
        await page.goto(controller.previewUrl(slug));
        await expect(page.locator("body")).toContainText('"version":"v1"', { timeout: 90_000 });
    });

    test("the start button brings a stopped preview back up", async ({ page, controller, api, repository, branch, slug }) => {
        await repository.push(branch);
        await startPreview(api, controller, repository, branch);
        await api.request(`${controller.url}/api/previews/${slug}/stop`, { method: "POST" });

        await page.goto(`${controller.url}/previews/${slug}`);
        await page.getByRole("button", { name: "Start" }).click();
        await expectStatus(page, "running");
        expect((await api.request(controller.previewUrl(slug))).status).toBe(200);
    });

    test("deleting asks first and removes everything", async ({ page, controller, api, repository, branch, slug }) => {
        await repository.push(branch);
        await startPreview(api, controller, repository, branch);
        await api.request(`${controller.url}/api/previews/${slug}/stop`, { method: "POST" });

        await page.goto(`${controller.url}/previews/${slug}`);
        page.once("dialog", (dialog) => void dialog.dismiss());
        await page.getByRole("button", { name: "Delete" }).click();
        await expect(page).toHaveURL(`${controller.url}/previews/${slug}`);
        expect(await getPreview(api, controller, slug)).toBeDefined();

        page.once("dialog", (dialog) => {
            expect(dialog.message()).toContain(`Delete ${slug}?`);
            void dialog.accept();
        });
        await page.getByRole("button", { name: "Delete" }).click();
        await expect(page).toHaveURL(`${controller.url}/`);
        await expect(page.getByRole("link", { name: `acme/demo @ ${branch}` })).toHaveCount(0);
        expect(await getPreview(api, controller, slug)).toBeUndefined();
        await expect(access(join(controller.dataDir, "checkouts", slug))).rejects.toThrow();
    });

    test("a running preview cannot be deleted", async ({ controller, api, repository, branch, slug }) => {
        await repository.push(branch);
        await startPreview(api, controller, repository, branch);

        const response = await api.request(`${controller.url}/previews/${slug}/delete`, { method: "POST", form: { redirectTo: "/" } });
        expect(response.status).toBe(409);
        expect(response.body).toContain(`Only a stopped preview can be deleted, ${slug} is running.`);
        expect((await getPreview(api, controller, slug))?.status).toBe("running");
    });

    test("an unknown preview has no detail page", async ({ controller, api }) => {
        for (const path of ["/previews/acme-demo-nothing", "/previews/acme-demo-nothing/logs"]) {
            const response = await api.request(`${controller.url}${path}`);
            expect(response.status, path).toBe(404);
        }
        const action = await api.request(`${controller.url}/previews/acme-demo-nothing/start`, { method: "POST", form: { redirectTo: "/" } });
        expect(action.status).toBe(404);
    });
});
