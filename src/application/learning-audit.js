import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureRuntimeDirectories } from "../services/desktop-runtime.js";

const MAX_HISTORY = 500;

function loadPersistedAudit() {
  try {
    const { logsDir } = ensureRuntimeDirectories();
    const filePath = join(logsDir, "learning-audit.json");
    if (!existsSync(filePath)) {
      return [];
    }
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistAudit(list) {
  try {
    const { logsDir } = ensureRuntimeDirectories();
    const filePath = join(logsDir, "learning-audit.json");
    writeFileSync(filePath, JSON.stringify(list, null, 2));
  } catch {
    // Keep runtime flow non-blocking if persistence fails.
  }
}

const history = loadPersistedAudit();

export const learningAudit = {
  record(entry) {
    history.push({
      timestamp: Date.now(),
      ...entry
    });

    if (history.length > MAX_HISTORY) {
      history.shift();
    }

    persistAudit(history);
  },

  getAll() {
    return history;
  }
};
