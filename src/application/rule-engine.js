import { metrics } from "./metrics.js";

function asErrorMessage(error) {
  if (!error) {
    return "Unknown error";
  }
  return typeof error.message === "string" ? error.message : String(error);
}

function shouldThrottle(rule, lastRunMap, now) {
  if (!rule.throttleMs || rule.throttleMs <= 0) {
    return false;
  }
  const lastRun = lastRunMap.get(rule.id) || 0;
  return now - lastRun < rule.throttleMs;
}

async function runRuleSafely(rule, eventEnvelope, eventBus) {
  try {
    if (typeof rule.condition === "function" && !rule.condition(eventEnvelope)) {
      return;
    }

    await rule.action(eventEnvelope, { eventBus });
    metrics.increment("rule.executed");
  } catch (error) {
    metrics.increment("rule.failed");
    await eventBus.emit("rule.failed", {
      ruleId: rule.id,
      error: asErrorMessage(error)
    });
  }
}

function registerDefaultRules(registerRule) {
  registerRule({
    id: "detect.slow.ipc",
    event: "orchestrator.request.completed",
    condition: (eventEnvelope) => Number(eventEnvelope?.payload?.durationMs ?? 0) > 2000,
    action: async (eventEnvelope, { eventBus }) => {
      await eventBus.emit("system.performance.slow", {
        channel: eventEnvelope?.payload?.channel,
        duration: eventEnvelope?.payload?.durationMs
      });
    }
  });

  registerRule({
    id: "detect.circuit.open",
    event: "orchestrator.circuit.open",
    action: async (eventEnvelope) => {
      console.warn("Circuit opened:", eventEnvelope?.payload?.channel);
    }
  });
}

export function createRuleEngine({ eventBus }) {
  const rules = new Map();
  const lastRunMap = new Map();

  function registerRule(rule) {
    rules.set(rule.id, rule);
    return () => {
      rules.delete(rule.id);
      lastRunMap.delete(rule.id);
    };
  }

  async function processEventRules(eventEnvelope) {
    const matchingRules = Array.from(rules.values())
      .filter((rule) => rule.event === eventEnvelope.name);

    const now = Date.now();

    const executions = matchingRules.map(async (rule) => {
      if (shouldThrottle(rule, lastRunMap, now)) {
        metrics.increment("rule.skipped.throttle");
        return;
      }

      lastRunMap.set(rule.id, now);
      await runRuleSafely(rule, eventEnvelope, eventBus);
    });

    await Promise.allSettled(executions);
  }

  eventBus.registerRuleHook(async (eventEnvelope) => {
    queueMicrotask(() => {
      void processEventRules(eventEnvelope);
    });
  });

  registerDefaultRules(registerRule);

  return {
    registerRule
  };
}
