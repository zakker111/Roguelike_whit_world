(function () {
  // SmokeTest Scenario: Dungeon chest loot + persistence invariants (exit/re-enter) + stair guard
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  async function run(ctx) {
    try {
      var record = ctx.record || function(){};
      var recordSkip = ctx.recordSkip || function(){};
      var sleep = ctx.sleep || (ms => new Promise(r => setTimeout(r, ms|0)));
      var key = ctx.key || function(){};
      var makeBudget = ctx.makeBudget || (ms => { var s=Date.now(),dl=s+(ms|0); return { exceeded:()=>Date.now()>dl, remain:()=>Math.max(0,dl-Date.now()) }; });
      var CONFIG = ctx.CONFIG || { timeouts: { route: 5000, interact: 250 } };
      var caps = (ctx && ctx.caps) || {};
      var ensureAllModalsClosed = (ctx && ctx.ensureAllModalsClosed) ? ctx.ensureAllModalsClosed : async function(){};

      async function waitUntil(fn, timeoutMs, stepMs) {
        var deadline = Date.now() + (timeoutMs|0 || 0);
        var step = Math.max(20, (stepMs|0) || 80);
        while (Date.now() < deadline) {
          try { if (fn()) return true; } catch(_){}
          await sleep(step);
        }
        try { return !!fn(); } catch(_){ return false; }
      }

      // Ensure dungeon mode; auto-enter if needed. Handle town/dungeon/world transitions robustly.
      var mode0 = (window.GameAPI && has(window.GameAPI.getMode)) ? window.GameAPI.getMode() : null;
      if (mode0 === "town") {
        try {
          if (has(window.GameAPI.returnToWorldIfAtExit)) window.GameAPI.returnToWorldIfAtExit();
        } catch (_) {}
        await sleep(240);
        mode0 = window.GameAPI.getMode();
        if (mode0 !== "world") {
          try { var btnNG = document.getElementById("god-newgame-btn"); if (btnNG) btnNG.click(); } catch (_) {}
          await sleep(400);
        }
      }

      var inDungeon = (window.GameAPI && has(window.GameAPI.getMode) && window.GameAPI.getMode() === "dungeon");
      if (!inDungeon) {
        try {
          if (has(window.GameAPI.getMode) && window.GameAPI.getMode() !== "world") {
            // If still not world, attempt minimal fallback
            try { var btnNG2 = document.getElementById("god-newgame-btn"); if (btnNG2) btnNG2.click(); } catch (_) {}
            await sleep(380);
          }
          if (has(window.GameAPI.gotoNearestDungeon)) {
            await window.GameAPI.gotoNearestDungeon();
          }
          key("g"); await sleep(280);
          if (has(window.GameAPI.enterDungeonIfOnEntrance)) window.GameAPI.enterDungeonIfOnEntrance();
          await sleep(260);
        } catch (_) {}
        inDungeon = (window.GameAPI && has(window.GameAPI.getMode) && window.GameAPI.getMode() === "dungeon");
        if (!inDungeon) { recordSkip("Dungeon persistence skipped (not in dungeon)"); return true; }
      }

      // Chest loot: find 'chest' corpse, route to it, press G
      try {
        var corpses = has(window.GameAPI.getCorpses) ? (window.GameAPI.getCorpses() || []) : [];
        var chest = corpses.find(c => c && c.kind === "chest");

        // Fallback: if no chest exists, try spawning one nearby (test-only helper)
        if (!chest && has(window.GameAPI.spawnChestNearby)) {
          try { window.GameAPI.spawnChestNearby(1); } catch (_) {}
          await sleep(200);
          corpses = has(window.GameAPI.getCorpses) ? (window.GameAPI.getCorpses() || []) : [];
          chest = corpses.find(c => c && c.kind === "chest");
        }

        if (chest) {
          // Route to chest tile
          var pathC = has(window.GameAPI.routeToDungeon) ? (window.GameAPI.routeToDungeon(chest.x, chest.y) || []) : [];
          var budgetC = makeBudget((CONFIG.timeouts && CONFIG.timeouts.route) || 5000);
          for (var i = 0; i < pathC.length; i++) {
            var step = pathC[i];
            if (budgetC.exceeded()) { recordSkip("Routing to chest timed out"); break; }
            var dx = Math.sign(step.x - (has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer().x : step.x));
            var dy = Math.sign(step.y - (has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer().y : step.y));
            key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
            await sleep(110);
          }
          // Ensure we stand exactly on the chest tile before interacting
          try {
            var pl0 = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : { x: chest.x, y: chest.y };
            var onChest = (pl0.x === chest.x && pl0.y === chest.y);
            if (!onChest) {
              // Try a direct bump towards the chest
              var bdx0 = Math.sign(chest.x - pl0.x), bdy0 = Math.sign(chest.y - pl0.y);
              key(bdx0 === -1 ? "ArrowLeft" : bdx0 === 1 ? "ArrowRight" : (bdy0 === -1 ? "ArrowUp" : "ArrowDown"));
              await sleep(120);
              pl0 = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : pl0;
              onChest = (pl0.x === chest.x && pl0.y === chest.y);
            }
            if (!onChest) {
              // Precise re-route to the exact chest tile (short budget)
              var pathExact = has(window.GameAPI.routeToDungeon) ? (window.GameAPI.routeToDungeon(chest.x, chest.y) || []) : [];
              var budE = makeBudget(1200);
              for (var ei = 0; ei < pathExact.length; ei++) {
                var stE = pathExact[ei];
                if (budE.exceeded()) break;
                var dxE = Math.sign(stE.x - (has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer().x : stE.x));
                var dyE = Math.sign(stE.y - (has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer().y : stE.y));
                key(dxE === -1 ? "ArrowLeft" : dxE === 1 ? "ArrowRight" : (dyE === -1 ? "ArrowUp" : "ArrowDown"));
                await sleep(90);
              }
              pl0 = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : pl0;
              onChest = (pl0.x === chest.x && pl0.y === chest.y);
            }
            if (!onChest) {
              // Last nudge: two extra bumps
              for (var nb = 0; nb < 2 && !onChest; nb++) {
                var bdx = Math.sign(chest.x - pl0.x), bdy = Math.sign(chest.y - pl0.y);
                key(bdx === -1 ? "ArrowLeft" : bdx === 1 ? "ArrowRight" : (bdy === -1 ? "ArrowUp" : "ArrowDown"));
                await sleep(100);
                pl0 = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : pl0;
                onChest = (pl0.x === chest.x && pl0.y === chest.y);
              }
            }
          } catch (_) {}

          // Snapshot before interaction
          var corpsesBefore = has(window.GameAPI.getCorpses) ? (window.GameAPI.getCorpses() || []) : [];
          var chestBefore = corpsesBefore.find(function (c) { return c && c.kind === "chest" && c.x === chest.x && c.y === chest.y; }) || { looted: false, lootCount: 0 };
          var invBefore = has(window.GameAPI.getInventory) ? (window.GameAPI.getInventory() || []).length : null;

          // Interact: ensure modals closed then press 'g'
          try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(1); } catch (_){}
          var ib = makeBudget((CONFIG.timeouts && CONFIG.timeouts.interact) || 500);
          key("g");
          await sleep(Math.min(ib.remain(), 300));

          // Check after
          var corpsesAfter = has(window.GameAPI.getCorpses) ? (window.GameAPI.getCorpses() || []) : [];
          var chestAfter = corpsesAfter.find(function (c) { return c && c.kind === "chest" && c.x === chest.x && c.y === chest.y; }) || null;
          var invAfter = has(window.GameAPI.getInventory) ? (window.GameAPI.getInventory() || []).length : null;

          var lootedFlag = !!(chestAfter ? chestAfter.looted : true); // if chest record missing, assume looted/consumed
          var lootCountReduced = !!(chestAfter && typeof chestBefore.lootCount === "number" && typeof chestAfter.lootCount === "number" && chestAfter.lootCount < chestBefore.lootCount);
          var inventoryChanged = (invBefore != null && invAfter != null) ? (invAfter > invBefore) : false;

          var okLoot = lootedFlag || lootCountReduced || inventoryChanged;
          record(okLoot, "Chest loot: " + (okLoot ? "OK" : "NO-OP") + " at (" + chest.x + "," + chest.y + ")" + (lootCountReduced ? " (loot--)" : "") + (inventoryChanged ? " (inv++)" : ""));
        } else {
          recordSkip("No chest found in dungeon (skipping chest loot)");
        } catch (e) {
        record(false, "Chest loot failed: " + (e && e.message ? e.message : String(e)));
      }

      // Stair guard: press G on a non-stair tile and assert mode remains dungeon
      try {
        // Attempt move to adjacent walkable non-stair tile (best-effort)
        var adj = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
        var moved = false;
        for (var k = 0; k < adj.length; k++) {
          var nx = (has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer().x : 0) + adj[k].dx;
          var ny = (has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer().y : 0) + adj[k].dy;
          var okWalk = has(window.GameAPI.isWalkableDungeon) ? !!window.GameAPI.isWalkableDungeon(nx, ny) : true;
          if (okWalk) {
            var dxm = Math.sign(nx - window.GameAPI.getPlayer().x);
            var dym = Math.sign(ny - window.GameAPI.getPlayer().y);
            key(dxm === -1 ? "ArrowLeft" : dxm === 1 ? "ArrowRight" : (dym === -1 ? "ArrowUp" : "ArrowDown"));
            await sleep(120);
            moved = true;
            break;
          }
        }
        key("g"); await sleep(160);
        var modeGuard = has(window.GameAPI.getMode) ? window.GameAPI.getMode() : "";
        record(modeGuard === "dungeon", "Stair guard: G on non-stair does not exit dungeon");
      } catch (eGuard) {
        record(false, "Stair guard check failed: " + (eGuard && eGuard.message ? eGuard.message : String(eGuard)));
      }

      // Exit via '>' then immediately re-enter to verify persistence invariants
      try {
        var exit = has(window.GameAPI.getDungeonExit) ? window.GameAPI.getDungeonExit() : null;
        if (exit) {
          var preCorpses = has(window.GameAPI.getCorpses) ? window.GameAPI.getCorpses().map(c => (c.x + "," + c.y + ":" + c.kind)) : [];
          var preDecals = has(window.GameAPI.getDecalsCount) ? window.GameAPI.getDecalsCount() : 0;

          var pathBack = has(window.GameAPI.routeToDungeon) ? (window.GameAPI.routeToDungeon(exit.x, exit.y) || []) : [];
          var budget = makeBudget((CONFIG.timeouts && CONFIG.timeouts.route) || 5000);
          for (var j = 0; j < pathBack.length; j++) {
            var st = pathBack[j];
            if (budget.exceeded()) { recordSkip("Routing to dungeon exit timed out"); break; }
            var dx2 = Math.sign(st.x - window.GameAPI.getPlayer().x);
            var dy2 = Math.sign(st.y - window.GameAPI.getPlayer().y);
            key(dx2 === -1 ? "ArrowLeft" : dx2 === 1 ? "ArrowRight" : (dy2 === -1 ? "ArrowUp" : "ArrowDown"));
            await sleep(110);
          }
          // Best-effort: final bump onto exact exit tile if still adjacent
          try {
            var plNow = window.GameAPI.getPlayer();
            if (plNow && (plNow.x !== exit.x || plNow.y !== exit.y)) {
              var bdx = Math.sign(exit.x - plNow.x), bdy = Math.sign(exit.y - plNow.y);
              key(bdx === -1 ? "ArrowLeft" : bdx === 1 ? "ArrowRight" : (bdy === -1 ? "ArrowUp" : "ArrowDown"));
              await sleep(120);
            }
          } catch(_){}
          // Ensure modals closed so 'g' is not intercepted
          await ensureAllModalsClosed(2);
          key("g"); await sleep(260); // exit on '>'
          // Fallback: call API directly if keypress was intercepted
          if (has(window.GameAPI.returnToWorldIfAtExit)) {
            var okRet = window.GameAPI.returnToWorldIfAtExit();
            if (!okRet) {
              // Try one more key press in case focus changed
              key("g"); await sleep(200);
            }
          }
          // Wait briefly for mode change
          await waitUntil(function(){ try { return window.GameAPI.getMode() === "world"; } catch(_){ return false; } }, 600, 80);

          var m1 = has(window.GameAPI.getMode) ? window.GameAPI.getMode() : "";
          record(m1 === "world", (m1 === "world") ? "Returned to overworld from dungeon" : ("Attempted return to overworld (mode=" + m1 + ")"));

          // Re-enter same dungeon and compare persistence markers
          if (has(window.GameAPI.enterDungeonIfOnEntrance)) {
            var playerBeforeReenter = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : null;
            await ensureAllModalsClosed(1);
            window.GameAPI.enterDungeonIfOnEntrance();
            await sleep(260);
            // Fallback: press 'g' to trigger context if API didn't take
            var m2 = has(window.GameAPI.getMode) ? window.GameAPI.getMode() : "";
            if (m2 !== "dungeon") { key("g"); await sleep(220); m2 = has(window.GameAPI.getMode) ? window.GameAPI.getMode() : ""; }
            if (m2 === "dungeon") {
              var postCorpses = has(window.GameAPI.getCorpses) ? window.GameAPI.getCorpses().map(c => (c.x + "," + c.y + ":" + c.kind)) : [];
              var postDecals = has(window.GameAPI.getDecalsCount) ? window.GameAPI.getDecalsCount() : 0;
              var overlap = preCorpses.filter(k => postCorpses.includes(k)).length;
              var corpsesOk = postCorpses.length >= preCorpses.length && (preCorpses.length === 0 || overlap > 0);
              var decalsOk = postDecals >= preDecals;
              record(corpsesOk, "Persistence corpses: before " + preCorpses.length + ", after " + postCorpses.length + ", overlap " + overlap);
              record(decalsOk, "Persistence decals: before " + preDecals + ", after " + postDecals);

              // Player non-teleport guard: delta <= 1 tile
              var playerAfterReenter = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : null;
              var stable = !!(playerBeforeReenter && playerAfterReenter && (Math.abs(playerBeforeReenter.x - playerAfterReenter.x) + Math.abs(playerBeforeReenter.y - playerAfterReenter.y) <= 1));
              record(stable, "Player teleport guard (re-enter): Δ <= 1 tile");

              // Return to world again to proceed with town flow
              if (has(window.GameAPI.returnToWorldIfAtExit)) {
                var okRet = window.GameAPI.returnToWorldIfAtExit();
                await sleep(240);
                if (!okRet) { key("g"); await sleep(240); }
              }
            } else {
              recordSkip("Persistence check skipped: failed to re-enter dungeon");
            }
          } else {
            recordSkip("Persistence check not available (enterDungeonIfOnEntrance API missing)");
          }
        } else {
          recordSkip("Skipped return to overworld (no exit info)");
        }
      } catch (e) {
        record(false, "Return to overworld/persistence failed: " + (e && e.message ? e.message : String(e)));
      }

      return true;
    } catch (e) {
      try { (ctx.record || function(){}) (false, "Dungeon persistence scenario failed: " + (e && e.message ? e.message : String(e))); } catch (_) {}
      return false;
    }
  }

  window.SmokeTest.Scenarios.Dungeon = window.SmokeTest.Scenarios.Dungeon || {};
  window.SmokeTest.Scenarios.Dungeon.Persistence = { run };
})();