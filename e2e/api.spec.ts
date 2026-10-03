import { access } from "node:fs/promises";
import { join } from "node:path";

import { createSlug } from "../src/repository.ts";
import type { PreviewJson } from "./support/environment.ts";
import { expect, getPreview, startPreview, test, waitForStatus } from "./support/fixtures.ts";

function exists(path: string): Promise<boolean> {
    return access(path).then(
        () => true,
        () => false,
    );
}

test.describe("api", () => {
    test("starting needs org, repo and branch", async ({ controller, api }) => {
        const response = await api.request(`${controller.url}/api/previews/start?org=acme&repo=demo`);
        expect(response.status).toBe(400);
        expect(JSON.parse(response.body)).toEqual({ error: "org, repo and branch are required" });
    });

    for (const [query, error] of [
        ["org=-acme&repo=demo&branch=main", 'Invalid organization "-acme"'],
        ["org=acme&repo=de..mo&branch=main", 'Invalid repository "de..mo"'],
        ["org=acme&repo=demo&branch=..%2Fetc", 'Invalid branch "../etc"'],
        ["org=acme&repo=demo&branch=main%3Brm+-rf", 'Invalid branch "main;rm -rf"'],
    ]) {
        test(`rejects ${query}`, async ({ controller, api }) => {
            const response = await api.request(`${controller.url}/api/previews/start?${query}`);
            expect(response.status).toBe(400);
            expect(JSON.parse(response.body)).toEqual({ error });
        });
    }

    test("starts a preview in the background and reports its url", async ({ controller, api, repository, branch, slug }) => {
        const commit = await repository.push(branch);
        const response = await api.request(`${controller.url}/api/previews/start?org=acme&repo=demo&branch=${branch}`);
        expect(response.status).toBe(200);
        const started = JSON.parse(response.body) as PreviewJson;
        expect(started).toMatchObject({ slug, status: "starting", ref: { org: "acme", repo: "demo", branch } });

        const preview = await waitForStatus(api, controller, slug, "running");
        expect(preview.commit).toBe(commit);
        // The first url the project reported is where a preview is opened, urls that are not http are dropped.
        expect(preview.url).toBe(controller.previewUrl(slug));
        expect(preview.urls).toEqual([
            { name: "Site", url: controller.previewUrl(slug) },
            { name: "Admin", url: controller.previewUrl(slug, "admin") },
        ]);

        const site = await api.request(preview.url);
        expect(site.status).toBe(200);
        expect(JSON.parse(site.body)).toMatchObject({ version: "v1" });
    });

    test("asking again for a running preview changes nothing", async ({ controller, api, repository, branch }) => {
        await repository.push(branch);
        const first = await startPreview(api, controller, repository, branch);

        const response = await api.request(`${controller.url}/api/previews/start?org=acme&repo=demo&branch=${branch}`);
        expect(JSON.parse(response.body)).toMatchObject({ slug: first.slug, status: "running", port: first.port });
    });

    test("a branch with a slash gets a slug with a hash", async ({ controller, api, repository, branch }) => {
        const nested = `feature/${branch}`;
        await repository.push(nested);
        const preview = await startPreview(api, controller, repository, nested);

        expect(preview.slug).toBe(createSlug({ org: "acme", repo: "demo", branch: nested }));
        expect(preview.slug).toMatch(/-[0-9a-f]{6}$/);
        expect(preview.slug).not.toContain("--");
        expect((await api.request(preview.url)).status).toBe(200);
    });

    test("the start script gets everything it needs from the environment", async ({ controller, api, repository, branch }) => {
        await repository.push(branch);
        const preview = await startPreview(api, controller, repository, branch);

        const log = await api.request(`${controller.url}/api/previews/${preview.slug}/logs?source=start`);
        expect(log.status).toBe(200);
        expect(log.body).toContain(`--- starting ${preview.slug} (acme/demo @ ${branch}) ---`);
        expect(log.body).toContain("running start-preview.sh...");
        expect(log.body).toContain(
            `slug=${preview.slug} project=preview-${preview.slug} port=${preview.port} host=${preview.slug}.preview.localhost:${controller.port} scheme=http`,
        );
        expect(log.body).toContain(`--- ${preview.slug} is up on port ${preview.port} ---`);
    });

    test("container logs can be read per service", async ({ controller, api, repository, branch }) => {
        await repository.push(branch);
        const preview = await startPreview(api, controller, repository, branch);
        await api.request(`${preview.url}/hello`);

        const all = await api.request(`${controller.url}/api/previews/${preview.slug}/logs`);
        expect(all.status).toBe(200);
        expect(all.body).toContain("fixture app v1 listening");
        expect(all.body).toMatch(/web-1 +\| \S+ GET \S+\/hello/);

        const tail = await api.request(`${controller.url}/api/previews/${preview.slug}/logs?service=web&tail=1`);
        expect(tail.body.trim().split("\n")).toHaveLength(1);

        const otherService = await api.request(`${controller.url}/api/previews/${preview.slug}/logs?service=db`);
        expect(otherService.body).toBe("");
    });

    test("stops and deletes a preview", async ({ controller, api, repository, branch }) => {
        await repository.push(branch);
        const preview = await startPreview(api, controller, repository, branch);
        const checkout = join(controller.dataDir, "checkouts", preview.slug);
        expect(await exists(checkout)).toBe(true);

        const stop = await api.request(`${controller.url}/api/previews/${preview.slug}/stop`, { method: "POST" });
        expect(JSON.parse(stop.body)).toEqual({ ok: true });
        expect((await getPreview(api, controller, preview.slug))?.status).toBe("stopped");

        const remove = await api.request(`${controller.url}/api/previews/${preview.slug}`, { method: "DELETE" });
        expect(JSON.parse(remove.body)).toEqual({ ok: true });
        expect(await getPreview(api, controller, preview.slug)).toBeUndefined();
        expect(await exists(checkout)).toBe(false);
        expect(await exists(join(controller.dataDir, "logs", `${preview.slug}.log`))).toBe(false);
    });

    test("unknown previews are reported as such", async ({ controller, api }) => {
        const slug = "acme-demo-does-not-exist";
        for (const [method, path] of [
            ["GET", `/api/previews/${slug}/logs`],
            ["POST", `/api/previews/${slug}/stop`],
            ["DELETE", `/api/previews/${slug}`],
        ]) {
            const response = await api.request(`${controller.url}${path}`, { method });
            expect(response.status, `${method} ${path}`).toBe(404);
            expect(JSON.parse(response.body), `${method} ${path}`).toEqual({ error: `Unknown preview "${slug}"` });
        }
    });
});
