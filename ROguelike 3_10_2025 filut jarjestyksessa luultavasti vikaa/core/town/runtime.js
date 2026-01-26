/**
 * TownRuntime: generation and helpers for town mode.
 *
 * Exports (ESM + window.TownRuntime):
 * - generate(ctx): populates ctx.map/visible/seen/npcs/shops/props/buildings/etc.
 * - ensureSpawnClear(ctx)
 * - spawnGateGreeters(ctx, count=4)
 * - isFreeTownFloor(ctx, x, y)
 * - talk(ctx): bump-talk with nearby NPCs; returns true if handled
 * - returnToWorldIfAtGate(ctx): leaves town if the player stands on the gate tile; returns true if handled
 * - startBanditsAtGateEvent(ctx): spawn a bandit group near the gate and mark a town combat event
 */

import { getMod } from "../../utils/access.js";
import { syncFollowersFromTown } from "../followers_runtime.js";
import { tickSeppo } from "./seppo_runtime.js";
import { tickTownFollowers } from "./follower_tick.js";
import { spawnInnFollowerHires } from "./follower_hires.js";
import { startBanditsAtGateEvent } from "./bandits_event.js";
import { talk as talkImpl } from "./talk.js";

export function generate(ctx) {
  // Ensure townBiome is not carrying over from previous towns; allow derive/persist per town
  try { ctx.townBiome = undefined; } catch (_) {}
  const Tn = (ctx && ctx.Town) || (typeof window !== "undefined" ? window.Town : null);
  if (Tn && typeof Tn.generate === "function") {
    const handled = Tn.generate(ctx);
    if (handled) {
      // Greeters at gate: Town.generate should ensure one; allow module to add none if unnecessary
      if (typeof Tn.spawnGateGreeters === "function") {
        try { Tn.spawnGateGreeters(ctx, 0); } catch (_) {}
      }

      // Safety: if no NPCs ended up populated, force a minimal population so the town isn't empty
      try {
        if (!Array.isArray(ctx.npcs) || ctx.npcs.length === 0) {
          const TAI = ctx.TownAI || (typeof window !== "undefined" ? window.TownAI : null);
          if (TAI && typeof TAI.populateTown === "function") {
            TAI.populateTown(ctx);
          }
          // Ensure at least one greeter near the gate
          if (typeof Tn.spawnGateGreeters === "function") {
            Tn.spawnGateGreeters(ctx, 1);
          }
          // Rebuild occupancy to reflect newly added NPCs
          try {
            if (typeof rebuildOccupancy === "function") rebuildOccupancy(ctx);
            else if (ctx.TownRuntime && typeof ctx.TownRuntime.rebuildOccupancy === "function") ctx.TownRuntime.rebuildOccupancy(ctx);
          } catch (_) {}
        }
      } catch (_) {}

      // Spawn recruitable follower NPCs in the inn (if present) with a modest rarity gate.
      try {
        if (typeof spawnInnFollowerHires === "function") {
          let rfn = null;
          try {
            if (typeof ctx.rng === "function") rfn = ctx.rng;
            else if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function") {
              rfn = window.RNGUtils.getRng(undefined);
            }
          } catch (_) {}
          const roll = typeof rfn === "function" ? rfn() : Math.random();
          // ~25% chance per town generation when below cap.
          if (roll < 0.25) {
            spawnInnFollowerHires(ctx);
          }
        }
      } catch (_) {}

      // Post-gen refresh via StateSync
      try {
        const SS = ctx.StateSync || getMod(ctx, "StateSync");
        if (SS && typeof SS.applyAndRefresh === "function") {
          SS.applyAndRefresh(ctx, {});
        }
      } catch (_) {}
      return true;
    }
  }
  ctx.log && ctx.log("Town module missing; unable to generate town.", "warn");
  return false;
}

export function ensureSpawnClear(ctx) {
  const Tn = (ctx && ctx.Town) || (typeof window !== "undefined" ? window.Town : null);
  if (Tn && typeof Tn.ensureSpawnClear === "function") {
    Tn.ensureSpawnClear(ctx);
    return;
  }
  ctx.log && ctx.log("Town.ensureSpawnClear not available.", "warn");
}

export function spawnGateGreeters(ctx, count) {
  const Tn = (ctx && ctx.Town) || (typeof window !== "undefined" ? window.Town : null);
  if (Tn && typeof Tn.spawnGateGreeters === "function") {
    Tn.spawnGateGreeters(ctx, count);
    return;
  }
  ctx.log && ctx.log("Town.spawnGateGreeters not available.", "warn");
}

// Spawn a recruitable follower NPC inside the inn (tavern) when available.
// Uses FollowersRuntime to pick a follower archetype and marks the NPC as a
// hire candidate so bumping them opens the hire prompt. Offers are gated by
// follower caps, tavern presence, and a separate rarity roll performed by
// callers (TownRuntime.generate and TownState.load).


export function isFreeTownFloor(ctx, x, y) {
  try {
    if (ctx && ctx.Utils && typeof ctx.Utils.isFreeTownFloor === "function") {
      return !!ctx.Utils.isFreeTownFloor(ctx, x, y);
    }
  } catch (_) {}
  const U = (typeof window !== "undefined" ? window.Utils : null);
  if (U && typeof U.isFreeTownFloor === "function") {
    return !!U.isFreeTownFloor(ctx, x, y);
  }
  if (!ctx.inBounds(x, y)) return false;
  const t = ctx.map[y][x];
  if (t !== ctx.TILES.FLOOR && t !== ctx.TILES.DOOR) return false;
  if (x === ctx.player.x && y === ctx.player.y) return false;
  if (Array.isArray(ctx.npcs) && ctx.npcs.some(n => n && n.x === x && n.y === y)) return false;
  if (Array.isArray(ctx.townProps) && ctx.townProps.some(p => p && p.x === x && p.y === y)) return false;
  return true;
}

export function talk(ctx, bumpAtX = null, bumpAtY = null) {
  return talkImpl(ctx, bumpAtX, bumpAtY);
}

export function tryMoveTown(ctx, dx, dy) {
  if (!ctx || ctx.mode !== "town") return false;
  const nx = ctx.player.x + (dx | 0);
  const ny = ctx.player.y + (dy | 0);
  if (!ctx.inBounds(nx, ny)) return false;

  let npcBlocked = false;
  let occupant = null;
  try {
    if (ctx.occupancy && typeof ctx.occupancy.hasNPC === "function") {
      npcBlocked = !!ctx.occupancy.hasNPC(nx, ny);
    } else {
      npcBlocked = Array.isArray(ctx.npcs) && ctx.npcs.some(n => n && n.x === nx && n.y === ny);
    }
    if (npcBlocked && Array.isArray(ctx.npcs)) {
      occupant = ctx.npcs.find(n => n && n.x === nx && n.y === ny) || null;
    }
  } catch (_) {}

  // When upstairs overlay is active, ignore downstairs NPC blocking inside the inn footprint
  // BUT: if the occupant at the bump tile is the innkeeper, still treat it as a talk bump to open the shop UI.
  try {
    if (ctx.innUpstairsActive && ctx.tavern && ctx.tavern.building) {
      const b = ctx.tavern.building;
      const insideInn = (nx > b.x && nx < b.x + b.w - 1 && ny > b.y && ny < b.y + b.h - 1);
      if (insideInn) {
        const npcs = Array.isArray(ctx.npcs) ? ctx.npcs : [];
        if (!occupant) {
          try {
            occupant = npcs.find(n => n && n.x === nx && n.y === ny) || null;
          } catch (_) {}
        }
        const isInnKeeper = !!(occupant && occupant.isShopkeeper && occupant._shopRef && String(occupant._shopRef.type || "").toLowerCase() === "inn");
        if (isInnKeeper) {
          // Open shop UI via talk even when overlay is active
          if (typeof talk === "function") {
            talk(ctx, nx, ny);
          }
          return true;
        }
        // Otherwise, allow walking through downstairs NPCs while upstairs overlay is active
        npcBlocked = false;
      }
    }
  } catch (_) {}

  // If bumping a hostile town NPC (currently bandits) during a town combat event, perform a full melee attack
  // using the shared Combat.playerAttackEnemy logic instead of simple flat damage.
  const isBanditTarget = !!(occupant && occupant.isBandit && !occupant._dead);
  const banditEventActive = !!(
    (ctx._townBanditEvent && ctx._townBanditEvent.active) ||
    (occupant && occupant._banditEvent)
  );
  if (npcBlocked && isBanditTarget && banditEventActive) {
    const C =
      (ctx && ctx.Combat) ||
      getMod(ctx, "Combat") ||
      (typeof window !== "undefined" ? window.Combat : null);

    if (C && typeof C.playerAttackEnemy === "function") {
      const enemyRef = occupant;
      const oldOnEnemyDied = ctx.onEnemyDied;
      try {
        // In town combat, killing a bandit should remove the NPC instead of using DungeonRuntime.killEnemy.
        ctx.onEnemyDied = function (enemy) {
          try {
            if (enemy === enemyRef) {
              enemyRef._dead = true;
            } else if (typeof oldOnEnemyDied === "function") {
              oldOnEnemyDied(enemy);
            }
          } catch (_) {}
        };
      } catch (_) {}

      try {
        C.playerAttackEnemy(ctx, enemyRef);
      } catch (_) {}

      // Restore original handler
      try {
        ctx.onEnemyDied = oldOnEnemyDied;
      } catch (_) {}

      // Rebuild occupancy if the bandit died
      try {
        if (enemyRef._dead) {
          rebuildOccupancy(ctx);
        }
      } catch (_) {}

      try { ctx.turn && ctx.turn(); } catch (_) {}
      return true;
    }

    // Fallback: simple town melee if Combat module is unavailable.
    let atk = 4;
    try {
      if (typeof ctx.getPlayerAttack === "function") {
        const v = ctx.getPlayerAttack();
        if (typeof v === "number" && v > 0) atk = v;
      }
    } catch (_) {}
    let mult = 1.0;
    try {
      if (typeof ctx.rng === "function") {
        mult = 0.8 + ctx.rng() * 0.7; // 0.8–1.5x
      }
    } catch (_) {}
    const dmg = Math.max(1, Math.round(atk * mult));
    const maxHp = typeof occupant.maxHp === "number" ? occupant.maxHp : 20;
    if (typeof occupant.hp !== "number") occupant.hp = maxHp;
    occupant.hp -= dmg;
    const label = occupant.name || (occupant.isBandit ? "Bandit" : "target");
    try {
      if (occupant.hp > 0) {
        ctx.log && ctx.log(`You hit ${label} for ${dmg}. (${Math.max(0, occupant.hp)} HP left)`, "combat");
      } else {
        occupant._dead = true;
        ctx.log && ctx.log(`You kill ${label}.`, "fatal");
      }
      if (typeof ctx.addBloodDecal === "function" && dmg > 0) {
        ctx.addBloodDecal(occupant.x, occupant.y, 1.2);
      }
    } catch (_) {}
    try { ctx.turn && ctx.turn(); } catch (_) {}
    return true;
  }

  if (npcBlocked) {
    if (typeof talk === "function") {
      talk(ctx, nx, ny);
    } else if (ctx.log) {
      ctx.log("Excuse me!", "info");
    }
    return true;
  }

  const walkable = (typeof ctx.isWalkable === "function") ? !!ctx.isWalkable(nx, ny) : true;
  if (walkable) {
    ctx.player.x = nx; ctx.player.y = ny;
    try {
      const SS = ctx.StateSync || getMod(ctx, "StateSync");
      if (SS && typeof SS.applyAndRefresh === "function") {
        SS.applyAndRefresh(ctx, {});
      }
    } catch (_) {}
    try { ctx.turn && ctx.turn(); } catch (_) {}
    return true;
  }
  return false;
}

export function returnToWorldIfAtGate(ctx) {
  if (!ctx || ctx.mode !== "town" || !ctx.world) return false;
  const atGate = !!(ctx.townExitAt && ctx.player.x === ctx.townExitAt.x && ctx.player.y === ctx.townExitAt.y);
  if (!atGate) return false;

  // Apply leave to overworld
  applyLeaveSync(ctx);

  return true;
}

export function applyLeaveSync(ctx) {
  if (!ctx || !ctx.world) return false;

  // Sync any follower/ally state before persisting and leaving town.
  try {
    syncFollowersFromTown(ctx);
  } catch (_) {}

  // End any forced Market Day event before saving town state so temporary
  // shops and vendor flags do not persist across visits.
  try {
    const God =
      ctx.God ||
      getMod(ctx, "God") ||
      (typeof window !== "undefined" ? window.God : null);
    if (God && typeof God.endMarketDayInTown === "function") {
      God.endMarketDayInTown(ctx);
    }
  } catch (_) {}

  // Persist current town state (map + visibility + entities) before leaving
  try {
    const TS = ctx.TownState || (typeof window !== "undefined" ? window.TownState : null);
    if (TS && typeof TS.save === "function") TS.save(ctx);
  } catch (_) {}

  // Switch mode and restore overworld map
  ctx.mode = "world";
  ctx.map = ctx.world.map;

  // Restore world fog-of-war arrays so minimap remembers explored areas
  try {
    if (ctx.world && ctx.world.seenRef && Array.isArray(ctx.world.seenRef)) ctx.seen = ctx.world.seenRef;
    if (ctx.world && ctx.world.visibleRef && Array.isArray(ctx.world.visibleRef)) ctx.visible = ctx.world.visibleRef;
  } catch (_) {}

  // Restore world position if available (convert absolute world coords -> local window indices)
  try {
    if (ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number" && typeof ctx.worldReturnPos.y === "number") {
      const WR = ctx.WorldRuntime || (typeof window !== "undefined" ? window.WorldRuntime : null);
      const rx = ctx.worldReturnPos.x | 0;
      const ry = ctx.worldReturnPos.y | 0;
      // Ensure the return position is inside the current window
      if (WR && typeof WR.ensureInBounds === "function") {
        // Suspend player shifting during expansion to avoid camera/position snaps
        ctx._suspendExpandShift = true;
        try {
          // Convert to local indices to test
          let lx = rx - ctx.world.originX;
          let ly = ry - ctx.world.originY;
          WR.ensureInBounds(ctx, lx, ly, 32);
        } finally {
          ctx._suspendExpandShift = false;
        }
        // Recompute after potential expansion shifts
        const lx2 = rx - ctx.world.originX;
        const ly2 = ry - ctx.world.originY;
        ctx.player.x = lx2;
        ctx.player.y = ly2;
      } else {
        // Fallback: clamp
        const lx = rx - ctx.world.originX;
        const ly = ry - ctx.world.originY;
        ctx.player.x = Math.max(0, Math.min((ctx.map[0]?.length || 1) - 1, lx));
        ctx.player.y = Math.max(0, Math.min((ctx.map.length || 1) - 1, ly));
      }
    }
  } catch (_) {}

  // Clear exit anchors
  try {
    ctx.townExitAt = null;
    ctx.dungeonExitAt = null;
    ctx.dungeon = ctx.dungeonInfo = null;
  } catch (_) {}

  // Hide UI elements (Quest Board and similar town-only modals)
  try {
    const UB = ctx.UIBridge || (typeof window !== "undefined" ? window.UIBridge : null);
    if (UB && typeof UB.hideQuestBoard === "function") UB.hideQuestBoard(ctx);
  } catch (_) {}

  // Refresh via StateSync
  try {
    const SS = ctx.StateSync || getMod(ctx, "StateSync");
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    }
  } catch (_) {}
  try { ctx.log && ctx.log("You return to the overworld.", "info"); } catch (_) {}

  return true;
}

// Explicit occupancy rebuild helper for callers that mutate town entities outside tick cadence.
export function rebuildOccupancy(ctx) {
  try {
    const OF = ctx.OccupancyFacade || (typeof window !== "undefined" ? window.OccupancyFacade : null);
    if (OF && typeof OF.rebuild === "function") {
      OF.rebuild(ctx);
      return true;
    }
  } catch (_) {}
  return false;
}

/**
 * Start a special caravan ambush encounter when the player chooses to attack a caravan
 * from inside town. The caravan master and their guards are represented as enemies,
 * and a broken caravan with a lootable chest appears on a small road map.
 */
function startCaravanAmbushEncounter(ctx, npc) {
  try {
    // Close any confirm dialog before switching modes
    try {
      const UIO = ctx.UIOrchestration || (typeof window !== "undefined" ? window.UIOrchestration : null);
      if (UIO && typeof UIO.cancelConfirm === "function") UIO.cancelConfirm(ctx);
    } catch (_) {}

    // Remove the caravan merchant and their shop from town so they don't persist after the attack.
    try {
      if (Array.isArray(ctx.npcs)) {
        const idx = ctx.npcs.indexOf(npc);
        if (idx !== -1) ctx.npcs.splice(idx, 1);
      }
      if (Array.isArray(ctx.shops)) {
        for (let i = ctx.shops.length - 1; i >= 0; i--) {
          const s = ctx.shops[i];
          if (s && s.type === "caravan") ctx.shops.splice(i, 1);
        }
      }
      // Mark any parked caravan at this town as no longer atTown so the overworld logic can move/retire it.
      try {
        const world = ctx.world;
        if (world && Array.isArray(world.caravans) && ctx.worldReturnPos) {
          const wx = ctx.worldReturnPos.x | 0;
          const wy = ctx.worldReturnPos.y | 0;
          for (const cv of world.caravans) {
            if (!cv) continue;
            if ((cv.x | 0) === wx && (cv.y | 0) === wy && cv.atTown) {
              cv.atTown = false;
              cv.dwellUntil = 0;
              cv.ambushed = true;
            }
          }
        }
      } catch (_) {}
      try { rebuildOccupancy(ctx); } catch (_) {}
    } catch (_) {}

    const template = {
      id: "caravan_ambush",
      name: "Caravan Ambush",
      map: { w: 26, h: 16, generator: "caravan_road" },
      groups: [
        { faction: "guard", count: { min: 3, max: 4 }, type: "guard" },
        { faction: "guard", count: { min: 2, max: 3 }, type: "guard_elite" }
      ],
      objective: { type: "reachExit" },
      difficulty: 4
    };

    const biome = "GRASS";
    let ok = false;
    try {
      const GA = ctx.GameAPI || getMod(ctx, "GameAPI") || (typeof window !== "undefined" ? window.GameAPI : null);
      if (GA && typeof GA.enterEncounter === "function") {
        ok = !!GA.enterEncounter(template, biome, template.difficulty);
      } else if (typeof ctx.enterEncounter === "function") {
        ok = !!ctx.enterEncounter(template, biome);
      }
    } catch (_) {}

    if (!ok && ctx.log) {
      ctx.log("Failed to start caravan ambush encounter.", "warn");
    } else if (ok && ctx.log) {
      ctx.log("You ambush the caravan outside the town!", "notice");
    }
  } catch (_) {}
}

if (typeof window !== "undefined") {
  window.TownRuntime = {
    generate,
    ensureSpawnClear,
    spawnGateGreeters,
    isFreeTownFloor,
    talk,
    tryMoveTown,
    tick,
    returnToWorldIfAtGate,
    applyLeaveSync,
    rebuildOccupancy,
    startBanditsAtGateEvent,
    spawnInnFollowerHires,
  };
}

/**
 * If a Market Day was started via GOD panel (manually or by weekly auto-start),
 * automatically end it once the in-game day index changes so the event lasts
 * exactly one day.
 */
function maybeEndMarketDay(ctx) {
  try {
    if (!ctx || ctx.mode !== "town") return;
    if (!ctx._forceMarketDay) return;

    const t = ctx.time;
    if (!t || typeof t.turnCounter !== "number" || typeof t.cycleTurns !== "number") return;

    const tc = t.turnCounter | 0;
    let cyc = t.cycleTurns | 0;
    if (!cyc || cyc <= 0) cyc = 360;
    const dayIdx = Math.floor(tc / Math.max(1, cyc));
    const forceDay =
      typeof ctx._forceMarketDayDayIdx === "number" ? ctx._forceMarketDayDayIdx : null;

    if (forceDay != null && dayIdx !== forceDay) {
      const God =
        ctx.God ||
        getMod(ctx, "God") ||
        (typeof window !== "undefined" ? window.God : null);
      if (God && typeof God.endMarketDayInTown === "function") {
        God.endMarketDayInTown(ctx);
      } else {
        ctx._forceMarketDay = false;
        try {
          ctx._forceMarketDayDayIdx = undefined;
        } catch (_) {}
      }
    }
  } catch (_) {}
}

/**
 * Automatically start a Market Day event once per in-game week when the player
 * is in a town/harbor/castle on the designated Market Day.
 */
function maybeAutoStartMarketDay(ctx) {
  try {
    if (!ctx || ctx.mode !== "town") return;
    const t = ctx.time;
    if (!t || typeof t.turnCounter !== "number" || typeof t.cycleTurns !== "number") return;

    const tc = t.turnCounter | 0;
    let cyc = t.cycleTurns | 0;
    if (!cyc || cyc <= 0) cyc = 360;
    const dayIdx = Math.floor(tc / Math.max(1, cyc));

    // Weekly Market Day rule: every 7th day (0,7,14,...) is a candidate.
    if ((dayIdx % 7) !== 0) return;

    // Only apply to supported town kinds (towns, harbor towns, castles).
    const kind = String(ctx.townKind || "town").toLowerCase();
    if (kind !== "town" && kind !== "port" && kind !== "castle") return;

    // If a Market Day is already active for this day, do not start again.
    if (ctx._forceMarketDay === true &&
        typeof ctx._forceMarketDayDayIdx === "number" &&
        ctx._forceMarketDayDayIdx === dayIdx) {
      return;
    }

    const God =
      ctx.God ||
      getMod(ctx, "God") ||
      (typeof window !== "undefined" ? window.God : null);
    if (God && typeof God.startMarketDayInTown === "function") {
      God.startMarketDayInTown(ctx);
    }
  } catch (_) {}
}

// Back-compat: tick implementation (retained)
export function tick(ctx) {
  if (!ctx || ctx.mode !== "town") return false;

  // End Market Day when the day index changes. Auto-start has been disabled to
  // avoid noisy repeated Market Day starts when entering towns; Market Day can
  // still be triggered explicitly via GOD panel.
  try {
    maybeEndMarketDay(ctx);
  } catch (_) {}
  // try {
  //   maybeAutoStartMarketDay(ctx);
  // } catch (_) {}

  // Wild Seppo (travelling merchant) arrival/departure
  tickSeppo(ctx);

  // Drive NPC behavior
  try {
    const TAI = ctx.TownAI || (typeof window !== "undefined" ? window.TownAI : null);
    if (TAI && typeof TAI.townNPCsAct === "function") {
      let t0 = null;
      try {
        if (typeof performance !== "undefined" && performance && typeof performance.now === "function") {
          t0 = performance.now();
        }
      } catch (_) {}
      TAI.townNPCsAct(ctx);
      if (t0 != null) {
        try {
          const dt = performance.now() - t0;
          ctx._perfTownAIAccum = (ctx._perfTownAIAccum || 0) + dt;
          ctx._perfTownAICount = (ctx._perfTownAICount || 0) + 1;
        } catch (_) {}
      }
    }
  } catch (_) {}

  // Simple follower NPC behavior: stay near the player in town, unless set to wait.
  tickTownFollowers(ctx);

  // Rebuild occupancy every other turn to avoid ghost-blocking after NPC bursts
  try {
    const stride = 2;
    const t = (ctx.time && typeof ctx.time.turnCounter === "number") ? (ctx.time.turnCounter | 0) : 0;
    if ((t % stride) === 0) {
      const OF = ctx.OccupancyFacade || (typeof window !== "undefined" ? window.OccupancyFacade : null);
      if (OF && typeof OF.rebuild === "function") OF.rebuild(ctx);
    }
  } catch (_) {}

  // Visual: fade blood decals over time in town mode, matching dungeon/region behavior
  try {
    const DC =
      (ctx && ctx.Decals) ||
      getMod(ctx, "Decals") ||
      (typeof window !== "undefined" ? window.Decals : null);
    if (DC && typeof DC.tick === "function") {
      DC.tick(ctx);
    } else if (Array.isArray(ctx.decals) && ctx.decals.length) {
      for (let i = 0; i < ctx.decals.length; i++) {
        ctx.decals[i].a *= 0.92;
      }
      ctx.decals = ctx.decals.filter(d => d.a > 0.04);
    }
  } catch (_) {}

  // Clamp corpse list length similar to dungeon tick so town combat can't grow it unbounded
  try {
    if (Array.isArray(ctx.corpses) && ctx.corpses.length > 50) {
      ctx.corpses = ctx.corpses.slice(-50);
    }
  } catch (_) {}

  return true;
}