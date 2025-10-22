// Numeric helpers shared across modules

// Round to a fixed number of decimals (avoids floating point artifacts by scaling).
export function roundTo(v, decimals = 0) {
  const p = Math.pow(10, decimals);
  return Math.round(v * p) / p;
}

// Random float in [min,max) using provided rng() or centralized RNGUtils when available
export function randomInRange(min, max, rng = Math.random) {
  try {
    if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.float === "function") {
      return window.RNGUtils.float(min, max, 6, (typeof rng === "function" ? rng : undefined));
    }
  } catch (_) {}
  const r = typeof rng === "function" ? rng() : Math.random();
  return min + r * (max - min);
}

// Back-compat global (optional)
import { attachGlobal } from "./global.js";
attachGlobal("NumberUtils", { roundTo, randomInRange });