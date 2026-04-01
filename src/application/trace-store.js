const traces = [];

export const traceStore = {
  push(trace) {
    traces.push(trace);

    if (traces.length > 1000) {
      traces.shift(); // keep bounded
    }
  },

  getAll() {
    return traces;
  }
};
