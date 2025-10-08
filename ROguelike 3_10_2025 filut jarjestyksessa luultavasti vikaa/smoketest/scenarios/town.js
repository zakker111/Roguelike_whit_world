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

      // Ensure modals are closed so movement and Enter aren't swallowed
      try { if (typeof ctx.ensureAllModalsClosed === "function") await ctx.ensureAllModalsClosed(8); } catch (_) {}

      let okTown = false;

      // Prefer precise routing to nearestTown coordinate
      try {
        const nt = has(window.GameAPI.nearestTown) ? window.GameAPI.nearestTown() : null;
        if (nt) {
          let usedHelper = false;
          try {
            var MV = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Movement;
            if (MV && typeof MV.routeTo === "function") {
              usedHelper = await MV.routeTo(nt.x, nt.y, { timeoutMs: (ctx.CONFIG && ctx.CONFIG.timeouts && ctx.CONFIG.timeouts.route) || 3500, stepMs: 95 });
            }
          } catch (_) {}
          if (!usedHelper && has(window.GameAPI.routeTo)) {
            const pathNT = window.GameAPI.routeTo(nt.x, nt.y);
            const budgetNT = ctx.makeBudget((ctx.CONFIG && ctx.CONFIG.timeouts && ctx.CONFIG.timeouts.route) || 3500);
            for (const step of pathNT) {
              if (budgetNT.exceeded()) break;
              const pl = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : step;
              const ddx = Math.sign(step.x - pl.x);
              const ddy = Math.sign(step.y - pl.y);
              ctx.key(ddx === -1 ? "ArrowLeft" : ddx === 1 ? "ArrowRight" : (ddy === -1 ? "ArrowUp" : "ArrowDown"));
              await ctx.sleep(95);
            }
          }
          // Fallback: route to a walkable adjacent tile near the town gate
          try {
            var MV2 = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Movement;
            if (MV2 && typeof MV2.routeAdjTo === "function") {
              await MV2.routeAdjTo(nt.x, nt.y, { timeoutMs: (ctx.CONFIG && ctx.CONFIG.timeouts && ctx.CONFIG.timeouts.route) || 3500, stepMs: 95 });
            } else if (has(window.GameAPI.routeTo)) {
              const adj = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
              for (const d of adj) {
                const ax = nt.x + d.dx, ay = nt.y + d.dy;
                const p2 = window.GameAPI.routeTo(ax, ay) || [];
                const b2 = ctx.makeBudget((ctx.CONFIG && ctx.CONFIG.timeouts && ctx.CONFIG.timeouts.route) || 3500);
                for (const st of p2) {
                  if (b2.exceeded()) break;
                  const pl2 = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : st;
                  const dx2 = Math.sign(st.x - pl2.x);
                  const dy2 = Math.sign(st.y - pl2.y);
                  ctx.key(dx2 === -1 ? "ArrowLeft" : dx2 === 1 ? "ArrowRight" : (dy2 === -1 ? "ArrowUp" : "ArrowDown"));
                  await ctx.sleep(95);
                }
                if (!b2.exceeded()) break;
              }
            }
          } catch (_) {}
          okTown = true;
        } else if (has(window.GameAPI.gotoNearestTown)) {
          okTown = !!(await window.GameAPI.gotoNearestTown());
        }
      } catch (_) {}

      // Attempt multiple entry tries: Enter + API
      const tryEnterTown = async () => {
        ctx.key("Enter"); await ctx.sleep(380);
        try { if (has(window.GameAPI.enterTownIfOnTile)) window.GameAPI.enterTownIfOnTile(); } catch (_) {}
        await ctx.sleep(320);
      };
      await tryEnterTown();
      let nowMode = window.GameAPI.getMode();
      if (nowMode !== "town") {
        await tryEnterTown();
      }
      // Final nudge toward gate then enter
      try {
        const nt = has(window.GameAPI.nearestTown) ? window.GameAPI.nearestTown() : null;
        var MVN = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Movement;
        if (nowMode !== "town" && nt && MVN && typeof MVN.bumpToward === "function") {
          MVN.bumpToward(nt.x, nt.y);
          ctx.key("Enter"); await ctx.sleep(320);
          try { if (has(window.GameAPI.enterTownIfOnTile)) window.GameAPI.enterTownIfOnTile(); } catch (_) {}
          await ctx.sleep(320);
        }
      } catch (_) {}

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