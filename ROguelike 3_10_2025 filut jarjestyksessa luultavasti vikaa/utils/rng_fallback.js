/**
 * RNGFallback
 * Minimal centralized fallback RNG for modules if RNG.service is unavailable.
 *
 * Usage:
 *   const r = (typeof window !== 'undefined' && window.RNG && typeof window.RNG.rng === 'function')
 *     ? window.RNG.rng
 *     : (typeof window !== 'undefined' && window.RNGFallback && typeof window.RNGFallback.getRng === 'function'
 *         ? window.RNGFallback.getRng(seedOptional)
 *         : Math.random);
 *
 * - If a seed is provided, uses it; otherwise tries localStorage SEED; else time-based.
 * - Deterministic across a session; not persisted unless seed is applied via RNG.service.
 */
import { attachGlobal } from "./global.js";

function mulberry32(a) {
  return function () {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getRng(seedOpt) {
  let source = "time";
  let s;
  try {
    if (typeof seedOpt === "number") {
      s = (seedOpt >>> 0);
      source = "provided";
    } else {
      const raw = (typeof localStorage !== "undefined") ? localStorage.getItem("SEED") : null;
      if (raw != null) {
        s = (Number(raw) >>> 0);
        source = "localStorage";
      } else {
        s = ((Date.now() % 0xffffffff) >>> 0);
        source = "time";
      }
    }
  } catch (_) {
    s = ((Date.now() % 0xffffffff) >>> 0);
    source = "time";
  }
  try {
    if (typeof window !== "undefined" && window.Fallback && typeof window.Fallback.log === "function") {
      window.Fallback.log("rng", "RNGFallback initialized", { seedSource: source, seed: s });
    }
  } catch (_) {}
  const f = mulberry32(s);
  return function () { return f(); };
}

// Back-compat: attach to window via helper
attachGlobal("RNGFallback", { getRng });
  const f = mulberry32(s);
  return function () { return f(); };
};
};
}

// Back-compat: attach to window via helper
attachGlobal("RNGFallback", { getRng });
