import { expect, getPreview, startPreview, test, waitForStatus } from "./support/fixtures.ts";

test.describe("restarting", () => {
    test("a restart picks up the commits pushed since the start", async ({ page, controller, api, repository, branch, slug }) => {
        await repository.push(branch);
        await startPreview(api, controller, repository, branch);
        const commit = await repository.push(branch, { "version.txt": "v2\n" });

        await page.goto(`${controller.url}/previews/${slug}`);
        await page.getByRole("button", { name: "Restart" }).click();
        await expect(page).toHaveURL(`${controller.url}/previews/${slug}`);

        // The status turns back to running a moment before the new commit is read in.
        await expect.poll(async () => (await getPreview(api, controller, slug))?.commit, { timeout: 20_000 }).toBe(commit);
        const preview = await waitForStatus(api, controller, slug, "running");
        expect(JSON.parse((await api.request(preview.url)).body)).toMatchObject({ version: "v2" });

        const log = await api.request(`${controller.url}/api/previews/${slug}/logs?source=start`);
        expect(log.body).toContain("building v2");
        // The log only ever shows the latest start.
        expect(log.body).not.toContain("building v1");
    });

    test("a restart without new commits does not build", async ({ controller, api, repository, branch, slug }) => {
        const commit = await repository.push(branch);
        await startPreview(api, controller, repository, branch);

        const response = await api.request(`${controller.url}/previews/${slug}/restart`, {
            method: "POST",
            form: { redirectTo: `/previews/${slug}` },
        });
        expect(response.status).toBe(303);
        expect(response.headers.location).toBe(`/previews/${slug}`);
        await waitForStatus(api, controller, slug, "running");

        const log = await api.request(`${controller.url}/api/previews/${slug}/logs?source=start`);
        expect(log.body).toContain(`${branch} is still at ${commit}, starting the containers it was built from...`);
        expect(log.body).not.toContain("running start-preview.sh");
    });

    test("waking a stopped preview builds only when the branch moved", async ({ controller, api, repository, branch, slug }) => {
        await repository.push(branch);
        await startPreview(api, controller, repository, branch);
        const startLog = () => api.request(`${controller.url}/api/previews/${slug}/logs?source=start`).then((response) => response.body);

        await api.request(`${controller.url}/api/previews/${slug}/stop`, { method: "POST" });
        await api.request(controller.previewUrl(slug));
        await waitForStatus(api, controller, slug, "running");
        expect(await startLog()).toContain("is still at");

        await api.request(`${controller.url}/api/previews/${slug}/stop`, { method: "POST" });
        await repository.push(branch, { "version.txt": "v3\n" });
        await api.request(controller.previewUrl(slug));
        await waitForStatus(api, controller, slug, "running");
        expect(await startLog()).toContain("building v3");
        expect(JSON.parse((await api.request(controller.previewUrl(slug))).body)).toMatchObject({ version: "v3" });
    });

    test("a restarted controller finds its previews again", async ({ controller, api, repository, branch, slug }) => {
        const commit = await repository.push(branch);
        const before = await startPreview(api, controller, repository, branch);

        await controller.kill();
        await controller.launch();

        // Nothing is stored: docker and the checkout are all it goes by.
        const after = await getPreview(api, controller, slug);
        expect(after).toMatchObject({ status: "running", commit, port: before.port, ref: { org: "acme", repo: "demo", branch }, urls: before.urls });
        expect((await api.request(controller.previewUrl(slug))).status).toBe(200);
    });
});
