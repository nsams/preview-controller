import { Client, password, previewUrl } from "./support/environment.ts";
import { expect, startPreview, test, waitFor } from "./support/fixtures.ts";

test("everything asks for the password first", async ({ controller: _ }) => {
    const anonymous = new Client();
    for (const url of ["/", "/api/previews", previewUrl("acme-demo-main")]) {
        const response = await anonymous.request(url);
        expect(response.status, url).toBe(401);
        expect(response.body, url).toContain("This environment is password protected.");
    }
});

test("signing in on a preview url leads back to the preview", async ({ browser, api, controller, branch }) => {
    const slug = await startPreview(api, controller, branch);
    await waitFor(api, slug, "running");

    const page = await browser.newPage();
    await page.goto(`${previewUrl(slug)}/some/page`);
    await page.getByPlaceholder("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Wrong password")).toBeVisible();

    await page.getByPlaceholder("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("body")).toContainText('"url":"/some/page"');

    // The cookie is set on the base domain, so the controller itself is open as well.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Previews" })).toBeVisible();
    await page.close();
});
