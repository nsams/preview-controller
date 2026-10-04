import { randomBytes } from "node:crypto";

import { test as base, expect } from "@playwright/test";

import { createSlug } from "../../src/repository.ts";
import { baseDomain, Client, Controller, type Preview } from "./environment.ts";

export { expect };

export const test = base.extend<{ api: Client; branch: string; slug: string }, { controller: Controller }>({
    controller: [
        async ({}, use) => {
            const controller = await Controller.start();
            await use(controller);
            await controller.dispose();
        },
        { scope: "worker" },
    ],
    api: async ({ controller: _ }, use) => {
        const api = new Client();
        await api.login();
        await use(api);
    },
    // A branch of its own for every test. Its previews are deleted afterwards, because every
    // preview has a docker network of its own and docker runs out of them after about 30.
    branch: async ({ api }, use, testInfo) => {
        const branch = `${testInfo.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .slice(0, 24)}-${randomBytes(3).toString("hex")}`;
        await use(branch);
        for (const preview of await api.previews()) {
            if (preview.ref?.branch === branch) {
                await api.request(`/api/previews/${preview.slug}`, { method: "DELETE" });
            }
        }
    },
    slug: async ({ branch }, use) => {
        await use(createSlug({ org: "acme", repo: "demo", branch }));
    },
    // Browsers resolve *.localhost on their own. Every page starts signed in on the status page.
    page: async ({ page, api }, use) => {
        const [name, value] = api.cookie!.split("=");
        await page.context().addCookies([{ name, value, domain: `.${baseDomain}`, path: "/" }]);
        await page.goto("/");
        await use(page);
    },
});

export async function waitFor(api: Client, slug: string, status: Preview["status"]): Promise<Preview> {
    await expect.poll(async () => (await api.preview(slug))?.status, { message: `${slug} should be ${status}`, timeout: 90_000 }).toBe(status);
    return (await api.preview(slug))!;
}

/** Starts a preview of the branch through the api, pushing the branch first. */
export async function startPreview(api: Client, controller: Controller, branch: string, files: Record<string, string> = {}): Promise<string> {
    await controller.repository.push(branch, files);
    const response = await api.request(`/api/previews/start?org=acme&repo=demo&branch=${branch}`);
    expect(response.status, response.body).toBe(200);
    return (JSON.parse(response.body) as Preview).slug;
}
