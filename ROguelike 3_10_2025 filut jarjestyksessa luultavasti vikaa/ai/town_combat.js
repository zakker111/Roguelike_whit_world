/**
 * Town combat helpers:
 *  - dist1(ax, ay, bx, by)
 *  - nearestBandit(ctx, from)
 *  - nearestCivilian(ctx, from)
 *  - applyHit(ctx, attacker, defender, baseMin, baseMax)
 *  - townNpcAttack(ctx, attacker, defender)
 *  - banditAttackPlayer(ctx, attacker)
 *  - removeDeadNPCs(ctx)
 *
 * These mirror dungeon/encounter combat behavior but are tuned for town use.
 */

import { getRNGUtils, getMod } from "../utils/access.js";
import { trackHitAndMaybeApplySeenLife } from "../entities/item_buffs.js";

// Local RNG helper (mirrors rngFor in town_ai.js)
function rngFor(ctx) {
  try {
    const RU = getRNGUtils(ctx);
    if (RU && typeof RU.getRng === "function") {
      return RU.getRng(typeof ctx.rng === "function" ? ctx.rng : undefined);
    }
  } catch (_) {}
  if (typeof ctx.rng === "function") return ctx.rng;
  return () => 0.5;
}

function dist1(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function nearestBandit(ctx, from) {
  let best = null;
  let bestD = Infinity;
  const list = Array.isArray(ctx.npcs) ? ctx.npcs : [];
  for (const n of list) {
    if (!n || !n.isBandit || n._dead) continue;
    const d = dist1(from.x, from.y, n.x, n.y);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

function nearestCivilian(ctx, from) {
  let best = null;
  let bestD = Infinity;
  const list = Array.isArray(ctx.npcs) ? ctx.npcs : [];
  for (const n of list) {
    if (!n || n._dead) continue;
    if (n.isGuard || n.isBandit || n.isPet) continue;
    const d = dist1(from.x, from.y, n.x, n.y);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

function applyHit(ctx, attacker, defender, baseMin, baseMax) {
  if (!defender) return;
  const r = rngFor({ rng: (defender && defender.rng) || ctx.rng || (() => 0.5) });
  const dmg = baseMin + Math.floor(r() * (baseMax - baseMin + 1));
  const maxHp = typeof defender.maxHp === "number" ? defender.maxHp : 20;
  if (typeof defender.hp !== "number") defender.hp = maxHp;
  defender.hp -= dmg;
  const nameA = attacker && attacker.name ? attacker.name : "Someone";
  const nameD = defender && defender.name ? defender.name : "someone";
  try {
    if (defender.hp > 0) {
      ctx.log && ctx.log(`${nameA} hits ${nameD} for ${dmg}. (${Math.max(0, defender.hp)} HP left)`, "combat");
    } else {
      defender._dead = true;
      ctx.log && ctx.log(`${nameA} kills ${nameD}.`, "fatal");
    }
  } catch (_) {}
}

// NPC vs NPC town combat: guards and bandits use a shared damage pipeline that mirrors
// dungeon/encounter enemy-vs-enemy attacks (hit locations, block, crits, scaling).
function townNpcAttack(ctx, attacker, defender) {
  if (!attacker || !defender || defender._dead) return;
  const rnd = rngFor(ctx);

  // Hit location
  let loc = { part: "torso", mult: 1.0, blockMod: 1.0, critBonus: 0.0 };
  try {
    if (typeof ctx.rollHitLocation === "function") {
      loc = ctx.rollHitLocation();
    }
  } catch (_) {}

  // Block chance based on defender type/faction
  let blockChance = 0;
  try {
    if (typeof ctx.getEnemyBlockChance === "function") {
      blockChance = ctx.getEnemyBlockChance(defender, loc);
    }
  } catch (_) {}

  try {
    if (rnd() < blockChance) {
      const nameA = attacker && (attacker.name || attacker.type) ? (attacker.name || attacker.type) : "Someone";
      const nameD = defender && (defender.name || defender.type) ? (defender.name || defender.type) : "someone";
      ctx.log &&
        ctx.log(
          `${nameD} blocks ${nameA}'s attack to the ${loc.part}.`,
          "block",
          { category: "Combat", side: "npc" }
        );
      return;
    }
  } catch (_) {}

  // Damage calculation: atk * enemyDamageMultiplier(level) * per-enemy scale * hit-location multiplier.
  const atk = typeof attacker.atk === "number" && attacker.atk > 0 ? attacker.atk : 2;
  const level = typeof attacker.level === "number" && attacker.level > 0 ? attacker.level : 1;
  const typeScale = typeof attacker.damageScale === "number" && attacker.damageScale > 0 ? attacker.damageScale : 1.0;
  let mult = 1 + 0.15 * Math.max(0, level - 1);
  try {
    if (typeof ctx.enemyDamageMultiplier === "function") {
      mult = ctx.enemyDamageMultiplier(level);
    }
  } catch (_) {}
  let raw = atk * mult * typeScale * (loc.mult || 1.0);

  // Crits
  let isCrit = false;
  try {
    let critChance = 0.10 + (loc.critBonus || 0);
    critChance = Math.max(0, Math.min(0.5, critChance));
    if (rnd() < critChance) {
      isCrit = true;
      let cMult = 1.8;
      if (typeof ctx.critMultiplier === "function") {
        cMult = ctx.critMultiplier();
      } else {
        cMult = 1.6 + rnd() * 0.4;
      }
      raw *= cMult;
    }
  } catch (_) {}

  // No DR for NPC vs NPC
  let dmg = raw;
  try {
    if (ctx.utils && typeof ctx.utils.round1 === "function") {
      dmg = ctx.utils.round1(dmg);
    } else {
      dmg = Math.round(dmg * 10) / 10;
    }
  } catch (_) {}
  if (!(dmg > 0)) dmg = 0.1;

  const maxHp = typeof defender.maxHp === "number"
    ? defender.maxHp
    : (typeof defender.hp === "number" ? Math.max(1, defender.hp) : 20);
  if (typeof defender.hp !== "number") defender.hp = maxHp;
  defender.hp -= dmg;

  // Visual blood for non-ethereal targets
  try {
    const ttype = String(defender.type || defender.name || "");
    const ethereal = /ghost|spirit|wraith|skeleton/i.test(ttype);
    if (!ethereal && typeof ctx.addBloodDecal === "function" && dmg > 0) {
      ctx.addBloodDecal(defender.x, defender.y, isCrit ? 1.2 : 0.9);
    }
  } catch (_) {}

  // Logging
  const nameA = attacker && (attacker.name || attacker.type) ? (attacker.name || attacker.type) : "Someone";
  const nameD = defender && (defender.name || defender.type) ? (defender.name || defender.type) : "someone";
  try {
    if (defender.hp > 0) {
      if (isCrit) {
        ctx.log &&
          ctx.log(
            `Critical! ${nameA} hits ${nameD}'s ${loc.part} for ${dmg}.`,
            "crit",
            { category: "Combat", side: "npc" }
          );
      } else {
        ctx.log &&
          ctx.log(
            `${nameA} hits ${nameD}'s ${loc.part} for ${dmg}.`,
            "combat",
            { category: "Combat", side: "npc" }
          );
      }
    } else {
      defender._dead = true;
      ctx.log &&
        ctx.log(
          `${nameA} kills ${nameD}.`,
          "fatal",
          { category: "Combat", side: "npc" }
        );
    }
  } catch (_) {}

  // Follower-specific flavor for town combat criticals.
  try {
    const FF = (typeof window !== "undefined" ? window.FollowersFlavor : null);
    if (FF && typeof FF.logFollowerCritTaken === "function" && defender && defender._isFollower && isCrit) {
      FF.logFollowerCritTaken(ctx, defender, loc, dmg);
    }
  } catch (_) {}
}

// Bandit attack against the player using the same damage model as dungeon/encounter enemies.
function banditAttackPlayer(ctx, attacker) {
  if (!ctx || !ctx.player || !attacker) return;
  const player = ctx.player;
  const rnd = rngFor(ctx);
  const U = ctx && ctx.utils ? ctx.utils : null;

  const randFloat = (min, max, dec = 1) => {
    try {
      if (U && typeof U.randFloat === "function") {
        return U.randFloat(min, max, dec);
      }
    } catch (_) {}
    const r = typeof rnd === "function" ? rnd() : 0.5;
    const v = min + r * (max - min);
    const p = Math.pow(10, dec);
    return Math.round(v * p) / p;
  };

  // Hit location
  let loc = { part: "torso", mult: 1.0, blockMod: 1.0, critBonus: 0.0 };
  try {
    if (typeof ctx.rollHitLocation === "function") {
      loc = ctx.rollHitLocation();
    }
  } catch (_) {}

  // Block
  let blockChance = 0;
  try {
    if (typeof ctx.getPlayerBlockChance === "function") {
      blockChance = ctx.getPlayerBlockChance(loc);
    }
  } catch (_) {}

  try {
    if (rnd() < blockChance) {
      const name = (attacker && (attacker.name || attacker.type)) || "bandit";
      ctx.log &&
        ctx.log(
          `You block ${name}'s attack to your ${loc.part}.`,
          "block",
          { category: "Combat", side: "player" }
        );
      try {
        if (ctx.Flavor && typeof ctx.Flavor.onBlock === "function") {
          ctx.Flavor.onBlock(ctx, {
            side: "player",
            attacker,
            defender: player,
            loc,
          });
        }
      } catch (_) {}
      try {
        if (typeof ctx.decayBlockingHands === "function") {
          ctx.decayBlockingHands();
        }
      } catch (_) {}
      try {
        if (typeof ctx.decayEquipped === "function") {
          ctx.decayEquipped("hands", randFloat(0.3, 1.0, 1));
        }
      } catch (_) {}
      return;
    }
  } catch (_) {}

  // Damage calculation
  const atk = typeof attacker.atk === "number" ? attacker.atk : 2;
  const level = typeof attacker.level === "number"
    ? attacker.level
    : (typeof player.level === "number" ? player.level : 1);
  const typeScale = typeof attacker.damageScale === "number" && attacker.damageScale > 0
    ? attacker.damageScale
    : 1.0;
  let mult = 1 + 0.15 * Math.max(0, level - 1);
  try {
    if (typeof ctx.enemyDamageMultiplier === "function") {
      mult = ctx.enemyDamageMultiplier(level);
    }
  } catch (_) {}
  let raw = atk * mult * typeScale * (loc.mult || 1);

  // Crits
  let isCrit = false;
  try {
    const critChance = Math.max(0, Math.min(0.5, 0.1 + (loc.critBonus || 0)));
    if (rnd() < critChance) {
      isCrit = true;
      let cMult = 1.8;
      try {
        if (typeof ctx.critMultiplier === "function") {
          cMult = ctx.critMultiplier(rnd);
        } else {
          cMult = 1.6 + rnd() * 0.4;
        }
      } catch (_) {}
      raw *= cMult;
    }
  } catch (_) {}

  let dmg = raw;
  try {
    if (typeof ctx.enemyDamageAfterDefense === "function") {
      dmg = ctx.enemyDamageAfterDefense(raw);
    }
  } catch (_) {}
  if (typeof dmg !== "number" || !(dmg > 0)) dmg = raw;

  try {
    if (U && typeof U.round1 === "function") {
      dmg = U.round1(dmg);
    } else {
      dmg = Math.round(dmg * 10) / 10;
    }
  } catch (_) {}

  player.hp -= dmg;

  // Blood decal
  try {
    if (typeof ctx.addBloodDecal === "function" && dmg > 0) {
      ctx.addBloodDecal(player.x, player.y, isCrit ? 1.4 : 1.0);
    }
  } catch (_) {}

  // Log hit
  try {
    const name = (attacker && (attacker.name || attacker.type)) || "bandit";
    if (isCrit) {
      ctx.log &&
        ctx.log(
          `Critical! ${name} hits your ${loc.part} for ${dmg}.`,
          "crit",
          { category: "Combat", side: "enemy" }
        );
    } else {
      ctx.log &&
        ctx.log(
          `${name} hits your ${loc.part} for ${dmg}.`,
          "info",
          { category: "Combat", side: "enemy" }
        );
    }
  } catch (_) {}

  // Status effects (daze/bleed) and flavor hook
  try {
    const ST = ctx.Status || (typeof window !== "undefined" ? window.Status : null);
    if (ST) {
      if (isCrit && loc.part === "head" && typeof ST.applyDazedToPlayer === "function") {
        const dur = 1 + Math.floor(rnd() * 2);
        try {
          ST.applyDazedToPlayer(ctx, dur);
        } catch (_) {}
      }
      if (isCrit && typeof ST.applyBleedToPlayer === "function") {
        try {
          ST.applyBleedToPlayer(ctx, 2);
        } catch (_) {}
      }
    }
    if (ctx.Flavor && typeof ctx.Flavor.logHit === "function") {
      ctx.Flavor.logHit(ctx, {
        attacker,
        loc,
        crit: isCrit,
        dmg,
      });
    }
  } catch (_) {}

  // Equipment decay by hit part
  try {
    if (typeof ctx.decayEquipped === "function") {
      const critWear = isCrit ? 1.6 : 1.0;
      let wear = 0.5;
      if (loc.part === "torso") wear = randFloat(0.8, 2.0, 1);
      else if (loc.part === "head") wear = randFloat(0.3, 1.0, 1);
      else if (loc.part === "legs") wear = randFloat(0.4, 1.3, 1);
      else if (loc.part === "hands") wear = randFloat(0.3, 1.0, 1);
      ctx.decayEquipped(loc.part, wear * critWear);
    }
  } catch (_) {}

  // Armor Seen Life buff: track per-slot hits and apply permanent buffs when threshold is reached.
  try {
    if (ctx && ctx.player && ctx.player.equipment) {
      const eq = ctx.player.equipment;
      const items = [];
      if (loc.part === "head" && eq.head) items.push(eq.head);
      else if (loc.part === "torso" && eq.torso) items.push(eq.torso);
      else if (loc.part === "legs" && eq.legs) items.push(eq.legs);
      else if (loc.part === "hands" && eq.hands) items.push(eq.hands);
      if (items.length) {
        const randF = (min, max, decimals = 1) => randFloat(min, max, decimals);
        for (let i = 0; i < items.length; i++) {
          trackHitAndMaybeApplySeenLife(ctx, items[i], { kind: "armor", randFloat: randF });
        }
      }
    }
  } catch (_) {}

  // Persistent injury tracking
  try {
    if (player) {
      if (!Array.isArray(player.injuries)) player.injuries = [];
      const injuries = player.injuries;
      const addInjury = (name, opts) => {
        if (!name) return;
        const exists = injuries.some(it =>
          typeof it === "string" ? it === name : it && it.name === name
        );
        if (exists) return;
        const healable = !opts || opts.healable !== false;
        const durationTurns = healable
          ? Math.max(10, (opts && opts.durationTurns) | 0)
          : 0;
        injuries.push({ name, healable, durationTurns });
        if (injuries.length > 24) injuries.splice(0, injuries.length - 24);
        try {
          ctx.log && ctx.log(`You suffer ${name}.`, "warn");
        } catch (_) {}
      };
      const rInj = rnd();
      if (loc.part === "hands") {
        if (isCrit && rInj < 0.08) addInjury("missing finger", { healable: false, durationTurns: 0 });
        else if (rInj < 0.2) addInjury("bruised knuckles", { healable: true, durationTurns: 30 });
      } else if (loc.part === "legs") {
        if (isCrit && rInj < 0.1) addInjury("sprained ankle", { healable: true, durationTurns: 80 });
        else if (rInj < 0.25) addInjury("bruised leg", { healable: true, durationTurns: 40 });
      } else if (loc.part === "head") {
        if (isCrit && rInj < 0.12) addInjury("facial scar", { healable: false, durationTurns: 0 });
        else if (rInj < 0.2) addInjury("black eye", { healable: true, durationTurns: 60 });
      } else if (loc.part === "torso") {
        if (isCrit && rInj < 0.1) addInjury("deep scar", { healable: false, durationTurns: 0 });
        else if (rInj < 0.22) addInjury("rib bruise", { healable: true, durationTurns: 50 });
      }
    }
  } catch (_) {}

  // Player death handling
  if (player.hp <= 0) {
    player.hp = 0;
    try {
      if (typeof ctx.onPlayerDied === "function") {
        ctx.onPlayerDied();
      }
    } catch (_) {}
  }
}

function removeDeadNPCs(ctx) {
  if (!Array.isArray(ctx.npcs)) return;
  let changed = false;

  // Ensure corpses array exists so town deaths can leave bodies behind.
  try {
    if (!Array.isArray(ctx.corpses)) {
      ctx.corpses = [];
    }
  } catch (_) {}

  for (let i = ctx.npcs.length - 1; i >= 0; i--) {
    const n = ctx.npcs[i];
    if (n && n._dead) {
      // For town bandit events, leave a corpse marker with real loot when bandits or guards die.
      try {
        if (ctx.mode === "town" && (n.isBandit || n.isGuard)) {
          ctx.corpses = Array.isArray(ctx.corpses) ? ctx.corpses : [];
          const already = ctx.corpses.some(c => c && c.x === n.x && c.y === n.y);
          if (!already) {
            let loot = [];
            try {
              const L =
                ctx.Loot ||
                getMod(ctx, "Loot") ||
                (typeof window !== "undefined" ? window.Loot : null);
              if (L && typeof L.generate === "function") {
                loot = L.generate(ctx, n) || [];
              }
            } catch (_) {
              loot = [];
            }
            ctx.corpses.push({
              x: n.x,
              y: n.y,
              kind: n.isGuard ? "guard_corpse" : "corpse",
              loot,
              looted: loot.length === 0,
              meta: null,
            });
          }
        }
      } catch (_) {}

      ctx.npcs.splice(i, 1);
      changed = true;
    }
  }
  if (changed) {
    try {
      const OF = ctx.OccupancyFacade || (typeof window !== "undefined" ? window.OccupancyFacade : null);
      if (OF && typeof OF.rebuild === "function") OF.rebuild(ctx);
    } catch (_) {}
  }
}

export {
  dist1,
  nearestBandit,
  nearestCivilian,
  applyHit,
  townNpcAttack,
  banditAttackPlayer,
  removeDeadNPCs,
};