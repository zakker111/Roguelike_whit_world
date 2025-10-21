/**
 * Modes: world/town/dungeon transitions and persistence, via ctx.
 *
 * API:
 *   enterTownIfOnTile(ctx) -> boolean handled
 *   enterDungeonIfOnEntrance(ctx) -> boolean handled
 *   returnToWorldIfAtExit(ctx) -> boolean handled
 *   leaveTownNow(ctx) -> void
 *   requestLeaveTown(ctx) -> void
 *   saveCurrentDungeonState(ctx)
 *   loadDungeonStateFor(ctx, x, y)
 */

// Helpers
function inBounds(ctx, x, y) {
  try {
    if (typeof ctx.inBounds === "function") {
      return !!ctx.inBounds(x, y);
    }
  } catch (_) {}
  try {
    if (ctx.Utils && typeof ctx.Utils.inBounds === "function") {
      return !!ctx.Utils.inBounds(ctx, x, y);
    }
  } catch (_) {}
  const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
  const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
  return x >= 0 && y >= 0 && x < cols && y < rows;
}

function syncAfterMutation(ctx) {
  if (typeof ctx.updateCamera === "function") ctx.updateCamera();
  if (typeof ctx.recomputeFOV === "function") ctx.recomputeFOV();
  if (typeof ctx.updateUI === "function") ctx.updateUI();
  if (typeof ctx.requestDraw === "function") ctx.requestDraw();
}

// Ensure player stands on the town gate interior tile on entry
function movePlayerToTownGateInterior(ctx) {
  try {
    const map = ctx.map;
    const rows = Array.isArray(map) ? map.length : 0;
    const cols = rows && Array.isArray(map[0]) ? map[0].length : 0;
    if (!rows || !cols) return;

    // Find perimeter door and move the player to the adjacent interior floor tile
    let gx = null, gy = null;
    // top row
    for (let x = 0; x < cols; x++) {
      if (map[0][x] === ctx.TILES.DOOR) { gx = x; gy = 1; break; }
    }
    // bottom row
    if (gx == null) {
      for (let x = 0; x < cols; x++) {
        if (map[rows - 1][x] === ctx.TILES.DOOR) { gx = x; gy = rows - 2; break; }
      }
    }
    // left column
    if (gx == null) {
      for (let y = 0; y < rows; y++) {
        if (map[y][0] === ctx.TILES.DOOR) { gx = 1; gy = y; break; }
      }
    }
    // right column
    if (gx == null) {
      for (let y = 0; y < rows; y++) {
        if (map[y][cols - 1] === ctx.TILES.DOOR) { gx = cols - 2; gy = y; break; }
      }
    }

    if (gx != null && gy != null) {
      ctx.player.x = gx; ctx.player.y = gy;
      ctx.townExitAt = { x: gx, y: gy };
    }
  } catch (_) {}
}

// Public API
export function leaveTownNow(ctx) {
  if (!ctx || !ctx.world) return;
  // Centralize leave/transition via TownRuntime
  try {
    if (ctx.TownRuntime && typeof ctx.TownRuntime.applyLeaveSync === "function") {
      ctx.TownRuntime.applyLeaveSync(ctx);
      return;
    }
  } catch (_) {}
  // Fallback: minimal path to avoid getting stuck if TownRuntime is missing
  ctx.mode = "world";
  ctx.map = ctx.world.map;
  try {
    if (Array.isArray(ctx.npcs)) ctx.npcs.length = 0;
    if (Array.isArray(ctx.shops)) ctx.shops.length = 0;
  } catch (_) {}
  if (ctx.worldReturnPos) {
    ctx.player.x = ctx.worldReturnPos.x;
    ctx.player.y = ctx.worldReturnPos.y;
  }
  try {
    if (ctx.UIBridge && typeof ctx.UIBridge.hideTownExitButton === "function") ctx.UIBridge.hideTownExitButton(ctx);
  } catch (_) {}
  if (ctx.log) ctx.log("You return to the overworld.", "notice");
  syncAfterMutation(ctx);
}

export function requestLeaveTown(ctx) {
  const pos = { x: window.innerWidth / 2 - 140, y: window.innerHeight / 2 - 60 };
  try {
    if (ctx.UIBridge && typeof ctx.UIBridge.showConfirm === "function") {
      ctx.UIBridge.showConfirm(ctx, "Do you want to leave the town?", pos, () => leaveTownNow(ctx), () => {});
      return;
    }
  } catch (_) {}
  // Fallback: proceed to leave to avoid getting stuck without a confirm UI
  leaveTownNow(ctx);
}

export function enterTownIfOnTile(ctx) {
  if (ctx.mode !== "world" || !ctx.world) return false;
  const WT = ctx.World && ctx.World.TILES;

  // Use the currently active map reference (supports infinite worlds)
  const mapRef = (Array.isArray(ctx.map) ? ctx.map : (ctx.world && Array.isArray(ctx.world.map) ? ctx.world.map : null));
  if (!mapRef) return false;
  const py = ctx.player.y | 0, px = ctx.player.x | 0;
  if (py < 0 || px < 0 || py >= mapRef.length || px >= (mapRef[0] ? mapRef[0].length : 0)) return false;
  const t = mapRef[py][px];

  // If already on the town tile, there's no clear approach; clear any stale dir
  if (WT && t === ctx.World.TILES.TOWN) {
    ctx.enterFromDir = "";
  }

  if (WT && t === ctx.World.TILES.TOWN) {
      // Store absolute world coords for return
      const enterWX = (ctx.world ? ctx.world.originX : 0) + ctx.player.x;
      const enterWY = (ctx.world ? ctx.world.originY : 0) + ctx.player.y;
      ctx.worldReturnPos = { x: enterWX, y: enterWY };
      // Preserve world fog-of-war before switching maps
      try {
        if (ctx.world) {
          ctx.world.seenRef = ctx.seen;
          ctx.world.visibleRef = ctx.visible;
        }
      } catch (_) {}
      ctx.mode = "town";

      // First, try to load a persisted town state for this overworld tile
      try {
        const TS = ctx.TownState || (typeof window !== "undefined" ? window.TownState : null);
        if (TS && typeof TS.load === "function") {
          const loaded = !!TS.load(ctx, enterWX, enterWY);
          if (loaded) {
            // Ensure occupancy and UI
            try {
              if (ctx.TownRuntime && typeof ctx.TownRuntime.rebuildOccupancy === "function") ctx.TownRuntime.rebuildOccupancy(ctx);
            } catch (_) {}
            try {
              if (ctx.TownRuntime && typeof ctx.TownRuntime.showExitButton === "function") ctx.TownRuntime.showExitButton(ctx);
              else if (ctx.UIBridge && typeof ctx.UIBridge.showTownExitButton === "function") ctx.UIBridge.showTownExitButton(ctx);
            } catch (_) {}
            // Ensure player spawns on gate interior tile on entry
            movePlayerToTownGateInterior(ctx);
            if (ctx.log) ctx.log(`You re-enter ${ctx.townName ? "the town of " + ctx.townName : "the town"}. Shops are marked with 'S'. Press G next to an NPC to talk. Press G on the gate to leave.`, "notice");
            syncAfterMutation(ctx);
            return true;
          }
        }
      } catch (_) {}

      // Prefer centralized TownRuntime generation/helpers
      try {
        if (ctx.TownRuntime && typeof ctx.TownRuntime.generate === "function") {
          const ok = !!ctx.TownRuntime.generate(ctx);
          if (ok) {
            // After TownRuntime.generate, ensure gate exit anchor, prime occupancy, and UI
            ctx.townExitAt = { x: ctx.player.x, y: ctx.player.y };
            // Ensure player stands on the gate interior tile
            movePlayerToTownGateInterior(ctx);
            try {
              if (ctx.TownRuntime && typeof ctx.TownRuntime.rebuildOccupancy === "function") ctx.TownRuntime.rebuildOccupancy(ctx);
            } catch (_) {}
            try {
              if (ctx.TownRuntime && typeof ctx.TownRuntime.showExitButton === "function") ctx.TownRuntime.showExitButton(ctx);
              else if (ctx.UIBridge && typeof ctx.UIBridge.showTownExitButton === "function") ctx.UIBridge.showTownExitButton(ctx);
            } catch (_) {}
            if (ctx.log) ctx.log(`You enter ${ctx.townName ? "the town of " + ctx.townName : "the town"}. Shops are marked with 'S'. Press G next to an NPC to talk. Press G on the gate to leave.`, "notice");
            syncAfterMutation(ctx);
            return true;
          }
        }
      } catch (_) {}

      // Fallback: inline generation path via Town module (ctx-first)
      if (ctx.Town && typeof ctx.Town.generate === "function") {
        ctx.Town.generate(ctx);
        try { if (typeof ctx.Town.ensureSpawnClear === "function") ctx.Town.ensureSpawnClear(ctx); } catch (_) {}
        ctx.townExitAt = { x: ctx.player.x, y: ctx.player.y };
        // Ensure player stands on the gate interior tile
        movePlayerToTownGateInterior(ctx);
        // Town.generate already spawns a gate greeter; avoid duplicates.
        try { if (typeof ctx.Town.spawnGateGreeters === "function") ctx.Town.spawnGateGreeters(ctx, 0); } catch (_) {}
      }
      try {
        if (ctx.TownRuntime && typeof ctx.TownRuntime.rebuildOccupancy === "function") ctx.TownRuntime.rebuildOccupancy(ctx);
      } catch (_) {}
      try {
        if (ctx.TownRuntime && typeof ctx.TownRuntime.showExitButton === "function") ctx.TownRuntime.showExitButton(ctx);
        else if (ctx.UIBridge && typeof ctx.UIBridge.showTownExitButton === "function") ctx.UIBridge.showTownExitButton(ctx);
      } catch (_) {}
      if (ctx.log) ctx.log(`You enter ${ctx.townName ? "the town of " + ctx.townName : "the town"}. Shops are marked with 'S'. Press G next to an NPC to talk. Press G on the gate to leave.`, "notice");
      syncAfterMutation(ctx);
      return true;
    }
    return false;
  }

export function saveCurrentDungeonState(ctx) {
  if (!(ctx && ctx.mode === "dungeon" && ctx.dungeonExitAt)) return;
  // Prefer centralized DungeonRuntime/DungeonState
  try {
    if (ctx.DungeonRuntime && typeof ctx.DungeonRuntime.save === "function") {
      ctx.DungeonRuntime.save(ctx, false);
      return;
    }
  } catch (_) {}
  try {
    if (ctx.DungeonState && typeof ctx.DungeonState.save === "function") {
      ctx.DungeonState.save(ctx);
      return;
    }
    if (typeof window !== "undefined" && window.DungeonState && typeof window.DungeonState.save === "function") {
      window.DungeonState.save(ctx);
      return;
    }
  } catch (_) {}
}

export function loadDungeonStateFor(ctx, x, y) {
  // Prefer centralized DungeonRuntime/DungeonState
  try {
    if (ctx.DungeonRuntime && typeof ctx.DungeonRuntime.load === "function") {
      const ok = ctx.DungeonRuntime.load(ctx, x, y);
      if (ok) syncAfterMutation(ctx);
      return ok;
    }
  } catch (_) {}
  try {
    if (ctx.DungeonState && typeof ctx.DungeonState.load === "function") {
      const ok = ctx.DungeonState.load(ctx, x, y);
      if (ok) syncAfterMutation(ctx);
      return ok;
    }
    if (typeof window !== "undefined" && window.DungeonState && typeof window.DungeonState.load === "function") {
      const ok = window.DungeonState.load(ctx, x, y);
      if (ok) syncAfterMutation(ctx);
      return ok;
    }
  } catch (_) {}
  return false;
}

export function enterDungeonIfOnEntrance(ctx) {
  if (ctx.mode !== "world" || !ctx.world) return false;
  const WT = ctx.World && ctx.World.TILES;
  const mapRef = (Array.isArray(ctx.map) ? ctx.map : (ctx.world && Array.isArray(ctx.world.map) ? ctx.world.map : null));
  if (!mapRef) return false;
  const py = ctx.player.y | 0, px = ctx.player.x | 0;
  if (py < 0 || px < 0 || py >= mapRef.length || px >= (mapRef[0] ? mapRef[0].length : 0)) return false;
  const t = mapRef[py][px];

  // Strict mode: adjacency entry disabled. Require standing exactly on the dungeon tile.

  if (t && WT && t === WT.DUNGEON) {
    // Use absolute world coords for dungeon key and return position
    const enterWX = (ctx.world ? ctx.world.originX : 0) + ctx.player.x;
    const enterWY = (ctx.world ? ctx.world.originY : 0) + ctx.player.y;
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
        if (ok) { syncAfterMutation(ctx); return true; }
      }
    } catch (_) {}

    // Fallback: inline generation path
    ctx.floor = Math.max(1, info.level | 0);
    ctx.mode = "dungeon";
    if (ctx.Dungeon && typeof ctx.Dungeon.generateLevel === "function") {
      ctx.startRoomRect = ctx.startRoomRect || null;
      ctx.Dungeon.generateLevel(ctx, ctx.floor);
    }
    ctx.dungeonExitAt = { x: ctx.player.x, y: ctx.player.y };
    if (inBounds(ctx, ctx.player.x, ctx.player.y)) {
      ctx.map[ctx.player.y][ctx.player.x] = ctx.TILES.STAIRS;
      if (Array.isArray(ctx.seen) && ctx.seen[ctx.player.y]) ctx.seen[ctx.player.y][ctx.player.x] = true;
      if (Array.isArray(ctx.visible) && ctx.visible[ctx.player.y]) ctx.visible[ctx.player.y][ctx.player.x] = true;
    }
    // Prime occupancy immediately after generation to avoid ghost-blocking
    try {
      const OG = ctx.OccupancyGrid || (typeof window !== "undefined" ? window.OccupancyGrid : null);
      if (OG && typeof OG.build === "function") {
        ctx.occupancy = OG.build({ map: ctx.map, enemies: ctx.enemies, npcs: ctx.npcs, props: ctx.townProps, player: ctx.player });
      }
    } catch (_) {}
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

export function returnToWorldIfAtExit(ctx) {
  // Prefer DungeonRuntime centralization first
  try {
    if (ctx.DungeonRuntime && typeof ctx.DungeonRuntime.returnToWorldIfAtExit === "function") {
      const ok = ctx.DungeonRuntime.returnToWorldIfAtExit(ctx);
      if (ok) syncAfterMutation(ctx);
      return ok;
    }
  } catch (_) {}

  // Next, defer to DungeonState helper if available
  try {
    const DS = ctx.DungeonState || (typeof window !== "undefined" ? window.DungeonState : null);
    if (DS && typeof DS.returnToWorldIfAtExit === "function") {
      const ok = DS.returnToWorldIfAtExit(ctx);
      if (ok) syncAfterMutation(ctx);
      return ok;
    }
  } catch (_) {}

  // Minimal fallback: guide the player
  if (ctx.log) ctx.log("Return to the dungeon entrance to go back to the overworld.", "info");
  return false;
}

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("Modes", {
  enterTownIfOnTile,
  enterDungeonIfOnEntrance,
  returnToWorldIfAtExit,
  leaveTownNow,
  requestLeaveTown,
  saveCurrentDungeonState,
  loadDungeonStateFor
});