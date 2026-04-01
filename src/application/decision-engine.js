import { traceDecision } from "./decision-trace.js";
import { traceStore } from "./trace-store.js";

export class DecisionEngine {
  constructor({ intelligence, health }) {
    this.intelligence = intelligence;
    this.health = health;
  }

  decide(context) {
    const healthState = this.health();
    let strategy = "normal";

    // Global override (system under stress)
    if (healthState.pressure > 100) {
      strategy = "throttle";
    } else if (healthState.instability > 0.5) {
      strategy = "safe-mode";
    } else {
      // Delegate to execution intelligence
      strategy = this.intelligence.decideStrategy(context);
    }

    const decision = { action: strategy };

    traceStore.push(
      traceDecision({
        context,
        decision,
        health: healthState
      })
    );

    return decision;
  }
}
