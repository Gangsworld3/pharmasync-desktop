const history = [];

export const learningAudit = {
  record(entry) {
    history.push({
      timestamp: Date.now(),
      ...entry
    });

    if (history.length > 500) {
      history.shift();
    }
  },

  getAll() {
    return history;
  }
};
