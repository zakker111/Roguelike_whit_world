/**
 * Modes: world/town/dungeon transitions and persistence, via ctx.
 *
 * API:
 *   enterTownIfOnTile(ctx) -> boolean handled
 *   enterDungeonIfOnEntrance(ctx) -> boolean handled
 *   enterRuinsIfOnTile(ctx) -> boolean handled
 *   returnToWorldIfAtExit(ctx) -> boolean handled
 *   leaveTownNow(ctx) -> void
 *   requestLeaveTown(ctx) -> void
 *   saveCurrentDungeonState(ctx)
 *   loadDungeonStateFor(ctx, x, y)
 */

import { getMod } from "../../utils/access.js";

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
  
  if (ctx.log) ctx.log("You return to the overworld.", "notice");
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
            // If a travelling caravan is parked at this town, spawn its merchant inside.
            try { spawnCaravanMerchantIfPresent(ctx, enterWX, enterWY); } catch (_) {}
            const kindLabel = settlementKind === "castle" ? "castle" : "town";
            const placeLabel = ctx.townName ? `the ${kindLabel} of ${ctx.townName}` : `the ${kindLabel}`;
            if (ctx.log) ctx.log(`You re-enter ${placeLabel}. Shops are marked with 'S'. Press G next to an NPC to talk. Press G on the gate to leave.`, "notice");
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
            // If a travelling caravan is parked at this town, spawn its merchant inside.
            try { spawnCaravanMerchantIfPresent(ctx, enterWX, enterWY); } catch (_) {}
            const kindLabel = settlementKind === "castle" ? "castle" : "town";
            const placeLabel = ctx.townName ? `the ${kindLabel} of ${ctx.townName}` : `the ${kindLabel}`;
            if (ctx.log) ctx.log(`You enter ${placeLabel}. Shops are marked with 'S'. Press G next to an NPC to talk. Press G on the gate to leave.`, "notice");
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
    // Prime occupancy immediately after generation to avoid ghost-blocking (centralized)
    try {
      const OF = ctx.OccupancyFacade || (typeof window !== "undefined" ? window.OccupancyFacade : null);
      if (OF && typeof OF.rebuild === "function") OF.rebuild(ctx);
    } catch (_) {}
    saveCurrentDungeonState(ctx);
    
    if (ctx.log) ctx.log(`You enter the dungeon (Difficulty ${ctx.floor}${info.size ? ", " + info.size : ""}).`, "notice");
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
          if (ctx.log) ctx.log("You enter the ancient ruins.", "notice");
          syncAfterMutation(ctx);
          return true;
        }
      }
    } catch (_) {}
    return false;
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

/**
 * Spawn a caravan merchant and camp inside the town, if a caravan is currently
 * on this settlement's overworld tile.
 *
 * Behavior:
 * - On each town entry, clears any previous caravan camp NPCs/shops/props.
 * - Looks in world.caravans for a caravan whose (x,y) matches (worldX,worldY).
 * - If such a caravan exists, spawns a Caravan master + caravan shop + small camp
 *   near the town plaza (or map center as a fallback).
 * - If no caravan is on this town tile, nothing is spawned.
 */
function spawnCaravanMerchantIfPresent(ctx, worldX, worldY) {
  try {
    const npcs = Array.isArray(ctx.npcs) ? ctx.npcs : (ctx.npcs = []);
    const shops = Array.isArray(ctx.shops) ? ctx.shops : (ctx.shops = []);
    ctx.townProps = Array.isArray(ctx.townProps) ? ctx.townProps : [];
    const props = ctx.townProps;

    function clearCaravanCamp() {
      try {
        if (Array.isArray(ctx.npcs)) {
          ctx.npcs = ctx.npcs.filter(n => !n || !n.isCaravanMerchant);
        }
      } catch (_) {}
      try {
        if (Array.isArray(ctx.shops)) {
          ctx.shops = ctx.shops.filter(s => !s || (!s.isCaravanShop && s.type !== "caravan"));
        }
      } catch (_) {}
      try {
        if (Array.isArray(ctx.townProps)) {
          ctx.townProps = ctx.townProps.filter(p => !p || !p.isCaravanProp);
        }
      } catch (_) {}
    }

    // Always clear any existing caravan camp so we don't accumulate duplicates.
    clearCaravanCamp();

    // Only spawn a caravan master if there is a caravan currently on this
    // town's overworld tile (worldX, worldY). We key off the caravan's
    // world-space coordinates, independent of its internal atTown flag.
    const world = ctx.world;
    if (!world || !Array.isArray(world.caravans) || !world.caravans.length) {
      return;
    }
    const caravans = world.caravans;
    const wx = worldX | 0;
    const wy = worldY | 0;

    // Only treat caravans that are actually parked in this town (atTown = true).
    // This lets caravans arrive at a town while the player is elsewhere; as long
    // as the caravan remains in its dwell period (atTown true), entering the town
    // later will still spawn the caravan camp.
    const parked = caravans.find(cv =>
      cv &&
      cv.atTown &&
      (cv.x | 0) === wx &&
      (cv.y | 0) === wy
    );

    // Debug: log basic caravan presence info for this town tile, and why we might not spawn.
    try {
      if (ctx.log) {
        const parkedStr = parked
          ? `id=${parked.id}, atTown=${!!parked.atTown}, pos=(${parked.x|0},${parked.y|0})`
          : "none";
        const sample = caravans.slice(0, 4).map(cv => {
          if (!cv) return "null";
          return `id=${cv.id}, atTown=${!!cv.atTown}, pos=(${cv.x|0},${cv.y|0}), dest=${cv.dest ? (cv.dest.x|0)+","+(cv.dest.y|0) : "none"}`;
        }).join(" | ");
        ctx.log(
          `[Caravan] Town entry at ${wx},${wy}: caravans=${caravans.length}, parkedHere=${!!parked} (${parkedStr}); sample=${sample}`,
          "info"
        );
      }
    } catch (_) {}

    if (!parked) {
      return;
    }

    const map = ctx.map;
    const rows = Array.isArray(map) ? map.length : 0;
    const cols = rows && Array.isArray(map[0]) ? map[0].length : 0;
    if (!rows || !cols) return;

    function isFree(x, y) {
      if (!inBounds(ctx, x, y)) return false;
      const t = ctx.map[y][x];
      // Prefer FLOOR/DOOR, but allow any walkable town tile if ctx.isWalkable says so.
      if (t !== ctx.TILES.FLOOR && t !== ctx.TILES.DOOR) {
        try {
          if (typeof ctx.isWalkable === "function" && !ctx.isWalkable(x, y)) return false;
        } catch (_) {}
      }
      if (ctx.player && ctx.player.x === x && ctx.player.y === y) return false;
      if (Array.isArray(ctx.npcs) && ctx.npcs.some(n => n && n.x === x && n.y === y)) return false;
      // Allow overlapping decorative props so the camp can appear even in dense layouts.
      return true;
    }

    // Choose a base position: town plaza if available, otherwise map center.
    let baseX, baseY;
    if (ctx.townPlaza && typeof ctx.townPlaza.x === "number" && typeof ctx.townPlaza.y === "number") {
      baseX = ctx.townPlaza.x | 0;
      baseY = ctx.townPlaza.y | 0;
    } else {
      baseX = (cols >> 1);
      baseY = (rows >> 1);
    }

    // Find a free tile near the base position (plaza), within a modest radius.
    let spot = null;
    const radius = 6;
    for (let r = 0; r <= radius && !spot; r++) {
      const minX = Math.max(1, baseX - r);
      const maxX = Math.min(cols - 2, baseX + r);
      const minY = Math.max(1, baseY - r);
      const maxY = Math.min(rows - 2, baseY + r);
      for (let y = minY; y <= maxY && !spot; y++) {
        for (let x = minX; x <= maxX && !spot; x++) {
          if (isFree(x, y)) {
            spot = { x, y };
            break;
          }
        }
      }
    }

    // As a very last resort, try the plaza tile itself.
    if (!spot && isFree(baseX, baseY)) {
      spot = { x: baseX, y: baseY };
    }

    if (!spot) return;

    const merchantName = "Caravan master";

    const npc = {
      x: spot.x,
      y: spot.y,
      name: merchantName,
      lines: [
        "Fresh goods from the road.",
        "We set up in the plaza wherever we travel."
      ],
      isShopkeeper: true,
      isCaravanMerchant: true
    };

    // Caravan shop: always open while you are in town.
    const shop = {
      x: spot.x,
      y: spot.y,
      type: "caravan",
      name: "Travelling Caravan",
      alwaysOpen: true,
      openMin: 0,
      closeMin: 0,
      building: null,
      inside: { x: spot.x, y: spot.y },
      isCaravanShop: true
    };
    npc._shopRef = shop;

    npcs.push(npc);
    shops.push(shop);

    // Ensure the caravan camp tile is considered seen so the Caravan master glyph is visible
    // even if the plaza area was not yet in FOV when entering town.
    try {
      if (Array.isArray(ctx.seen) && ctx.seen[spot.y] && typeof ctx.seen[spot.y][spot.x] !== "undefined") {
        ctx.seen[spot.y][spot.x] = true;
      }
    } catch (_) {}

    // Debug: log spawn position for caravan master inside town.
    try {
      if (ctx.log) {
        ctx.log(
          `[Caravan] Spawned Caravan master at town tile (${spot.x},${spot.y}) in local town coords.`,
          "notice"
        );
      }
    } catch (_) {}

    // Add a small \"caravan camp\" of props near the merchant: a cart (stall),
    // a sign, and a few crates/barrels.
    try {
      // Cart on the merchant's tile if no prop there yet.
      const hasPropHere = props.some(p => p && p.x === spot.x && p.y === spot.y);
      if (!hasPropHere) {
        props.push({
          x: spot.x,
          y: spot.y,
          type: "stall",
          name: "Caravan cart",
          isCaravanProp: true
        });
      }

      // Sign adjacent to the cart if possible.
      const signOffsets = [
        { dx: 0, dy: -1 },
        { dx: 0, dy: 1 },
        { dx: -1, dy: 0 },
        { dx: 1, dy: 0 }
      ];
      for (const o of signOffsets) {
        const sx = spot.x + o.dx;
        const sy = spot.y + o.dy;
        if (!inBounds(ctx, sx, sy)) continue;
        if (!isFree(sx, sy)) continue;
        props.push({
          x: sx,
          y: sy,
          type: "sign",
          name: "Caravan",
          isCaravanProp: true
        });
        break;
      }

      // A few crates/barrels around the cart.
      const offsets = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
        { dx: 1, dy: 1 },
        { dx: -1, dy: 1 },
        { dx: 1, dy: -1 },
        { dx: -1, dy: -1 }
      ];
      let added = 0;
      for (const o of offsets) {
        if (added >= 3) break;
        const x = spot.x + o.dx;
        const y = spot.y + o.dy;
        if (!inBounds(ctx, x, y)) continue;
        if (!isFree(x, y)) continue;
        const type = (added % 2 === 0) ? "crate" : "barrel";
        props.push({
          x,
          y,
          type,
          name: type === "crate" ? "Crate" : "Barrel",
          isCaravanProp: true
        });
        added++;
      }
    } catch (_) {}
  } catch (_) {}
}

import { attachGlobal } from "../../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("Modes", {
  enterTownIfOnTile,
  enterDungeonIfOnEntrance,
  enterRuinsIfOnTile,
  returnToWorldIfAtExit,
  leaveTownNow,
  requestLeaveTown,
  saveCurrentDungeonState,
  loadDungeonStateFor
});