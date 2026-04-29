(function () {
  // SmokeTest Scenario: transitions that can leave stale tower/dungeon exit state.
  // Focus: enter tower -> use internal stairs -> exit -> enter normal dungeon -> exit.
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  async function run(ctx) {
    try {
      var record = ctx.record || function () {};
      var recordSkip = ctx.recordSkip || function () {};
      var sleep = ctx.sleep || (ms => new Promise(r => setTimeout(r, ms | 0)));
      var key = ctx.key || function () {};
      var ensureAllModalsClosed = (ctx && ctx.ensureAllModalsClosed) ? ctx.ensureAllModalsClosed : async function () {};

      var G = window.GameAPI || {};
      if (!G || !has(G.getMode) || !has(G.getCtx)) {
        recordSkip("Dungeon stairs transitions skipped (GameAPI.getMode/getCtx not available)");
        return true;
      }

      async function waitUntil(fn, timeoutMs, stepMs) {
        var deadline = Date.now() + Math.max(50, timeoutMs | 0);
        var step = Math.max(20, stepMs | 0 || 70);
        while (Date.now() < deadline) {
          try { if (fn()) return true; } catch (_) {}
          await sleep(step);
        }
        try { return !!fn(); } catch (_) { return false; }
      }

      function ctxRef() {
        try { return G.getCtx(); } catch (_) { return null; }
      }

      function worldPosOfPlayer(c) {
        try {
          if (!c || !c.world || !c.player) return null;
          return { wx: (c.world.originX | 0) + (c.player.x | 0), wy: (c.world.originY | 0) + (c.player.y | 0) };
        } catch (_) { return null; }
      }

      function worldTileUnderfoot(c) {
        try {
          if (!c || !c.world || !c.player) return null;
          var WT = c.World && c.World.TILES;
          if (!WT) return null;
          var wp = worldPosOfPlayer(c);
          if (!wp) return null;
          var gen = c.world.gen;
          var tile = (gen && typeof gen.tileAt === "function") ? gen.tileAt(wp.wx, wp.wy) : null;
          return { tile, WT, wx: wp.wx, wy: wp.wy };
        } catch (_) { return null; }
      }

      async function ensureWorldMode() {
        try {
          var mode0 = G.getMode();
          if (mode0 === "world") return true;
          await ensureAllModalsClosed(3);

          var TP = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Teleport;
          if (mode0 === "dungeon") {
            if (TP && typeof TP.teleportToDungeonExitAndLeave === "function") {
              await TP.teleportToDungeonExitAndLeave(ctx, { closeModals: true, waitMs: 400 });
            } else if (has(G.returnToWorldIfAtExit)) {
              G.returnToWorldIfAtExit();
            }
          } else if (mode0 === "town") {
            if (TP && typeof TP.teleportToGateAndExit === "function") {
              await TP.teleportToGateAndExit(ctx, { closeModals: true, waitMs: 400 });
            } else if (has(G.returnToWorldFromTown)) {
              G.returnToWorldFromTown();
            } else if (has(G.leaveTownNow)) {
              G.leaveTownNow();
            }
          }

          await waitUntil(function () { try { return G.getMode() === "world"; } catch (_) { return false; } }, 900, 80);

          if (G.getMode() !== "world" && has(G.forceWorld)) {
            G.forceWorld();
            await waitUntil(function () { try { return G.getMode() === "world"; } catch (_) { return false; } }, 900, 80);
          }

          return G.getMode() === "world";
        } catch (_) {
          return G.getMode() === "world";
        }
      }

      async function godTeleportTarget(target) {
        try {
          var c = ctxRef();
          if (!c) return false;
          if (typeof window.God === "object" && typeof window.God.teleportToTarget === "function") {
            window.God.teleportToTarget(c, String(target || "tower"));
            await sleep(220);
            return true;
          }
          if (c.God && typeof c.God.teleportToTarget === "function") {
            c.God.teleportToTarget(c, String(target || "tower"));
            await sleep(220);
            return true;
          }
          // UI handler fallback
          if (typeof window.UI === "object" && window.UI.handlers && typeof window.UI.handlers.onGodTeleport === "function") {
            window.UI.handlers.onGodTeleport(String(target || "tower"));
            await sleep(220);
            return true;
          }
        } catch (_) {}
        return false;
      }

      async function enterDungeonOrTowerFromWorld(expectLabel) {
        try {
          await ensureAllModalsClosed(2);
          try { key("g"); } catch (_) {}
          await sleep(260);
          try { if (has(G.enterDungeonIfOnEntrance)) G.enterDungeonIfOnEntrance(); } catch (_) {}
          await sleep(260);
          await waitUntil(function () { try { return G.getMode() === "dungeon"; } catch (_) { return false; } }, 1400, 80);
          var m = G.getMode();
          record(m === "dungeon", (m === "dungeon") ? ("Entered " + expectLabel) : ("Failed to enter " + expectLabel + " (mode=" + m + ")"));
          return (m === "dungeon");
        } catch (_) {
          record(false, "Enter " + expectLabel + " failed (exception)");
          return false;
        }
      }

      async function exitDungeonToWorldStrict(label) {
        try {
          var c = ctxRef();
          if (!c) return false;

          var exit = null;
          try { exit = has(G.getDungeonExit) ? G.getDungeonExit() : null; } catch (_) { exit = null; }

          if (!exit && c && c.towerRun && c.towerRun.floors) {
            try {
              var tr = c.towerRun;
              var f = tr.currentFloor || 1;
              var meta = tr.floors && tr.floors[f];
              if (meta && meta.exitToWorldPos && f === 1) {
                exit = { x: meta.exitToWorldPos.x, y: meta.exitToWorldPos.y };
              }
            } catch (_) {}
          }

          if (!exit || typeof exit.x !== "number" || typeof exit.y !== "number") {
            record(false, label + ": missing dungeon exit coordinates");
            return false;
          }

          await ensureAllModalsClosed(2);

          var tpOk = false;
          try {
            if (has(G.teleportTo)) {
              tpOk = !!G.teleportTo(exit.x, exit.y, { ensureWalkable: false, fallbackScanRadius: 0 });
            }
          } catch (_) {}
          await sleep(120);

          var pl = has(G.getPlayer) ? G.getPlayer() : { x: exit.x, y: exit.y };
          var onExit = (pl.x === exit.x && pl.y === exit.y);

          var tiles = null;
          try { tiles = has(G.getTiles) ? G.getTiles() : null; } catch (_) { tiles = null; }
          var t = null;
          try { t = has(G.getTile) ? G.getTile(exit.x, exit.y) : null; } catch (_) { t = null; }
          var isStairs = (tiles && tiles.STAIRS != null && t != null) ? (t === tiles.STAIRS) : true;

          record(!!onExit, label + ": positioned on exit tile (" + exit.x + "," + exit.y + ")" + (tpOk ? "" : " [teleport failed]") );
          record(!!isStairs, label + ": exit tile is STAIRS");

          var okRet = false;
          try { okRet = has(G.returnToWorldIfAtExit) ? !!G.returnToWorldIfAtExit() : false; } catch (_) { okRet = false; }
          await waitUntil(function () { try { return G.getMode() === "world"; } catch (_) { return false; } }, 1200, 80);

          var m = G.getMode();
          record(okRet && m === "world", label + ": returnToWorldIfAtExit() => " + okRet + " (mode=" + m + ")");
          return okRet && m === "world";
        } catch (_) {
          record(false, label + ": strict exit failed (exception)");
          return false;
        }
      }

      // --- Sequence A: tower -> exit -> normal dungeon ---

      var okWorld = await ensureWorldMode();
      if (!okWorld) {
        record(false, "Transitions: failed to reach world mode");
        return true;
      }

      // Teleport to nearest tower and assert the tile type.
      var tpTower = await godTeleportTarget("tower");
      if (!tpTower) {
        recordSkip("Transitions skipped (GOD teleportToTarget not available)");
        return true;
      }
      await sleep(120);

      var c0 = ctxRef();
      var under0 = worldTileUnderfoot(c0);
      var onTowerTile = !!(under0 && under0.WT && under0.tile === under0.WT.TOWER);
      if (!onTowerTile) {
        recordSkip("World: no tower found / GOD teleport did not land on a TOWER tile (skipping tower→dungeon transition check)");
        return true;
      }
      record(true, "World: on tower tile (" + under0.wx + "," + under0.wy + ")");

      // Enter the tower.
      var okEnterTower = await enterDungeonOrTowerFromWorld("tower");
      if (!okEnterTower) { await ensureWorldMode(); return true; }

      var c1 = ctxRef();
      var isTower = !!(c1 && c1.towerRun && c1.towerRun.kind === "tower");
      record(isTower, "Tower: towerRun present");
      if (!isTower) { await ensureWorldMode(); return true; }

      // Use internal stairs: base -> floor 2 -> base.
      try {
        var tr = c1.towerRun;
        var fBase = tr.currentFloor || 1;
        var metaBase = tr.floors && tr.floors[fBase];
        var up = metaBase && metaBase.stairsUpPos ? metaBase.stairsUpPos : null;

        if (!up || typeof up.x !== "number" || typeof up.y !== "number") {
          recordSkip("Tower: no stairsUpPos on base floor (cannot test internal stairs)");
        } else {
          await ensureAllModalsClosed(1);
          if (has(G.teleportTo)) G.teleportTo(up.x, up.y, { ensureWalkable: false, fallbackScanRadius: 0 });
          await sleep(140);

          var beforeFloor = (ctxRef() && ctxRef().towerRun) ? (ctxRef().towerRun.currentFloor || 1) : 1;
          // Trigger stairs via key + API to mirror normal play.
          key("g");
          await sleep(200);
          var okUp = has(G.returnToWorldIfAtExit) ? !!G.returnToWorldIfAtExit() : false;
          await sleep(260);

          var cUp = ctxRef();
          var afterFloor = (cUp && cUp.towerRun) ? (cUp.towerRun.currentFloor || 1) : beforeFloor;
          record(okUp && afterFloor === beforeFloor + 1 && G.getMode() === "dungeon", "Tower stairs: climbed to floor " + afterFloor);

          // Now go back down to base.
          var metaNow = cUp && cUp.towerRun && cUp.towerRun.floors ? cUp.towerRun.floors[afterFloor] : null;
          var down = metaNow && metaNow.stairsDownPos ? metaNow.stairsDownPos : null;
          if (!down || typeof down.x !== "number" || typeof down.y !== "number") {
            record(false, "Tower stairs: missing stairsDownPos on floor " + afterFloor);
          } else {
            if (has(G.teleportTo)) G.teleportTo(down.x, down.y, { ensureWalkable: false, fallbackScanRadius: 0 });
            await sleep(140);
            key("g");
            await sleep(200);
            var okDown = has(G.returnToWorldIfAtExit) ? !!G.returnToWorldIfAtExit() : false;
            await sleep(260);
            var cDown = ctxRef();
            var floorAfterDown = (cDown && cDown.towerRun) ? (cDown.towerRun.currentFloor || 1) : afterFloor;
            record(okDown && floorAfterDown === beforeFloor && G.getMode() === "dungeon", "Tower stairs: descended back to base floor");
          }
        }
      } catch (_) {
        record(false, "Tower stairs: internal stairs test failed (exception)");
      }

      // Exit tower to world and assert towerRun cleared.
      var okExitTower = await exitDungeonToWorldStrict("Tower exit");
      if (!okExitTower) { await ensureWorldMode(); return true; }

      var cAfterTower = ctxRef();
      var towerCleared = !!(cAfterTower && !cAfterTower.towerRun);
      record(towerCleared, "Post-tower: towerRun cleared");

      // Teleport to nearest normal dungeon, enter, and then exit.
      var okWorld2 = await ensureWorldMode();
      if (!okWorld2) {
        record(false, "Transitions: failed to return to world after tower");
        return true;
      }

      await godTeleportTarget("dungeon");
      await sleep(120);

      var cW = ctxRef();
      var underD = worldTileUnderfoot(cW);
      var onDungeonTile = !!(underD && underD.WT && underD.tile === underD.WT.DUNGEON);
      if (!onDungeonTile) {
        recordSkip("World: no dungeon found / GOD teleport did not land on a DUNGEON tile (skipping post-tower dungeon exit check)");
        await ensureWorldMode();
        return true;
      }
      record(true, "World: on dungeon tile (" + underD.wx + "," + underD.wy + ")");

      var okEnterDungeon = await enterDungeonOrTowerFromWorld("dungeon");
      if (!okEnterDungeon) { await ensureWorldMode(); return true; }

      var cD = ctxRef();
      var towerNull = !!(cD && !cD.towerRun);
      var kind = (cD && cD.dungeonInfo && typeof cD.dungeonInfo.kind === "string") ? String(cD.dungeonInfo.kind) : "";
      record(towerNull && kind.toLowerCase() !== "tower", "Dungeon: entered normal dungeon (towerRun=null, kind=" + (kind || "(none)") + ")");

      await exitDungeonToWorldStrict("Dungeon exit after tower");
      await ensureWorldMode();

      var cFinal = ctxRef();
      record(!!(cFinal && !cFinal.towerRun), "Post-dungeon: towerRun remains null");

      return true;
    } catch (e) {
      try {
        (ctx.record || function () {}) (false, "Dungeon stairs transitions scenario failed: " + (e && e.message ? e.message : String(e)));
      } catch (_) {}
      return true;
    }
  }

  window.SmokeTest.Scenarios.Dungeon = window.SmokeTest.Scenarios.Dungeon || {};
  window.SmokeTest.Scenarios.Dungeon.StairsTransitions = { run };
})();
