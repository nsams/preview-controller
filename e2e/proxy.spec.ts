import { baseDomain, docker } from "./support/environment.ts";
import { expect, startPreview, test } from "./support/fixtures.ts";

type Echo = {
    version: string;
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string;
};

test.describe("proxy", () => {
    test("passes a request on without the session cookie", async ({ controller, api, repository, branch }) => {
        await repository.push(branch);
        const preview = await startPreview(api, controller, repository, branch);

        const response = await api.request(`${preview.url}/some/path?query=1`, { headers: { cookie: "app_session=abc" } });
        expect(response.status).toBe(200);
        // What the preview sets reaches the browser unchanged.
        expect(response.headers["set-cookie"]).toEqual(["fixture_app=1; Path=/"]);

        const echo = JSON.parse(response.body) as Echo;
        expect(echo.url).toBe("/some/path?query=1");
        expect(echo.headers.cookie).toBe("app_session=abc");
        expect(echo.headers.host).toBe(`${preview.slug}.${baseDomain}:${controller.port}`);
        expect(echo.headers["x-forwarded-host"]).toBe(`${preview.slug}.${baseDomain}:${controller.port}`);
        expect(echo.headers["x-forwarded-proto"]).toBe("http");

        const withoutCookie = JSON.parse((await api.request(preview.url)).body) as Echo;
        expect(withoutCookie.headers.cookie).toBeUndefined();
    });

    test("passes method and body on", async ({ controller, api, repository, branch }) => {
        await repository.push(branch);
        const preview = await startPreview(api, controller, repository, branch);

        const response = await api.request(`${preview.url}/form`, { method: "POST", form: { name: "value" } });
        expect(JSON.parse(response.body)).toMatchObject({ method: "POST", url: "/form", body: "name=value" });
    });

    test("routes every host of a preview to it", async ({ controller, api, repository, branch }) => {
        await repository.push(branch);
        const preview = await startPreview(api, controller, repository, branch);

        const hosts = [
            `admin--${preview.slug}.${baseDomain}:${controller.port}`,
            `idp--${preview.slug}.${baseDomain}:${controller.port}`,
            // The older spelling, which projects that have not been migrated still use.
            `admin.${preview.slug}.${baseDomain}:${controller.port}`,
        ];
        for (const host of hosts) {
            const response = await api.request(`http://${host}/`);
            expect(response.status, host).toBe(200);
            expect((JSON.parse(response.body) as Echo).headers.host, host).toBe(host);
        }
    });

    test("an unknown host is answered by the controller", async ({ controller, api }) => {
        for (const host of [`nothing-here.${baseDomain}`, `admin--nothing-here.${baseDomain}`, "example.com"]) {
            const response = await api.request(`http://${host}:${controller.port}/`);
            expect(response.status, host).toBe(404);
            expect(response.body, host).toContain("No preview for this host");
        }
    });

    test("a preview that went away answers with a bad gateway", async ({ controller, api, repository, branch }) => {
        await repository.push(branch);
        const preview = await startPreview(api, controller, repository, branch);

        // Stopping behind the back of the controller, which only notices on its next refresh.
        await docker(["compose", "-p", `preview-${preview.slug}`, "stop"]);

        const response = await api.request(preview.url);
        expect(response.status).toBe(502);
        expect(response.body).toContain("Preview is not reachable");
    });
});
