import { getRng as rngGetRng } from "../facades/rng.js";

export function initRngRuntime() {
  let currentSeed = null;
  try {
    if (typeof window !== "undefined" && window.RNG && typeof window.RNG.autoInit === "function") {
      currentSeed = window.RNG.autoInit();
    } else {
      // If RNG service is unavailable, try to read persisted seed for diagnostics only
      const noLS = (typeof window !== "undefined" && !!window.NO_LOCALSTORAGE);
      const sRaw = (!noLS && typeof localStorage !== "undefined") ? localStorage.getItem("SEED") : null;
      currentSeed = sRaw != null ? (Number(sRaw) >>> 0) : null;
    }
  } catch (_) { currentSeed = null; }

  // Single RNG function via RNG facade; deterministic (0.5) if RNG is unavailable
  const rng = rngGetRng();

  return { currentSeed, rng };
}
