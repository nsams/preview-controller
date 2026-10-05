import { readFileSync } from "node:fs";
import { join } from "node:path";

import { previewUrl } from "./support/environment.ts";
import { expect, startPreview, test, waitFor } from "./support/fixtures.ts";

test("a failed start is shown, not retried on its own, and started again by hand", async ({ page, api, controller, branch }) => {
    const slug = await startPreview(api, controller, branch, { fail: "boom: dependency not found" });
    expect((await waitFor(api, slug, "failed")).error).toContain("boom: dependency not found");

    const opened = await api.request(previewUrl(slug));
    expect(opened.status).toBe(503);
    expect(opened.body).toContain("The preview could not be started");
    expect((await api.preview(slug))?.status).toBe("failed");

    await controller.repository.push(branch, { fail: "" });
    await page.goto(`/previews/${slug}`);
    await expect(page.getByRole("alert")).toContainText("boom: dependency not found");
    await page.getByRole("button", { name: "Start" }).click();
    await waitFor(api, slug, "running");
});

test("a crashing service is called out on the detail page", async ({ page, api, controller, branch }) => {
    // Up long enough for `compose up --wait`, then gone for good.
    const compose = `${readFileSync(join(import.meta.dirname, "fixture-project", "compose.yml"), "utf8")}
  worker:
    build: .
    command: ["node", "-e", "setTimeout(() => { console.error('worker crashed'); process.exit(3); }, 3000)"]
`;
    const slug = await startPreview(api, controller, branch, { "compose.yml": compose });
    // The preview as a whole is running, only one of its services is not.
    await waitFor(api, slug, "running");

    // The page stops polling once nothing is starting or failing, which is the case until the worker exits.
    // The old logs page leads to the detail page.
    await page.goto(`/previews/${slug}/logs`);
    await expect(page).toHaveURL(`/previews/${slug}`);
    await expect(async () => {
        await page.reload();
        await expect(page.getByRole("alert")).toContainText("worker (exited (3))", { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });

    await page.locator('[data-status="failed"]').click();
    await expect(page.locator("pre")).toContainText("worker crashed");
});
