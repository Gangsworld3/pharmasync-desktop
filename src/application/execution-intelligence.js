export class ExecutionIntelligence {
  constructor({ metrics }) {
    this.metrics = metrics ?? {};
  }

  metric(name) {
    if (typeof this.metrics.get === "function") {
      const value = this.metrics.get(name);
      return Number.isFinite(Number(value)) ? Number(value) : 0;
    }

    if (typeof this.metrics.snapshot === "function") {
      const snapshot = this.metrics.snapshot();
      const counterValue = snapshot?.counters?.[name];
      if (Number.isFinite(Number(counterValue))) {
        return Number(counterValue);
      }
      const timingAverage = snapshot?.timings?.[name]?.avg;
      if (Number.isFinite(Number(timingAverage))) {
        return Number(timingAverage);
      }
    }

    return 0;
  }

  decideStrategy({ operation, systemState }) {
    if (systemState?.isOffline) {
      return "queue";
    }

    if (this.metric("sync.fail.rate") > 0.3) {
      return "defer";
    }

    if (operation?.priority === "high") {
      return "immediate";
    }

    return "normal";
  }
}
