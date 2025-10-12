/**
 * Combat Orchestrator: handles the full player-attack-on-enemy flow.
 *
 * Exports:
 * - playerAttackEnemy(ctx, enemy, { forcedCritPart, alwaysCrit } = {})
 *
 * Responsibilities:
 * - Hit location roll (optionally forced by GOD)
 * - Block chance and block log
 * - Damage, crit roll, decals
 * - Status effects (limp on legs crit, bleed on crit)
 * - Death handling via ctx.onEnemyDied
 * - Equipment decay for hands
 */

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function playerAttackEnemy(ctx, enemy, { forcedCritPart = "", alwaysCrit = false } = {}) {
  // Hit location
  let loc = (typeof ctx.rollHitLocation === "function") ? ctx.rollHitLocation() : { part: "torso", mult: 1.0, blockMod: 1.0, critBonus: 0.0 };
  if (alwaysCrit && forcedCritPart) {
    const profiles = {
      torso: { part: "torso", mult: 1.0, blockMod: 1.0, critBonus: 0.00 },
      head:  { part: "head",  mult: 1.1, blockMod: 0.85, critBonus: 0.15 },
      hands: { part: "hands", mult: 0.9, blockMod: 0.75, critBonus: -0.05 },
      legs:  { part: "legs",  mult: 0.95, blockMod: 0.75, critBonus: -0.03 },
    };
    if (profiles[forcedCritPart]) loc = profiles[forcedCritPart];
  }

  // Block
  const blocked = (typeof ctx.getEnemyBlockChance === "function") && (ctx.rng() < ctx.getEnemyBlockChance(enemy, loc));
  if (blocked) {
    ctx.log(`${capitalize(enemy.type || "enemy")} blocks your attack to the ${loc.part}.`, "block");
    // Decay on block (lighter)
    if (typeof ctx.decayAttackHands === "function") ctx.decayAttackHands(true);
    if (typeof ctx.randFloat === "function" && typeof ctx.decayEquipped === "function") {
      ctx.decayEquipped("hands", ctx.randFloat(0.2, 0.7, 1));
    }
    return { attacked: true, blocked: true, crit: false, dmg: 0, killed: false, loc };
  }

  // Damage + crit
  let dmg = (typeof ctx.getPlayerAttack === "function") ? ctx.getPlayerAttack() * (loc.mult || 1.0) : 1.0;
  let isCrit = false;
  const critChance = Math.max(0, Math.min(0.6, 0.12 + (loc.critBonus || 0)));
  if (alwaysCrit || ctx.rng() < critChance) {
    isCrit = true;
    if (typeof ctx.critMultiplier === "function") dmg *= ctx.critMultiplier();
  }
  dmg = Math.max(0, (typeof ctx.round1 === "function") ? ctx.round1(dmg) : Math.round(dmg * 10) / 10);
  enemy.hp -= dmg;

  // Decals
  if (dmg > 0 && typeof ctx.addBloodDecal === "function") {
    ctx.addBloodDecal(enemy.x, enemy.y, isCrit ? 1.6 : 1.0);
  }

  // Logs + Flavor
  if (isCrit) ctx.log(`Critical! You hit the ${enemy.type || "enemy"}'s ${loc.part} for ${dmg}.`, "crit");
  else ctx.log(`You hit the ${enemy.type || "enemy"}'s ${loc.part} for ${dmg}.`);
  try {
    if (ctx.Flavor && typeof ctx.Flavor.logPlayerHit === "function") {
      ctx.Flavor.logPlayerHit(ctx, { target: enemy, loc, crit: isCrit, dmg });
    }
  } catch (_) {}

  // Status effects
  try {
    const ST = ctx.Status || (typeof window !== "undefined" ? window.Status : null);
    if (isCrit && loc.part === "legs" && enemy.hp > 0) {
      if (ST && typeof ST.applyLimpToEnemy === "function") ST.applyLimpToEnemy(ctx, enemy, 2);
      else {
        enemy.immobileTurns = Math.max(enemy.immobileTurns || 0, 2);
        ctx.log(`${capitalize(enemy.type || "enemy")} staggers; its legs are crippled and it can't move for 2 turns.`, "notice");
      }
    }
    if (isCrit && enemy.hp > 0 && ST && typeof ST.applyBleedToEnemy === "function") {
      ST.applyBleedToEnemy(ctx, enemy, 2);
    }
  } catch (_) {}

  const killed = (enemy.hp <= 0);
  if (killed) {
    // Let higher-level runtime handle corpse/loot/xp via ctx.onEnemyDied
    if (typeof ctx.onEnemyDied === "function") ctx.onEnemyDied(enemy);
  }

  // Decay hands after attack
  if (typeof ctx.decayAttackHands === "function") ctx.decayAttackHands();
  if (typeof ctx.randFloat === "function" && typeof ctx.decayEquipped === "function") {
    ctx.decayEquipped("hands", ctx.randFloat(0.3, 1.0, 1));
  }

  return { attacked: true, blocked: false, crit: isCrit, dmg, killed, loc };
}