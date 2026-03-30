import { runPullOrchestrator } from "./sync-pull/index.js";

export async function pullServerChanges({ repo, api, config, helpers }) {
  return runPullOrchestrator({ repo, api, config, helpers });
}
