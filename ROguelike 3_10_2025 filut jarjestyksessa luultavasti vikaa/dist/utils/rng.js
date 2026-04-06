/**
 * RNG Utils
 * Unify RNG selection and helpers across modules.
 *
 * Exports (ESM + window.RNGUtils):
 * - getRng(preferred?)            // returns an rng() function; uses preferred if provided
 * - int(min, max, rngFn?)         // integer in [min, max]
 * - float(min, max, decimals?, rngFn?) // float with rounding
 * - chance(p, rngFn?)             // boolean with probability p
 */
export function getRng(preferred) {
  if (typeof preferred === "function") return preferred;
  try {
    if (typeof window !== "undefined" && window.RNG && typeof window.RNG.rng === "function") {
      // Ensure RNG is initialized (seeded) if possible
      try {
        if (typeof window.RNG.getSeed !== "function" || window.RNG.getSeed() == null) {
          if (typeof window.RNG.autoInit === "function") window.RNG.autoInit();
        }
      } catch (_) {}
      return window.RNG.rng;
    }
  } catch (_) {}
  // Deterministic fallback: constant function avoids non-determinism
  return () => 0.5;
}

export function int(min, max, rngFn) {
  const r = getRng(rngFn);
  const lo = Math.min(min | 0, max | 0);
  const hi = Math.max(min | 0, max | 0);
  return Math.floor(r() * (hi - lo + 1)) + lo;
}

export function float(min, max, decimals = 1, rngFn) {
  const r = getRng(rngFn);
  const v = min + r() * (max - min);
  const p = Math.pow(10, decimals);
  return Math.round(v * p) / p;
}

export function chance(p, rngFn) {
  const r = getRng(rngFn);
  return r() < p;
}

import { attachGlobal } from "./global.js";
// Back-compat: attach to window via helper
attachGlobal("RNGUtils", { getRng, int, float, chance });