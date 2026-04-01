import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

function read(relPath) {
  return fs.readFileSync(path.join(rootDir, relPath), "utf8");
}

function lineCount(relPath) {
  return read(relPath).split(/\r?\n/).length;
}

test("sync service dependency direction is one-way", () => {
  const pushSource = read("src/services/sync-push/push-orchestrator.js");
  const pullSource = read("src/services/sync-pull/pull-orchestrator.js");
  const cycleSource = read("src/services/sync-cycle-runner.js");
  const engineSource = read("src/services/sync-engine.js");

  assert.equal(pushSource.includes("sync-pull"), false, "push must not import pull");
  assert.equal(pushSource.includes("sync-cycle-runner"), false, "push must not import cycle runner");
  assert.equal(pushSource.includes("sync-engine"), false, "push must not import engine");

  assert.equal(pullSource.includes("sync-push"), false, "pull must not import push");
  assert.equal(pullSource.includes("sync-cycle-runner"), false, "pull must not import cycle runner");
  assert.equal(pullSource.includes("sync-engine"), false, "pull must not import engine");

  assert.equal(cycleSource.includes("sync-engine"), false, "cycle runner must not import engine");
  assert.equal(engineSource.includes("sync-cycle-runner"), true, "engine should wire cycle runner");
  assert.equal(engineSource.includes("sync-push/push-orchestrator"), true, "engine should wire push orchestrator");
  assert.equal(engineSource.includes("sync-pull/pull-orchestrator"), true, "engine should wire pull orchestrator");
});

test("sync service size budgets stay below threshold", () => {
  assert.ok(lineCount("src/services/sync-push/push-orchestrator.js") < 250, "push-orchestrator.js exceeded size budget");
  assert.ok(lineCount("src/services/sync-pull/pull-orchestrator.js") < 250, "pull-orchestrator.js exceeded size budget");
  assert.ok(lineCount("src/services/sync-cycle-runner.js") < 250, "sync-cycle-runner.js exceeded size budget");
});
