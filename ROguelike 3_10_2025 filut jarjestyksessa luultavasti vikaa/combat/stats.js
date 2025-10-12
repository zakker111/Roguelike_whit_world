/**
 * Stats: centralized helpers for player attack and defense calculations.
 *
 * Exports (ESM + window.Stats):
 * - getPlayerAttack(ctx): number
 * - getPlayerDefense(ctx): number
 *
 * Notes:
 * - Prefers Player module implementations when available.
 * - Falls back to computing from ctx.player using the same logic as game.js.
 * - Uses ctx.utils.round1 when available for consistent rounding.
 */

function round1(ctx, n) {
  if (ctx && ctx.utils && typeof ctx.utils.round1 === "function") return ctx.utils.round1(n);
  return Math.round(n * 10) / 10;
}

export function getPlayerAttack(ctx) {
  // Prefer Player module
  if (typeof window !== "undefined" && window.Player && typeof Player.getAttack === "function") {
    return Player.getAttack(ctx.player);
  }
  // Fallback: mirror game.js logic
  const p = ctx.player || {};
  let bonus = 0;
  const eq = p.equipment || {};
  if (eq.left && typeof eq.left.atk === "number") bonus += eq.left.atk;
  if (eq.right && typeof eq.right.atk === "number") bonus += eq.right.atk;
  if (eq.hands && typeof eq.hands.atk === "number") bonus += eq.hands.atk;
  const levelBonus = Math.floor(((p.level || 1) - 1) / 2);
  return round1(ctx, (p.atk || 1) + bonus + levelBonus);
}

export function getPlayerDefense(ctx) {
  // Prefer Player module
  if (typeof window !== "undefined" && window.Player && typeof Player.getDefense === "function") {
    return Player.getDefense(ctx.player);
  }
  // Fallback: mirror game.js logic
  const p = ctx.player || {};
  let def = 0;
  const eq = p.equipment || {};
  if (eq.left && typeof eq.left.def === "number") def += eq.left.def;
  if (eq.right && typeof eq.right.def === "number") def += eq.right.def;
  if (eq.head && typeof eq.head.def === "number") def += eq.head.def;
  if (eq.torso && typeof eq.torso.def === "number") def += eq.torso.def;
  if (eq.legs && typeof eq.legs.def === "number") def += eq.legs.def;
  if (eq.hands && typeof eq.hands.def === "number") def += eq.hands.def;
  return round1(ctx, def);
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.Stats = { getPlayerAttack, getPlayerDefense };
}