import test from "node:test";
import assert from "node:assert/strict";

import { IPC_CHANNELS } from "../../../electron/ipc-channels.js";
import { createEventBus } from "../event-bus.js";
import { createDesktopOrchestrator } from "../desktop-orchestrator.js";

test("all IPC handlers return valid envelope", async () => {
  const eventBus = createEventBus();
  const orchestrator = createDesktopOrchestrator({ eventBus });

  for (const channel of Object.values(IPC_CHANNELS)) {
    const res = await orchestrator.handleIpc(channel, {}, { timeoutMs: 100 });

    assert.equal(Boolean(res && typeof res === "object"), true, `${channel}: envelope must be object`);
    assert.equal(Object.prototype.hasOwnProperty.call(res, "success"), true, `${channel}: missing success`);

    if (res.success) {
      assert.equal(Object.prototype.hasOwnProperty.call(res, "data"), true, `${channel}: success missing data`);
    } else {
      assert.equal(Object.prototype.hasOwnProperty.call(res, "error"), true, `${channel}: failure missing error`);
    }
  }
});
