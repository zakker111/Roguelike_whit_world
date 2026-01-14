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

// Expose ensureInBoundsExt for other runtimes (town/dungeon) to place the player at absolute world coords.
export function _ensureInBounds(ctx, nx, ny, CHUNK = 32) {
  return ensureInBoundsExt(ctx, nx, ny, CHUNK);
}

// For debugging: force a castle POI to spawn close to the starting position so it's easy to inspect.
// This is layered on top of the normal (very rare) castle placement in InfiniteGen.
function spawnDebugCastleNearPlayer(ctx) {
  try {
    const W = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
    const WT = W && W.TILES;
    const world = ctx.world;
    const map = ctx.map;
    if (!WT || !world || !Array.isArray(map) || !map.length) return;
    if (typeof WT.CASTLE !== "number") return;

    const rows = map.length;
    const cols = map[0] ? map[0].length : 0;
    if (!cols) return;

    const px = (ctx.player && typeof ctx.player.x === "number") ? (ctx.player.x | 0) : (cols >> 1);
    const py = (ctx.player && typeof ctx.player.y === "number") ? (ctx.player.y | 0) : (rows >> 1);

    const radius = 4;
    const candidates = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (!dx && !dy) continue;
        const x = px + dx;
        const y = py + dy;
        if (x < 0 || y < 0 || y >= rows || x >= cols) continue;
        candidates.push({ x, y });
      }
    }
    if (!candidates.length) return;

    function isPOITile(t) {
      return t === WT.TOWN || t === WT.DUNGEON || t === WT.RUINS || (WT.CASTLE != null && t === WT.CASTLE);
    }

    function isReasonableSpot(x, y) {
      const t = map[y][x];
      if (isPOITile(t)) return false;
      if (t === WT.WATER || t === WT.RIVER || t === WT.MOUNTAIN || t === WT.SWAMP) return false;
      return true;
    }

    let chosen = null;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (isReasonableSpot(c.x, c.y)) {
        chosen = c;
        break;
      }
    }
    if (!chosen) return;

    map[chosen.y][chosen.x] = WT.CASTLE;
    world.map = map;
  } catch (_) {}
}

/**
 * Spawn initial travelling caravans after the first POIs are registered.
 * Caravans are stored in world.caravans with world-space coordinates and a destination town.
 */
function spawnInitialCaravans(ctx) {
  try {
    const world = ctx.world;
    if (!world) return;
    const towns = Array.isArray(world.towns) ? world.towns : [];
    if (!towns.length) return;

    if (!Array.isArray(world.caravans)) world.caravans = [];

    // Use RNGUtils when available so caravans are deterministic per seed.
    let r = null;
    try {
      if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function") {
        r = window.RNGUtils.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined);
      } else if (typeof ctx.rng === "function") {
        r = ctx.rng;
      }
    } catch (_) {}
    if (typeof r !== "function") {
      r = function () { return Math.random(); };
    }

    const desired = Math.min(16, Math.max(4, Math.floor(towns.length * 0.8)));
    let idCounter = (world.caravans.length ? world.caravans.length : 0);
    const existing = world.caravans.length;

    for (let i = existing; i < desired; i++) {
      const fromIndex = (r() * towns.length) | 0;
      const from = towns[fromIndex];
      if (!from) continue;

      // Find nearest and farthest other towns from this origin.
      let nearest = null;
      let nearestDist = Infinity;
      let farthest = null;
      let farthestDist = -Infinity;
      for (let j = 0; j < towns.length; j++) {
        if (j === fromIndex) continue;
        const t = towns[j];
        if (!t) continue;
        const dx = (t.x | 0) - (from.x | 0);
        const dy = (t.y | 0) - (from.y | 0);
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist === 0) continue;
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = t;
        }
        if (dist > farthestDist) {
          farthestDist = dist;
          farthest = t;
        }
      }
      if (!nearest) continue;

      // Default to nearest, but sometimes choose a far destination so some initial
      // caravans run longer routes across the world.
      let destTown = nearest;
      try {
        const roll = typeof r === "function" ? r() : Math.random();
        if (towns.length >= 4 && roll < 0.35 && farthest) {
          destTown = farthest;
        }
      } catch (_) {}

      world.caravans.push({
        id: ++idCounter,
        x: from.x | 0,
        y: from.y | 0,
        from: { x: from.x | 0, y: from.y | 0 },
        dest: { x: destTown.x | 0, y: destTown.y | 0 },
        atTown: true,
        dwellUntil: 0
      });
    }
  } catch (_) {}
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
      ruins: [],
      roads: [],
      bridges: [],
      caravans: [],
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

    // For debugging: always spawn a castle very close to the starting position so layout/NPCs are easy to test.
    try { spawnDebugCastleNearPlayer(ctx); } catch (_) {}

    // Register POIs present in the initial window (sparse anchors only) and lay initial roads/bridges
    try { scanPOIs(ctx, 0, 0, ctx.world.width, ctx.world.height); } catch (_) {}

    // Spawn a few travelling caravans that wander between the known towns.
    try { spawnInitialCaravans(ctx); } catch (_) {}

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