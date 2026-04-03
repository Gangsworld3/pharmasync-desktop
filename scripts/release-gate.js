import { execSync } from "node:child_process";

function run(cmd) {
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch {
    console.error(`FAILED: ${cmd}`);
    process.exit(1);
  }
}

console.log("=== RELEASE GATE START ===");

// Core tests
run("npm run test:architecture");
run("npm run test:desktop-sync");
run("npm run test:desktop-chaos");

// Critical simulations
run("npm run simulate:sync:high-failure");
run("npm run simulate:sync:high-conflict");

// Optional (fast sanity)
run("npm run simulate:pharmacy-day");

console.log("=== RELEASE GATE PASSED ===");
