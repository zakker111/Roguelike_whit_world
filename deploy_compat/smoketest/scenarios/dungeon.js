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
      let ok = (typeof ctx.ensureDungeonOnce === "function") ? await ctx.ensureDungeonOnce() : false;

      // Grace period: if mode isn't dungeon yet, wait briefly in case the context/UI sync finishes
      try {
        if (window.GameAPI && typeof window.GameAPI.getMode === "function") {
          const deadline = Date.now() + 1000;
          while (Date.now() < deadline) {
            if (window.GameAPI.getMode() === "dungeon") { ok = true; break; }
            await (ctx.sleep ? ctx.sleep(60) : new Promise(r => setTimeout(r, 60)));
          }
        }
      } catch (_) {}

      const modeNow = window.GameAPI.getMode();
      ctx.record(ok || modeNow === "dungeon", (ok || modeNow === "dungeon")
        ? `Entered dungeon (mode=${modeNow})`
        : `Dungeon entry failed (mode=${modeNow})`);

      return true; // handled by scenario module (regardless of pass/fail)
    } catch (e) {
      ctx.record(false, "Dungeon scenario module failed: " + (e && e.message ? e.message : String(e)));
      return true;
    }
  }

  window.SmokeTest.Scenarios.Dungeon = { run };
})();