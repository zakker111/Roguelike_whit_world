(function () {
  // SmokeTest Scenario: Dungeon entry, chest/decay core checks (subset)
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  async function run(ctx) {
    // ctx: { key, sleep, makeBudget, record, recordSkip, ensureAllModalsClosed, CONFIG }
    try {
      if (!window.GameAPI || !has(window.GameAPI.getMode)) return false;
      // Precondition: overworld only
      const inWorld = window.GameAPI.getMode() === "world";
      if (!inWorld) return false;

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
      if (!entered && has(window.GameAPI.nearestDungeon) && has(window.GameAPI.routeTo)) {
        try {
          const nd = window.GameAPI.nearestDungeon();
          if (nd) {
            const pathND = window.GameAPI.routeTo(nd.x, nd.y);
            const budgetND = ctx.makeBudget(ctx.CONFIG.timeouts.route);
            for (const step of pathND) {
              if (budgetND.exceeded()) break;
              const pl = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : step;
              const ddx = Math.sign(step.x - pl.x);
              const ddy = Math.sign(step.y - pl.y);
              ctx.key(ddx === -1 ? "ArrowLeft" : ddx === 1 ? "ArrowRight" : (ddy === -1 ? "ArrowUp" : "ArrowDown"));
              await ctx.sleep(90);
            }
            ctx.key("Enter"); await ctx.sleep(280);
            if (has(window.GameAPI.enterDungeonIfOnEntrance)) window.GameAPI.enterDungeonIfOnEntrance();
            await ctx.sleep(260);
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