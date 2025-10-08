// SmokeTest Core Config (smoke_test)
// Exposes RUNNER_VERSION and CONFIG (timeouts, performance budgets)

(function () {
  window.SmokeCore = window.SmokeCore || {};
  window.SmokeCore.Config = {
    RUNNER_VERSION: "1.6.0",
    CONFIG: {
      timeouts: {
        route: 5000,    // ms budget for routing/path-following
        interact: 2500, // ms budget for interactions (loot/use)
        battle: 5000,   // ms budget for short combat burst
      },
      perfBudget: {
        turnMs: 6.0,    // soft target per-turn
        drawMs: 12.0    // soft target per-draw
      }
    }
  };
})();