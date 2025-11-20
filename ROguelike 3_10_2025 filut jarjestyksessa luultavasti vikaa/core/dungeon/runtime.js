/**
 * DungeonRuntime: generation and persistence glue for dungeon mode.
 *
 * Exports (ESM + window.DungeonRuntime):
 * - keyFromWorldPos(x, y)
 * - save(ctx, logOnce=false)
 * - load(ctx, x, y): returns boolean
 * - generate(ctx, depth=1)
 * - generateLoot(ctx, source)
 * - returnToWorldIfAtExit(ctx)
 * - killEnemy(ctx, enemy)
 * - enter(ctx, info)
 */

import { getMod } from "../../utils/access.js";
import { keyFromWorldPos as keyFromWorldPosExt, save as saveExt, load as loadExt } from "./state.js";
import { generate as generateExt } from "./generate.js";
import { generateLoot as generateLootExt, lootHere as lootHereExt } from "./loot.js";
import { tryMoveDungeon as tryMoveDungeonExt } from "./movement.js";
import { tick as tickExt } from "./tick.js";
import { returnToWorldIfAtExit as returnToWorldIfAtExitExt, computeAcrossMountainTarget as computeAcrossMountainTargetExt } from "./transitions.js";
import { enter as enterExt } from "./enter.js";
import { killEnemy as killEnemyExt } from "./kill_enemy.js";

export function keyFromWorldPos(x, y) {
  return keyFromWorldPosExt(x, y);
}

// Spawn sparse wall torches on WALL tiles adjacent to FLOOR/DOOR/STAIRS.
// Options: { density:number (0..1), minSpacing:number (tiles) }
function spawnWallTorches(ctx, options = {}) {
  const density = typeof options.density === "number" ? Math.max(0, Math.min(1, options.density)) : 0.006;
  const minSpacing = Math.max(1, (options.minSpacing | 0) || 2);
  const list = [];
  const rows = ctx.map.length;
  const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
  const RU = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
  const rng = (RU && typeof RU.getRng === "function")
    ? RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
    : ((typeof ctx.rng === "function") ? ctx.rng : null);

  const isWall = (x, y) => ctx.inBounds(x, y) && ctx.map[y][x] === ctx.TILES.WALL;
  const isWalkableTile = (x, y) => ctx.inBounds(x, y) && (ctx.map[y][x] === ctx.TILES.FLOOR || ctx.map[y][x] === ctx.TILES.DOOR || ctx.map[y][x] === ctx.TILES.STAIRS);

  function nearTorch(x, y, r = minSpacing) {
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const dx = Math.abs(p.x - x);
      const dy = Math.abs(p.y - y);
      if (dx <= r && dy <= r) return true;
    }
    return false;
  }

  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      if (!isWall(x, y)) continue;
      // Must border at least one walkable tile (corridor/room edge)
      const bordersWalkable =
        isWalkableTile(x + 1, y) || isWalkableTile(x - 1, y) ||
        isWalkableTile(x, y + 1) || isWalkableTile(x, y - 1);
      if (!bordersWalkable) continue;
      // Sparse random placement with spacing constraint
      const rv = (typeof rng === "function") ? rng() : 0.5;
      if (rv < density && !nearTorch(x, y)) {
        list.push({ x, y, type: "wall_torch", name: "Wall Torch" });
      }
    }
  }
  return list;
}

export function save(ctx, logOnce = false) {
  return saveExt(ctx, logOnce);
}

export function load(ctx, x, y) {
  return loadExt(ctx, x, y);
}

export function generate(ctx, depth) {
  return generateExt(ctx, depth);
}

export function generateLoot(ctx, source) {
  return generateLootExt(ctx, source);
}

export function returnToWorldIfAtExit(ctx) {
  return returnToWorldIfAtExitExt(ctx);
}

export function lootHere(ctx) {
  return lootHereExt(ctx);
}

export function killEnemy(ctx, enemy) {
  return killEnemyExt(ctx, enemy);
}

export function enter(ctx, info) {
  return enterExt(ctx, info);
}

export function tryMoveDungeon(ctx, dx, dy) {
  return tryMoveDungeonExt(ctx, dx, dy);
}

// Determine a target world coordinate across a mountain from this dungeon's entrance.
function computeAcrossMountainTarget(ctx) {
  return computeAcrossMountainTargetExt(ctx);
}

export function tick(ctx) {
  return tickExt(ctx);
}

// Back-compat: attach to window for classic scripts
import { attachGlobal } from "../../utils/global.js";
if (typeof window !== "undefined") {
  attachGlobal("DungeonRuntime", { keyFromWorldPos, save, load, generate, generateLoot, returnToWorldIfAtExit, lootHere, killEnemy, enter, tryMoveDungeon, tick });
}