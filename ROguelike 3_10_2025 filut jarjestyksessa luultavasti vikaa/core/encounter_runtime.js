/**
 * EncounterRuntime: compact, single-scene skirmishes triggered from overworld.
 *
 * Exports (ESM + window.EncounterRuntime):
 * - enter(ctx, info): switches to encounter mode and generates a tactical map
 * - tryMoveEncounter(ctx, dx, dy): movement during encounter (bump to attack)
 * - tick(ctx): drives AI and completes encounter on kill-all
 */
// Module-level flags to avoid spamming logs or duplicate quest notifications across ctx recreations
let _clearAnnounced = false;
let _victoryNotified = false;
// Persist the active quest instance id across ctx recreations
let _currentQuestInstanceId = null;

import { getMod } from "../utils/access.js";
import { enter as enterExt } from "./encounter/enter.js";
import { tryMoveEncounter as tryMoveEncounterExt } from "./encounter/movement.js";
import { tick as tickExt } from "./encounter/tick.js";
import { complete as completeExt } from "./encounter/transitions.js";

function createDungeonEnemyAt(ctx, x, y, depth) {
  // Prefer the same factory used by dungeon floors
  try {
    if (typeof ctx.enemyFactory === "function") {
      const e = ctx.enemyFactory(x, y, depth);
      if (e) return e;
    }
  } catch (_) {}
  // Use Enemies registry to pick a type by depth (JSON-only)
  try {
    const EM = ctx.Enemies || (typeof window !== "undefined" ? window.Enemies : null);
    if (EM && typeof EM.pickType === "function") {
      const type = EM.pickType(depth, ctx.rng);
      const td = EM.getTypeDef && EM.getTypeDef(type);
      if (td) {
        const level = (EM.levelFor && typeof EM.levelFor === "function") ? EM.levelFor(type, depth, ctx.rng) : depth;
        return {
          x, y,
          type,
          glyph: (td.glyph && td.glyph.length) ? td.glyph : ((type && type.length) ? type.charAt(0) : "?"),
          hp: td.hp(depth),
          atk: td.atk(depth),
          xp: td.xp(depth),
          level,
          announced: false
        };
      }
    }
  } catch (_) {}
  // Fallback enemy: visible '?' for debugging
  try { ctx.log && ctx.log("Fallback enemy spawned (auto-pick failed).", "warn"); } catch (_) {}
  return { x, y, type: "fallback_enemy", glyph: "?", hp: 3, atk: 1, xp: 5, level: depth, faction: "monster", announced: false };
}

// Create a specific enemy type defined in data/entities/enemies.json; JSON-only (no fallbacks).
function createEnemyOfType(ctx, x, y, depth, type) {
  try {
    const EM = ctx.Enemies || (typeof window !== "undefined" ? window.Enemies : null);
    if (EM && typeof EM.getTypeDef === "function") {
      const td = EM.getTypeDef(type);
      if (td) {
        const level = (EM.levelFor && typeof EM.levelFor === "function") ? EM.levelFor(type, depth, ctx.rng) : depth;
        return {
          x, y,
          type,
          glyph: (td.glyph && td.glyph.length) ? td.glyph : ((type && type.length) ? type.charAt(0) : "?"),
          hp: td.hp(depth),
          atk: td.atk(depth),
          xp: td.xp(depth),
          level,
          announced: false
        };
      }
    }
  } catch (_) {}
  // Fallback enemy: visible '?' for debugging
  try { ctx.log && ctx.log("Fallback enemy spawned (auto-pick failed).", "warn"); } catch (_) {}
  return { x, y, type: "fallback_enemy", glyph: "?", hp: 3, atk: 1, xp: 5, level: depth, faction: "monster", announced: false };
}

export function enter(ctx, info) {
  return enterExt(ctx, info);
}

export function tryMoveEncounter(ctx, dx, dy) {
  return tryMoveEncounterExt(ctx, dx, dy);
}

// Start an encounter within the existing Region Map mode (ctx.mode === "region").
// Spawns enemies on the current region sample without changing mode or map.
export function enterRegion(ctx, info) {
  if (!ctx || ctx.mode !== "region" || !ctx.map || !Array.isArray(ctx.map) || !ctx.map.length) return false;
  // Reset clear-announcement guard for region-embedded encounters too
  _clearAnnounced = false;
  const template = info && info.template ? info.template : { id: "ambush_forest", name: "Ambush", groups: [ { type: "bandit", count: { min: 2, max: 3 } } ] };
  const difficulty = Math.max(1, Math.min(5, (info && typeof info.difficulty === "number") ? (info.difficulty | 0) : 1));
  ctx.encounterDifficulty = difficulty;

  const WT = (typeof window !== "undefined" && window.World && window.World.TILES) ? window.World.TILES : (ctx.World && ctx.World.TILES) ? ctx.World.TILES : null;
  const isWalkableWorld = (typeof window !== "undefined" && window.World && typeof window.World.isWalkable === "function")
    ? window.World.isWalkable
    : (ctx.World && typeof ctx.World.isWalkable === "function") ? ctx.World.isWalkable : null;

  const H = ctx.map.length;
  const W = ctx.map[0] ? ctx.map[0].length : 0;
  if (!W || !H) return false;
  const RU = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
  const r = (RU && typeof RU.getRng === "function")
    ? RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
    : ((typeof ctx.rng === "function") ? ctx.rng : (() => 0.5));

  // Initialize encounter state on region
  if (!Array.isArray(ctx.enemies)) ctx.enemies = [];
  ctx.corpses = Array.isArray(ctx.corpses) ? ctx.corpses : [];

  // Helper: free spawn spot (walkable region tile, not on player, not duplicate)
  const placements = [];
  function walkableAt(x, y) {
    if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return false;
    const t = ctx.map[y][x];
    if (isWalkableWorld) return !!isWalkableWorld(t);
    if (!WT) return true;
    // Fallback: avoid water/river/mountain
    return !(t === WT.WATER || t === WT.RIVER || t === WT.MOUNTAIN);
  }
  function free(x, y) {
    if (!walkableAt(x, y)) return false;
    if (x === (ctx.player.x | 0) && y === (ctx.player.y | 0)) return false;
    if (placements.some(p => p.x === x && p.y === y)) return false;
    return true;
  }

  // Determine total enemies from groups
  const groups = Array.isArray(template.groups) ? template.groups : [];
  const totalWanted = groups.reduce((acc, g) => {
    const min = (g && g.count && typeof g.count.min === "number") ? g.count.min : 1;
    const max = (g && g.count && typeof g.count.max === "number") ? g.count.max : Math.max(1, min + 2);
    const n = (RU && typeof RU.int === "function")
      ? RU.int(min, max, ctx.rng)
      : Math.max(min, Math.min(max, min + Math.floor((r() * (max - min + 1)))));
    return acc + n;
  }, 0);

  // Seed at least one placement near the player within FOV range to ensure visibility
  (function seedNearPlayer() {
    try {
      const px = (ctx.player.x | 0), py = (ctx.player.y | 0);
      const maxR = Math.max(3, Math.min(6, ((ctx.fovRadius | 0) || 8) - 1));
      outer:
      for (let r2 = 2; r2 <= maxR; r2++) {
        // Sample 16 directions around the ring
        const dirs = [
          [ r2,  0], [ 0,  r2], [-r2,  0], [ 0, -r2],
          [ r2,  1], [ 1,  r2], [-1,  r2], [-r2,  1],
          [-r2, -1], [-1, -r2], [ 1, -r2], [ r2, -1],
          [ r2,  2], [ 2,  r2], [-2,  r2], [-r2,  2],
        ];
        for (const d of dirs) {
          const x = px + d[0], y = py + d[1];
          if (free(x, y)) { placements.push({ x, y }); break outer; }
        }
      }
    } catch (_) {}
  })();

  // Collect edge-ring placements inward to avoid spawning adjacent to player
  let ring = 0, placed = placements.length | 0;
  while (placed < totalWanted && ring < Math.max(W, H)) {
    for (let x = 1 + ring; x < W - 1 - ring && placed < totalWanted; x++) {
      const y1 = 1 + ring, y2 = H - 2 - ring;
      if (free(x, y1)) { placements.push({ x, y: y1 }); placed++; }
      if (placed >= totalWanted) break;
      if (free(x, y2)) { placements.push({ x, y: y2 }); placed++; }
    }
    for (let y = 2 + ring; y < H - 2 - ring && placed < totalWanted; y++) {
      const x1 = 1 + ring, x2 = W - 2 - ring;
      if (free(x1, y)) { placements.push({ x: x1, y }); placed++; }
      if (placed >= totalWanted) break;
      if (free(x2, y)) { placements.push({ x: x2, y }); placed++; }
    }
    ring++;
  }

  // Materialize enemies; honor group.type when provided
  let pIdx = 0;
  const depth = Math.max(1, (ctx.floor | 0) || 1);
  const deriveFaction = (t) => {
    const s = String(t || "").toLowerCase();
    if (s.includes("bandit")) return "bandit";
    if (s.includes("orc")) return "orc";
    return "monster";
  };
  for (const g of groups) {
    const min = (g && g.count && typeof g.count.min === "number") ? g.count.min : 1;
    const max = (g && g.count && typeof g.count.max === "number") ? g.count.max : Math.max(1, min + 2);
    let n = (RU && typeof RU.int === "function")
      ? RU.int(min, max, ctx.rng)
      : Math.max(min, Math.min(max, min + Math.floor((r() * (max - min + 1)))));
    // Difficulty raises group size modestly
    n = Math.max(min, Math.min(placements.length - pIdx, n + Math.max(0, (ctx.encounterDifficulty || 1) - 1)));
    for (let i = 0; i < n && pIdx < placements.length; i++) {
      const p = placements[pIdx++];
      const type = (g && typeof g.type === "string" && g.type) ? g.type : null;
      let e = type ? createEnemyOfType(ctx, p.x, p.y, depth, type) : createDungeonEnemyAt(ctx, p.x, p.y, depth);
      if (!e) { continue; }
      // Difficulty scaling: raise level/HP/ATK with diminishing returns
      try {
        const d = Math.max(1, Math.min(5, ctx.encounterDifficulty || 1));
        e.level = Math.max(1, (e.level | 0) + (d - 1));
        const hpMult = 1 + 0.25 * (d - 1);
        const atkMult = 1 + 0.20 * (d - 1);
        e.hp = Math.max(1, Math.round(e.hp * hpMult));
        e.atk = Math.max(0.1, Math.round(e.atk * atkMult * 10) / 10);
      } catch (_) {}
      try {
        e.faction = (g && g.faction) ? String(g.faction) : deriveFaction(e.type);
      } catch (_) {}
      ctx.enemies.push(e);
    }
  }

  // Build occupancy for region map
  try {
    const OF = ctx.OccupancyFacade || (typeof window !== "undefined" ? window.OccupancyFacade : null);
    if (OF && typeof OF.rebuild === "function") OF.rebuild(ctx);
  } catch (_) {}

  // Mark encounter-active in region and notify
  try { ctx.log && ctx.log(`${template.name || "Encounter"} begins here.`, "notice"); } catch (_) {}
  ctx.encounterInfo = { id: template.id, name: template.name || "Encounter" };
  if (!ctx.region) ctx.region = {};
  ctx.region._isEncounter = true;

  try {
    const SS = ctx.StateSync || getMod(ctx, "StateSync");
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    }
  } catch (_) {}
  return true;
}

export function complete(ctx, outcome = "victory") {
  return completeExt(ctx, outcome);
}

export function tick(ctx) {
  if (!ctx || ctx.mode !== "encounter") return false;
  // Reuse DungeonRuntime.tick so AI/status/decals behave exactly like dungeon mode
  try {
    const DR = ctx.DungeonRuntime || (typeof window !== "undefined" ? window.DungeonRuntime : null);
    if (DR && typeof DR.tick === "function") {
      DR.tick(ctx);
    } else {
      // Fallback to local minimal tick (should rarely happen)
      const AIH = ctx.AI || (typeof window !== "undefined" ? window.AI : null);
      if (AIH && typeof AIH.enemiesAct === "function") AIH.enemiesAct(ctx);
    }
  } catch (_) {}

  // Objectives processing (non-blocking; does not auto-exit)
  try {
    const obj = ctx.encounterObjective || null;
    if (obj && obj.status !== "success") {
      const here = (ctx.inBounds && ctx.inBounds(ctx.player.x, ctx.player.y)) ? ctx.map[ctx.player.y][ctx.player.x] : null;
      if (obj.type === "surviveTurns" && typeof obj.turnsRemaining === "number") {
        obj.turnsRemaining = Math.max(0, (obj.turnsRemaining | 0) - 1);
        if (obj.turnsRemaining === 0) {
          obj.status = "success";
          ctx.log && ctx.log("Objective complete: You survived. Step onto an exit (>) to leave.", "good");
        } else {
          // periodic reminder
          if ((obj.turnsRemaining % 3) === 0) {
            ctx.log && ctx.log(`Survive ${obj.turnsRemaining} more turn(s)...`, "info");
          }
        }
      } else if (obj.type === "reachExit") {
        if (here === ctx.TILES.STAIRS) {
          obj.status = "success";
          ctx.log && ctx.log("Objective complete: Reached exit. Press G to leave.", "good");
        }
      } else if (obj.type === "rescueTarget") {
        const rescued = !!obj.rescued;
        if (!rescued && obj.target && obj.target.x === ctx.player.x && obj.target.y === ctx.player.y) {
          obj.rescued = true;
          ctx.log && ctx.log("You free the captive! Now reach an exit (>) to leave.", "good");
        } else if (rescued && here === ctx.TILES.STAIRS) {
          obj.status = "success";
          ctx.log && ctx.log("Objective complete: Escorted the captive to safety.", "good");
        }
      }
    }
  } catch (_) {}

  // Do NOT auto-return to overworld on victory. Keep the encounter map active so player can loot or explore.
  // Announce clear state only once per encounter session (guarded by a module-level flag).
  // Also, proactively notify QuestService of victory so the Quest Board can show "Claim" on re-entry even if exit is delayed.
  try {
    if (Array.isArray(ctx.enemies) && ctx.enemies.length === 0) {
      if (!_clearAnnounced) {
        _clearAnnounced = true;
        try { ctx.log && ctx.log("Area clear. Step onto an exit (>) to leave when ready.", "notice"); } catch (_) {}
      }
      // Proactive quest victory notification (only once per encounter session)
      if (!_victoryNotified) {
        _victoryNotified = true;
        try {
          const QS = ctx.QuestService || (typeof window !== "undefined" ? window.QuestService : null);
          const qid = ctx._questInstanceId || _currentQuestInstanceId || null;
          if (QS && typeof QS.onEncounterComplete === "function" && qid) {
            QS.onEncounterComplete(ctx, { questInstanceId: qid, enemiesRemaining: 0 });
          }
        } catch (_) {}
      }
    } else {
      // If new enemies appear (edge-case), allow re-announcement once they are cleared again
      _clearAnnounced = false;
      _victoryNotified = false;
    }
  } catch (_) {}
  return true;
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.EncounterRuntime = { enter, tryMoveEncounter, tick, complete };
}