/**
 * Combat utilities: hit location profiles and critical multiplier.
 *
 * Exports (ESM + window.Combat augmentation):
 * - rollHitLocation(rng): { part, mult, blockMod, critBonus }
 * - critMultiplier(rng): number in [1.6, 2.0)
 * - profiles: readonly map of named locations
 */
export const profiles = {
  torso: { part: "torso", mult: 1.0, blockMod: 1.0, critBonus: 0.00 },
  head:  { part: "head",  mult: 1.1, blockMod: 0.85, critBonus: 0.15 },
  hands: { part: "hands", mult: 0.9, blockMod: 0.75, critBonus: -0.05 },
  legs:  { part: "legs",  mult: 0.95, blockMod: 0.75, critBonus: -0.03 },
};

export function rollHitLocation(rng) {
  const r = (typeof rng === "function")
    ? rng()
    : ((typeof window !== "undefined" && window.RNG && typeof RNG.rng === "function")
        ? RNG.rng()
        : ((typeof window !== "undefined" && window.RNGFallback && typeof RNGFallback.getRng === "function")
            ? RNGFallback.getRng()()
            : Math.random()));
  if (r < 0.50) return profiles.torso;
  if (r < 0.65) return profiles.head;
  if (r < 0.80) return profiles.hands;
  return profiles.legs;
}

export function critMultiplier(rng) {
  const r = (typeof rng === "function")
    ? rng()
    : ((typeof window !== "undefined" && window.RNG && typeof RNG.rng === "function")
        ? RNG.rng()
        : ((typeof window !== "undefined" && window.RNGFallback && typeof RNGFallback.getRng === "function")
            ? RNGFallback.getRng()()
            : Math.random()));
  return 1.6 + r * 0.4;
}

// Back-compat: augment window.Combat
if (typeof window !== "undefined") {
  const base = window.Combat || {};
  window.Combat = Object.assign({}, base, { rollHitLocation, critMultiplier, profiles });
}