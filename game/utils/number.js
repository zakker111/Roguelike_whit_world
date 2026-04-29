// Numeric helpers shared across modules

// Round to a fixed number of decimals (avoids floating point artifacts by scaling).
export function roundTo(v, decimals = 0) {
  const p = Math.pow(10, decimals);
  return Math.round(v * p) / p;
}

// Random float in [min,max) using provided rng() or centralized RNGUtils when available
export function randomInRange(min, max, rng = undefined) {
  try {
    if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.float === "function") {
      return window.RNGUtils.float(min, max, 6, (typeof rng === "function" ? rng : undefined));
    }
  } catch (_) {}
  // State B: RNGUtils mandatory — no Math.random fallback
  let rfn = null;
  try {
    if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function") {
      rfn = window.RNGUtils.getRng(typeof rng === "function" ? rng : undefined);
    }
  } catch (_) {}
  if (typeof rfn !== "function" && typeof rng === "function") {
    rfn = rng;
  }
  const r = rfn();
  return min + r * (max - min);
}

// Back-compat global (optional)
import { attachGlobal } from "./global.js";
attachGlobal("NumberUtils", { roundTo, randomInRange });