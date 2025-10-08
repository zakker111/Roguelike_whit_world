/**
 * smoketest/helpers/budget.js
 * Deadline-based budget helpers for routing and interactions.
 */
(function () {
  const NS = (window.SmokeTest = window.SmokeTest || {});
  NS.Helpers = NS.Helpers || {};

  function makeBudget(ms) {
    const start = Date.now();
    const deadline = start + Math.max(0, ms | 0);
    return {
      exceeded: () => Date.now() > deadline,
      remain: () => Math.max(0, deadline - Date.now()),
    };
  }

  NS.Helpers.makeBudget = makeBudget;
})();
