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

      // Ensure we are in overworld; if not, fallback to Start New Game
      let mode0 = window.GameAPI.getMode();
      if (mode0 !== "world") {
        try {
          const btnNG = document.getElementById("god-newgame-btn");
          if (btnNG) { btnNG.click(); await ctx.sleep(650); }
        } catch (_) {}
        mode0 = window.GameAPI.getMode();
        if (mode0 !== "world") {
          ctx.recordSkip && ctx.recordSkip("Town scenario skipped (unable to reach overworld)");
          return true;
        }
      }

      async function routeAdjToTownGate(nt) {
        try {
          var MV = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Movement;
          const timeoutMs = ((ctx.CONFIG && ctx.CONFIG.timeouts && ctx.CONFIG.timeouts.route) || 3500) + 3000;
          const stepMs = 85;
          if (MV && typeof MV.routeAdjTo === "function") {
            return await MV.routeAdjTo(nt.x, nt.y, { timeoutMs, stepMs });
          }
          if (has(window.GameAPI.routeTo)) {
            const adj = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
            for (const d of adj) {
              const ax = nt.x + d.dx, ay = nt.y + d.dy;
              const path = window.GameAPI.routeTo(ax, ay) || [];
              const budget = ctx.makeBudget(timeoutMs);
              for (const st of path) {
                if (budget.exceeded()) break;
                const pl = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : st;
                const dx = Math.sign(st.x - pl.x);
                const dy = Math.sign(st.y - pl.y);
                ctx.key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                await ctx.sleep(stepMs);
              }
              if (!budget.exceeded()) return true;
            }
          }
        } catch (_) {}
        return false;
      }

      const waitUntilTown = async (timeoutMs) => {
        const deadline = Date.now() + (timeoutMs | 0);
        while (Date.now() < deadline) {
          try { if (window.GameAPI.getMode() === "town") return true; } catch (_) {}
          await ctx.sleep(120);
        }
        try { return window.GameAPI.getMode() === "town"; } catch (_) { return false; }
      };

      let okTown = false;
      try {
        const nt = has(window.GameAPI.nearestTown) ? window.GameAPI.nearestTown() : null;
        if (nt) {
          // Prefer auto helper first; if unavailable, route to adjacent
          if (has(window.GameAPI.gotoNearestTown)) {
            okTown = !!(await window.GameAPI.gotoNearestTown());
          } else {
            okTown = await routeAdjToTownGate(nt);
          }
        } else if (has(window.GameAPI.gotoNearestTown)) {
          okTown = !!(await window.GameAPI.gotoNearestTown());
        }
      } catch (_) {}

      // Attempt multiple entry tries: G + API with retries and waits
      const tryEnterTown = async () => {
        ctx.key("g"); await ctx.sleep(420);
        try { if (has(window.GameAPI.enterTownIfOnTile)) window.GameAPI.enterTownIfOnTile(); } catch (_) {}
        await ctx.sleep(420);
      };

      let entered = (window.GameAPI.getMode() === "town");
      for (let attempt = 0; attempt < 5 && !entered; attempt++) {
        await tryEnterTown();
        entered = await waitUntilTown(2200);
        if (!entered) {
          // Nudge toward town gate and retry
          try {
            const nt = has(window.GameAPI.nearestTown) ? window.GameAPI.nearestTown() : null;
            var MVN = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Movement;
            if (nt && MVN && typeof MVN.bumpToward === "function") {
              MVN.bumpToward(nt.x, nt.y);
            }
          } catch (_) {}
          await tryEnterTown();
          entered = await waitUntilTown(2200);
        }
      }

      // Final fallback: small manual moves then Enter/API
      if (!entered) {
        const moves = ["ArrowRight","ArrowDown","ArrowLeft","ArrowUp","ArrowRight","ArrowRight","ArrowDown","ArrowDown","ArrowRight"];
        for (const m of moves) { ctx.key(m); await ctx.sleep(90); }
        await tryEnterTown();
        entered = (window.GameAPI.getMode() === "town");
      }

      const nowMode = window.GameAPI.getMode();
      ctx.record(nowMode === "town", nowMode === "town" ? "Entered town (scenario)" : "Town entry not achieved (scenario)");

      return true;
    } catch (e) {
      ctx.record(false, "Town scenario module failed: " + (e && e.message ? e.message : String(e)));
      return true;
    }
  }

  window.SmokeTest.Scenarios.Town = { run };
})();