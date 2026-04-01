import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const SUITES = {
  sync: [
    "desktop-tests/fefo.test.js",
    "desktop-tests/invoice-batch-split.test.js",
    "desktop-tests/sync-resilience.test.js",
    "desktop-tests/sync-dependency-boundaries.test.js",
    "desktop-tests/sync-cycle-runner.test.js",
    "desktop-tests/sync-shared.test.js",
    "desktop-tests/ipc-contract.test.js"
  ],
  architecture: [
    "desktop-tests/render-config-guard.test.js",
    "desktop-tests/sync-dependency-boundaries.test.js",
    "desktop-tests/sync-cycle-runner.test.js",
    "desktop-tests/sync-shared.test.js"
  ],
  chaos: [
    "desktop-tests/sync-chaos.test.js"
  ],
  matrix: [
    "desktop-tests/chaos-matrix.test.js"
  ]
};

const suite = process.argv[2];
if (!suite || !SUITES[suite]) {
  const available = Object.keys(SUITES).join(", ");
  console.error(`Usage: node scripts/run-desktop-suite.js <suite>\nAvailable suites: ${available}`);
  process.exit(1);
}

const workspaceRoot = resolve(process.cwd());
const runtimeDir = resolve(workspaceRoot, "runtime", "test-runs", `${suite}-${process.pid}`);
rmSync(runtimeDir, { recursive: true, force: true });
mkdirSync(runtimeDir, { recursive: true });

const env = {
  ...process.env,
  PHARMASYNC_DATA_DIR: runtimeDir
};

const args = ["--test", "--test-concurrency=1", ...SUITES[suite]];
const child = spawn(process.execPath, args, {
  cwd: workspaceRoot,
  env,
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
