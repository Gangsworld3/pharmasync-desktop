import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("render config guard passes for repository manifest", () => {
  const result = spawnSync(process.execPath, ["scripts/check-render-config.js"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(
    result.status,
    0,
    `expected render config guard to pass.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
});
