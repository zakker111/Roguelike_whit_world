/**
 * StatsService: centralize player stat computations to avoid duplication.
 *
 * Exports (ESM + window.Stats):
 * - getPlayerAttack(ctx): number
 * - getPlayerDefense(ctx): number
 */
function round1(n) { return Math.round(n * 10) / 10; }

export function getPlayerAttack(ctx) {
  try {
    // Prefer Player module if available
    const P = (ctx && ctx.Player) || (typeof window !== "undefined" ? window.Player : null);
    if (P && typeof P.getAttack === "function") {
      return P.getAttack(ctx.player);
    }
  } catch (_) {}
  // Fallback: equipment bonuses + level bonus
  try {
    const p = ctx && ctx.player || {};
    let bonus = 0;
    const eq = p.equipment || {};
    if (eq.left && typeof eq.left.atk === "number") bonus += eq.left.atk;
    if (eq.right && typeof eq.right.atk === "number") bonus += eq.right.atk;
    if (eq.hands && typeof eq.hands.atk === "number") bonus += eq.hands.atk;
    const levelBonus = Math.floor(((p.level || 1) - 1) / 2);
    return round1((p.atk || 1) + bonus + levelBonus);
  } catch (_) {
    return 1;
  }
}

export function getPlayerDefense(ctx) {
  try {
    // Prefer Player module if available
    const P = (ctx && ctx.Player) || (typeof window !== "undefined" ? window.Player : null);
    if (P && typeof P.getDefense === "function") {
      return P.getDefense(ctx.player);
    }
  } catch (_) {}
  // Fallback: sum of equipment defense
  try {
    const p = ctx && ctx.player || {};
    let def = 0;
    const eq = p.equipment || {};
    if (eq.left && typeof eq.left.def === "number") def += eq.left.def;
    if (eq.right && typeof eq.right.def === "number") def += eq.right.def;
    if (eq.head && typeof eq.head.def === "number") def += eq.head.def;
    if (eq.torso && typeof eq.torso.def === "number") def += eq.torso.def;
    if (eq.legs && typeof eq.legs.def === "number") def += eq.legs.def;
    if (eq.hands && typeof eq.hands.def === "number") def += eq.hands.def;
    return round1(def);
  } catch (_) {
    return 0;
  }
}

import { attachGlobal } from "../utils/global.js";
attachGlobal("Stats", { getPlayerAttack, getPlayerDefense });