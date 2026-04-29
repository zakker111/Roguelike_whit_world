(function () {
  // SmokeTest budget helpers and shared config
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Helpers = window.SmokeTest.Helpers || {};

  // Central runner config (timeouts, perf budgets)
  window.SmokeTest.Config = window.SmokeTest.Config || {
    timeouts: {
      route: 5000,       // ms budget for any routing/path-following sequence
      interact: 2500,    // ms budget for local interactions (loot/G/use)
      battle: 5000,      // ms budget for short combat burst
    },
    perfBudget: {
      turnMs: 6.0,       // soft target per-turn
      drawMs: 12.0       // soft target per-draw
    }
  };

  const Budget = {
    makeBudget(ms) {
      const start = Date.now();
      const deadline = start + Math.max(0, ms | 0);
      return {
        exceeded: () => Date.now() > deadline,
        remain: () => Math.max(0, deadline - Date.now())
      };
    }
  };

  window.SmokeTest.Helpers.Budget = Budget;
})();