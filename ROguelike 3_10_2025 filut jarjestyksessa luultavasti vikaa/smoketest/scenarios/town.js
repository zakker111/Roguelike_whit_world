(function () {
  // SmokeTest Scenario: Town entry and basic interactions (subset)
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  async function run(ctx) {
    // ctx: { key, sleep, makeBudget, record, recordSkip, CONFIG, caps }
    try {
      var caps = (ctx && ctx.caps) || {};
      if (!caps.GameAPI || !caps.getMode) { ctx.recordSkip && ctx.recordSkip("Town scenario skipped (GameAPI/getMode not available)"); return true; }
      if (!((caps.nearestTown && caps.routeTo) || caps.gotoNearestTown)) { ctx.recordSkip && ctx.recordSkip("Town scenario skipped (nearestTown+routeTo or gotoNearestTown not available)"); return true; }
      if (!window.GameAPI || !has(window.GameAPI.getMode)) { ctx.recordSkip && ctx.recordSkip("Town scenario skipped (GameAPI.getMode unavailable)"); return true; }
      if (window.GameAPI.getMode() !== "world") { ctx.recordSkip && ctx.recordSkip("Town scenario skipped (not in overworld)"); return true; }

      let okTown = false;

      // Prefer precise routing to nearestTown coordinate
      try {
        const nt = has(window.GameAPI.nearestTown) ? window.GameAPI.nearestTown() : null;
        if (nt) {
          let usedHelper = false;
          try {
            var MV = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Movement;
            if (MV && typeof MV.routeTo === "function") {
              usedHelper = await MV.routeTo(nt.x, nt.y, { timeoutMs: (ctx.CONFIG && ctx.CONFIG.timeouts && ctx.CONFIG.timeouts.route) || 2500, stepMs: 90 });
            }
          } catch (_) {}
          if (!usedHelper && has(window.GameAPI.routeTo)) {
            const pathNT = window.GameAPI.routeTo(nt.x, nt.y);
            const budgetNT = ctx.makeBudget(ctx.CONFIG.timeouts.route || 2500);
            for (const step of pathNT) {
              if (budgetNT.exceeded()) break;
              const pl = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : step;
              const ddx = Math.sign(step.x - pl.x);
              const ddy = Math.sign(step.y - pl.y);
              ctx.key(ddx === -1 ? "ArrowLeft" : ddx === 1 ? "ArrowRight" : (ddy === -1 ? "ArrowUp" : "ArrowDown"));
              await ctx.sleep(90);
            }
          }
          okTown = true;
        } else if (has(window.GameAPI.gotoNearestTown)) {
          okTown = !!(await window.GameAPI.gotoNearestTown());
        }
      } catch (_) {}

      // Attempt multiple entry tries: Enter + API
      const tryEnterTown = async () => {
        ctx.key("Enter"); await ctx.sleep(300);
        try { if (has(window.GameAPI.enterTownIfOnTile)) window.GameAPI.enterTownIfOnTile(); } catch (_) {}
        await ctx.sleep(240);
      };
      await tryEnterTown();
      let nowMode = window.GameAPI.getMode();
      if (nowMode !== "town") {
        await tryEnterTown();
      }
      nowMode = window.GameAPI.getMode();
      ctx.record(nowMode === "town", nowMode === "town" ? "Entered town (scenario)" : "Town entry not achieved (scenario)");

      return true;
    } catch (e) {
      ctx.record(false, "Town scenario module failed: " + (e && e.message ? e.message : String(e)));
      return true;
    }
  }

  window.SmokeTest.Scenarios.Town = { run };
})();