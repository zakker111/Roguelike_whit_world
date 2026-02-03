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
import { allocFog } from "./engine/fog.js";
import {
  ensurePOIState,
  addTown,
  addDungeon,
  addRuins,
  spawnDebugCastleNearPlayer,
  spawnInitialCaravans,
} from "./world_runtime_poi.js";

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

// POI helpers now live in core/world_runtime_poi.js (imported at top).

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
// Castle debug and caravan helpers now live in core/world_runtime_poi.js (imported at top).

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

    // Allocate fog-of-war arrays; FOV module will mark seen/visible around player.
    // Use typed rows (Uint8Array) for overworld fog so future expansions can take advantage
    // of cheaper per-tile storage without changing consumer code.
    ctx.seen = allocFog(ctx.world.height, ctx.world.width, false, true);
    ctx.visible = allocFog(ctx.world.height, ctx.world.width, false, true);
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