/**
 * Combat module: shared calculations for block chance and damage after defense.
 *
 * Exports (ESM + window.Combat augmentation):
 * - getPlayerBlockChance(ctx, loc)
 * - getEnemyBlockChance(ctx, enemy, loc)
 * - enemyDamageAfterDefense(ctx, raw)
 * - enemyDamageMultiplier(level)  // small helper for consistency
 *
 * Notes:
 * - Prefers helpers available on ctx (e.g., ctx.getPlayerDefense, ctx.utils.round1).
 * - Keeps logic aligned with existing game.js fallbacks.
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
  return Math.max(0, Math.min(0.6, base * mod));
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

// Back-compat: attach/augment window.Combat
if (typeof window !== "undefined") {
  const base = window.Combat || {};
  const augmented = Object.assign({}, base, {
    getPlayerBlockChance,
    getEnemyBlockChance,
    enemyDamageAfterDefense,
    enemyDamageMultiplier,
  });
  window.Combat = augmented;
}