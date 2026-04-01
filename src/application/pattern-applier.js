import { learningAudit } from "./learning-audit.js";

export class PatternApplier {
  constructor({ decisionEngine }) {
    this.decisionEngine = decisionEngine;
  }

  apply(patterns) {
    if (patterns.confidence < 0.5) return;

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
