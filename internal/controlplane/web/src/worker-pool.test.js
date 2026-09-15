import assert from "node:assert/strict";
import test from "node:test";
import { groupWorkersByHost, hostFromWorkerName } from "./worker-pool.js";

test("a pooled worker name resolves to the host that runs it", () => {
  assert.equal(hostFromWorkerName("machinist-vm-1"), "machinist-vm");
  assert.equal(hostFromWorkerName("machinist-vm-12"), "machinist-vm");
  // An unpooled worker keeps its whole name, including a trailing digit that
  // is part of the name rather than a pool index.
  assert.equal(hostFromWorkerName("machinist-w2"), "machinist-w2");
  assert.equal(hostFromWorkerName(""), "unknown");
});

test("hosts group their workers and report how much capacity is live", () => {
  const hosts = groupWorkersByHost([
    { instance_id: "b", name: "vm-2", connected: false, repositories: ["tac"] },
    { instance_id: "a", name: "vm-1", connected: true, repositories: ["tac", "machinist"] },
    { instance_id: "c", name: "laptop", connected: true, repositories: ["machinist"] },
  ]);

  assert.deepEqual(hosts.map(({ host }) => host), ["laptop", "vm"]);
  const vm = hosts[1];
  assert.equal(vm.total, 2);
  assert.equal(vm.connected, 1);
  assert.deepEqual(vm.workers.map(({ name }) => name), ["vm-1", "vm-2"]);
  assert.deepEqual(vm.repositories, ["machinist", "tac"]);
});

test("a reported host wins over guessing from the worker name", () => {
  // Deriving the host from "<host>-<n>" mis-groups a machine whose own name
  // ends in a number, so the worker reports its host and the name is only a
  // fallback for workers that predate that.
  // An unpooled worker on a host called "build-2" is named "build-2", which
  // the name heuristic would file under "build".
  const hosts = groupWorkersByHost([
    { instance_id: "a", name: "build-2", host: "build-2", connected: true },
    { instance_id: "b", name: "legacy-1", connected: false },
  ]);

  assert.deepEqual(hosts.map(({ host }) => host), ["build-2", "legacy"]);
  assert.equal(hosts[0].total, 1);
  assert.equal(hosts[1].total, 1);
});
