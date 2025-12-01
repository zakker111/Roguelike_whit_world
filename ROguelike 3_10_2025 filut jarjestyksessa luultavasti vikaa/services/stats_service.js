/**
 * StatsService: centralize player stat computations to avoid duplication.
 *
 * Exports (ESM + window.Stats):
 * - getPlayerAttack(ctx): number
 * - getPlayerDefense(ctx): number
 */
function round1(n) { return Math.round(n * 10) / 10; }

export function getPlayerAttack(ctx) {
  let base = 1;
  // Base attack from Player module or fallback
  try {
    const P = (ctx && ctx.Player) || (typeof window !== "undefined" ? window.Player : null);
    if (P && typeof P.getAttack === "function" && ctx && ctx.player) {
      base = P.getAttack(ctx.player);
    } else {
      const p = ctx && ctx.player || {};
      let bonus = 0;
      const eq = p.equipment || {};
      if (eq.left && typeof eq.left.atk === "number") bonus += eq.left.atk;
      if (eq.right && typeof eq.right.atk === "number") bonus += eq.right.atk;
      if (eq.hands && typeof eq.hands.atk === "number") bonus += eq.hands.atk;
      const levelBonus = Math.floor(((p.level || 1) - 1) / 2);
      base = round1((p.atk || 1) + bonus + levelBonus);
    }
  } catch (_) {
    return 1;
  }

  // Injury-based hand penalty: serious hand injuries reduce attack slightly,
  // capped so damage reduction stays modest.
  try {
    const p = ctx && ctx.player;
    const list = p && Array.isArray(p.injuries) ? p.injuries : null;
    if (!list || !list.length) return base;

    let penalty = 0;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const name = typeof it === "string" ? it : (it && it.name) || "";
      const n = String(name || "").toLowerCase();
      if (!n) continue;
      if (n.includes("missing finger") || n.includes("sprained wrist")) {
        penalty += 0.08; // major hand injury
      } else if (n.includes("bruised knuckles") || n.includes("scratched hand")) {
        penalty += 0.03; // minor hand injury
      }
    }
    if (!(penalty > 0)) return base;
    if (penalty > 0.2) penalty = 0.2;

    const adjusted = round1(base * (1 - penalty));
    const minRatio = 0.5;
    const minAllowed = round1(base * minRatio);
    return adjusted < minAllowed ? minAllowed : adjusted;
  } catch (_) {
    return base;
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