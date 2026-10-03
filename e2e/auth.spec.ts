import { baseDomain, password } from "./support/environment.ts";
import { expect, startPreview, test } from "./support/fixtures.ts";

test.describe("signing in", () => {
    test("everything asks for the password first", async ({ controller, repository, api, branch }) => {
        await repository.push(branch);
        const preview = await startPreview(api, controller, repository, branch);
        const anonymous = controller.client();

        for (const url of [
            controller.url,
            `${controller.url}/api/previews`,
            `${controller.url}/previews/${preview.slug}`,
            controller.previewUrl(preview.slug),
        ]) {
            const response = await anonymous.request(url);
            expect(response.status, url).toBe(401);
            expect(response.body, url).toContain("This environment is password protected.");
        }
    });

    test("a wrong password is rejected", async ({ controller }) => {
        const response = await controller.client().request(`${controller.url}/__preview-controller/login`, {
            method: "POST",
            form: { password: "not-the-password" },
        });
        expect(response.status).toBe(401);
        expect(response.body).toContain("Wrong password");
        expect(response.headers["set-cookie"]).toBeUndefined();
    });

    test("the session cookie is valid for the base domain and all subdomains", async ({ controller }) => {
        const response = await controller.client().login();
        const cookie = response.headers["set-cookie"]?.[0] ?? "";
        expect(cookie).toContain(`Domain=${baseDomain}`);
        expect(cookie).toContain("HttpOnly");
        expect(cookie).toContain("SameSite=Lax");
        expect(cookie).not.toContain("Secure");
        expect(response.headers.location).toBe("/");
    });

    test("only local paths are accepted as redirect target", async ({ controller }) => {
        const client = controller.client();
        const login = (redirectTo: string) =>
            client.request(`${controller.url}/__preview-controller/login`, { method: "POST", form: { password, redirectTo } });

        expect((await login("/previews/some-slug")).headers.location).toBe("/previews/some-slug");
        expect((await login("//evil.example.com")).headers.location).toBe("/");
        expect((await login("https://evil.example.com")).headers.location).toBe("/");
        expect((await login("/\\evil.example.com")).headers.location).toBe("/");
    });

    test("a forged or expired cookie is not accepted", async ({ controller, api }) => {
        const [, value] = (api.cookie ?? "").split("=");
        const [expiresAt, signature] = value.split(".");
        const client = controller.client();

        for (const forged of [`${Number(expiresAt) + 1000}.${signature}`, `${Date.now() - 1000}.${signature}`, `${expiresAt}.`, "garbage"]) {
            client.cookie = `preview_controller_auth=${forged}`;
            expect((await client.request(`${controller.url}/api/previews`)).status, forged).toBe(401);
        }
        client.cookie = api.cookie;
        expect((await client.request(`${controller.url}/api/previews`)).status).toBe(200);
    });

    test("signing in through the form opens the controller and its previews", async ({ browser, controller, repository, api, branch }) => {
        await repository.push(branch);
        const preview = await startPreview(api, controller, repository, branch);

        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(controller.url);
        await page.getByPlaceholder("Password").fill("wrong-password");
        await page.getByRole("button", { name: "Sign in" }).click();
        await expect(page.getByText("Wrong password")).toBeVisible();

        await page.getByPlaceholder("Password").fill(password);
        await page.getByRole("button", { name: "Sign in" }).click();
        await expect(page.getByRole("heading", { name: "Previews" })).toBeVisible();

        // The cookie is set on the base domain, so the preview is open without signing in again.
        await page.goto(controller.previewUrl(preview.slug));
        await expect(page.locator("body")).toContainText('"version":"v1"');
        await context.close();
    });

    test("signing in from a preview url leads back to that preview", async ({ browser, controller, repository, api, branch }) => {
        await repository.push(branch);
        const preview = await startPreview(api, controller, repository, branch);

        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(`${controller.previewUrl(preview.slug)}/some/page`);
        await page.getByPlaceholder("Password").fill(password);
        await page.getByRole("button", { name: "Sign in" }).click();

        await expect(page).toHaveURL(`${controller.previewUrl(preview.slug)}/some/page`);
        await expect(page.locator("body")).toContainText('"url":"/some/page"');
        await context.close();
    });
});
