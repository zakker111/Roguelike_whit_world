(function () {
  // SmokeTest Scenario: Logging filters (LOG_LEVEL=all reveals previously filtered logs)

  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  async function run(ctx) {
    try {
      const record = (ctx && ctx.record) || function () {};
      const recordSkip = (ctx && ctx.recordSkip) || function () {};
      const sleep = (ctx && ctx.sleep) || (ms => new Promise(r => setTimeout(r, ms | 0)));

      const LC = (typeof window !== "undefined") ? window.LogConfig : null;
      const L = (typeof window !== "undefined") ? window.Logger : null;
      const el = (typeof document !== "undefined") ? document.getElementById("log") : null;

      if (!LC || !has(LC.setThreshold) || !L || !has(L.log) || !has(L.getHistory) || !el) {
        recordSkip("Logging filters scenario skipped (LogConfig/Logger/log element not available)");
        return true;
      }

      // Start from a clean slate.
      try { if (has(LC.reset)) LC.reset(); } catch (_) {}
      try { if (has(L.clear)) L.clear(); } catch (_) {}
      await sleep(80);

      // Ensure strict default: info should hide warn/error.
      try { LC.setThreshold("info"); } catch (_) {}
      await sleep(30);

      const tag = "SMOKE: log-level-all " + Date.now();
      try { L.log(tag, "warn", { category: "General" }); } catch (_) {}

      // Wait a bit (logger flush is batched) then assert it is not visible.
      await sleep(120);
      const before = String(el.textContent || "");
      record(before.indexOf(tag) === -1, "Log filtering: warn not visible at threshold=info");

      // It should still be captured in history so it can be revealed later.
      let foundInHistory = false;
      try {
        const hist = L.getHistory() || [];
        for (let i = hist.length - 1; i >= 0; i--) {
          const e = hist[i];
          if (e && e.msg === tag && String(e.type || "").toLowerCase() === "warn") { foundInHistory = true; break; }
        }
      } catch (_) {}
      record(foundInHistory, "Log filtering: warn captured in history even when filtered");

      // Switch to "all" and ensure the previously filtered warn becomes visible.
      try { LC.setThreshold("all"); } catch (_) {}
      await sleep(120);

      const after = String(el.textContent || "");
      record(after.indexOf(tag) !== -1, "Log filtering: warn becomes visible after switching threshold to all");

      return true;
    } catch (e) {
      try { (ctx && ctx.record) && ctx.record(false, "Logging filters scenario failed: " + (e && e.message ? e.message : String(e))); } catch (_) {}
      return true;
    }
  }

  window.SmokeTest.Scenarios.logging_filters = { run };
})();
