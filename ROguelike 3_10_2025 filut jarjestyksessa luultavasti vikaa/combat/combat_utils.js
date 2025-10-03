/**
 * Combat utilities: hit location profiles and critical multiplier.
 *
 * Exports (window.Combat):
 * - rollHitLocation(rng): { part, mult, blockMod, critBonus }
 * - critMultiplier(rng): number in [1.6, 2.0)
 * - profiles: readonly map of named locations
 */
(function () {
  const profiles = {
    torso: { part: "torso", mult: 1.0, blockMod: 1.0, critBonus: 0.00 },
    head:  { part: "head",  mult: 1.1, blockMod: 0.85, critBonus: 0.15 },
    hands: { part: "hands", mult: 0.9, blockMod: 0.75, critBonus: -0.05 },
    legs:  { part: "legs",  mult: 0.95, blockMod: 0.75, critBonus: -0.03 },
  };

  function rollHitLocation(rng) {
    const r = (typeof rng === "function") ? rng() : Math.random();
    if (r < 0.50) return profiles.torso;
    if (r < 0.65) return profiles.head;
    if (r < 0.80) return profiles.hands;
    return profiles.legs;
  }

  function critMultiplier(rng) {
    const r = (typeof rng === "function") ? rng() : Math.random();
    return 1.6 + r * 0.4;
  }

  window.Combat = { rollHitLocation, critMultiplier, profiles };
})();