import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { defaultTriggerName, githubTriggerRegistration, triggerDescription } from "./trigger-form.js";

test("githubTriggerRegistration builds the body the control plane expects", () => {
  assert.deepEqual(githubTriggerRegistration({ repository: "tac-restaurant", on: "pull_request", label: " machinist:shepherd ", command: "shepherd", prompt: " Shepherd it. ", every: "", name: "", model: "" }), {
    body: { name: "shepherd-tac-restaurant-pull-requests", repository: "tac-restaurant", on: "pull_request", label: "machinist:shepherd", command: "shepherd", every: "1m", prompt: "Shepherd it." },
  });
  assert.equal(defaultTriggerName({ command: "foreman", repository: "web", on: "issue" }), "foreman-web");
});

test("githubTriggerRegistration explains what to correct", () => {
  const valid = { repository: "web", label: "go", command: "foreman" };
  assert.match(githubTriggerRegistration({ ...valid, repository: "" }).error, /repository/);
  assert.match(githubTriggerRegistration({ ...valid, command: "" }).error, /command/);
  assert.match(githubTriggerRegistration({ ...valid, label: "a,b" }).error, /without commas/);
  assert.match(githubTriggerRegistration({ ...valid, label: "Machinist:Queued" }).error, /reserved/);
  assert.match(githubTriggerRegistration({ ...valid, every: "soon" }).error, /duration/);
  assert.match(githubTriggerRegistration({ ...valid, name: "a b" }).error, /letters, digits/);
});

test("triggerDescription says what each trigger does", () => {
  assert.equal(triggerDescription({ family: "github", command: "shepherd", label: "machinist:shepherd", on: "pull_request", repositories: ["tac-restaurant"] }), "Runs shepherd when machinist:shepherd is added to a pull request in tac-restaurant.");
  assert.equal(triggerDescription({ family: "github", command: "foreman", label: "machinist:requested", on: "issue", repositories: [] }), "Runs foreman when machinist:requested is added to an issue in every registered repository.");
  assert.equal(triggerDescription({ family: "cron", command: "audit", schedule: "0 2 * * *", repositories: ["web"] }), "Runs audit on 0 2 * * * in web.");
});

test("the trigger form sends the CSRF token", async () => {
  const source = await readFile(new URL("./triggers.jsx", import.meta.url), "utf8");
  assert.match(source, /fetch\("\/api\/v1\/triggers"/);
  assert.match(source, /"X-Machinist-CSRF": csrfToken/);
});
