// SmokeTest Budget helper (smoke_test)
// Provides makeBudget(ms) with exceeded() and remain().

(function () {
  function makeBudget(ms) {
    const start = Date.now();
    const deadline = start + Math.max(0, ms | 0);
    return {
      exceeded: () => Date.now() > deadline,
      remain: () => Math.max(0, deadline - Date.now())
    };
  }

  window.SmokeCore = window.SmokeCore || {};
  window.SmokeCore.Budget = { makeBudget };
})();