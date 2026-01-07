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
import { spawnInDungeon } from "../followers_runtime.js";

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
  const ok = enterExt(ctx, info);
  if (ok) {
    try {
      // Spawn player follower/ally into this encounter map, if configured.
      spawnInDungeon(ctx);
    } catch (_) {}
  }
  return ok;
}

export function tryMoveEncounter(ctx, dx, dy) {
  return tryMoveEncounterExt(ctx, dx, dy);
}

// Start an encounter within the existing Region Map mode (ctx.mode === "region").
// Spawns enemies on the current region sample without changing mode or map.
// Also ensures the active player follower spawns into this region encounter.
export function enterRegion(ctx, info) {
  const ok = (typeof enterRegionExt === "function") ? enterRegionExt(ctx, info) : false;
  if (ok) {
    try {
      spawnInDungeon(ctx);
    } catch (_) {}
  }
  return ok;
}

export function complete(ctx, outcome = "victory") {
  return completeExt(ctx, outcome);
}

export function tick(ctx) {
  if (!ctx || ctx.mode !== "encounter") return false;
  // Reuse DungeonRuntime.tick so AI/status/decals behave exactly like dungeon mode; required for encounters.
  const DR = ctx.DungeonRuntime || (typeof window !== "undefined" ? window.DungeonRuntime : null);
  if (!DR || typeof DR.tick !== "function") {
    throw new Error("DungeonRuntime.tick missing; encounter tick cannot proceed");
  }
  DR.tick(ctx);

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

          // Remove the captive prop at the target tile so it disappears visually.
          try {
            const props = Array.isArray(ctx.encounterProps) ? ctx.encounterProps : null;
            if (props) {
              for (let i = props.length - 1; i >= 0; i--) {
                const p = props[i];
                if (!p) continue;
                if (String(p.type || "").toLowerCase() !== "captive") continue;
                if (p.x === obj.target.x && p.y === obj.target.y) {
                  props.splice(i, 1);
                  break;
                }
              }
              ctx.encounterProps = props;
            }
          } catch (_) {}

          // Spawn a freed ally next to the player, mirroring tower captive behavior,
          // and mark them as a recruitable follower candidate.
          try {
            const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
            const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
            if (rows && cols) {
              const T = ctx.TILES;
              const px = ctx.player && typeof ctx.player.x === "number" ? (ctx.player.x | 0) : (obj.target.x | 0);
              const py = ctx.player && typeof ctx.player.y === "number" ? (ctx.player.y | 0) : (obj.target.y | 0);

              const dirs = [
                { x: 1, y: 0 },
                { x: -1, y: 0 },
                { x: 0, y: 1 },
                { x: 0, y: -1 },
              ];
              const inBounds = (x, y) => y >= 0 && y < rows && x >= 0 && x < cols;
              const hasEnemyAt = (x, y) =>
                Array.isArray(ctx.enemies) && ctx.enemies.some(e => e && e.x === x && e.y === y);
              const hasCorpseAt = (x, y) =>
                Array.isArray(ctx.corpses) && ctx.corpses.some(c => c && c.x === x && c.y === y);
              const hasPropAt = (x, y) =>
                Array.isArray(ctx.encounterProps) && ctx.encounterProps.some(pr => pr && pr.x === x && pr.y === y);

              let sx = null;
              let sy = null;
              for (let i = 0; i < dirs.length; i++) {
                const nx = px + dirs[i].x;
                const ny = py + dirs[i].y;
                if (!inBounds(nx, ny)) continue;
                const tile = ctx.map[ny][nx];
                if (tile !== T.FLOOR && tile !== T.DOOR && tile !== T.STAIRS) continue;
                if (hasEnemyAt(nx, ny)) continue;
                if (hasCorpseAt(nx, ny)) continue;
                if (hasPropAt(nx, ny)) continue;
                sx = nx;
                sy = ny;
                break;
              }

              if (sx == null || sy == null) {
                try {
                  ctx.log && ctx.log("You free the captive, but there's no room for them to stand and fight here.", "info");
                } catch (_) {}
              } else {
                const EM = ctx.Enemies || (typeof window !== "undefined" ? window.Enemies : null);
                let ally = null;
                if (EM && typeof EM.getTypeDef === "function") {
                  let type = "guard";
                  let def = EM.getTypeDef(type);
                  if (!def) {
                    type = "bandit";
                    def = EM.getTypeDef(type);
                  }
                  if (def) {
                    const depth = 1;
                    let rfn = ctx.rng;
                    try {
                      const RU = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
                      if (RU && typeof RU.getRng === "function") {
                        rfn = RU.getRng(typeof ctx.rng === "function" ? ctx.rng : undefined);
                      }
                    } catch (_) {}
                    if (typeof rfn !== "function") rfn = () => 0.5;
                    const level =
                      EM.levelFor && typeof EM.levelFor === "function"
                        ? EM.levelFor(type, depth, rfn)
                        : depth;
                    const glyph =
                      (def.glyph && def.glyph.length) ? def.glyph : (type && type.length ? type.charAt(0) : "?");
                    const hp = def.hp ? def.hp(depth) : 16;
                    const atk = def.atk ? def.atk(depth) : 3;
                    const xp = def.xp ? def.xp(depth) : 0;

                    ally = {
                      x: sx,
                      y: sy,
                      type,
                      glyph,
                      hp,
                      maxHp: hp,
                      atk,
                      xp,
                      level,
                      faction: def.faction || "guard",
                      announced: false,
                      _ignorePlayer: true,
                      _recruitCandidate: true,
                      _recruitFollowerId: "guard_follower",
                    };
                  }
                }

                if (!ally) {
                  ally = {
                    x: sx,
                    y: sy,
                    type: "rescued_guard",
                    glyph: "G",
                    hp: 18,
                    maxHp: 18,
                    atk: 3,
                    xp: 0,
                    level: 1,
                    faction: "guard",
                    announced: false,
                    _ignorePlayer: true,
                    _recruitCandidate: true,
                    _recruitFollowerId: "guard_follower",
                  };
                }

                if (!Array.isArray(ctx.enemies)) ctx.enemies = [];
                ctx.enemies.push(ally);

                try {
                  if (ctx.occupancy && typeof ctx.occupancy.setEnemy === "function") {
                    ctx.occupancy.setEnemy(ally.x, ally.y);
                  }
                } catch (_) {}

                try {
                  ctx.log && ctx.log("The freed captive arms themselves and is ready to fight beside you.", "good");
                } catch (_) {}
              }
            }
          } catch (_) {}

          try {
            ctx.log && ctx.log("You free the captive! Now reach an exit (>) to leave.", "good");
          } catch (_) {}
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
        try { ctx.log && ctx.log("Area clear. Step onto an exit (>) to leave when ready.", "info"); } catch (_) {}
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