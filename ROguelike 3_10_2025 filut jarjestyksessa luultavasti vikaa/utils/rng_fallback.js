/**
 * RNGFallback
 * Minimal centralized fallback RNG for modules if RNG.service is unavailable.
 *
 * Usage:
 *   const r = (window.RNG && typeof RNG.rng === 'function')
 *     ? RNG.rng
 *     : RNGFallback.getRng(seedOptional);
 *
 * - If a seed is provided, uses it; otherwise tries localStorage SEED; else time-based.
 * - Deterministic across a session; not persisted unless seed is applied via RNG.service.
 */
(function () {
  function mulberry32(a) {
    return function () {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function resolveSeed(seedOpt) {
    try {
      if (typeof seedOpt === 'number') return (seedOpt >>> 0);
      const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem('SEED') : null;
      if (raw != null) return (Number(raw) >>> 0);
    } catch (_) {}
    return ((Date.now() % 0xffffffff) >>> 0);
  }

  function getRng(seedOpt) {
    const s = resolveSeed(seedOpt);
    const f = mulberry32(s);
    return function () { return f(); };
  }

  window.RNGFallback = { getRng };
})();
