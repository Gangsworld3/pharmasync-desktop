import { runPushOrchestrator } from "./sync-push/push-orchestrator.js";

export async function pushPendingChanges({ repo, api, clock, config, policy, helpers }) {
  return runPushOrchestrator({ repo, api, clock, config, policy, helpers });
}
