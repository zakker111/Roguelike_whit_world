(function () {
  // SmokeTest Scenario: Town entry (robust retries, world gating)
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  async function run(ctx) {
    // ctx: { key, sleep, makeBudget, record, recordSkip, CONFIG, caps, ensureAllModalsClosed }
    try {
      var caps = (ctx && ctx.caps) || {};
      if (!caps.GameAPI || !caps.getMode) { ctx.recordSkip && ctx.recordSkip("Town scenario skipped (GameAPI/getMode not available)"); return true; }
      if (!((caps.nearestTown && caps.routeTo) || caps.gotoNearestTown)) { ctx.recordSkip && ctx.recordSkip("Town scenario skipped (nearestTown+routeTo or gotoNearestTown not available)"); return true; }
      if (!window.GameAPI || !has(window.GameAPI.getMode)) { ctx.recordSkip && ctx.recordSkip("Town scenario skipped (GameAPI.getMode unavailable)"); return true; }

      await ctx.ensureAllModalsClosed?.(12);

      // Single-attempt centralized entry to avoid repeated toggles across scenarios
      const ok = (typeof ctx.ensureTownOnce === "function") ? await ctx.ensureTownOnce() : false;
      const nowMode = window.GameAPI.getMode();
      ctx.record(ok && nowMode === "town", ok ? "Entered town (scenario)" : "Town entry not achieved (scenario)");

      return true;
    } catch (e) {
      ctx.record(false, "Town scenario module failed: " + (e && e.message ? e.message : String(e)));
      return true;
    }
  }

  window.SmokeTest.Scenarios.Town = { run };
})();