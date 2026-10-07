import { baseDomain, Client, previewUrl } from "./support/environment.ts";
import { expect, startPreview, test, waitFor } from "./support/fixtures.ts";

const controllerUrl = new Client().url;
const callbackUrl = `${controllerUrl}/__oauth2/callback`;

/** The way back a sign-in carries, from the redirect to oauth2-proxy. */
function returnTo(location: unknown): string | null {
    const url = new URL(String(location));
    expect(url.origin + url.pathname).toBe(`${controllerUrl}/__oauth2/start`);
    return url.searchParams.get("rd");
}

test("everything asks for a sign-in first, on the base domain, and leads back to the full url", async ({ controller: _ }) => {
    const anonymous = new Client();
    for (const url of [
        `${controllerUrl}/previews/x?y=1`,
        `${previewUrl("acme-demo-main")}/some/page?x=1`,
        `${previewUrl("acme-demo-main", "admin")}/`,
    ]) {
        const response = await anonymous.request(url);
        expect(response.status, url).toBe(302);
        expect(returnTo(response.headers.location), url).toBe(url);
    }

    // The api answers fetches of the frontend with 401, as does everything that is not a get.
    expect((await anonymous.request("/api/previews")).status).toBe(401);
    expect((await anonymous.request(previewUrl("acme-demo-main"), { method: "POST" })).status).toBe(401);
});

test("signing in on a preview url leads back to the preview, and is valid for every host", async ({ browser, api, controller, branch }) => {
    const slug = await startPreview(api, controller, branch);
    await waitFor(api, slug, "running");
    const signInsBefore = controller.identityProvider.signIns.length;

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${previewUrl(slug, "admin")}/some/page?x=1`);
    await expect(page.locator("body")).toContainText('"url":"/some/page?x=1"');
    expect(page.url()).toBe(`${previewUrl(slug, "admin")}/some/page?x=1`);

    // The provider was asked once, with the one callback on the base domain.
    expect(controller.identityProvider.signIns.slice(signInsBefore)).toEqual([{ redirectUri: callbackUrl }]);

    // The session cookie is on the base domain, so the preview itself and the controller are
    // open as well without signing in again.
    const cookies = await context.cookies();
    expect(cookies.find((cookie) => cookie.name === "_oauth2_proxy")?.domain).toBe(`.${baseDomain}`);
    await page.goto(previewUrl(slug));
    await expect(page.locator("body")).toContainText('"url":"/"');
    await page.goto(controllerUrl);
    await expect(page.getByRole("heading", { name: "Previews" })).toBeVisible();
    expect(controller.identityProvider.signIns.length).toBe(signInsBefore + 1);

    // The preview never sees the cookies of oauth2-proxy, only its own.
    await context.addCookies([{ name: "own", value: "1", domain: `.${baseDomain}`, path: "/" }]);
    await page.goto(previewUrl(slug));
    const echoed = JSON.parse(await page.locator("body").innerText()) as { headers: { cookie?: string } };
    expect(echoed.headers.cookie).toBe("own=1");

    await context.close();
});

test("signing out ends the session for every host", async ({ api, controller, branch }) => {
    const slug = await startPreview(api, controller, branch);
    const client = new Client();
    await client.login();
    expect((await client.request("/api/previews")).status).toBe(200);

    const signOut = await client.request("/__oauth2/sign_out");
    expect(signOut.status).toBe(302);
    expect((await client.request("/api/previews")).status).toBe(401);
    expect((await client.request(previewUrl(slug))).status).toBe(302);
});
