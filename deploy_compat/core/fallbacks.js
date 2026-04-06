/**
 * Fallbacks: centralized minimal implementations used when primary modules are unavailable.
 * Exports (ESM + window.Fallbacks):
 * - rollHitLocation(rng)
 * - critMultiplier(rng)
 * - enemyBlockChance(ctx, enemy, loc)
 * - enemyDamageAfterDefense(ctx, raw)
 * - enemyDamageMultiplier(level)
 */

export function rollHitLocation(rng) {
  const r = (typeof rng === "function") ? rng() : 0.5;
  if (r < 0.50) return { part: "torso", mult: 1.0, blockMod: 1.0, critBonus: 0.00 };
  if (r < 0.65) return { part: "head",  mult: 1.1, blockMod: 0.85, critBonus: 0.15 };
  if (r < 0.80) return { part: "hands", mult: 0.9, blockMod: 0.75, critBonus: -0.05 };
  return { part: "legs",  mult: 0.95, blockMod: 0.75, critBonus: -0.03 };
}

export function critMultiplier(rng) {
  const r = (typeof rng === "function") ? rng() : 0.5;
  // Deterministic baseline multiplier when RNG unavailable
  return 1.6 + r * 0.4;
}

export function enemyBlockChance(ctx, enemy, loc) {
  const type = enemy?.type;
  const base = type === "ogre" ? 0.10 : type === "troll" ? 0.08 : 0.06;
  const chance = Math.max(0, Math.min(0.35, base * ((loc?.blockMod) || 1.0)));
  return chance;
}

export function enemyDamageAfterDefense(ctx, raw) {
  // Diminishing returns DR curve; chip-damage floor
  const def = (typeof ctx.getPlayerDefense === "function") ? ctx.getPlayerDefense() : 0;
  const DR = Math.max(0, Math.min(0.85, def / (def + 6)));
  const reduced = raw * (1 - DR);
  const round1 = (n) => Math.round(n * 10) / 10;
  return Math.max(0.1, round1(reduced));
}

export function enemyDamageMultiplier(level) {
  return 1 + 0.15 * Math.max(0, (level || 1) - 1);
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.Fallbacks = {
    rollHitLocation,
    critMultiplier,
    enemyBlockChance,
    enemyDamageAfterDefense,
    enemyDamageMultiplier,
  };
}