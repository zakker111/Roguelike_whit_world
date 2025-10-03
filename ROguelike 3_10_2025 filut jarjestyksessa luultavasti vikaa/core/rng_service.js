/**
 * RNG Service: centralized deterministic RNG with seed management.
 *
 * Exports (window.RNG):
 * - init(seed?)        // initialize with a specific uint32 seed (does not persist unless persist=true)
 * - applySeed(seed)    // initialize and persist seed to localStorage
 * - autoInit()         // init from localStorage SEED if present, else time-based seed
 * - rng()              // random float in [0,1)
 * - int(min,max)
 * - float(min,max,decimals=1)
 * - chance(p)
 * - getSeed()          // current uint32 seed (or null)
 */
(function () {
  function mulberry32(a) {
    return function() {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  let _seed = null;
  let _rng = null;

  function setSeed(seed, persist) {
    const s = (Number(seed) >>> 0);
    _seed = s;
    _rng = mulberry32(s);
    if (persist) {
      try { localStorage.setItem("SEED", String(s)); } catch (_) {}
    }
    return s;
  }

  function init(seed) {
    if (seed == null) {
      // fall back to auto if no seed provided
      return autoInit();
    }
    return setSeed(seed, false);
  }

  function applySeed(seed) {
    return setSeed(seed, true);
  }

  function autoInit() {
    try {
      const raw = localStorage.getItem("SEED");
      if (raw != null) {
        return setSeed(Number(raw) >>> 0, false);
      }
    } catch (_) {}
    const s = (Date.now() % 0xffffffff) >>> 0;
    return setSeed(s, false);
  }

  function rng() {
    if (!_rng) autoInit();
    return _rng();
  }

  function int(min, max) {
    const lo = Math.min(min|0, max|0);
    const hi = Math.max(min|0, max|0);
    return Math.floor(rng() * (hi - lo + 1)) + lo;
  }

  function float(min, max, decimals = 1) {
    const v = min + rng() * (max - min);
    const p = Math.pow(10, decimals);
    return Math.round(v * p) / p;
  }

  function chance(p) {
    return rng() < p;
  }

  function getSeed() {
    return _seed;
  }

  window.RNG = {
    init,
    applySeed,
    autoInit,
    rng,
    int,
    float,
    chance,
    getSeed,
  };
})();