import fs from "node:fs";
import path from "node:path";

const logPath = path.join(process.cwd(), "runtime", "logs", "sync.log");

if (!fs.existsSync(logPath)) {
  console.error(`Sync log file not found: ${logPath}`);
  process.exit(1);
}

const raw = fs.readFileSync(logPath, "utf8").trim();
if (!raw) {
  console.log(JSON.stringify({
    attempts: 0,
    success: 0,
    failed: 0,
    deferred: 0,
    conflicts: 0,
    deadLetters: 0
  }, null, 2));
  process.exit(0);
}

const lines = raw.split("\n");
const stats = {
  attempts: 0,
  success: 0,
  failed: 0,
  deferred: 0,
  conflicts: 0,
  deadLetters: 0
};

for (const line of lines) {
  try {
    const log = JSON.parse(line);

    if (log.event === "sync_attempt") stats.attempts += 1;
    if (log.event === "sync_result" && log.status === "SYNCED") stats.success += 1;
    if (log.event === "sync_failed_transport" || log.event === "sync_failed_response") stats.failed += 1;
    if (log.event === "sync_deferred") stats.deferred += 1;
    if (log.event === "sync_result" && log.status === "CONFLICT") stats.conflicts += 1;
    if (log.event === "sync_result" && log.status === "DEAD_LETTER") stats.deadLetters += 1;
  } catch {
    // Skip malformed lines to keep analyzer resilient.
  }
}

console.log(JSON.stringify(stats, null, 2));
