import { runPullOrchestrator } from "./sync-pull/pull-orchestrator.js";

export async function pullServerChanges({ repo, api, config, helpers }) {
  return runPullOrchestrator({ repo, api, config, helpers });
}
