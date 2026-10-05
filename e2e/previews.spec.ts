import { existsSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { previewUrl } from "./support/environment.ts";
import { expect, startPreview, test, waitFor } from "./support/fixtures.ts";

/** The status chip next to the title. The page polls on its own, so this only has to wait. */
function expectStatus(page: Page, status: string) {
    return expect(page.getByText(status, { exact: true })).toBeVisible({ timeout: 90_000 });
}

test("starts a preview from the form and opens it", async ({ page, controller, branch, slug }) => {
    const commit = await controller.repository.push(branch);

    await page.getByLabel("Organization").fill("acme");
    await page.getByLabel("Repository").fill("demo");
    await page.getByLabel("Branch").fill(branch);
    await page.getByRole("button", { name: "Start" }).click();

    await expect(page.getByRole("heading", { name: slug })).toBeVisible();
    await expectStatus(page, "running");
    await expect(page.locator("dd code")).toHaveText(commit);
    await expect(page.getByRole("link", { name: "Admin" })).toBeVisible();

    await page.getByRole("link", { name: "Site" }).click();
    await expect(page.locator("body")).toContainText('"version":"v1"');
});

test("an invalid branch is reported in the form", async ({ page }) => {
    await page.getByLabel("Organization").fill("acme");
    await page.getByLabel("Repository").fill("demo");
    await page.getByLabel("Branch").fill("-not-a-branch");
    await page.getByRole("button", { name: "Start" }).click();

    await expect(page.getByRole("alert")).toHaveText('Invalid branch "-not-a-branch"');
});

test("a branch that cannot start is reported in the form, without creating a preview", async ({ page, api, controller, branch }) => {
    await page.getByLabel("Organization").fill("acme");
    await page.getByLabel("Repository").fill("demo");
    await page.getByLabel("Branch").fill(branch);
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("alert")).toContainText(`Branch "${branch}" does not exist`);

    await controller.repository.push(branch);
    await page.getByLabel("Start script").fill("missing.sh");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("alert")).toContainText('Start script "missing.sh" does not exist');

    expect((await api.previews()).filter((preview) => preview.ref?.branch === branch)).toEqual([]);
});

test("proxies every host of a preview without the session cookie", async ({ api, controller, branch }) => {
    const slug = await startPreview(api, controller, branch);
    await waitFor(api, slug, "running");

    const response = await api.request(`${previewUrl(slug)}/path?query=1`, { method: "POST", form: { a: "b" }, headers: { cookie: "app=1" } });
    expect(JSON.parse(response.body)).toMatchObject({
        url: "/path?query=1",
        body: "a=b",
        headers: { cookie: "app=1", "x-forwarded-proto": "http", "x-forwarded-host": new URL(previewUrl(slug)).host },
    });

    for (const host of [previewUrl(slug, "admin"), previewUrl(`admin.${slug}`)]) {
        expect(JSON.parse((await api.request(host)).body).headers.host).toBe(new URL(host).host);
    }
    expect((await api.request(previewUrl("nothing-here"))).status).toBe(404);
});

test("a stopped preview starts again when it is opened", async ({ page, api, controller, branch, slug }) => {
    await startPreview(api, controller, branch);
    await page.goto(`/previews/${slug}`);
    await expectStatus(page, "running");

    await page.getByRole("button", { name: "Stop" }).click();
    await expectStatus(page, "stopped");

    // The page shown meanwhile reloads itself until the preview is back.
    await page.goto(previewUrl(slug));
    await expect(page.getByRole("heading", { name: "Starting the preview" })).toBeVisible();
    await expect(page.locator("body")).toContainText('"version":"v1"', { timeout: 90_000 });
});

test("deleting asks first and removes the checkout", async ({ page, api, controller, branch, slug }) => {
    await startPreview(api, controller, branch);
    await waitFor(api, slug, "running");
    await api.request(`/api/previews/${slug}/stop`, { method: "POST" });

    await page.goto(`/previews/${slug}`);
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();

    await expect(page.getByRole("heading", { name: "Previews" })).toBeVisible();
    await expect.poll(() => api.preview(slug)).toBeUndefined();
    expect(existsSync(join(controller.dataDir, "checkouts", slug))).toBe(false);
});

test("a restart picks up new commits and only builds for them", async ({ page, api, controller, branch, slug }) => {
    await startPreview(api, controller, branch);
    await page.goto(`/previews/${slug}`);
    await expectStatus(page, "running");

    await page.getByRole("button", { name: "Restart" }).click();
    await expect.poll(() => api.startLog(slug), { timeout: 90_000 }).toContain("is still at");
    await waitFor(api, slug, "running");

    const commit = await controller.repository.push(branch, { "version.txt": "v2" });
    await page.getByRole("button", { name: "Restart" }).click();
    // The status reads running a moment before the new commit, so the commit is what to wait for.
    await expect.poll(async () => (await api.preview(slug))?.commit, { timeout: 90_000 }).toBe(commit);
    await waitFor(api, slug, "running");
    expect(await api.startLog(slug)).toContain("building v2");
    expect(JSON.parse((await api.request(previewUrl(slug))).body).version).toBe("v2");
});

test("the logs page shows the start and the containers", async ({ page, api, controller, branch, slug }) => {
    await startPreview(api, controller, branch);
    await waitFor(api, slug, "running");

    await page.goto(`/previews/${slug}/logs`);
    await expect(page.locator("pre").first()).toContainText("building v1");
    await expect(page.locator("pre").last()).toContainText("fixture app v1 listening");
});

test("the logs page follows the logs while it is open", async ({ page, api, controller, branch, slug }) => {
    await startPreview(api, controller, branch);
    await waitFor(api, slug, "running");

    await page.goto(`/previews/${slug}/logs`);
    await expect(page.getByTestId("container-log-state")).toHaveText("live");
    await api.request(`${previewUrl(slug)}/followed-live`);
    await expect(page.locator("pre").last()).toContainText("fixture app served /followed-live");

    // A restart clears the start log and writes it anew, which shows up without a reload too.
    await expect(page.locator("pre").first()).toContainText("building v1");
    await api.request(`/api/previews/${slug}/restart`, { method: "POST" });
    await expect(page.locator("pre").first()).toContainText("is still at", { timeout: 90_000 });
    await expect(page.locator("pre").first()).toContainText("is up on port", { timeout: 90_000 });
    await expect(page.locator("pre").first()).not.toContainText("building v1");
});

test("the logs only follow while follow is switched on", async ({ page, api, controller, branch, slug }) => {
    await startPreview(api, controller, branch);
    await waitFor(api, slug, "running");
    const request = async (count: number, path: string) => {
        for (let index = 0; index < count; index++) {
            await api.request(`${previewUrl(slug)}/${path}-${index}`);
        }
    };

    await page.goto(`/previews/${slug}/logs`);
    await expect(page.getByTestId("container-log-state")).toHaveText("live");
    const log = page.locator("pre").last();
    const follow = page.getByRole("switch", { name: "Follow" }).last();
    const distanceFromBottom = () => log.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight);

    await expect(follow).toBeChecked();
    await request(80, "followed");
    await expect(log).toContainText("fixture app served /followed-79");
    await expect.poll(distanceFromBottom).toBeLessThan(5);

    await follow.uncheck();
    const scrollTop = await log.evaluate((element) => element.scrollTop);
    await request(40, "not-followed");
    await expect(log).toContainText("fixture app served /not-followed-39");
    expect(await log.evaluate((element) => element.scrollTop)).toBe(scrollTop);
    expect(await distanceFromBottom()).toBeGreaterThan(100);

    // Switching it back on jumps to the end, scrolling up switches it off again.
    await follow.check();
    await expect.poll(distanceFromBottom).toBeLessThan(5);
    await log.evaluate((element) => element.scrollTo({ top: 0 }));
    await expect(follow).not.toBeChecked();
});

test("a restarted controller finds its previews again", async ({ api, controller, branch }) => {
    const slug = await startPreview(api, controller, branch);
    const before = await waitFor(api, slug, "running");

    await controller.stop();
    await controller.launch();

    // Nothing is stored, docker and the checkout are all it goes by.
    expect(await api.preview(slug)).toMatchObject({ status: "running", commit: before.commit, ref: before.ref, urls: before.urls });
    expect((await api.request(previewUrl(slug))).status).toBe(200);
});

test("the link of the github action starts the preview and opens it", async ({ page, api, controller, branch, slug }) => {
    await controller.repository.push(branch);

    await page.goto(`/open/acme/demo/${branch}`);
    await expect(page.locator("body")).toContainText('"version":"v1"', { timeout: 90_000 });

    // Once it runs, the same link only opens it.
    const response = await api.request(`/open/acme/demo/${branch}`);
    expect(response.status).toBe(302);
    expect((await api.preview(slug))?.status).toBe("running");
});

test("the link of the github action reports an invalid branch", async ({ api }) => {
    const response = await api.request("/open/acme/demo/-not-a-branch");
    expect(response.status).toBe(400);
    expect(response.body).toContain("Invalid branch");
});
