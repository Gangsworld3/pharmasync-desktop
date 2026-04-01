import { learningAudit } from "./learning-audit.js";

export class LearningEngine {
  constructor({ decisionEngine, logger = console }) {
    this.decisionEngine = decisionEngine;
    this.logger = logger;
    this.enabled = true;
  }

  setEnabled(value) {
    this.enabled = Boolean(value);
  }

  apply(patterns) {
    if (!this.enabled) return;
    if (patterns.confidence < 0.5) {
      this.logger?.debug?.("Learning skipped: low confidence", patterns);
      return;
    }

    if (patterns.frequentSafeMode) {
      this.decisionEngine.adjustThreshold("pressure", 85);
      learningAudit.record({
        type: "threshold_adjustment",
        reason: "frequentSafeMode",
        value: 85
      });
    }

    if (patterns.risingPressure) {
      this.decisionEngine.adjustThreshold("pressure", 90);
      learningAudit.record({
        type: "threshold_adjustment",
        reason: "risingPressure",
        value: 90
      });
    }

    if (patterns.highInstability) {
      this.decisionEngine.enableSafeModeBias();
      learningAudit.record({
        type: "mode_change",
        reason: "highInstability"
      });
    }
  }
}
