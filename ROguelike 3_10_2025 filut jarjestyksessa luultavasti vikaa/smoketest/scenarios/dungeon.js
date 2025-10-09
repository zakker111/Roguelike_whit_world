(function () {
  // SmokeTest Scenario: Dungeon entry, chest/decay core checks (subset)
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  async function run(ctx) {
    // ctx: { key, sleep, makeBudget, record, recordSkip, ensureAllModalsClosed, CONFIG, caps }
    try {
      var caps = (ctx && ctx.caps) || {};
      if (!caps.GameAPI || !caps.getMode) { ctx.recordSkip && ctx.recordSkip("Dungeon scenario skipped (GameAPI/getMode not available)"); return true; }
      if (!window.GameAPI || !has(window.GameAPI.getMode)) return false;

      await ctx.ensureAllModalsClosed?.(8);

      // If already in dungeon, record and keep mode for downstream scenarios
      const mode0 = window.GameAPI.getMode();
      if (mode0 === "dungeon") {
        ctx.record(true, "Already in dungeon");
        return true;
      }

      // If in town, attempt to return to world first
      try {
        if (mode0 === "town") {
          if (typeof window.GameAPI.returnToWorldIfAtExit === "function") window.GameAPI.returnToWorldIfAtExit();
          await ctx.sleep(240);
          if (window.GameAPI.getMode() !== "world") {
            // Fallback: Start New Game to reach world quickly
            const btnNG = document.getElementById("god-newgame-btn");
            if (btnNG) { btnNG.click(); await ctx.sleep(500); }
          }
        }
      } catch (_) {}

      // Robust entry routine with retries and waits
      const tryEnterDungeon = async () => {
        try {
          if (has(window.GameAPI.gotoNearestDungeon)) await window.GameAPI.gotoNearestDungeon();
          ctx.key("Enter"); await ctx.sleep(280);
          if (has(window.GameAPI.enterDungeonIfOnEntrance)) window.GameAPI.enterDungeonIfOnEntrance();
          await ctx.sleep(320);
        } catch (_) {}
      };
      const waitUntilDungeon = async (timeoutMs) => {
        const deadline = Date.now() + (timeoutMs | 0);
        while (Date.now() < deadline) {
          try { if (window.GameAPI.getMode() === "dungeon") return true; } catch (_) {}
          await ctx.sleep(100);
        }
        try { return window.GameAPI.getMode() === "dungeon"; } catch (_) { return false; }
      };

      let entered = (window.GameAPI.getMode() === "dungeon");
      for (let attempt = 0; attempt < 3 && !entered; attempt++) {
        await tryEnterDungeon();
        entered = await waitUntilDungeon(1500);
        if (!entered) {
          // Route to entrance/adjacent and retry
          try {
            if (has(window.GameAPI.nearestDungeon)) {
              const nd = window.GameAPI.nearestDungeon();
              if (nd) {
                // Movement helper preferred
                try {
                  var MV = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Movement;
                  if (MV && typeof MV.routeAdjTo === "function") {
                    await MV.routeAdjTo(nd.x, nd.y, { timeoutMs: (ctx.CONFIG && ctx.CONFIG.timeouts && ctx.CONFIG.timeouts.route) || 5000, stepMs: 95 });
                  } else if (has(window.GameAPI.routeTo)) {
                    const adj = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
                    for (const d of adj) {
                      const ax = nd.x + d.dx, ay = nd.y + d.dy;
                      const path = window.GameAPI.routeTo(ax, ay) || [];
                      const dl = Date.now() + ((ctx.CONFIG && ctx.CONFIG.timeouts && ctx.CONFIG.timeouts.route) || 4000);
                      for (const st of path) {
                        if (Date.now() > dl) break;
                        const pl = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : st;
                        const dx = Math.sign(st.x - pl.x);
                        const dy = Math.sign(st.y - pl.y);
                        ctx.key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                        await ctx.sleep(95);
                      }
                      if (Date.now() <= dl) break;
                    }
                  }
                } catch (_) {}
                // Final nudge and enter again
                try {
                  var MVN = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Movement;
                  if (MVN && typeof MVN.bumpToward === "function") {
                    MVN.bumpToward(nd.x, nd.y);
                  }
                } catch (_) {}
                await tryEnterDungeon();
                entered = await waitUntilDungeon(1500);
              }
            }
          } catch (_) {}
        }
      }

      // Last-chance manual moves then enter/API
      if (!entered) {
        const moves = ["ArrowRight","ArrowDown","ArrowLeft","ArrowUp","ArrowRight","ArrowRight","ArrowDown","ArrowDown","ArrowRight"];
        for (const m of moves) { ctx.key(m); await ctx.sleep(110); }
        ctx.key("Enter"); await ctx.sleep(220);
        if (has(window.GameAPI.enterDungeonIfOnEntrance)) window.GameAPI.enterDungeonIfOnEntrance();
        await ctx.sleep(260);
        entered = (window.GameAPI.getMode() === "dungeon");
      }

      const modeNow = window.GameAPI.getMode();
      ctx.record(entered, entered ? `Entered dungeon (mode=${modeNow})` : `Dungeon entry failed (mode=${modeNow})`);

      return true; // handled by scenario module (regardless of pass/fail)
    } catch (e) {
      ctx.record(false, "Dungeon scenario module failed: " + (e && e.message ? e.message : String(e)));
      return true;
    }
  }

  window.SmokeTest.Scenarios.Dungeon = { run };
})();