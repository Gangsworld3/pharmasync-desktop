import { traceDecision } from "./decision-trace.js";
import { traceStore } from "./trace-store.js";

export class DecisionEngine {
  constructor({ intelligence, health }) {
    this.intelligence = intelligence;
    this.health = health;
    this.thresholds = {
      pressure: 100
    };
    this.safeModeBiasEnabled = false;
  }

  decide(context) {
    const healthState = this.health();
    let strategy = "normal";

    // Global override (system under stress)
    if (healthState.pressure > this.thresholds.pressure) {
      strategy = "throttle";
    } else if (healthState.instability > (this.safeModeBiasEnabled ? 0.4 : 0.5)) {
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

  adjustThreshold(name, value) {
    if (name === "pressure" && Number.isFinite(Number(value))) {
      this.thresholds.pressure = Number(value);
    }
  }

  enableSafeModeBias() {
    this.safeModeBiasEnabled = true;
  }
}
