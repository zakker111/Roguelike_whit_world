/**
 * RNG facade: consistent RNG helpers with graceful fallbacks.
 */
function tryGetUtils() {
  try { return (typeof window !== "undefined" ? window.RNGUtils : null); } catch (_) { return null; }
}

export function getRng() {
  try {
    const RU = tryGetUtils();
    if (RU && typeof RU.getRng === "function") return RU.getRng();
  } catch (_) {}
  return () => 0.5;
}

export function int(min, max, rng) {
  const RU = tryGetUtils();
  try {
    if (RU && typeof RU.int === "function") return RU.int(min, max, rng);
  } catch (_) {}
  // midpoint fallback
  return Math.floor((min + max) / 2);
}

export function float(min, max, decimals = 1, rng) {
  const RU = tryGetUtils();
  try {
    if (RU && typeof RU.float === "function") return RU.float(min, max, decimals, rng);
  } catch (_) {}
  const v = (min + max) / 2;
  const p = Math.pow(10, decimals);
  return Math.round(v * p) / p;
}

export function chance(p, rng) {
  const RU = tryGetUtils();
  try {
    if (RU && typeof RU.chance === "function") return !!RU.chance(p, rng);
  } catch (_) {}
  try { return typeof rng === "function" ? (rng() < p) : false; } catch (_) { return false; }
}

// Optional back-compat
if (typeof window !== "undefined") {
  window.RNGFacade = { getRng, int, float, chance };
}