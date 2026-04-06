/**
 * Combat facade: centralized combat/stat helpers used by core/game.js and other modules.
 *
 * Exports (ESM + window.CombatFacade):
 * - getPlayerAttack(ctx)
 * - getPlayerDefense(ctx)
 * - rollHitLocation(ctx)
 * - critMultiplier(ctx)
 * - getEnemyBlockChance(ctx, enemy, loc)
 * - getPlayerBlockChance(ctx, loc)
 * - enemyDamageAfterDefense(ctx, raw)
 * - enemyDamageMultiplier(ctx, level)
 * - enemyThreatLabel(ctx, enemy)
 *
 * Notes:
 * - Prefers Stats/Combat modules when available, with Fallbacks as a safety net.
 * - Keeps ctx-first signatures so callers do not touch window.* directly.
 */

import { getMod } from "../../utils/access.js";

function getCombat(ctx) {
  return getMod(ctx, "Combat");
}

function getFallbacks(ctx) {
  return getMod(ctx, "Fallbacks");
}

function getStats(ctx) {
  return getMod(ctx, "Stats");
}

function getPlayerModule(ctx) {
  return getMod(ctx, "Player");
}

function getCombatRules(ctx) {
  return getMod(ctx, "CombatRules");
}

export function getPlayerAttack(ctx) {
  const S = getStats(ctx);
  if (S && typeof S.getPlayerAttack === "function") {
    return S.getPlayerAttack(ctx);
  }
  const P = getPlayerModule(ctx);
  if (P && typeof P.getAttack === "function" && ctx && ctx.player) {
    return P.getAttack(ctx.player);
  }
  const p = (ctx && ctx.player) || {};
  const base = (typeof p.atk === "number") ? p.atk : 1;
  return base;
}

export function getPlayerDefense(ctx) {
  const S = getStats(ctx);
  if (S && typeof S.getPlayerDefense === "function") {
    return S.getPlayerDefense(ctx);
  }
  const P = getPlayerModule(ctx);
  if (P && typeof P.getDefense === "function" && ctx && ctx.player) {
    return P.getDefense(ctx.player);
  }
  const p = (ctx && ctx.player) || {};
  const eq = p.equipment || {};
  let def = 0;
  if (eq.left && typeof eq.left.def === "number") def += eq.left.def;
  if (eq.right && typeof eq.right.def === "number") def += eq.right.def;
  if (eq.head && typeof eq.head.def === "number") def += eq.head.def;
  if (eq.torso && typeof eq.torso.def === "number") def += eq.torso.def;
  if (eq.legs && typeof eq.legs.def === "number") def += eq.legs.def;
  if (eq.hands && typeof eq.hands.def === "number") def += eq.hands.def;
  return def;
}

export function rollHitLocation(ctx) {
  const C = getCombat(ctx);
  if (C && typeof C.rollHitLocation === "function") {
    try {
      return C.rollHitLocation(ctx && ctx.rng);
    } catch (_) {
      // fall through to Fallbacks
    }
  }
  const FB = getFallbacks(ctx);
  if (FB && typeof FB.rollHitLocation === "function") {
    try {
      return FB.rollHitLocation(ctx && ctx.rng);
    } catch (_) {
      // fall through to default
    }
  }
  return { part: "torso", mult: 1.0, blockMod: 1.0, critBonus: 0.0 };
}

export function critMultiplier(ctx) {
  const C = getCombat(ctx);
  if (C && typeof C.critMultiplier === "function") {
    try {
      return C.critMultiplier(ctx && ctx.rng);
    } catch (_) {
      // fall through
    }
  }
  const FB = getFallbacks(ctx);
  if (FB && typeof FB.critMultiplier === "function") {
    try {
      return FB.critMultiplier(ctx && ctx.rng);
    } catch (_) {
      // fall through
    }
  }
  return 1.5;
}

export function getEnemyBlockChance(ctx, enemy, loc) {
  const C = getCombat(ctx);
  if (C && typeof C.getEnemyBlockChance === "function") {
    try {
      return C.getEnemyBlockChance(ctx, enemy, loc);
    } catch (_) {
      // fall through
    }
  }
  const FB = getFallbacks(ctx);
  if (FB && typeof FB.enemyBlockChance === "function") {
    try {
      return FB.enemyBlockChance(ctx, enemy, loc);
    } catch (_) {
      // fall through
    }
  }
  return 0;
}

export function getPlayerBlockChance(ctx, loc) {
  const C = getCombat(ctx);
  if (C && typeof C.getPlayerBlockChance === "function") {
    try {
      return C.getPlayerBlockChance(ctx, loc);
    } catch (_) {
      // fall through
    }
  }
  const p = (ctx && ctx.player) || {};
  const eq = p.equipment || {};
  const leftDef = (eq.left && typeof eq.left.def === "number") ? eq.left.def : 0;
  const rightDef = (eq.right && typeof eq.right.def === "number") ? eq.right.def : 0;
  const handDef = Math.max(leftDef, rightDef);
  const base = 0.08 + handDef * 0.06;
  const mod = (loc && typeof loc.blockMod === "number") ? loc.blockMod : 1.0;
  const braceBonus = (p && typeof p.braceTurns === "number" && p.braceTurns > 0) ? 1.5 : 1.0;
  const clampMax = (braceBonus > 1.0) ? 0.75 : 0.6;
  const val = base * mod * braceBonus;
  return Math.max(0, Math.min(clampMax, val));
}

export function enemyDamageAfterDefense(ctx, raw) {
  const C = getCombat(ctx);
  if (C && typeof C.enemyDamageAfterDefense === "function") {
    try {
      return C.enemyDamageAfterDefense(ctx, raw);
    } catch (_) {
      // fall through
    }
  }
  const FB = getFallbacks(ctx);
  if (FB && typeof FB.enemyDamageAfterDefense === "function") {
    try {
      return FB.enemyDamageAfterDefense(ctx, raw);
    } catch (_) {
      // fall through
    }
  }
  return raw;
}

export function enemyDamageMultiplier(ctx, level) {
  const CR = getCombatRules(ctx);
  if (CR && typeof CR.enemyDamageMultiplier === "function") {
    try {
      return CR.enemyDamageMultiplier(level);
    } catch (_) {
      // fall through
    }
  }
  const C = getCombat(ctx);
  if (C && typeof C.enemyDamageMultiplier === "function") {
    try {
      return C.enemyDamageMultiplier(level);
    } catch (_) {
      // fall through
    }
  }
  const FB = getFallbacks(ctx);
  if (FB && typeof FB.enemyDamageMultiplier === "function") {
    try {
      return FB.enemyDamageMultiplier(level);
    } catch (_) {
      // fall through
    }
  }
  return 1 + 0.15 * Math.max(0, (level || 1) - 1);
}

export function enemyThreatLabel(ctx, enemy) {
  const p = (ctx && ctx.player) || {};
  const playerLevel = (typeof p.level === "number") ? p.level : 1;
  const enemyLevel = (enemy && typeof enemy.level === "number") ? enemy.level : 1;
  const diff = enemyLevel - playerLevel;
  let label = "moderate";
  let tone = "info";
  if (diff <= -2) {
    label = "weak";
    tone = "good";
  } else if (diff === -1) {
    label = "weak";
    tone = "good";
  } else if (diff === 0) {
    label = "moderate";
    tone = "info";
  } else if (diff === 1) {
    label = "strong";
    tone = "warn";
  } else if (diff >= 2) {
    label = "deadly";
    tone = "warn";
  }
  return { label, tone, diff };
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.CombatFacade = {
    getPlayerAttack,
    getPlayerDefense,
    rollHitLocation,
    critMultiplier,
    getEnemyBlockChance,
    getPlayerBlockChance,
    enemyDamageAfterDefense,
    enemyDamageMultiplier,
    enemyThreatLabel,
  };
}