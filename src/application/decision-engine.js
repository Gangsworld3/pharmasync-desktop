export class DecisionEngine {
  constructor({ intelligence, health }) {
    this.intelligence = intelligence;
    this.health = health;
  }

  decide(context) {
    const systemHealth = this.health();

    // Global override (system under stress)
    if (systemHealth.pressure > 100) {
      return { action: "throttle" };
    }

    if (systemHealth.instability > 0.5) {
      return { action: "safe-mode" };
    }

    // Delegate to execution intelligence
    const strategy = this.intelligence.decideStrategy(context);

    return { action: strategy };
  }
}
