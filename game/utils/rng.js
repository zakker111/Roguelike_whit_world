/**
 * Shared deterministic PRNG helpers.
 *
 * Exports:
 * - mulberry32(seed): returns a function () => float in [0, 1).
 *
 * Notes:
 * - Identical algorithm previously copy-pasted across dungeon/world/gm/ui modules.
 *   Keep this single source of truth so determinism stays consistent.
 */

export function mulberry32(seed) {
  let a = (seed >>> 0);
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
