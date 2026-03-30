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
  const pushSource = read("src/services/sync-push-service.js");
  const pullSource = read("src/services/sync-pull-service.js");
  const cycleSource = read("src/services/sync-cycle-runner.js");
  const engineSource = read("src/services/sync-engine.js");

  assert.equal(pushSource.includes("sync-pull-service"), false, "push must not import pull");
  assert.equal(pushSource.includes("sync-cycle-runner"), false, "push must not import cycle runner");
  assert.equal(pushSource.includes("sync-engine"), false, "push must not import engine");

  assert.equal(pullSource.includes("sync-push-service"), false, "pull must not import push");
  assert.equal(pullSource.includes("sync-cycle-runner"), false, "pull must not import cycle runner");
  assert.equal(pullSource.includes("sync-engine"), false, "pull must not import engine");

  assert.equal(cycleSource.includes("sync-engine"), false, "cycle runner must not import engine");
  assert.equal(engineSource.includes("sync-cycle-runner"), true, "engine should wire cycle runner");
  assert.equal(engineSource.includes("sync-push-service"), true, "engine should wire push service");
  assert.equal(engineSource.includes("sync-pull-service"), true, "engine should wire pull service");
});

test("sync service size budgets stay below threshold", () => {
  assert.ok(lineCount("src/services/sync-push-service.js") < 250, "sync-push-service.js exceeded size budget");
  assert.ok(lineCount("src/services/sync-pull-service.js") < 250, "sync-pull-service.js exceeded size budget");
  assert.ok(lineCount("src/services/sync-cycle-runner.js") < 250, "sync-cycle-runner.js exceeded size budget");
});
