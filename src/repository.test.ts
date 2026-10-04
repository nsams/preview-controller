import assert from "node:assert/strict";
import { test } from "node:test";

import { createSlug, repositoryUrl, validateRepositoryRef } from "./repository.ts";

test("valid references pass", () => {
    for (const ref of [
        { org: "vivid-planet", repo: "dextinity-starter", branch: "main" },
        { org: "a", repo: "repo.name_1", branch: "feature/some-thing_1.2" },
    ]) {
        assert.equal(validateRepositoryRef(ref), undefined);
    }
});

test("anything that could end up as an option, a path or a shell word is rejected", () => {
    assert.equal(validateRepositoryRef({ org: "-org", repo: "repo", branch: "main" }), 'Invalid organization "-org"');
    assert.equal(validateRepositoryRef({ org: "org", repo: "re..po", branch: "main" }), 'Invalid repository "re..po"');
    for (const branch of ["-main", "../etc", "a..b", "main;rm", "main branch", "a$(b)", ""]) {
        assert.equal(validateRepositoryRef({ org: "org", repo: "repo", branch }), `Invalid branch "${branch}"`);
    }
});

test("the repository url points at github", () => {
    assert.equal(repositoryUrl({ org: "acme", repo: "demo", branch: "main" }), "https://github.com/acme/demo.git");
});

test("a slug is readable as long as nothing gets lost", () => {
    assert.equal(createSlug({ org: "acme", repo: "demo", branch: "main" }), "acme-demo-main");
});

test("case does not matter, like on github", () => {
    assert.equal(createSlug({ org: "Acme", repo: "Demo", branch: "main" }), "acme-demo-main");
});

test("a lossy slug gets a hash, so two references never share one", () => {
    const slash = createSlug({ org: "acme", repo: "demo", branch: "feature/x" });
    const dash = createSlug({ org: "acme", repo: "demo", branch: "feature-x" });
    assert.match(slash, /^acme-demo-feature-x-[0-9a-f]{6}$/);
    assert.equal(dash, "acme-demo-feature-x");
});

test("a slug is a short dns label without --, which separates the other hosts of a preview", () => {
    const slug = createSlug({ org: "acme", repo: "demo", branch: `feature/${"very-long--name.".repeat(10)}` });
    assert.ok(slug.length <= 57, slug);
    assert.match(slug, /^[a-z0-9-]+$/);
    assert.ok(!slug.includes("--"), slug);
});
