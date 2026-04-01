import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureRuntimeDirectories } from "../services/desktop-runtime.js";

const MAX_IN_MEMORY = 1000;
const MAX_PERSISTED = 100;

function loadPersistedTraces() {
  try {
    const { logsDir } = ensureRuntimeDirectories();
    const filePath = join(logsDir, "decision-traces.json");
    if (!existsSync(filePath)) {
      return [];
    }
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistTraces(list) {
  try {
    const { logsDir } = ensureRuntimeDirectories();
    const filePath = join(logsDir, "decision-traces.json");
    writeFileSync(filePath, JSON.stringify(list.slice(-MAX_PERSISTED), null, 2));
  } catch {
    // Keep runtime flow non-blocking if persistence fails.
  }
}

const traces = loadPersistedTraces();

export const traceStore = {
  push(trace) {
    traces.push(trace);

    if (traces.length > MAX_IN_MEMORY) {
      traces.shift(); // keep bounded
    }

    persistTraces(traces);
  },

  getAll() {
    return traces;
  }
};
