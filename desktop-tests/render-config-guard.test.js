import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

test("render config guard passes for repository manifest", () => {
  const result = spawnSync(process.execPath, ["scripts/check-render-config.js"], {
    cwd: rootDir,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, `guard failed: ${result.stderr || result.stdout}`);
  assert.match(result.stdout, /Render config validation passed\./);
});
