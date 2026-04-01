import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

function read(relPath) {
  return fs.readFileSync(path.join(rootDir, relPath), "utf8");
}

test("electron main uses orchestrator boundary instead of direct service imports", () => {
  const source = read("electron/main.js");

  assert.equal(source.includes("../src/services/"), false, "electron/main.js must not import service modules directly");
  assert.equal(source.includes("createDesktopOrchestrator"), true, "electron/main.js must route through orchestrator");
  assert.equal(source.includes("orchestrator.handleIpc"), true, "ipc handlers must delegate through orchestrator");
});

test("desktop orchestrator owns service fan-out and emits lifecycle events", () => {
  const source = read("src/application/desktop-orchestrator.js");

  assert.equal(source.includes("../services/"), true, "orchestrator must own service imports");
  assert.equal(source.includes("orchestrator.request.received"), true, "request-received event is required");
  assert.equal(source.includes("orchestrator.request.completed"), true, "request-completed event is required");
  assert.equal(source.includes("orchestrator.request.failed"), true, "request-failed event is required");
});
