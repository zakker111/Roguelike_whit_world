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

import { getMod } from "../../utils/access.js";
import { enter as enterExt } from "./enter.js";
import { tryMoveEncounter as tryMoveEncounterExt } from "./movement.js";
import { tick as tickExt } from "./tick.js";
import { complete as completeExt } from "./transitions.js";
import { enterRegion as enterRegionExt } from "./enter_region.js";

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
  return (typeof enterRegionExt === "function") ? enterRegionExt(ctx, info) : false;
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
    const hasEnemies = Array.isArray(ctx.enemies) && ctx.enemies.length > 0;
    const info = ctx.encounterInfo || {};
    const tplId = (info.id || "").toLowerCase();

    let treatAsClear = false;
    let guardsWon = false;

    if (!hasEnemies) {
      treatAsClear = true;
    } else if (tplId === "guards_vs_bandits") {
      let anyBandit = false;
      let anyGuard = false;
      let allGuardsNeutral = true;
      for (const e of ctx.enemies) {
        if (!e) continue;
        const fac = String(e.faction || "").toLowerCase();
        if (fac === "bandit") anyBandit = true;
        if (fac === "guard") {
          anyGuard = true;
          if (!e._ignorePlayer) allGuardsNeutral = false;
        }
      }
      if (!anyBandit && anyGuard && allGuardsNeutral) {
        treatAsClear = true;
        guardsWon = true;
      }
    }

    if (treatAsClear) {
      if (!_clearAnnounced) {
        _clearAnnounced = true;
        if (guardsWon) {
          try { ctx.log && ctx.log('The surviving guards cheer: "For the kingdom!"', "good"); } catch (_) {}
        }
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
import { attachGlobal } from "../../utils/global.js";
if (typeof window !== "undefined") {
  attachGlobal("EncounterRuntime", { enter, tryMoveEncounter, tick, complete, enterRegion });
}