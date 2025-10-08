// SmokeTest Time/Wait utilities
(function () {
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  async function waitUntilTrue(fn, timeoutMs = 400, intervalMs = 40) {
    const deadline = Date.now() + Math.max(0, timeoutMs | 0);
    while (Date.now() < deadline) {
      try { if (fn()) return true; } catch (_) {}
      await sleep(intervalMs);
    }
    return fn();
  }
  function makeBudget(ms) {
    const start = Date.now();
    const deadline = start + Math.max(0, ms | 0);
    return {
      exceeded: () => Date.now() > deadline,
      remain: () => Math.max(0, deadline - Date.now())
    };
  }
  window.SmokeTime = { sleep, waitUntilTrue, makeBudget };
})();