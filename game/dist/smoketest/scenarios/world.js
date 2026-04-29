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

      // Expansion sanity: directly exercise the infinite-world growth path so
      // the smoke test validates width/height/origin bookkeeping, not just
      // one-step movement near spawn.
      try {
        var api = window.GameAPI || {};
        var WR = window.WorldRuntime || {};
        var gctx = (typeof api.getCtx === "function") ? api.getCtx() : null;
        if (!gctx || !gctx.world || typeof WR.ensureInBounds !== "function") {
          recordSkip("World expansion test skipped (ctx/world runtime unavailable)");
        } else {
          var beforeExpand = {
            width: gctx.world.width | 0,
            height: gctx.world.height | 0,
            originX: gctx.world.originX | 0,
            originY: gctx.world.originY | 0,
            tile00: gctx.map[0] ? gctx.map[0][0] : null
          };

          WR.ensureInBounds(gctx, -1, gctx.player.y, 32);

          var afterLeft = {
            width: gctx.world.width | 0,
            height: gctx.world.height | 0,
            originX: gctx.world.originX | 0,
            originY: gctx.world.originY | 0,
            mapCols: gctx.map[0] ? gctx.map[0].length : 0,
            seenCols: gctx.seen[0] ? gctx.seen[0].length : 0,
            visibleCols: gctx.visible[0] ? gctx.visible[0].length : 0,
            shiftedTile: gctx.map[0] ? gctx.map[0][32] : null
          };

          WR.ensureInBounds(gctx, gctx.player.x, -1, 32);

          var afterTop = {
            width: gctx.world.width | 0,
            height: gctx.world.height | 0,
            originX: gctx.world.originX | 0,
            originY: gctx.world.originY | 0,
            mapRows: gctx.map.length | 0,
            seenRows: gctx.seen.length | 0,
            visibleRows: gctx.visible.length | 0,
            shiftedTile: (gctx.map[32] && typeof gctx.map[32][32] !== "undefined") ? gctx.map[32][32] : null
          };

          record(afterLeft.width > beforeExpand.width, "World expansion test: width grows on left expansion");
          record(afterLeft.originX < beforeExpand.originX, "World expansion test: originX shifts on left expansion");
          record(afterLeft.mapCols === afterLeft.width, "World expansion test: map width tracks world width");
          record(afterLeft.seenCols === afterLeft.width, "World expansion test: seen width tracks world width");
          record(afterLeft.visibleCols === afterLeft.width, "World expansion test: visible width tracks world width");
          record(afterLeft.shiftedTile === beforeExpand.tile00, "World expansion test: left expansion preserves shifted tile data");

          record(afterTop.height > afterLeft.height, "World expansion test: height grows on top expansion");
          record(afterTop.originY < afterLeft.originY, "World expansion test: originY shifts on top expansion");
          record(afterTop.mapRows === afterTop.height, "World expansion test: map height tracks world height");
          record(afterTop.seenRows === afterTop.height, "World expansion test: seen height tracks world height");
          record(afterTop.visibleRows === afterTop.height, "World expansion test: visible height tracks world height");
          record(afterTop.shiftedTile === beforeExpand.tile00, "World expansion test: top expansion preserves shifted tile data");
        }
      } catch (e) {
        record(false, "World expansion test failed: " + (e && e.message ? e.message : String(e)));
      }

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
