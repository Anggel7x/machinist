import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { logicalRepositoryName, repositoryRegistration, repositoryRows } from "./repositories.js";

test("logicalRepositoryName derives the name the control plane registers", () => {
  assert.equal(logicalRepositoryName("tac_restaurant"), "tac-restaurant");
  assert.equal(logicalRepositoryName("My.Site"), "my-site");
  assert.equal(logicalRepositoryName("__web__"), "web");
  assert.equal(logicalRepositoryName("日本"), "");
});

test("repositoryRegistration accepts a slug or a GitHub URL", () => {
  assert.deepEqual(repositoryRegistration({ slug: " anggel7x/tac_restaurant ", name: "", parallel: "" }), {
    body: { slug: "anggel7x/tac_restaurant", name: "tac-restaurant" },
    name: "tac-restaurant",
    derived: "tac-restaurant",
  });
  assert.deepEqual(repositoryRegistration({ slug: "https://github.com/acme/web.git", name: "site", parallel: "2" }).body, { slug: "acme/web", name: "site", parallel: 2 });
});

test("repositoryRegistration explains what to correct", () => {
  assert.match(repositoryRegistration({ slug: "acme" }).error, /owner\/name/);
  assert.match(repositoryRegistration({ slug: "acme/.." }).error, /owner\/name/);
  assert.match(repositoryRegistration({ slug: "acme/web", name: "web app" }).error, /letters, digits/);
  assert.match(repositoryRegistration({ slug: "acme/web", parallel: "0" }).error, /at least 1/);
  assert.match(repositoryRegistration({ slug: "acme/web", parallel: "1.5" }).error, /whole number/);
});

test("repositoryRows counts connected workers and surfaces unregistered ones", () => {
  const rows = repositoryRows(
    [{ name: "web", slug: "acme/web", parallel: 2 }, { name: "api", slug: "acme/api" }],
    [
      { connected: true, repositories: ["web", "machinist"] },
      { connected: true, repositories: ["web"] },
      { connected: false, repositories: ["api"] },
    ],
  );
  assert.deepEqual(rows, [
    { name: "api", slug: "acme/api", registered: true, workers: 0 },
    { name: "machinist", slug: "", registered: false, workers: 1 },
    { name: "web", slug: "acme/web", parallel: 2, registered: true, workers: 2 },
  ]);
});

test("the registration form sends the CSRF token", async () => {
  const source = await readFile(new URL("./repositories.jsx", import.meta.url), "utf8");
  assert.match(source, /fetch\("\/api\/v1\/repositories"/);
  assert.match(source, /"X-Machinist-CSRF": csrfToken/);
});
