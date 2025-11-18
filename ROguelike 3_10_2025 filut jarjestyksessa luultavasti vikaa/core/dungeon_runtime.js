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

import { getMod } from "../utils/access.js";
import { keyFromWorldPos as keyFromWorldPosExt, save as saveExt, load as loadExt } from "./dungeon/state.js";
import { generate as generateExt } from "./dungeon/generate.js";
import { generateLoot as generateLootExt, lootHere as lootHereExt } from "./dungeon/loot.js";
import { tryMoveDungeon as tryMoveDungeonExt } from "./dungeon/movement.js";
import { tick as tickExt } from "./dungeon/tick.js";
import { returnToWorldIfAtExit as returnToWorldIfAtExitExt, computeAcrossMountainTarget as computeAcrossMountainTargetExt } from "./dungeon/transitions.js";
import { enter as enterExt } from "./dungeon/enter.js";

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
  if (!ctx || !enemy) return;
  // Announce death
  try {
    const Cap = (ctx.utils && typeof ctx.utils.capitalize === "function") ? ctx.utils.capitalize : (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    const name = Cap(enemy.type || "enemy");
    ctx.log && ctx.log(`${name} dies.`, "bad");
  } catch (_) {}

  // Generate loot
  let loot = [];
  try {
    if (ctx.Loot && typeof ctx.Loot.generate === "function") {
      loot = ctx.Loot.generate(ctx, enemy) || [];
    }
  } catch (_) { loot = []; }

  // Build flavor metadata from last hit info if available (JSON-driven via FlavorService)
  const last = enemy._lastHit || null;
  let meta = null;
  try {
    const FS = (typeof window !== "undefined" ? window.FlavorService : null);
    if (FS && typeof FS.buildCorpseMeta === "function") {
      meta = FS.buildCorpseMeta(ctx, enemy, last);
    }
  } catch (_) { meta = null; }
  if (!meta) {
    // Fallback inline flavor
    function flavorFromLastHit(lh) {
      if (!lh) return null;
      const part = lh.part || "torso";
      const killer = lh.by || "unknown";
      const via = lh.weapon ? lh.weapon : (lh.via || "attack");
      let wound = "";
      if (part === "head") wound = lh.crit ? "head crushed into pieces" : "wound to the head";
      else if (part === "torso") wound = lh.crit ? "deep gash across the torso" : "bleeding cut in torso";
      else if (part === "legs") wound = lh.crit ? "leg shattered beyond use" : "wound to the leg";
      else if (part === "hands") wound = lh.crit ? "hands mangled" : "cut on the hand";
      else wound = "fatal wound";
      const killedBy = (killer === "player") ? "you" : killer;
      return { killedBy, wound, via };
    }
    meta = flavorFromLastHit(last);
  }

  // Place corpse with flavor meta
  try {
    ctx.corpses = Array.isArray(ctx.corpses) ? ctx.corpses : [];
    ctx.corpses.push({
      x: enemy.x,
      y: enemy.y,
      loot,
      looted: loot.length === 0,
      meta: meta || undefined
    });
  } catch (_) {}

  // Remove enemy from list
  try {
    if (Array.isArray(ctx.enemies)) {
      ctx.enemies = ctx.enemies.filter(e => e !== enemy);
    }
  } catch (_) {}

  // Clear occupancy
  try {
    if (ctx.occupancy && typeof ctx.occupancy.clearEnemy === "function") {
      ctx.occupancy.clearEnemy(enemy.x, enemy.y);
    }
  } catch (_) {}

  // Award XP only if the last hit was by the player
  const xp = (typeof enemy.xp === "number") ? enemy.xp : 5;
  let awardXp = false;
  try {
    const byStr = (enemy._lastHit && enemy._lastHit.by) ? String(enemy._lastHit.by).toLowerCase() : "";
    awardXp = (byStr === "player");
  } catch (_) { awardXp = false; }
  if (awardXp) {
    try {
      if (ctx.Player && typeof ctx.Player.gainXP === "function") {
        ctx.Player.gainXP(ctx.player, xp, { log: ctx.log, updateUI: ctx.updateUI });
      } else if (typeof window !== "undefined" && window.Player && typeof window.Player.gainXP === "function") {
        window.Player.gainXP(ctx.player, xp, { log: ctx.log, updateUI: ctx.updateUI });
      } else {
        ctx.player.xp = (ctx.player.xp || 0) + xp;
        ctx.log && ctx.log(`You gain ${xp} XP.`);
        while (ctx.player.xp >= ctx.player.xpNext) {
          ctx.player.xp -= ctx.player.xpNext;
          ctx.player.level = (ctx.player.level || 1) + 1;
          ctx.player.maxHp = (ctx.player.maxHp || 1) + 2;
          ctx.player.hp = ctx.player.maxHp;
          if ((ctx.player.level % 2) === 0) ctx.player.atk = (ctx.player.atk || 1) + 1;
          ctx.player.xpNext = Math.floor((ctx.player.xpNext || 20) * 1.3 + 10);
          ctx.log && ctx.log(`You are now level ${ctx.player.level}. Max HP increased.`, "good");
        }
        ctx.updateUI && ctx.updateUI();
      }
    } catch (_) {}
  }

  // Persist dungeon state so corpses remain on revisit
  try { save(ctx, false); } catch (_) {}
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
if (typeof window !== "undefined") {
  window.DungeonRuntime = { keyFromWorldPos, save, load, generate, generateLoot, returnToWorldIfAtExit, lootHere, killEnemy, enter, tryMoveDungeon, tick };
}