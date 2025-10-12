/**
 * Modes: world/town/dungeon transitions and persistence, via ctx.
 *
 * API:
 *   Modes.enterTownIfOnTile(ctx) -> boolean handled
 *   Modes.enterDungeonIfOnEntrance(ctx) -> boolean handled
 *   Modes.returnToWorldIfAtExit(ctx) -> boolean handled
 *   Modes.leaveTownNow(ctx) -> void
 *   Modes.requestLeaveTown(ctx) -> void
 *   (keeps DungeonState integration inside)
 */
(function () {
  function inBounds(ctx, x, y) {
    const rows = ctx.map.length, cols = ctx.map[0] ? ctx.map[0].length : 0;
    return x >= 0 && y >= 0 && x < cols && y < rows;
  }

  function syncAfterMutation(ctx) {
    if (typeof ctx.updateCamera === "function") ctx.updateCamera();
    if (typeof ctx.recomputeFOV === "function") ctx.recomputeFOV();
    if (typeof ctx.updateUI === "function") ctx.updateUI();
    if (typeof ctx.requestDraw === "function") ctx.requestDraw();
  }

  function leaveTownNow(ctx) {
    if (!ctx.world) return;
    ctx.mode = "world";
    ctx.map = ctx.world.map;
    ctx.npcs.length = 0;
    ctx.shops.length = 0;
    if (ctx.worldReturnPos) {
      ctx.player.x = ctx.worldReturnPos.x;
      ctx.player.y = ctx.worldReturnPos.y;
    }
    try {
      if (ctx.UIBridge && typeof ctx.UIBridge.hideTownExitButton === "function") ctx.UIBridge.hideTownExitButton(ctx);
      else if (ctx.UI && typeof ctx.UI.hideTownExitButton === "function") ctx.UI.hideTownExitButton();
    } catch (_) {}
    if (ctx.log) ctx.log("You return to the overworld.", "notice");
    syncAfterMutation(ctx);
  }

  function requestLeaveTown(ctx) {
    const pos = { x: window.innerWidth / 2 - 140, y: window.innerHeight / 2 - 60 };
    try {
      if (ctx.UIBridge && typeof ctx.UIBridge.showConfirm === "function") {
        ctx.UIBridge.showConfirm(ctx, "Do you want to leave the town?", pos, () => leaveTownNow(ctx), () => {});
        return;
      }
      if (ctx.UI && typeof ctx.UI.showConfirm === "function") {
        ctx.UI.showConfirm("Do you want to leave the town?", pos, () => leaveTownNow(ctx), () => {});
        return;
      }
    } catch (_) {}
    if (typeof window !== "undefined" && window.confirm && window.confirm("Do you want to leave the town?")) {
      leaveTownNow(ctx);
    }
  }

  function enterTownIfOnTile(ctx) {
    if (ctx.mode !== "world" || !ctx.world) return false;
    const WT = ctx.World && ctx.World.TILES;
    const t = ctx.world.map[ctx.player.y][ctx.player.x];

    // Try to move one step into a target tile and capture approach direction
    function tryEnterAdjacent(kindTile) {
      const dirs = [
        { dx: 1, dy: 0, dir: "E" },
        { dx: -1, dy: 0, dir: "W" },
        { dx: 0, dy: 1, dir: "S" },
        { dx: 0, dy: -1, dir: "N" },
      ];
      for (const d of dirs) {
        const nx = ctx.player.x + d.dx, ny = ctx.player.y + d.dy;
        if (!inBounds(ctx, nx, ny)) continue;
        if (ctx.world.map[ny][nx] === kindTile) {
          // Record the direction of movement (the side we approached from)
          ctx.enterFromDir = d.dir;
          ctx.player.x = nx; ctx.player.y = ny;
          return true;
        }
      }
      return false;
    }

    // If already on the town tile, there's no clear approach; clear any stale dir
    if (WT && t === ctx.World.TILES.TOWN) {
      ctx.enterFromDir = "";
    }

    if (WT && (t === ctx.World.TILES.TOWN || tryEnterAdjacent(ctx.World.TILES.TOWN))) {
        ctx.worldReturnPos = { x: ctx.player.x, y: ctx.player.y };
        ctx.mode = "town";

        // Prefer centralized TownRuntime generation/helpers
        try {
          if (ctx.TownRuntime && typeof ctx.TownRuntime.generate === "function") {
            const ok = !!ctx.TownRuntime.generate(ctx);
            if (ok) {
              // After TownRuntime.generate, ensure gate exit anchor and UI
              ctx.townExitAt = { x: ctx.player.x, y: ctx.player.y };
              try {
                if (ctx.UIBridge && typeof ctx.UIBridge.showTownExitButton === "function") ctx.UIBridge.showTownExitButton(ctx);
                else if (ctx.UI && typeof ctx.UI.showTownExitButton === "function") ctx.UI.showTownExitButton();
              } catch (_) {}
              if (ctx.log) ctx.log(`You enter ${ctx.townName ? "the town of " + ctx.townName : "the town"}. Shops are marked with 'S'. Press G next to an NPC to talk. Press G on the gate to leave.`, "notice");
              syncAfterMutation(ctx);
              return true;
            }
          }
        } catch (_) {}

        // Fallback: inline generation path via Town module
        if (ctx.Town && typeof Town.generate === "function") {
          Town.generate(ctx);
          if (typeof Town.ensureSpawnClear === "function") Town.ensureSpawnClear(ctx);
          ctx.townExitAt = { x: ctx.player.x, y: ctx.player.y };
          // Town.generate already spawns a gate greeter; avoid duplicates.
          if (typeof Town.spawnGateGreeters === "function") Town.spawnGateGreeters(ctx, 0);
        }
        try {
          if (ctx.UIBridge && typeof ctx.UIBridge.showTownExitButton === "function") ctx.UIBridge.showTownExitButton(ctx);
          else if (ctx.UI && typeof ctx.UI.showTownExitButton === "function") ctx.UI.showTownExitButton();
        } catch (_) {}
        if (ctx.log) ctx.log(`You enter ${ctx.townName ? "the town of " + ctx.townName : "the town"}. Shops are marked with 'S'. Press G next to an NPC to talk. Press G on the gate to leave.`, "notice");
        syncAfterMutation(ctx);
        return true;
      }
      return false;
    }

  function saveCurrentDungeonState(ctx) {
    if (!(ctx.mode === "dungeon" && ctx.dungeon && ctx.dungeonExitAt)) return;
    // Prefer centralized DungeonRuntime.save when available
    try {
      if (ctx.DungeonRuntime && typeof ctx.DungeonRuntime.save === "function") {
        ctx.DungeonRuntime.save(ctx, false);
        return;
      }
      if (typeof window !== "undefined" && window.DungeonRuntime && typeof DungeonRuntime.save === "function") {
        DungeonRuntime.save(ctx, false);
        return;
      }
    } catch (_) {}
    // Fallback in-memory snapshot on ctx._dungeonStates if present
    const key = `${ctx.dungeon.x},${ctx.dungeon.y}`;
    if (!ctx._dungeonStates) ctx._dungeonStates = Object.create(null);
    ctx._dungeonStates[key] = {
      map: ctx.map,
      seen: ctx.seen,
      visible: ctx.visible,
      enemies: ctx.enemies,
      corpses: ctx.corpses,
      decals: ctx.decals || [],
      dungeonExitAt: { x: ctx.dungeonExitAt.x, y: ctx.dungeonExitAt.y },
      info: ctx.dungeon,
      level: ctx.floor
    };
    try {
      const msg = `[DEV] Fallback save key ${key}: enemies=${Array.isArray(ctx.enemies)?ctx.enemies.length:0}, corpses=${Array.isArray(ctx.corpses)?ctx.corpses.length:0}`;
      if (ctx.log) ctx.log(msg, "notice");
      if (window.DEV) console.log("[TRACE] " + msg);
    } catch (_) {}
  }

  function loadDungeonStateFor(ctx, x, y) {
    // Prefer centralized DungeonRuntime if available
    try {
      if (ctx.DungeonRuntime && typeof ctx.DungeonRuntime.load === "function") {
        const ok = ctx.DungeonRuntime.load(ctx, x, y);
        if (ok) {
          syncAfterMutation(ctx);
        }
        return ok;
      }
      if (typeof window !== "undefined" && window.DungeonRuntime && typeof DungeonRuntime.load === "function") {
        const ok = DungeonRuntime.load(ctx, x, y);
        if (ok) {
          syncAfterMutation(ctx);
        }
        return ok;
      }
    } catch (_) {}
    const key = `${x},${y}`;
    const st = ctx._dungeonStates && ctx._dungeonStates[key];
    if (!st) return false;
    ctx.mode = "dungeon";
    ctx.dungeon = st.info || { x, y, level: st.level || 1, size: "medium" };
    ctx.dungeonInfo = ctx.dungeon;
    ctx.floor = st.level || 1;
    ctx.map = st.map;
    ctx.seen = st.seen;
    ctx.visible = st.visible;
    ctx.enemies = st.enemies;
    ctx.corpses = st.corpses;
    ctx.decals = st.decals || [];
    ctx.dungeonExitAt = st.dungeonExitAt || { x, y };
    // Place player at entrance and mark as STAIRS
    ctx.player.x = ctx.dungeonExitAt.x;
    ctx.player.y = ctx.dungeonExitAt.y;
    if (inBounds(ctx, ctx.player.x, ctx.player.y)) {
      ctx.map[ctx.player.y][ctx.player.x] = ctx.TILES.STAIRS;
      if (ctx.visible[ctx.player.y]) ctx.visible[ctx.player.y][ctx.player.x] = true;
      if (ctx.seen[ctx.player.y]) ctx.seen[ctx.player.y][ctx.player.x] = true;
    }
    // Re-entry message is logged by DungeonState.applyState to avoid duplicates.
    syncAfterMutation(ctx);
    return true;
  }

  function enterDungeonIfOnEntrance(ctx) {
    if (ctx.mode !== "world" || !ctx.world) return false;
    const WT = ctx.World && ctx.World.TILES;
    const t = ctx.world.map[ctx.player.y][ctx.player.x];

    function tryEnterAdjacent(kindTile) {
      const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
      for (const d of dirs) {
        const nx = ctx.player.x + d.dx, ny = ctx.player.y + d.dy;
        if (!inBounds(ctx, nx, ny)) continue;
        if (ctx.world.map[ny][nx] === kindTile) {
          ctx.player.x = nx; ctx.player.y = ny;
          return true;
        }
      }
      return false;
    }

    if (t && WT && (t === WT.DUNGEON || tryEnterAdjacent(WT.DUNGEON))) {
      const enterWX = ctx.player.x, enterWY = ctx.player.y;
      ctx.cameFromWorld = true;
      ctx.worldReturnPos = { x: enterWX, y: enterWY };

      let info = null;
      try {
        const list = Array.isArray(ctx.world?.dungeons) ? ctx.world.dungeons : [];
        info = list.find(d => d.x === enterWX && d.y === enterWY) || null;
      } catch (_) { info = null; }
      if (!info) info = { x: enterWX, y: enterWY, level: 1, size: "medium" };
      ctx.dungeon = info;
      ctx.dungeonInfo = info;

      // Prefer centralized enter flow
      try {
        if (ctx.DungeonRuntime && typeof ctx.DungeonRuntime.enter === "function") {
          const ok = ctx.DungeonRuntime.enter(ctx, info);
          if (ok) return true;
        }
        if (typeof window !== "undefined" && window.DungeonRuntime && typeof DungeonRuntime.enter === "function") {
          const ok = DungeonRuntime.enter(ctx, info);
          if (ok) return true;
        }
      } catch (_) {}

      // Fallback: inline generation path
      ctx.floor = Math.max(1, info.level | 0);
      ctx.mode = "dungeon";
      if (ctx.Dungeon && typeof Dungeon.generateLevel === "function") {
        ctx.startRoomRect = ctx.startRoomRect || null;
        Dungeon.generateLevel(ctx, ctx.floor);
      }
      ctx.dungeonExitAt = { x: ctx.player.x, y: ctx.player.y };
      if (inBounds(ctx, ctx.player.x, ctx.player.y)) {
        ctx.map[ctx.player.y][ctx.player.x] = ctx.TILES.STAIRS;
        if (Array.isArray(ctx.seen) && ctx.seen[ctx.player.y]) ctx.seen[ctx.player.y][ctx.player.x] = true;
        if (Array.isArray(ctx.visible) && ctx.visible[ctx.player.y]) ctx.visible[ctx.player.y][ctx.player.x] = true;
      }
      saveCurrentDungeonState(ctx);
      try {
        const k = `${info.x},${info.y}`;
        if (ctx.log) ctx.log(`[DEV] Initial dungeon save for key ${k}.`, "notice");
        const dx = (ctx.dungeonExitAt && typeof ctx.dungeonExitAt.x === "number") ? ctx.dungeonExitAt.x : "n/a";
        const dy = (ctx.dungeonExitAt && typeof ctx.dungeonExitAt.y === "number") ? ctx.dungeonExitAt.y : "n/a";
        if (window.DEV) console.log("[DEV] Initial dungeon save for key " + k + ". worldEnter=(" + enterWX + "," + enterWY + ") dungeonExit=(" + dx + "," + dy + ") player=(" + ctx.player.x + "," + ctx.player.y + ")");
      } catch (_) {}
      if (ctx.log) ctx.log(`You enter the dungeon (Difficulty ${ctx.floor}${info.size ? ", " + info.size : ""}).`, "notice");
      syncAfterMutation(ctx);
      return true;
    }
    return false;
  }

  function returnToWorldIfAtExit(ctx) {
    // Prefer DungeonRuntime centralization first
    try {
      if (ctx.DungeonRuntime && typeof ctx.DungeonRuntime.returnToWorldIfAtExit === "function") {
        const ok = ctx.DungeonRuntime.returnToWorldIfAtExit(ctx);
        if (ok) syncAfterMutation(ctx);
        return ok;
      }
      if (typeof window !== "undefined" && window.DungeonRuntime && typeof DungeonRuntime.returnToWorldIfAtExit === "function") {
        const ok = DungeonRuntime.returnToWorldIfAtExit(ctx);
        if (ok) syncAfterMutation(ctx);
        return ok;
      }
    } catch (_) {}
    
    // Last-resort local fallback
    if (ctx.mode !== "dungeon" || !ctx.world) return false;
    if (!ctx.dungeonExitAt) return false;
    if (ctx.player.x !== ctx.dungeonExitAt.x || ctx.player.y !== ctx.dungeonExitAt.y) {
      if (ctx.log) ctx.log("Return to the dungeon entrance to go back to the overworld.", "info");
      return false;
    }
    // Save and return
    saveCurrentDungeonState(ctx);
    ctx.mode = "world";
    ctx.enemies.length = 0;
    ctx.corpses.length = 0;
    ctx.decals.length = 0;
    ctx.map = ctx.world.map;

    let rx = (ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number") ? ctx.worldReturnPos.x : null;
    let ry = (ctx.worldReturnPos && typeof ctx.worldReturnPos.y === "number") ? ctx.worldReturnPos.y : null;
    if (rx == null || ry == null) {
      const info = ctx.dungeon || ctx.dungeonInfo;
      if (info && typeof info.x === "number" && typeof info.y === "number") { rx = info.x; ry = info.y; }
    }
    if (rx == null || ry == null) {
      rx = Math.max(0, Math.min(ctx.world.map[0].length - 1, ctx.player.x));
      ry = Math.max(0, Math.min(ctx.world.map.length - 1, ctx.player.y));
    }
    ctx.player.x = rx; ctx.player.y = ry;

    if (ctx.FOV && typeof ctx.FOV.recomputeFOV === "function") ctx.FOV.recomputeFOV(ctx);
    if (ctx.updateUI) ctx.updateUI();
    if (ctx.log) ctx.log("You climb back to the overworld.", "notice");
    if (ctx.requestDraw) ctx.requestDraw();
    return true;
  }

  window.Modes = {
    enterTownIfOnTile,
    enterDungeonIfOnEntrance,
    returnToWorldIfAtExit,
    leaveTownNow,
    requestLeaveTown,
    saveCurrentDungeonState,
    loadDungeonStateFor
  };
})();