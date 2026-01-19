/**
 * Modes: world/town/dungeon transitions and persistence, via ctx.
 *
 * API:
 *   enterTownIfOnTile(ctx) -> boolean handled
 *   enterDungeonIfOnEntrance(ctx) -> boolean handled
 *   enterRuinsIfOnTile(ctx) -> boolean handled
 *   returnToWorldFromTown(ctx, applyCtxSyncAndRefresh?, logExitHint?) -> boolean handled
 *   returnToWorldIfAtExit(ctx) -> boolean handled
 *   leaveTownNow(ctx) -> void
 *   requestLeaveTown(ctx) -> void
 *   saveCurrentDungeonState(ctx)
 *   loadDungeonStateFor(ctx, x, y)
 */

import { getMod } from "../../utils/access.js";
import { log as fallbackLog } from "../../utils/fallback.js";
import { spawnInTown, spawnInDungeon } from "../followers_runtime.js";

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
  try {
    const SS = ctx.StateSync || getMod(ctx, "StateSync");
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
      return;
    }
  } catch (_) {}
  if (typeof ctx.updateCamera === "function") ctx.updateCamera();
  if (typeof ctx.recomputeFOV === "function") ctx.recomputeFOV();
  if (typeof ctx.updateUI === "function") ctx.updateUI();
  if (typeof ctx.requestDraw === "function") ctx.requestDraw();
}

// Helper: get overworld tile at absolute world coords, using current window or InfiniteGen generator.
function worldTileAtAbs(ctx, ax, ay) {
  try {
    const world = ctx && ctx.world ? ctx.world : null;
    if (!world) return null;
    const wmap = Array.isArray(world.map) ? world.map : null;
    const ox = world.originX | 0;
    const oy = world.originY | 0;
    const lx = (ax - ox) | 0;
    const ly = (ay - oy) | 0;
    if (wmap && ly >= 0 && lx >= 0 && ly < wmap.length && lx < (wmap[0] ? wmap[0].length : 0)) {
      return wmap[ly][lx];
    }
    if (world.gen && typeof world.gen.tileAt === "function") {
      return world.gen.tileAt(ax, ay);
    }
  } catch (_) {}
  return null;
}

// Harbor detection for potential port towns: scan outward in N/S/E/W for WATER/BEACH/RIVER tiles.
function detectHarborContext(ctx, wx, wy, WT) {
  try {
    if (!ctx || !ctx.world || !WT) return null;
    const dirs = [
      { id: "N", dx: 0, dy: -1 },
      { id: "S", dx: 0, dy: 1 },
      { id: "W", dx: -1, dy: 0 },
      { id: "E", dx: 1, dy: 0 },
    ];
    // Slightly increase scan radius so coastal towns with water a bit further out
    // still qualify as ports, especially for starting towns near large seas.
    const MAX_DIST = 10;
    let bestDir = "";
    let bestScore = 0;
    let bestCoast = 0;
    let bestRiver = 0;

    for (let i = 0; i < dirs.length; i++) {
      const d = dirs[i];
      let coast = 0;
      let river = 0;
      for (let step = 1; step <= MAX_DIST; step++) {
        const t = worldTileAtAbs(ctx, wx + d.dx * step, wy + d.dy * step);
        if (t == null) continue;
        if (t === WT.WATER || t === WT.BEACH) {
          coast += 2;
        } else if (t === WT.RIVER) {
          river += 1;
        }
      }
      const score = coast + river;
      if (score > bestScore) {
        bestScore = score;
        bestDir = d.id;
        bestCoast = coast;
        bestRiver = river;
      }
    }

    // Require a water-heavy direction, but be a bit more permissive so towns that
    // are clearly coastal in play (like some starting towns) are recognized as ports.
    const MIN_SCORE = 3;
    if (!bestDir || bestScore < MIN_SCORE) return null;

    let waterContext = "coast";
    if (bestRiver > 0 && bestRiver * 1.5 >= bestCoast) {
      waterContext = "river";
    }

    return {
      harborDir: bestDir,
      waterContext,
      score: bestScore,
      coastScore: bestCoast,
      riverScore: bestRiver,
    };
  } catch (_) {
    return null;
  }
}

function debugPortHarborsEnabled() {
  try {
    if (typeof window === "undefined") return false;
    const v = localStorage.getItem("DEBUG_PORT_TOWNS");
    if (typeof v === "string") {
      const s = v.toLowerCase();
      return s === "1" || s === "true" || s === "yes" || s === "on";
    }
  } catch (_) {}
  return false;
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

  // Town exit must go through the heuristic gate logic so there is a single
  // source of truth for leaving towns.
  if (ctx.mode === "town") {
    // No custom hint callback here; reuse the same behavior as the G-key path.
    returnToWorldFromTown(ctx);
    return;
  }

  // Non-town safety: retain minimal inline path if something calls this
  // outside of town mode (should be rare).
  ctx.mode = "world";
  ctx.map = ctx.world.map;
  try {
    if (Array.isArray(ctx.npcs)) ctx.npcs.length = 0;
    if (Array.isArray(ctx.shops)) ctx.shops.length = 0;
  } catch (_) {}
  if (ctx.worldReturnPos && ctx.world) {
    const rx = ctx.worldReturnPos.x | 0;
    const ry = ctx.worldReturnPos.y | 0;
    const WR = ctx.WorldRuntime || (typeof window !== "undefined" ? window.WorldRuntime : null);
    if (WR && typeof WR.ensureInBounds === "function") {
      // Avoid snap during expansion
      ctx._suspendExpandShift = true;
      try {
        let lx = rx - (ctx.world.originX | 0);
        let ly = ry - (ctx.world.originY | 0);
        WR.ensureInBounds(ctx, lx, ly, 32);
      } finally {
        ctx._suspendExpandShift = false;
      }
      const lx2 = rx - (ctx.world.originX | 0);
      const ly2 = ry - (ctx.world.originY | 0);
      ctx.player.x = lx2;
      ctx.player.y = ly2;
    } else {
      const lx = rx - (ctx.world.originX | 0);
      const ly = ry - (ctx.world.originY | 0);
      const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
      const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
      ctx.player.x = Math.max(0, Math.min((cols ? cols - 1 : 0), lx));
      ctx.player.y = Math.max(0, Math.min((rows ? rows - 1 : 0), ly));
    }
  }
  if (ctx.log) ctx.log("You return to the overworld.", "info");
  syncAfterMutation(ctx);
}

export function requestLeaveTown(ctx) {
  const pos = { x: window.innerWidth / 2 - 140, y: window.innerHeight / 2 - 60 };
  try {
    const UIO = ctx.UIOrchestration || (typeof window !== "undefined" ? window.UIOrchestration : null);
    if (UIO && typeof UIO.showConfirm === "function") {
      UIO.showConfirm(ctx, "Do you want to leave the town?", pos, () => leaveTownNow(ctx), () => {});
      return;
    }
  } catch (_) {}
  // Fallback: proceed to leave to avoid getting stuck without a confirm UI
  try {
    fallbackLog("modes.requestLeaveTown.noConfirm", "UI confirm dialog unavailable; leaving town immediately.");
  } catch (_) {}
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

  // Strict entry: require standing exactly on the town (or castle) tile (no adjacency allowed)
  let townPx = px, townPy = py;
  let approachedDir = "";
  const onTownTile = !!(WT && (t === WT.TOWN || (WT.CASTLE != null && t === WT.CASTLE)));

  // Record approach direction (used by Town generation to pick gate side). Empty string when stepping directly on tile.
  if (onTownTile) {
    ctx.enterFromDir = approachedDir || "";
  }

  if (WT && onTownTile) {
      // Proactively close any confirm dialog to avoid UI overlap
      try {
        const UIO = ctx.UIOrchestration || (typeof window !== "undefined" ? window.UIOrchestration : null);
        if (UIO && typeof UIO.cancelConfirm === "function") UIO.cancelConfirm(ctx);
      } catch (_) {}

      // Store absolute world coords for return (use town tile if adjacent entry)
      const enterWX = (ctx.world ? ctx.world.originX : 0) + townPx;
      const enterWY = (ctx.world ? ctx.world.originY : 0) + townPy;
      ctx.worldReturnPos = { x: enterWX, y: enterWY };
      // Preserve world fog-of-war before switching maps
      try {
        if (ctx.world) {
          ctx.world.seenRef = ctx.seen;
          ctx.world.visibleRef = ctx.visible;
        }
      } catch (_) {}
      ctx.mode = "town";
      // Reset town biome on entry so each town derives or loads its own biome correctly
      try { ctx.townBiome = undefined; } catch (_) {}

      // Harbor detection for potential port towns (metadata-only at this stage).
      try {
        const isTownTile = !!(WT && t === WT.TOWN);
        if (isTownTile) {
          const harborInfo = detectHarborContext(ctx, enterWX, enterWY, WT);
          if (harborInfo && harborInfo.harborDir) {
            try {
              ctx.townHarborDir = harborInfo.harborDir;
              ctx.townWaterContext = harborInfo.waterContext;
            } catch (_) {}
            // Persist harbor metadata on world.towns entry when available
            try {
              if (ctx.world && Array.isArray(ctx.world.towns)) {
                const rec = ctx.world.towns.find(r => r && r.x === enterWX && r.y === enterWY);
                if (rec) {
                  if (!rec.harborDir) rec.harborDir = harborInfo.harborDir;
                  if (!rec.harborWater) rec.harborWater = harborInfo.waterContext;
                  if (!rec._harborLogged) rec._harborLogged = true;
                }
              }
            } catch (_) {}
            // Log harbor scan so it is visible while tuning ports.
            try {
              if (ctx.log) {
                ctx.log(
                  `World: harbor scan for town at (${enterWX},${enterWY}) dir=${harborInfo.harborDir} water=${harborInfo.waterContext} score=${harborInfo.score}.`,
                  "notice"
                );
              }
            } catch (_) {}
          } else {
            try { ctx.townHarborDir = undefined; ctx.townWaterContext = undefined; } catch (_) {}
            try {
              if (ctx.log) {
                ctx.log(
                  `World: harbor scan found no water-heavy direction for town at (${enterWX},${enterWY}).`,
                  "notice"
                );
              }
            } catch (_) {}
          }
        } else {
          try { ctx.townHarborDir = undefined; ctx.townWaterContext = undefined; } catch (_) {}
        }
      } catch (_) {}

      // Determine settlement kind (town vs castle) from overworld metadata for messaging.
      let settlementKind = "town";
      try {
        if (ctx.world && Array.isArray(ctx.world.towns)) {
          const rec = ctx.world.towns.find(t => t && t.x === enterWX && t.y === enterWY);
          if (rec && rec.kind) settlementKind = String(rec.kind);
        }
      } catch (_) {}

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
            // Ensure player spawns on gate interior tile on entry
            movePlayerToTownGateInterior(ctx);
            // Spawn follower/ally in town, if configured.
            try { spawnInTown(ctx); } catch (_) {}
            const kindLabel = settlementKind === "castle" ? "castle" : "town";
            const placeLabel = ctx.townName ? `the ${kindLabel} of ${ctx.townName}` : `the ${kindLabel}`;
            if (ctx.log) ctx.log(`You re-enter ${placeLabel}. Shops are marked with 'S'. Press G next to an NPC to talk. Press G on the gate to leave.`, "info");
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
            // Spawn follower/ally in town, if configured.
            try { spawnInTown(ctx); } catch (_) {}
            try {
              if (ctx.TownRuntime && typeof ctx.TownRuntime.rebuildOccupancy === "function") ctx.TownRuntime.rebuildOccupancy(ctx);
            } catch (_) {}
            const kindLabel = settlementKind === "castle" ? "castle" : "town";
            const placeLabel = ctx.townName ? `the ${kindLabel} of ${ctx.townName}` : `the ${kindLabel}`;
            if (ctx.log) ctx.log(`You enter ${placeLabel}. Shops are marked with 'S'. Press G next to an NPC to talk. Press G on the gate to leave.`, "info");
            syncAfterMutation(ctx);
            return true;
          }
        }
      } catch (_) {}

      
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

  // Strict mode: adjacency entry disabled. Require standing exactly on the dungeon (or tower) tile.

  if (t && WT && (t === WT.DUNGEON || (WT.TOWER != null && t === WT.TOWER))) {
    const isTowerTile = !!(WT.TOWER != null && t === WT.TOWER);
    // Use absolute world coords for dungeon key and return position
    const enterWX = (ctx.world ? ctx.world.originX : 0) + ctx.player.x;
    const enterWY = (ctx.world ? ctx.world.originY : 0) + ctx.player.y;
    ctx.cameFromWorld = true;
    ctx.worldReturnPos = { x: enterWX, y: enterWY };

    let info = null;
    try {
      const list = Array.isArray(ctx.world?.dungeons) ? ctx.world.dungeons : [];
      info = list.find(d => d.x === enterWX && d.y === enterWY) || null;
      // If this entrance sits on a TOWER tile but the saved dungeon metadata does not
      // yet mark it as a tower (older saves), upgrade it in-place so tower logic applies
      // (multi-floor, bandit theming, etc.).
      if (isTowerTile && info) {
        info.kind = "tower";
        if (typeof info.towerFloors !== "number" || info.towerFloors < 2) {
          const seed = ((enterWX | 0) * 31 + (enterWY | 0) * 17) | 0;
          const n = (seed ^ (seed >>> 13)) >>> 0;
          const floors = 3 + (n % 3); // 3..5
          info.towerFloors = floors;
        }
      }
    } catch (_) { info = null; }
    if (!info) {
      info = { x: enterWX, y: enterWY, level: 1, size: "medium" };
      if (isTowerTile) {
        info.kind = "tower";
        const seed = ((enterWX | 0) * 31 + (enterWY | 0) * 17) | 0;
        const n = (seed ^ (seed >>> 13)) >>> 0;
        info.towerFloors = 3 + (n % 3); // 3..5
      }
    }
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
    // Prime occupancy immediately after generation to avoid ghost-blocking (centralized)
    try {
      const OF = ctx.OccupancyFacade || (typeof window !== "undefined" ? window.OccupancyFacade : null);
      if (OF && typeof OF.rebuild === "function") OF.rebuild(ctx);
    } catch (_) {}
    saveCurrentDungeonState(ctx);

    // Spawn follower/ally when using the legacy inline dungeon generation path.
    try { spawnInDungeon(ctx); } catch (_) {}
    
    if (ctx.log) ctx.log(`You enter the dungeon (Difficulty ${ctx.floor}${info.size ? ", " + info.size : ""}).`, "info");
    syncAfterMutation(ctx);
    return true;
  }
  return false;
}

export function enterRuinsIfOnTile(ctx) {
  if (ctx.mode !== "world" || !ctx.world) return false;
  const WT = ctx.World && ctx.World.TILES;
  const mapRef = (Array.isArray(ctx.map) ? ctx.map : (ctx.world && Array.isArray(ctx.world.map) ? ctx.world.map : null));
  if (!mapRef) return false;
  const py = ctx.player.y | 0, px = ctx.player.x | 0;
  if (py < 0 || px < 0 || py >= mapRef.length || px >= (mapRef[0] ? mapRef[0].length : 0)) return false;
  const t = mapRef[py][px];

  if (t && WT && t === WT.RUINS) {
    // Open Region Map at this location; RegionMapRuntime.open rejects town/dungeon but allows ruins
    try {
      const RMR = ctx.RegionMapRuntime || (typeof window !== "undefined" ? window.RegionMapRuntime : null);
      if (RMR && typeof RMR.open === "function") {
        const ok = !!RMR.open(ctx);
        if (ok) {
          if (ctx.log) ctx.log("You enter the ancient ruins.", "info");
          syncAfterMutation(ctx);
          return true;
        }
      }
    } catch (_) {}
    return false;
  }
  return false;
}

export function enterEncounter(ctx, template, biome, difficulty, applyCtxSyncAndRefresh) {
  if (!ctx || !ctx.world || !ctx.world.map) return false;
  try {
    const ER = ctx.EncounterRuntime || (typeof window !== "undefined" ? window.EncounterRuntime : null);
    if (!ER || typeof ER.enter !== "function") return false;
    let diff = 1;
    try {
      if (typeof difficulty === "number") {
        diff = Math.max(1, Math.min(5, difficulty | 0));
      } else {
        const ES = getMod(ctx, "EncounterService");
        if (ES && typeof ES.computeDifficulty === "function") {
          diff = ES.computeDifficulty(ctx, biome);
        }
      }
    } catch (_) {}
    const ok = !!ER.enter(ctx, { template, biome, difficulty: diff });
    if (!ok) return false;
    if (typeof applyCtxSyncAndRefresh === "function") {
      try { applyCtxSyncAndRefresh(ctx); } catch (_) {}
    } else {
      syncAfterMutation(ctx);
    }
    return true;
  } catch (_) {}
  return false;
}

export function openRegionMap(ctx, applyCtxSyncAndRefresh) {
  if (!ctx || ctx.mode !== "world" || !ctx.world || !ctx.world.map) return false;
  try {
    const RMR = ctx.RegionMapRuntime || (typeof window !== "undefined" ? window.RegionMapRuntime : null);
    if (RMR && typeof RMR.open === "function") {
      const ok = !!RMR.open(ctx);
      if (!ok) return false;
      if (typeof applyCtxSyncAndRefresh === "function") {
        try { applyCtxSyncAndRefresh(ctx); } catch (_) {}
      } else {
        syncAfterMutation(ctx);
      }
      return true;
    }
  } catch (_) {}
  return false;
}

export function startRegionEncounter(ctx, template, biome, applyCtxSyncAndRefresh) {
  if (!ctx || ctx.mode !== "region") return false;
  try {
    const ER = ctx.EncounterRuntime || (typeof window !== "undefined" ? window.EncounterRuntime : null);
    if (!ER || typeof ER.enterRegion !== "function") return false;
    let diff = 1;
    try {
      const ES = getMod(ctx, "EncounterService");
      if (ES && typeof ES.computeDifficulty === "function") {
        diff = ES.computeDifficulty(ctx, biome);
      }
    } catch (_) {}
    const ok = !!ER.enterRegion(ctx, { template, biome, difficulty: diff });
    if (!ok) return false;
    if (typeof applyCtxSyncAndRefresh === "function") {
      try { applyCtxSyncAndRefresh(ctx); } catch (_) {}
    } else {
      syncAfterMutation(ctx);
    }
    return true;
  } catch (_) {}
  return false;
}

export function completeEncounter(ctx, outcome, applyCtxSyncAndRefresh, helpers) {
  if (!ctx || ctx.mode !== "encounter") return false;
  try {
    const ER = ctx.EncounterRuntime || (typeof window !== "undefined" ? window.EncounterRuntime : null);
    if (!ER || typeof ER.complete !== "function") return false;
    const ok = !!ER.complete(ctx, outcome || "victory");
    if (!ok) return false;
    if (typeof applyCtxSyncAndRefresh === "function") {
      try { applyCtxSyncAndRefresh(ctx); } catch (_) {}
    } else {
      syncAfterMutation(ctx);
    }
    // Optional auto-travel helper after returning to overworld (e.g., caravan escort flows)
    try {
      const h = helpers || {};
      if (ctx.mode === "world" && typeof h.startEscortAutoTravel === "function") {
        h.startEscortAutoTravel();
      }
    } catch (_) {}
    return true;
  } catch (_) {}
  return false;
}

export function returnToWorldFromTown(ctx, applyCtxSyncAndRefresh, logExitHint) {
  if (!ctx || ctx.mode !== "town" || !ctx.world) return false;

  // Heuristic-only exit: detect gate by geometry.
  // If the player is on the inner perimeter and adjacent to a boundary DOOR,
  // treat this as the town gate and leave via TownRuntime.applyLeaveSync(ctx).
  let nearPerimeterGate = false;
  try {
    const map = ctx.map;
    const rows = Array.isArray(map) ? map.length : 0;
    const cols = rows && Array.isArray(map[0]) ? map[0].length : 0;
    if (rows && cols && ctx.player && ctx.TILES) {
      const px = ctx.player.x | 0;
      const py = ctx.player.y | 0;
      const T = ctx.TILES;
      const onInnerPerimeter =
        px === 1 || py === 1 || px === cols - 2 || py === rows - 2;
      if (onInnerPerimeter) {
        const dirs = [
          { dx: 1, dy: 0 },
          { dx: -1, dy: 0 },
          { dx: 0, dy: 1 },
          { dx: 0, dy: -1 },
        ];
        for (let i = 0; i < dirs.length; i++) {
          const nx = px + dirs[i].dx;
          const ny = py + dirs[i].dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const isBoundary =
            nx === 0 || ny === 0 || nx === cols - 1 || ny === rows - 1;
          if (!isBoundary) continue;
          if (map[ny][nx] === T.DOOR) {
            nearPerimeterGate = true;
            break;
          }
        }
      }
    }
  } catch (_) {}

  if (nearPerimeterGate) {
    try {
      const TR = ctx.TownRuntime || (typeof window !== "undefined" ? window.TownRuntime : null);
      if (TR && typeof TR.applyLeaveSync === "function") {
        TR.applyLeaveSync(ctx);
        if (typeof applyCtxSyncAndRefresh === "function") {
          try { applyCtxSyncAndRefresh(ctx); } catch (_) {}
        } else {
          syncAfterMutation(ctx);
        }
        return true;
      }
    } catch (_) {}
  }

  // Not at gate: optional guidance hint
  try {
    if (typeof logExitHint === "function") {
      logExitHint();
    } else if (ctx.log) {
      ctx.log("Return to the town gate (inner perimeter door) and press G to leave.", "info");
    }
  } catch (_) {}
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
  try {
    fallbackLog(
      "modes.returnToWorldIfAtExit.noRuntime",
      "DungeonRuntime/DungeonState.returnToWorldIfAtExit unavailable; guiding player instead."
    );
  } catch (_) {}
  try {
    if (ctx && ctx.log) {
      ctx.log("Return to the dungeon entrance stairs (>) to go back to the overworld.", "info");
    }
  } catch (_) {}
  return false;
}



import { attachGlobal } from "../../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("Modes", {
  enterTownIfOnTile,
  enterDungeonIfOnEntrance,
  enterRuinsIfOnTile,
  enterEncounter,
  openRegionMap,
  startRegionEncounter,
  completeEncounter,
  returnToWorldFromTown,
  returnToWorldIfAtExit,
  leaveTownNow,
  requestLeaveTown,
  saveCurrentDungeonState,
  loadDungeonStateFor
});