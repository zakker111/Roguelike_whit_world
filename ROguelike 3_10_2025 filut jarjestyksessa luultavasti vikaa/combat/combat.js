/**
 * Combat module: shared calculations for block chance and damage after defense,
 * plus a standardized playerAttackEnemy to unify attacks across modes.
 *
 * Exports (ESM + window.Combat augmentation):
 * - getPlayerBlockChance(ctx, loc)
 * - getEnemyBlockChance(ctx, enemy, loc)
 * - enemyDamageAfterDefense(ctx, raw)
 * - enemyDamageMultiplier(level)  // small helper for consistency
 * - playerAttackEnemy(ctx, enemy) // full bump-attack flow used by dungeon/encounter/region
 *
 * Notes:
 * - Prefers helpers available on ctx (e.g., ctx.getPlayerAttack/Defense, ctx.utils.round1).
 * - Keeps logic aligned with existing game.js/dungeon flow for consistency.
 */

function round1(ctx, n) {
  if (ctx && ctx.utils && typeof ctx.utils.round1 === "function") return ctx.utils.round1(n);
  return Math.round(n * 10) / 10;
}

function getPlayerDefenseFromCtx(ctx) {
  if (ctx && typeof ctx.getPlayerDefense === "function") {
    return ctx.getPlayerDefense();
  }
  // fallback: compute from equipment as in game.js
  const p = ctx.player || {};
  const eq = p.equipment || {};
  let def = 0;
  if (eq.left && typeof eq.left.def === "number") def += eq.left.def;
  if (eq.right && typeof eq.right.def === "number") def += eq.right.def;
  if (eq.head && typeof eq.head.def === "number") def += eq.head.def;
  if (eq.torso && typeof eq.torso.def === "number") def += eq.torso.def;
  if (eq.legs && typeof eq.legs.def === "number") def += eq.legs.def;
  if (eq.hands && typeof eq.hands.def === "number") def += eq.hands.def;
  return round1(ctx, def);
}

export function getPlayerBlockChance(ctx, loc) {
  const p = ctx.player || {};
  const eq = p.equipment || {};
  const leftDef = (eq.left && typeof eq.left.def === "number") ? eq.left.def : 0;
  const rightDef = (eq.right && typeof eq.right.def === "number") ? eq.right.def : 0;
  const handDef = Math.max(leftDef, rightDef);
  const base = 0.08 + handDef * 0.06;
  const mod = (loc && typeof loc.blockMod === "number") ? loc.blockMod : 1.0;
  // Brace stance: if active, increase block chance for this turn.
  const braceBonus = (p && typeof p.braceTurns === "number" && p.braceTurns > 0) ? 1.5 : 1.0;
  // Slightly higher clamp while bracing.
  const clampMax = (braceBonus > 1.0) ? 0.75 : 0.6;
  return Math.max(0, Math.min(clampMax, base * mod * braceBonus));
}

export function getEnemyBlockChance(ctx, enemy, loc) {
  const type = enemy && enemy.type ? String(enemy.type) : "";
  const base = type === "ogre" ? 0.10 : (type === "troll" ? 0.08 : 0.06);
  const mod = (loc && typeof loc.blockMod === "number") ? loc.blockMod : 1.0;
  return Math.max(0, Math.min(0.35, base * mod));
}

export function enemyDamageAfterDefense(ctx, raw) {
  const def = getPlayerDefenseFromCtx(ctx);
  const DR = Math.max(0, Math.min(0.85, def / (def + 6)));
  const reduced = raw * (1 - DR);
  return Math.max(0.1, round1(ctx, reduced));
}

export function enemyDamageMultiplier(level) {
  return 1 + 0.15 * Math.max(0, (level || 1) - 1);
}

/**
 * Standardized player attack against an enemy:
 * - Computes hit location (ctx.rollHitLocation or profiles.torso)
 * - Computes block chance via ctx.getEnemyBlockChance
 * - Applies crit chance/multiplier when available
 * - Damages enemy; logs; applies status on crit; blood decal
 * - Calls ctx.onEnemyDied(enemy) when hp <= 0
 * - Applies equipment decay for attack hands
 */
export function playerAttackEnemy(ctx, enemy) {
  if (!ctx || !enemy) return;
  const rng = (function () {
    try {
      if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function") {
        return window.RNGUtils.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined);
      }
    } catch (_) {}
    return (typeof ctx.rng === "function") ? ctx.rng : null;
  })();

  // Helper: classify equipped weapon for skill tracking
  function classifyWeapon(p) {
    const eq = (p && p.equipment) ? p.equipment : {};
    const left = eq.left || null;
    const right = eq.right || null;
    const twoHanded = !!(left && right && left === right && left.twoHanded) || !!(left && left.twoHanded) || !!(right && right.twoHanded);
    // crude blunt detection by name; extend when mace/club types are added
    const name = (left && left.name) || (right && right.name) || "";
    const blunt = /mace|club|hammer|stick/i.test(name);
    return { twoHanded, blunt, oneHand: !twoHanded };
  }

  // Hit location
  let loc = { part: "torso", mult: 1.0, blockMod: 1.0, critBonus: 0.00 };
  try {
    if (typeof ctx.rollHitLocation === "function") loc = ctx.rollHitLocation();
  } catch (_) {}

  // GOD forced part (best-effort)
  try {
    const forcedPart = (typeof window !== "undefined" && typeof window.ALWAYS_CRIT_PART === "string")
      ? window.ALWAYS_CRIT_PART
      : (typeof localStorage !== "undefined" ? (localStorage.getItem("ALWAYS_CRIT_PART") || "") : "");
    if (forcedPart && (ctx.Combat && ctx.Combat.profiles && ctx.Combat.profiles[forcedPart])) {
      loc = ctx.Combat.profiles[forcedPart];
    }
  } catch (_) {}

  // Block check
  let blockChance = 0;
  try {
    if (typeof ctx.getEnemyBlockChance === "function") blockChance = ctx.getEnemyBlockChance(enemy, loc);
    else blockChance = getEnemyBlockChance(ctx, enemy, loc);
  } catch (_) { blockChance = 0; }
  // Prefer RNGUtils.chance when available for determinism; fallback to raw rng comparison
  const didBlock = (function () {
    try {
      if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.chance === "function") {
        return window.RNGUtils.chance(blockChance, rng);
      }
    } catch (_) {}
    if (typeof rng === "function") return rng() < blockChance;
    return false;
  })();

  if (didBlock) {
    try {
      const name = (enemy.type || "enemy");
      if (ctx.log) ctx.log(`${name.charAt(0).toUpperCase()}${name.slice(1)} blocks your attack to the ${loc.part}.`, "block");
    } catch (_) {}
    // Small passive skill gain even on block (half)
    try {
      const p = ctx.player || null;
      const cat = classifyWeapon(p);
      p.skills = p.skills || { oneHand: 0, twoHand: 0, blunt: 0 };
      if (cat.twoHanded) p.skills.twoHand += 0.5;
      else p.skills.oneHand += 0.5;
      if (cat.blunt) p.skills.blunt += 0.5;
    } catch (_) {}
    // Decay hands (light) on block
    try {
      if (typeof ctx.decayBlockingHands === "function") ctx.decayBlockingHands();
      else if (typeof ctx.decayEquipped === "function") {
        const rf = (min, max) =>
          (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.float === "function")
            ? window.RNGUtils.float(min, max, 1, rng)
            : (min + (rng() * (max - min)));
        ctx.decayEquipped("hands", rf(0.2, 0.7));
      }
    } catch (_) {}
    return;
  }

  // Damage calculation
  let atk = 1;
  try { if (typeof ctx.getPlayerAttack === "function") atk = ctx.getPlayerAttack(); } catch (_) {}
  let dmg = (atk || 1) * (loc.mult || 1.0);

  // Passive skills: apply small buff based on weapon category
  try {
    const p = ctx.player || null;
    const s = (p && p.skills) ? p.skills : null;
    if (p && s) {
      const cat = classifyWeapon(p);
      const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
      // Buffs scale slowly with usage (every ~20 attacks gives +1%), cap low
      const oneHandBuff = clamp(Math.floor((s.oneHand || 0) / 20) * 0.01, 0, 0.05);
      const twoHandBuff = clamp(Math.floor((s.twoHand || 0) / 20) * 0.01, 0, 0.06);
      const bluntBuff   = clamp(Math.floor((s.blunt   || 0) / 25) * 0.01, 0, 0.04);
      let mult = 1.0;
      if (cat.twoHanded) mult *= (1 + twoHandBuff);
      else mult *= (1 + oneHandBuff);
      if (cat.blunt) mult *= (1 + bluntBuff);
      dmg *= mult;
    }
  } catch (_) {}

  let isCrit = false;
  const alwaysCrit = !!((typeof window !== "undefined" && typeof window.ALWAYS_CRIT === "boolean") ? window.ALWAYS_CRIT : false);
  const critChance = Math.max(0, Math.min(0.6, 0.12 + (loc.critBonus || 0)));
  let critMult = 1.8;
  try { if (ctx.Combat && typeof ctx.Combat.critMultiplier === "function") critMult = ctx.Combat.critMultiplier(rng); } catch (_) {}
  const didCrit = (function () {
    if (alwaysCrit) return true;
    try {
      if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.chance === "function") {
        return window.RNGUtils.chance(critChance, rng);
      }
    } catch (_) {}
    const r = rng();
    return r < critChance;
  })();
  if (didCrit) {
    isCrit = true;
    dmg *= critMult;
  }
  dmg = Math.max(0, round1(ctx, dmg));
  enemy.hp = (typeof enemy.hp === "number" ? enemy.hp : 0) - dmg;

  // Visual: blood decal (skip ethereal/undead foes)
  try {
    const t = String(enemy.type || "");
    const ethereal = /ghost|spirit|wraith|skeleton/i.test(t);
    if (!ethereal && typeof ctx.addBloodDecal === "function" && dmg > 0) ctx.addBloodDecal(enemy.x, enemy.y, isCrit ? 1.6 : 1.0);
  } catch (_) {}

  // Log
  try {
    const name = (enemy.type || "enemy");
    if (isCrit) ctx.log && ctx.log(`Critical! You hit the ${name}'s ${loc.part} for ${dmg}.`, "crit");
    else ctx.log && ctx.log(`You hit the ${name}'s ${loc.part} for ${dmg}.`);
    if (ctx.Flavor && typeof ctx.Flavor.logPlayerHit === "function") ctx.Flavor.logPlayerHit(ctx, { target: enemy, loc, crit: isCrit, dmg });
    // Record last hit for death flavor/meta
    try {
      const eq = ctx.player && ctx.player.equipment ? ctx.player.equipment : {};
      const weaponName = (eq.right && eq.right.name) ? eq.right.name : (eq.left && eq.left.name) ? eq.left.name : null;
      enemy._lastHit = { by: "player", part: loc.part, crit: isCrit, dmg, weapon: weaponName, via: weaponName ? `with ${weaponName}` : "melee" };
    } catch (_) {}
  } catch (_) {}

  // Status effects on crit
  try {
    const ST = (typeof window !== "undefined") ? window.Status : (ctx.Status || null);
    if (isCrit && loc.part === "legs" && enemy.hp > 0) {
      if (ST && typeof ST.applyLimpToEnemy === "function") ST.applyLimpToEnemy(ctx, enemy, 2);
      else { enemy.immobileTurns = Math.max(enemy.immobileTurns || 0, 2); if (ctx.log) ctx.log(`${(enemy.type || "enemy")[0].toUpperCase()}${(enemy.type || "enemy").slice(1)} staggers; its legs are crippled and it can't move for 2 turns.`, "notice"); }
    }
    if (isCrit && enemy.hp > 0) {
      const t = String(enemy.type || "");
      const ethereal = /ghost|spirit|wraith|skeleton/i.test(t);
      if (!ethereal && ST && typeof ST.applyBleedToEnemy === "function") ST.applyBleedToEnemy(ctx, enemy, 2);
    }
  } catch (_) {}

  // Death
  try {
    if (enemy.hp <= 0) {
      try {
        if (ctx.Flavor && typeof ctx.Flavor.logDeath === "function") {
          ctx.Flavor.logDeath(ctx, { target: enemy, loc, crit: isCrit });
        }
      } catch (_) {}
      if (typeof ctx.onEnemyDied === "function") {
        ctx.onEnemyDied(enemy);
      }
    }
  } catch (_) {}

  // Passive skill gain on successful hit
  try {
    const p = ctx.player || null;
    const cat = classifyWeapon(p);
    p.skills = p.skills || { oneHand: 0, twoHand: 0, blunt: 0 };
    if (cat.twoHanded) p.skills.twoHand += 1;
    else p.skills.oneHand += 1;
    if (cat.blunt) p.skills.blunt += 1;
  } catch (_) {}

  // Decay hands after attack
  try {
    if (typeof ctx.decayAttackHands === "function") ctx.decayAttackHands(false);
    else if (typeof ctx.decayEquipped === "function") {
      const rf = (min, max) =>
        (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.float === "function")
          ? window.RNGUtils.float(min, max, 1, rng)
          : ((min + max) / 2);
      ctx.decayEquipped("hands", rf(0.3, 1.0));
    }
  } catch (_) {}
}

// Back-compat: attach/augment window.Combat
if (typeof window !== "undefined") {
  const base = window.Combat || {};
  const augmented = Object.assign({}, base, {
    getPlayerBlockChance,
    getEnemyBlockChance,
    enemyDamageAfterDefense,
    enemyDamageMultiplier,
    playerAttackEnemy,
  });
  window.Combat = augmented;
}