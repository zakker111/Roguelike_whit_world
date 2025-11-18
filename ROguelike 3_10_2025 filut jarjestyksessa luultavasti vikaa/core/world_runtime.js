/**
 * WorldRuntime: generation and helpers for overworld mode (now supports near-infinite expansion).
 *
 * Exports (ESM + window.WorldRuntime):
 * - generate(ctx, { width, height }?)
 * - tryMovePlayerWorld(ctx, dx, dy)
 * - tick(ctx)      // optional per-turn hook for world mode
 */

import { getMod } from "../utils/access.js";
import { scanPOIs as scanPOIsExt } from "./world/scan_pois.js";
import { ensureRoads as ensureRoadsExt, ensureExtraBridges as ensureExtraBridgesExt } from "./world/roads_bridges.js";
import { ensureInBounds as ensureInBoundsExt } from "./world/expand.js";
import { tryMovePlayerWorld as tryMovePlayerWorldExt } from "./world/move.js";
import { tick as tickExt } from "./world/tick.js";

function currentSeed() {
  try {
    if (typeof window !== "undefined" && window.RNG && typeof window.RNG.getSeed === "function") {
      return window.RNG.getSeed();
    }
  } catch (_) {}
  return (Date.now() >>> 0);
}

// Config helpers (GameData.config overrides, with localStorage flags for quick toggles)
function _getConfig() {
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    if (GD && GD.config && GD.config.world) return GD.config.world;
  } catch (_) {}
  return {};
}
function _lsBool(key) {
  try {
    const v = localStorage.getItem(key);
    if (typeof v === "string") {
      const s = v.toLowerCase();
      return s === "1" || s === "true" || s === "yes" || s === "on";
    }
  } catch (_) {}
  return null;
}
function featureEnabled(name, defaultVal) {
  // Feature toggles:
  // - WORLD_INFINITE: config.world.infinite
  // - WORLD_ROADS: config.world.roadsEnabled
  // - WORLD_BRIDGES: config.world.bridgesEnabled
  // Resolution order: localStorage override → config value → default
  const ls = _lsBool(name);
  if (ls != null) return !!ls;
  const cfg = _getConfig();
  if (name === "WORLD_INFINITE") {
    // config.world.infinite boolean
    if (typeof cfg.infinite === "boolean") return !!cfg.infinite;
    return !!defaultVal;
  }
  if (name === "WORLD_ROADS") {
    if (typeof cfg.roadsEnabled === "boolean") return !!cfg.roadsEnabled;
    return !!defaultVal;
  }
  if (name === "WORLD_BRIDGES") {
    if (typeof cfg.bridgesEnabled === "boolean") return !!cfg.bridgesEnabled;
    return !!defaultVal;
  }
  return !!defaultVal;
}

// Stable coordinate hash → [0,1). Used to derive deterministic POI metadata.
function h2(x, y) {
  const n = (((x | 0) * 73856093) ^ ((y | 0) * 19349663)) >>> 0;
  return (n % 1000003) / 1000003;
}

// Ensure POI bookkeeping containers exist on world
function ensurePOIState(world) {
  if (!world.towns) world.towns = [];
  if (!world.dungeons) world.dungeons = [];
  if (!world.ruins) world.ruins = [];
  if (!world._poiSet) world._poiSet = new Set();
}

// Add a town at world coords if not present; derive size deterministically
function addTown(world, x, y) {
  ensurePOIState(world);
  const key = `${x},${y}`;
  if (world._poiSet.has(key)) return;
  // Size distribution: small/big/city via hash
  const r = h2(x + 11, y - 7);
  const size = (r < 0.60) ? "small" : (r < 0.90 ? "big" : "city");
  world.towns.push({ x, y, size });
  world._poiSet.add(key);
}

// Add a dungeon at world coords if not present; derive level/size deterministically
function addDungeon(world, x, y) {
  ensurePOIState(world);
  const key = `${x},${y}`;
  if (world._poiSet.has(key)) return;
  const r1 = h2(x - 5, y + 13);
  const level = 1 + Math.floor(r1 * 5); // 1..5
  const r2 = h2(x + 29, y + 3);
  const size = (r2 < 0.45) ? "small" : (r2 < 0.85 ? "medium" : "large");
  world.dungeons.push({ x, y, level, size });
  world._poiSet.add(key);
}

// Add a ruins POI at world coords if not present
function addRuins(world, x, y) {
  ensurePOIState(world);
  const key = `${x},${y}`;
  if (world._poiSet.has(key)) return;
  world.ruins.push({ x, y });
  world._poiSet.add(key);
}

// Scan a rectangle of the current window (map space) and register POIs sparsely
function scanPOIs(ctx, x0, y0, w, h) {
  return scanPOIsExt(ctx, x0, y0, w, h);
}

// Build roads between nearby towns in current window and mark bridge points where crossing water/river
function ensureRoads(ctx) {
  return ensureRoadsExt(ctx);
}

// Add extra bridges so players can always find at least one crossing point over rivers in the current window.
// Strategy: scan vertical and horizontal spans of RIVER/WATER and place a BEACH + bridge overlay every N tiles.
function ensureExtraBridges(ctx) {
  return ensureExtraBridgesExt(ctx);
}

// Expand map arrays on any side by K tiles, generating via world.gen.tileAt against world origin offsets.
function expandMap(ctx, side, K) {
  const world = ctx.world;
  const gen = world && world.gen;
  if (!gen || typeof gen.tileAt !== "function") return false;

  const rows = ctx.map.length;
  const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;

  // Helper: normalize a visibility/seen row to a plain Array for safe concat operations.
  const toRowArray = (row, lenHint) => {
    if (!row) return new Array(lenHint | 0).fill(false);
    // Typed arrays (e.g., Uint8Array) need conversion to plain array when concatenating.
    if (ArrayBuffer.isView(row)) return Array.from(row);
    // Already a plain array
    return row;
  };

  if (side === "left") {
    // prepend K columns; shift origin and player by +K to keep world coords aligned, and offset camera to avoid visual snap
    for (let y = 0; y < rows; y++) {
      const row = ctx.map[y];
      const seenRow = toRowArray(ctx.seen[y], cols);
      const visRow = toRowArray(ctx.visible[y], cols);
      const prepend = new Array(K);
      const seenPre = new Array(K).fill(false);
      const visPre = new Array(K).fill(false);
      for (let i = 0; i < K; i++) {
        const wx = world.originX - (K - i); // new world x
        const wy = world.originY + y;
        prepend[i] = gen.tileAt(wx, wy);
      }
      ctx.map[y] = prepend.concat(row);
      ctx.seen[y] = seenPre.concat(seenRow);
      ctx.visible[y] = visPre.concat(visRow);
    }
    const _prevOX = world.originX | 0, _prevOY = world.originY | 0;
    world.originX -= K;
    // Newly added strip is columns [0..K-1]
    try {
      if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") {
        window.Logger.log(`[WorldGen] Expanded ${String(side)}`, "notice", {
          category: "WorldGen",
          side: String(side),
          tilesAdded: K | 0,
          originXFrom: _prevOX,
          originXTo: world.originX,
          originYFrom: _prevOY,
          originYTo: _prevOY,
          playerShifted: !ctx._suspendExpandShift
        });
      }
    } catch (_) {}
    scanPOIs(ctx, 0, 0, K, rows);
    // Shift player and entities right by K to preserve world position mapping, unless ctx._suspendExpandShift is true.
    // When suspended (e.g., during mode transitions), expansion avoids shifting to prevent camera snap; caller handles camera/position.
    if (!ctx._suspendExpandShift) {
      try { ctx.player.x += K; } catch (_) {}
      try {
        if (Array.isArray(ctx.enemies)) for (const e of ctx.enemies) if (e) e.x += K;
        if (Array.isArray(ctx.corpses)) for (const c of ctx.corpses) if (c) c.x += K;
        if (Array.isArray(ctx.decals)) for (const d of ctx.decals) if (d) d.x += K;
      } catch (_) {}
      // Offset camera so the screen doesn't jump this frame
      try {
        const cam = (typeof ctx.getCamera === "function") ? ctx.getCamera() : (ctx.camera || null);
        const TILE = (typeof ctx.TILE === "number") ? ctx.TILE : 32;
        if (cam) cam.x += K * TILE;
      } catch (_) {}
    }
  } else if (side === "right") {
    // append K columns
    for (let y = 0; y < rows; y++) {
      const row = ctx.map[y];
      const seenRow = toRowArray(ctx.seen[y], cols);
      const visRow = toRowArray(ctx.visible[y], cols);
      const append = new Array(K);
      const seenApp = new Array(K).fill(false);
      const visApp = new Array(K).fill(false);
      for (let i = 0; i < K; i++) {
        const wx = world.originX + cols + i;
        const wy = world.originY + y;
        append[i] = gen.tileAt(wx, wy);
      }
      ctx.map[y] = row.concat(append);
      ctx.seen[y] = seenRow.concat(seenApp);
      ctx.visible[y] = visRow.concat(visApp);
    }
    // Newly added strip starts at previous width (cols)
    try {
      if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") {
        window.Logger.log(`[WorldGen] Expanded ${String(side)}`, "notice", {
          category: "WorldGen",
          side: String(side),
          tilesAdded: K | 0,
          originXFrom: world.originX | 0,
          originXTo: world.originX | 0,
          originYFrom: world.originY | 0,
          originYTo: world.originY | 0,
          playerShifted: false
        });
      }
    } catch (_) {}
    scanPOIs(ctx, cols, 0, K, rows);
  } else if (side === "top") {
    // prepend K rows; shift origin and player by +K to keep world coords aligned, and offset camera to avoid visual snap
    const newRows = [];
    const newSeen = [];
    const newVis = [];
    for (let i = 0; i < K; i++) {
      const arr = new Array(cols);
      for (let x = 0; x < cols; x++) {
        const wx = world.originX + x;
        const wy = world.originY - (K - i);
        arr[x] = gen.tileAt(wx, wy);
      }
      newRows.push(arr);
      newSeen.push(new Array(cols).fill(false));
      newVis.push(new Array(cols).fill(false));
    }
    ctx.map = newRows.concat(ctx.map);
    ctx.seen = newSeen.concat(ctx.seen.map(r => toRowArray(r, cols)));
    ctx.visible = newVis.concat(ctx.visible.map(r => toRowArray(r, cols)));
    const _prevOX2 = world.originX | 0, _prevOY2 = world.originY | 0;
    world.originY -= K;
    try {
      if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") {
        window.Logger.log(`[WorldGen] Expanded ${String(side)}`, "notice", {
          category: "WorldGen",
          side: String(side),
          tilesAdded: K | 0,
          originXFrom: _prevOX2,
          originXTo: _prevOX2,
          originYFrom: _prevOY2,
          originYTo: world.originY,
          playerShifted: !ctx._suspendExpandShift
        });
      }
    } catch (_) {}
    // Newly added strip is rows [0..K-1]
    scanPOIs(ctx, 0, 0, cols, K);
    // Shift player and entities down by K to preserve world position mapping, unless ctx._suspendExpandShift is true.
    // When suspended (e.g., during mode transitions), expansion avoids shifting to prevent camera snap; caller handles cameraded)
    if (!ctx._suspendExpandShift) {
      try { ctx.player.y += K; } catch (_) {}
      try {
        if (Array.isArray(ctx.enemies)) for (const e of ctx.enemies) if (e) e.y += K;
        if (Array.isArray(ctx.corpses)) for (const c of ctx.corpses) if (c) c.y += K;
        if (Array.isArray(ctx.decals)) for (const d of ctx.decals) if (d) d.y += K;
      } catch (_) {}
      // Let updateCamera after movement handle centering to keep perceived 1-tile movement consistent
    }
  } else if (side === "bottom") {
    // append K rows
    for (let i = 0; i < K; i++) {
      const arr = new Array(cols);
      const seenArr = new Array(cols).fill(false);
      const visArr = new Array(cols).fill(false);
      for (let x = 0; x < cols; x++) {
        const wx = world.originX + x;
        const wy = world.originY + rows + i;
        arr[x] = gen.tileAt(wx, wy);
      }
      ctx.map.push(arr);
      ctx.seen.push(seenArr);
      ctx.visible.push(visArr);
    }
    // Newly added strip starts at previous height (rows)
    try {
      if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") {
        window.Logger.log(`[WorldGen] Expanded ${String(side)}`, "notice", {
          category: "WorldGen",
          side: String(side),
          tilesAdded: K | 0,
          originXFrom: world.originX | 0,
          originXTo: world.originX | 0,
          originYFrom: world.originY | 0,
          originYTo: world.originY | 0,
          playerShifted: false
        });
      }
    } catch (_) {}
    scanPOIs(ctx, 0, rows, cols, K);
  }

  world.width = ctx.map[0] ? ctx.map[0].length : 0;
  world.height = ctx.map.length;
  // Keep world.map and fog refs in sync
  world.map = ctx.map;
  world.seenRef = ctx.seen;
  world.visibleRef = ctx.visible;
  return true;
}

// Ensure (nx,ny) is inside map bounds; expand outward by chunk size if needed.
function ensureInBounds(ctx, nx, ny, CHUNK = 32) {
  return ensureInBoundsExt(ctx, nx, ny, CHUNK);
}

// Expose ensureInBounds for other runtimes (town/dungeon) to place the player at absolute world coords.
export function _ensureInBounds(ctx, nx, ny, CHUNK = 32) {
  return ensureInBounds(ctx, nx, ny, CHUNK);
}

export function generate(ctx, opts = {}) {
  // Prefer infinite generator; fall back to finite world if module missing or disabled
  const IG = (typeof window !== "undefined" ? window.InfiniteGen : null);
  const W = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);

  const width = (typeof opts.width === "number") ? opts.width : (ctx.MAP_COLS || 120);
  const height = (typeof opts.height === "number") ? opts.height : (ctx.MAP_ROWS || 80);

  // Clear non-world entities
  ctx.enemies = [];
  ctx.corpses = [];
  ctx.decals = [];
  ctx.npcs = [];
  ctx.shops = [];

  // Feature gate for infinite world
  const infiniteEnabled = featureEnabled("WORLD_INFINITE", true);

  // Create generator (infinite only)
  if (IG && typeof IG.create === "function") {
    const seed = currentSeed();
    const gen = IG.create(seed);

    // Choose a deterministic world start, then center the initial window on it so the player is on screen.
    const startWorld = gen.pickStart();
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const originX = (startWorld.x | 0) - centerX;
    const originY = (startWorld.y | 0) - centerY;

    const map = Array.from({ length: height }, (_, y) => {
      const wy = originY + y;
      const row = new Array(width);
      for (let x = 0; x < width; x++) {
        const wx = originX + x;
        row[x] = gen.tileAt(wx, wy);
      }
      return row;
    });

    ctx.world = {
      type: "infinite",
      gen,
      originX,
      originY,
      width,
      height,
      // Keep a live reference to the current windowed map for modules that read ctx.world.map
      map,            // note: will be kept in sync on expansion
      towns: [],       // optional: can be populated lazily if we scan tiles
      dungeons: [],
      roads: [],
      bridges: [],
    };

    // Place player at the center of the initial window
    ctx.map = map;
    ctx.world.width = map[0] ? map[0].length : 0;
    ctx.world.height = map.length;

    ctx.player.x = centerX;
    ctx.player.y = centerY;
    ctx.mode = "world";

    // Allocate fog-of-war arrays; FOV module will mark seen/visible around player
    ctx.seen = Array.from({ length: ctx.world.height }, () => Array(ctx.world.width).fill(false));
    ctx.visible = Array.from({ length: ctx.world.height }, () => Array(ctx.world.width).fill(false));
    // Keep references on world so we can restore them after visiting towns/dungeons
    ctx.world.seenRef = ctx.seen;
    ctx.world.visibleRef = ctx.visible;

    // Register POIs present in the initial window (sparse anchors only) and lay initial roads/bridges
    try { scanPOIs(ctx, 0, 0, ctx.world.width, ctx.world.height); } catch (_) {}

    // Camera/FOV/UI via StateSync
    try {
      const SS = ctx.StateSync || getMod(ctx, "StateSync");
      if (SS && typeof SS.applyAndRefresh === "function") {
        SS.applyAndRefresh(ctx, {});
      }
    } catch (_) {}

    // Arrival log
    ctx.log && ctx.log("You arrive in the overworld. The world expands as you explore. Minimap shows discovered tiles.", "notice");

    // Hide town exit button via TownRuntime
    try {
      const TR = (ctx && ctx.TownRuntime) || (typeof window !== "undefined" ? window.TownRuntime : null);
      if (TR && typeof TR.hideExitButton === "function") TR.hideExitButton(ctx);
    } catch (_) {}

    return true;
  }

  // Infinite generator unavailable: throw a hard error (no finite fallback)
  try { ctx.log && ctx.log("Error: Infinite world generator unavailable or not initialized.", "bad"); } catch (_) {}
  throw new Error("Infinite world generator unavailable or not initialized");
}

export function tryMovePlayerWorld(ctx, dx, dy) {
  return tryMovePlayerWorldExt(ctx, dx, dy);
}

/**
 * Optional per-turn hook for world mode.
 * Keeps the interface consistent with TownRuntime/DungeonRuntime tick hooks.
 */
export function tick(ctx) {
  return tickExt(ctx);
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.WorldRuntime = { generate, tryMovePlayerWorld, tick, ensureInBounds: _ensureInBounds };
}