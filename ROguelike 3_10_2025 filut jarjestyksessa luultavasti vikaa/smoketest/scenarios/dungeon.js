(function () {
  // SmokeTest Scenario: Dungeon entry, robust retries and routing
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  async function run(ctx) {
    // ctx: { key, sleep, makeBudget, record, recordSkip, ensureAllModalsClosed, CONFIG, caps }
    try {
      var caps = (ctx && ctx.caps) || {};
      if (!caps.GameAPI || !caps.getMode) { ctx.recordSkip && ctx.recordSkip("Dungeon scenario skipped (GameAPI/getMode not available)"); return true; }
      if (!window.GameAPI || !has(window.GameAPI.getMode)) return false;

      await ctx.ensureAllModalsClosed?.(12);

      // If already in dungeon, record and keep mode for downstream scenarios
      const mode0 = window.GameAPI.getMode();
      if (mode0 === "dungeon") {
        ctx.record(true, "Already in dungeon");
        return true;
      }

      // Single-attempt centralized entry to avoid repeated toggles across scenarios
      const ok = (typeof ctx.ensureDungeonOnce === "function") ? await ctx.ensureDungeonOnce() : false;
      const modeNow = window.GameAPI.getMode();
      ctx.record(ok, ok ? `Entered dungeon (mode=${modeNow})` : `Dungeon entry failed (mode=${modeNow})`);

      return true; // handled by scenario module (regardless of pass/fail)
    } catch (e) {
      ctx.record(false, "Dungeon scenario module failed: " + (e && e.message ? e.message : String(e)));
      return true;
    }
  }

  window.SmokeTest.Scenarios.Dungeon = { run };
})();