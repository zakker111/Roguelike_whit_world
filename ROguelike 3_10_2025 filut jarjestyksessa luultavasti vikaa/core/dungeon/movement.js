/**
 * Dungeon movement and combat (Phase 3 extraction): tryMoveDungeon.
 */
import { getMod } from "../../utils/access.js";
import { maybeEnterMountainPass } from "./transitions.js";

export function tryMoveDungeon(ctx, dx, dy) {
  if (!ctx || (ctx.mode !== "dungeon" && ctx.mode !== "encounter")) return false;
  const advanceTurn = (ctx.mode === "dungeon"); // in encounter, the orchestrator advances the turn after syncing

  // Dazed: skip action if dazedTurns > 0
  try {
    if (ctx.player && ctx.player.dazedTurns && ctx.player.dazedTurns > 0) {
      ctx.player.dazedTurns -= 1;
      ctx.log && ctx.log("You are dazed and lose your action this turn.", "warn");
      if (advanceTurn && ctx.turn) ctx.turn();
      return true;
    }
  } catch (_) {}

  const nx = ctx.player.x + (dx | 0);
  const ny = ctx.player.y + (dy | 0);
  if (!ctx.inBounds(nx, ny)) return false;

  // Special: stepping on a mountain-pass portal (if present) transfers to a dungeon across the mountain
  try {
    if (maybeEnterMountainPass(ctx, nx, ny)) return true;
  } catch (_) {}

  // Is there an enemy at target tile?
  let enemy = null;
  try {
    const enemies = Array.isArray(ctx.enemies) ? ctx.enemies : [];
    enemy = enemies.find(e => e && e.x === nx && e.y === ny) || null;
  } catch (_) { enemy = null; }

  if (enemy) {
    // Hit location
    const C = (ctx && ctx.Combat) || (typeof window !== "undefined" ? window.Combat : null);
    const rollLoc = (C && typeof C.rollHitLocation === "function")
      ? () => C.rollHitLocation(ctx.rng)
      : (typeof ctx.rollHitLocation === "function" ? () => ctx.rollHitLocation() : null);
    let loc = rollLoc ? rollLoc() : { part: "torso", mult: 1.0, blockMod: 1.0, critBonus: 0.00 };

    // GOD forced part (best-effort)
    try {
      const forcedPart = (typeof window !== "undefined" && typeof window.ALWAYS_CRIT_PART === "string")
        ? window.ALWAYS_CRIT_PART
        : (typeof localStorage !== "undefined" ? (localStorage.getItem("ALWAYS_CRIT_PART") || "") : "");
      if (forcedPart) {
        const profs = (C && C.profiles) ? C.profiles : {
          torso: { part: "torso", mult: 1.0, blockMod: 1.0, critBonus: 0.00 },
          head:  { part: "head",  mult: 1.1, blockMod: 0.85, critBonus: 0.15 },
          hands: { part: "hands", mult: 0.9, blockMod: 0.75, critBonus: -0.05 },
          legs:  { part: "legs",  mult: 0.95, blockMod: 0.75, critBonus: -0.03 },
        };
        if (profs[forcedPart]) loc = profs[forcedPart];
      }
    } catch (_) {}

    // Block chance
    const blockChance = (C && typeof C.getEnemyBlockChance === "function")
      ? C.getEnemyBlockChance(ctx, enemy, loc)
      : (typeof ctx.getEnemyBlockChance === "function" ? ctx.getEnemyBlockChance(enemy, loc) : 0);
    const RU = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
    const rBlockFn = (RU && typeof RU.getRng === "function")
      ? RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
      : ((typeof ctx.rng === "function") ? ctx.rng : null);
    const rBlock = (typeof rBlockFn === "function") ? rBlockFn() : 0.5;

    if (rBlock < blockChance) {
      try {
        const name = (enemy.type || "enemy");
        ctx.log && ctx.log(`${name.charAt(0).toUpperCase()}${name.slice(1)} blocks your attack to the ${loc.part}.`, "block", { category: "Combat", side: "player" });
      } catch (_) {}
      // Decay hands (light) on block
      try {
        const ED = (typeof window !== "undefined") ? window.EquipmentDecay : null;
        const twoHanded = !!(ctx.player.equipment && ctx.player.equipment.left && ctx.player.equipment.right && ctx.player.equipment.left === ctx.player.equipment.right && ctx.player.equipment.left.twoHanded);
        if (ED && typeof ED.decayAttackHands === "function") {
          ED.decayAttackHands(ctx.player, ctx.rng, { twoHanded, light: true }, { log: ctx.log, updateUI: ctx.updateUI, onInventoryChange: ctx.rerenderInventoryIfOpen });
        } else if (typeof ctx.decayEquipped === "function") {
          const rf = (typeof ctx.randFloat === "function") ? ctx.randFloat : ((min, max) => {
            try {
              const RUx = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
              if (RUx && typeof RUx.float === "function") {
                const rfnLocal = (typeof ctx.rng === "function") ? ctx.rng : undefined;
                return RUx.float(min, max, 6, rfnLocal);
              }
            } catch (_) {}
            if (typeof ctx.rng === "function") {
              const r = ctx.rng();
              return min + r * (max - min);
            }
            // Deterministic midpoint when RNG unavailable
            return (min + max) / 2;
          });
          ctx.decayEquipped("hands", rf(0.2, 0.7));
        }
      } catch (_) {}
      if (advanceTurn && ctx.turn) ctx.turn();
      return true;
    }

    // Damage calculation
    const S = (typeof window !== "undefined") ? window.Stats : null;
    const atk = (typeof ctx.getPlayerAttack === "function")
      ? ctx.getPlayerAttack()
      : (S && typeof S.getPlayerAttack === "function" ? S.getPlayerAttack(ctx) : 1);
    let dmg = (atk || 1) * (loc.mult || 1.0);
    let isCrit = false;
    const alwaysCrit = !!((typeof window !== "undefined" && typeof window.ALWAYS_CRIT === "boolean") ? window.ALWAYS_CRIT : false);
    const critChance = Math.max(0, Math.min(0.6, 0.12 + (loc.critBonus || 0)));
    const RUcrit = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
    const rfnCrit = (RUcrit && typeof RUcrit.getRng === "function")
      ? RUcrit.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
      : ((typeof ctx.rng === "function") ? ctx.rng : null);
    const rCrit = (typeof rfnCrit === "function") ? rfnCrit() : 0.5;
    const critMult = (C && typeof C.critMultiplier === "function")
      ? C.critMultiplier(rfnCrit || undefined)
      : (typeof ctx.critMultiplier === "function" ? ctx.critMultiplier(rfnCrit || undefined) : 1.8);
    if (alwaysCrit || rCrit < critChance) {
      isCrit = true;
      dmg *= critMult;
    }
    const round1 = (ctx.utils && typeof ctx.utils.round1 === "function") ? ctx.utils.round1 : ((n) => Math.round(n * 10) / 10);
    // Guarantee chip damage so fights always progress, even with very low attack values.
    dmg = Math.max(0.1, round1(dmg));
    enemy.hp -= dmg;

    // Visual: blood decal (skip ethereal foes)
    try {
      const t = String(enemy.type || "");
      const ethereal = /ghost|spirit|wraith|skeleton/i.test(t);
      if (!ethereal && typeof ctx.addBloodDecal === "function" && dmg > 0) ctx.addBloodDecal(enemy.x, enemy.y, isCrit ? 1.6 : 1.0);
    } catch (_) {}

    // Log
    try {
      const name = (enemy.type || "enemy");
      if (isCrit) ctx.log && ctx.log(`Critical! You hit the ${name}'s ${loc.part} for ${dmg}.`, "crit", { category: "Combat", side: "player" });
      else ctx.log && ctx.log(`You hit the ${name}'s ${loc.part} for ${dmg}.`, "info", { category: "Combat", side: "player" });
      if (ctx.Flavor && typeof ctx.Flavor.logPlayerHit === "function") ctx.Flavor.logPlayerHit(ctx, { target: enemy, loc, crit: isCrit, dmg });
      // Record last hit for death flavor
      try {
        const eq = ctx.player && ctx.player.equipment ? ctx.player.equipment : {};
        const weaponName = (eq.right && eq.right.name) ? eq.right.name
                     : (eq.left && eq.left.name) ? eq.left.name
                     : null;
        enemy._lastHit = { by: "player", part: loc.part, crit: isCrit, dmg, weapon: weaponName, via: weaponName ? `with ${weaponName}` : "melee" };
      } catch (_) {}
    } catch (_) {}

    // Status effects on crit
    try {
      const ST = (typeof window !== "undefined") ? window.Status : null;
      if (isCrit && loc.part === "legs" && enemy.hp > 0) {
        if (ST && typeof ST.applyLimpToEnemy === "function") ST.applyLimpToEnemy(ctx, enemy, 2);
        else { enemy.immobileTurns = Math.max(enemy.immobileTurns || 0, 2); ctx.log && ctx.log(`${(enemy.type || "enemy")[0].toUpperCase()}${(enemy.type || "enemy").slice(1)} staggers; its legs are crippled and it can't move for 2 turns.`, "notice"); }
      }
      if (isCrit && enemy.hp > 0) {
        // Skip bleed status for ethereal/undead foes
        const t = String(enemy.type || "");
        const ethereal = /ghost|spirit|wraith|skeleton/i.test(t);
        if (!ethereal && ST && typeof ST.applyBleedToEnemy === "function") ST.applyBleedToEnemy(ctx, enemy, 2);
      }
    } catch (_) {}

    // Death
    try {
      if (enemy.hp <= 0) {
        if (typeof ctx.onEnemyDied === "function") {
          ctx.onEnemyDied(enemy);
        } else {
          // Failsafe removal if the callback is missing
          try {
            // Minimal inline corpse + removal to avoid immortal enemies
            const loot = (ctx.Loot && typeof ctx.Loot.generate === "function") ? (ctx.Loot.generate(ctx, enemy) || []) : [];
            ctx.corpses = Array.isArray(ctx.corpses) ? ctx.corpses : [];
            ctx.corpses.push({ x: enemy.x, y: enemy.y, loot, looted: loot.length === 0 });
          } catch (_) {}
          try {
            if (Array.isArray(ctx.enemies)) ctx.enemies = ctx.enemies.filter(e => e !== enemy);
            if (ctx.occupancy && typeof ctx.occupancy.clearEnemy === "function") ctx.occupancy.clearEnemy(enemy.x, enemy.y);
          } catch (_) {}
        }
      }
    } catch (_) {}

    // Decay hands after attack
    try {
      const ED = (typeof window !== "undefined") ? window.EquipmentDecay : null;
      const twoHanded = !!(ctx.player.equipment && ctx.player.equipment.left && ctx.player.equipment.right && ctx.player.equipment.left === ctx.player.equipment.right && ctx.player.equipment.left.twoHanded);
      if (ED && typeof ED.decayAttackHands === "function") {
        ED.decayAttackHands(ctx.player, ctx.rng, { twoHanded }, { log: ctx.log, updateUI: ctx.updateUI, onInventoryChange: ctx.rerenderInventoryIfOpen });
      } else if (typeof ctx.decayEquipped === "function") {
        const rf = (typeof ctx.randFloat === "function") ? ctx.randFloat : ((min, max) => {
          try {
            const RUx = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
            if (RUx && typeof RUx.float === "function") {
              const rfnLocal = (typeof ctx.rng === "function") ? ctx.rng : undefined;
              return RUx.float(min, max, 6, rfnLocal);
            }
          } catch (_) {}
          // Deterministic midpoint when RNG unavailable
          return (min + max) / 2;
        });
        ctx.decayEquipped("hands", rf(0.3, 1.0));
      }
    } catch (_) {}

    if (advanceTurn && ctx.turn) ctx.turn();
    return true;
  }

  // Movement into empty tile
  try {
    const blockedByEnemy = Array.isArray(ctx.enemies) && ctx.enemies.some(e => e && e.x === nx && e.y === ny);
    const walkable = ctx.inBounds(nx, ny) && (ctx.map[ny][nx] === ctx.TILES.FLOOR || ctx.map[ny][nx] === ctx.TILES.DOOR || ctx.map[ny][nx] === ctx.TILES.STAIRS);
    if (walkable && !blockedByEnemy) {
      ctx.player.x = nx; ctx.player.y = ny;
      try {
        const SS = ctx.StateSync || getMod(ctx, "StateSync");
        if (SS && typeof SS.applyAndRefresh === "function") {
          SS.applyAndRefresh(ctx, {});
        }
      } catch (_) {}
      if (advanceTurn && ctx.turn) ctx.turn();
      return true;
    }
  } catch (_) {}

  return false;
}