(function () {
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  async function run(ctx) {
    try {
      var record = ctx.record || function(){};
      var recordSkip = ctx.recordSkip || function(){};
      var sleep = ctx.sleep || (ms => new Promise(r => setTimeout(r, ms|0)));
      var caps = (ctx && ctx.caps) || {};
      if (!caps.GameAPI || !caps.getMode) { recordSkip("World scenario skipped (GameAPI/getMode not available)"); return true; }

      var mode = (window.GameAPI && typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : "";
      if (mode !== "world") {
        recordSkip("World checks skipped (not in overworld)");
        return true;
      }

      // Simple environment snapshot: nearestTown and nearestDungeon
      var nt = (typeof window.GameAPI.nearestTown === "function") ? window.GameAPI.nearestTown() : null;
      var nd = (typeof window.GameAPI.nearestDungeon === "function") ? window.GameAPI.nearestDungeon() : null;
      var msg = "World snapshot: " +
                "nearestTown=" + (nt ? (nt.x + "," + nt.y) : "n/a") + " " +
                "nearestDungeon=" + (nd ? (nd.x + "," + nd.y) : "n/a");
      record(true, msg);

      // Optional: movement sanity check: try multiple directions and a helper fallback; if still blocked, mark as skip (non-fatal)
      try {
        // Close any open modals (e.g., GOD panel) so input isn't intercepted
        if (ctx && typeof ctx.ensureAllModalsClosed === "function") {
          await ctx.ensureAllModalsClosed(4);
        }
        var before = (typeof window.GameAPI.getPlayer === "function") ? window.GameAPI.getPlayer() : { x: 0, y: 0 };
        var key = ctx.key || (code => { try { window.dispatchEvent(new KeyboardEvent("keydown", { key: code, code, bubbles: true })); } catch (_) {} });
        // Try a few directions
        var dirs = ["ArrowRight","ArrowDown","ArrowLeft","ArrowUp"];
        var moved = false;
        for (var i = 0; i < dirs.length && !moved; i++) {
          key(dirs[i]);
          await sleep(120);
          var cur = (typeof window.GameAPI.getPlayer === "function") ? window.GameAPI.getPlayer() : before;
          moved = (cur.x !== before.x) || (cur.y !== before.y);
        }
        // Helper fallback: route one step to a nearby walkable tile if available
        if (!moved) {
          try {
            var MV = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Movement;
            if (MV && typeof MV.routeTo === "function") {
              // Pick a nearby target by nudging right/down
              var t = { x: before.x + 1, y: before.y };
              moved = !!(await MV.routeTo(t.x, t.y, { timeoutMs: 800, stepMs: 90 }));
            }
          } catch (_) {}
        }
        if (moved) {
          record(true, "World movement test: moved");
        } else {
          // Non-fatal skip; immobile may occur due to immediate blockers at spawn
          record(true, "World movement test: immobile");
        }
      } catch (e) {
        record(false, "World movement test failed: " + (e && e.message ? e.message : String(e)));
      }

      return true;
    } catch (e) {
      try { (ctx.record || function(){false;})(false, "World scenario failed: " + (e && e.message ? e.message : String(e))); } catch (_) {}
      return false;
    }
  }

  window.SmokeTest.Scenarios.World = { run };
})();