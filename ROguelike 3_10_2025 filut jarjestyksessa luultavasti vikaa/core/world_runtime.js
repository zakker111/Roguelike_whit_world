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
import { ensureInBounds as ensureInBoundsExt } from "./world/expand.js";
import { tryMovePlayerWorld as tryMovePlayerWorldExt } from "./world/move.js";
import { tick as tickExt } from "./world/tick.js";
import { allocFog } from "./engine/fog.js";
import { createSparseFogStore, createSparseMatrix, createSparseTileStore } from "./world/sparse_window.js";
import * as GMBridge from "./bridge/gm_bridge.js";
import {
  spawnDebugCastleNearPlayer,
  spawnInitialCaravans,
} from "./world_runtime_poi.js";

function currentSeed() {
  try {
    if (typeof window !== "undefined" && window.RNG && typeof window.RNG.getSeed === "function") {
      return window.RNG.getSeed();
    }
  } catch {
    return (Date.now() >>> 0);
  }
  return (Date.now() >>> 0);
}

// POI helpers now live in core/world_runtime_poi.js (imported at top).

// Scan a rectangle of the current window (map space) and register POIs sparsely
function scanPOIs(ctx, x0, y0, w, h) {
  return scanPOIsExt(ctx, x0, y0, w, h);
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

  const width = (typeof opts.width === "number") ? opts.width : (ctx.MAP_COLS || 120);
  const height = (typeof opts.height === "number") ? opts.height : (ctx.MAP_ROWS || 80);

  // Clear non-world entities
  ctx.enemies = [];
  ctx.corpses = [];
  ctx.decals = [];
  ctx.npcs = [];
  ctx.shops = [];

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

    ctx.world = {
      type: "infinite",
      gen,
      originX,
      originY,
      width,
      height,
      tileStore: createSparseTileStore(gen),
      seenStore: createSparseFogStore(),
      towns: [],       // optional: can be populated lazily if we scan tiles
      dungeons: [],
      ruins: [],
      roads: [],
      bridges: [],
      caravans: [],
    };

    ctx.world.map = createSparseMatrix(ctx.world.tileStore, ctx.world);
    ctx.world.seenRef = createSparseMatrix(ctx.world.seenStore, ctx.world);

    // Place player at the center of the initial window
    ctx.map = ctx.world.map;
    ctx.seen = ctx.world.seenRef;
    ctx.visible = allocFog(ctx.world.height, ctx.world.width, false, true);
    ctx.world.visibleRef = ctx.visible;

    ctx.player.x = centerX;
    ctx.player.y = centerY;
    ctx.mode = "world";

    // For debugging: always spawn a castle very close to the starting position so layout/NPCs are easy to test.
    try { spawnDebugCastleNearPlayer(ctx); } catch { void 0; }

    // Register POIs present in the initial window (sparse anchors only) and lay initial roads/bridges
    try { scanPOIs(ctx, 0, 0, ctx.world.width, ctx.world.height); } catch { void 0; }

    // Hybrid GM marker thread: guarantee at least one Survey Cache per run.
    try {
      if (GMBridge && typeof GMBridge.ensureGuaranteedSurveyCache === "function") {
        GMBridge.ensureGuaranteedSurveyCache(ctx);
      }
    } catch {
      void 0;
    }

    // Spawn a few travelling caravans that wander between the known towns.
    try { spawnInitialCaravans(ctx); } catch { void 0; }

    // Camera/FOV/UI via StateSync
    try {
      const SS = ctx.StateSync || getMod(ctx, "StateSync");
      if (SS && typeof SS.applyAndRefresh === "function") {
        SS.applyAndRefresh(ctx, {});
      }
    } catch {
      void 0;
    }

    // Arrival log
    ctx.log && ctx.log("You arrive in the overworld. The world expands as you explore. Minimap shows discovered tiles.", "notice");

    // Hide town exit button via TownRuntime
    try {
      const TR = (ctx && ctx.TownRuntime) || (typeof window !== "undefined" ? window.TownRuntime : null);
      if (TR && typeof TR.hideExitButton === "function") TR.hideExitButton(ctx);
    } catch {
      void 0;
    }

    return true;
  }

  // Infinite generator unavailable: throw a hard error (no finite fallback)
  try { ctx.log && ctx.log("Error: Infinite world generator unavailable or not initialized.", "bad"); } catch { void 0; }
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
