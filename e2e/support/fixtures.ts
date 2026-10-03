import { randomBytes } from "node:crypto";

import { test as base, expect } from "@playwright/test";

import { createSlug } from "../../src/repository.ts";
import { baseDomain, Controller, type Client, type FixtureRepository, type PreviewJson } from "./environment.ts";

type WorkerFixtures = {
    controller: Controller;
    repository: FixtureRepository;
};

type TestFixtures = {
    /** A client that is signed in already. */
    api: Client;
    /** A branch of its own for every test, so that tests sharing a controller do not see each other. */
    branch: string;
    /** The slug the controller gives `branch` of `repository`. */
    slug: string;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
    controller: [
        async ({}, use, workerInfo) => {
            const controller = await Controller.start(workerInfo.workerIndex);
            await use(controller);
            await controller.dispose();
        },
        { scope: "worker" },
    ],
    repository: [async ({ controller }, use) => use(await controller.createRepository("acme", "demo")), { scope: "worker" }],
    api: async ({ controller }, use) => {
        const client = controller.client();
        await client.login();
        await use(client);
    },
    branch: async ({}, use, testInfo) => {
        const title = testInfo.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        // Random rather than derived from the test, because --repeat-each runs the same test on the same controller again.
        await use(`${title.slice(0, 24).replace(/-+$/, "")}-${randomBytes(3).toString("hex")}`);
    },
    slug: async ({ repository, branch }, use) => {
        await use(createSlug({ org: repository.org, repo: repository.repo, branch }));
    },
    // Browsers resolve *.localhost on their own, so the page talks to the controller directly.
    // Signing in through the form is tested separately, every other test starts signed in.
    page: async ({ page, api, controller }, use) => {
        const [name, value] = (api.cookie ?? "").split("=");
        // The leading dot makes it a domain cookie, like the one the controller sets.
        await page.context().addCookies([{ name, value, domain: `.${baseDomain}`, path: "/" }]);
        await page.goto(controller.url);
        await use(page);
    },
});

export { expect };

export async function getPreview(api: Client, controller: Controller, slug: string): Promise<PreviewJson | undefined> {
    const response = await api.request(`${controller.url}/api/previews`);
    expect(response.status).toBe(200);
    return (JSON.parse(response.body) as PreviewJson[]).find((preview) => preview.slug === slug);
}

export async function waitForStatus(api: Client, controller: Controller, slug: string, status: PreviewJson["status"]): Promise<PreviewJson> {
    await expect
        .poll(async () => (await getPreview(api, controller, slug))?.status, { message: `${slug} should become ${status}`, timeout: 20_000 })
        .toBe(status);
    return (await getPreview(api, controller, slug))!;
}

/** Starts a preview of the given branch through the api and waits until it runs. */
export async function startPreview(api: Client, controller: Controller, repository: FixtureRepository, branch: string): Promise<PreviewJson> {
    const query = new URLSearchParams({ org: repository.org, repo: repository.repo, branch });
    const response = await api.request(`${controller.url}/api/previews/start?${query.toString()}`);
    expect(response.status, response.body).toBe(200);
    const { slug } = JSON.parse(response.body) as PreviewJson;
    return waitForStatus(api, controller, slug, "running");
}
