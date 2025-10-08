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
      // Precondition: overworld only
      const inWorld = window.GameAPI.getMode() === "world";
      if (!inWorld) { ctx.recordSkip && ctx.recordSkip("Dungeon scenario skipped (not in overworld)"); return true; }

      await ctx.ensureAllModalsClosed?.(8);

      let entered = false;

      // Attempt 1: helper + Enter/API
      try {
        if (has(window.GameAPI.gotoNearestDungeon)) {
          await window.GameAPI.gotoNearestDungeon();
        }
        ctx.key("Enter"); await ctx.sleep(280);
        if (has(window.GameAPI.enterDungeonIfOnEntrance)) window.GameAPI.enterDungeonIfOnEntrance();
        await ctx.sleep(260);
        entered = (window.GameAPI.getMode() === "dungeon");
      } catch (_) {}

      // Attempt 2: route to nearestDungeon coords
      if (!entered && has(window.GameAPI.nearestDungeon)) {
        try {
          const nd = window.GameAPI.nearestDungeon();
          if (nd) {
            let usedHelper = false;
            try {
              var MV = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Movement;
              if (MV && typeof MV.routeTo === "function") {
                usedHelper = await MV.routeTo(nd.x, nd.y, { timeoutMs: (ctx.CONFIG && ctx.CONFIG.timeouts && ctx.CONFIG.timeouts.route) || 2500 });
              }
            } catch (_) {}
            let pathND = null;
            if (!usedHelper && has(window.GameAPI.routeTo)) {
              pathND = window.GameAPI.routeTo(nd.x, nd.y);
              const budgetND = ctx.makeBudget(ctx.CONFIG.timeouts.route);
              for (const step of pathND) {
                if (budgetND.exceeded()) break;
                const pl = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : step;
                const ddx = Math.sign(step.x - pl.x);
                const ddy = Math.sign(step.y - pl.y);
                ctx.key(ddx === -1 ? "ArrowLeft" : ddx === 1 ? "ArrowRight" : (ddy === -1 ? "ArrowUp" : "ArrowDown"));
                await ctx.sleep(90);
              }
            }
            // Fallback: route to an adjacent walkable tile next to the dungeon entrance
            if (!entered && (!pathND || !pathND.length) && has(window.GameAPI.routeTo)) {
              const adj = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
              outer: for (const d of adj) {
                const ax = nd.x + d.dx, ay = nd.y + d.dy;
                try {
                  const p2 = window.GameAPI.routeTo(ax, ay) || [];
                  const budget2 = ctx.makeBudget((ctx.CONFIG && ctx.CONFIG.timeouts && ctx.CONFIG.timeouts.route) || 2500);
                  for (const st of p2) {
                    if (budget2.exceeded()) break outer;
                    const pl2 = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : st;
                    const dx2 = Math.sign(st.x - pl2.x);
                    const dy2 = Math.sign(st.y - pl2.y);
                    ctx.key(dx2 === -1 ? "ArrowLeft" : dx2 === 1 ? "ArrowRight" : (dy2 === -1 ? "ArrowUp" : "ArrowDown"));
                    await ctx.sleep(90);
                  }
                  break; // attempted one adjacency
                } catch (_) {}
              }
            }
            ctx.key("Enter"); await ctx.sleep(320);
            if (has(window.GameAPI.enterDungeonIfOnEntrance)) window.GameAPI.enterDungeonIfOnEntrance();
            await ctx.sleep(300);
            entered = (window.GameAPI.getMode() === "dungeon");
          }
        } catch (_) {}
      }

      // Fallback short path: a few manual steps then try Enter/API
      if (!entered) {
        const moves = ["ArrowRight","ArrowDown","ArrowLeft","ArrowUp","ArrowRight","ArrowRight","ArrowDown","ArrowDown","ArrowRight"];
        for (const m of moves) { ctx.key(m); await ctx.sleep(110); }
        ctx.key("Enter"); await ctx.sleep(200);
        ctx.key("KeyG"); await ctx.sleep(200);
        if (has(window.GameAPI.enterDungeonIfOnEntrance)) window.GameAPI.enterDungeonIfOnEntrance();
        await ctx.sleep(240);
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