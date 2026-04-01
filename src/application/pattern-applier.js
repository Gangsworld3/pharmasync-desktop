export class PatternApplier {
  constructor({ decisionEngine }) {
    this.decisionEngine = decisionEngine;
  }

  apply(patterns) {
    if (patterns.confidence < 0.5) return;

    if (patterns.frequentSafeMode) {
      this.decisionEngine.adjustThreshold("pressure", 85);
    }

    if (patterns.risingPressure) {
      this.decisionEngine.adjustThreshold("pressure", 90);
    }

    if (patterns.highInstability) {
      this.decisionEngine.enableSafeModeBias();
    }
  }
}
