import { metrics } from "./metrics.js";

export function enforceBoundary(layer, moduleName) {
  if (layer === "domain" && moduleName.includes("infrastructure")) {
    metrics.increment("architecture.violation");
    throw new Error("Forbidden dependency: domain → infrastructure");
  }
}
