import { fetchPullDelta } from "./pull-fetcher.js";
import { applyPullDelta } from "./pull-diff-applier.js";

export async function runPullOrchestrator({ repo, api, config, helpers }) {
  const { deviceState, response, body } = await fetchPullDelta({ repo, api });

  if (!response.ok) {
    throw new Error(`Pull failed (${response.status}).`);
  }

  return applyPullDelta({ repo, helpers, body, deviceState, config });
}
