/**
 * WeatherService: lightweight, non-gameplay visual weather state.
 *
 * State shape:
 *   { type: string, turnsLeft: number }
 *
 * Public API:
 *   export function create(opts?): {
 *     tick(state, time, rng?): newState
 *     describe(state, time): { type, label, intensity }
 *   }
 *
 * Notes:
 * - Reads GameData.weatherConfig when available; otherwise uses built-in defaults.
 * - Time argument should be ctx.time (from TimeService.getClock()).
 * - RNG parameter is optional; when omitted, Math.random() is used (visual only).
 */

function _getConfig() {
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const cfg = GD && GD.weatherConfig && typeof GD.weatherConfig === "object" ? GD.weatherConfig : null;
    if (cfg) return cfg;
  } catch (_) {}
  return {
    types: {
      clear:      { label: "Clear",      baseWeight: 5,   intensity: 0.0 },
      cloudy:     { label: "Cloudy",     baseWeight: 3,   intensity: 0.3 },
      foggy:      { label: "Foggy",      baseWeight: 1,   intensity: 0.7 },
      light_rain: { label: "Light rain", baseWeight: 1,   intensity: 0.5 },
      heavy_rain: { label: "Heavy rain", baseWeight: 0.3, intensity: 1.0 }
    },
    phaseWeights: {
      night: { foggy: 1.5, heavy_rain: 0.7 },
      dawn:  { foggy: 1.3 }
    },
    durationTurns: { min: 40, max: 140 }
  };
}

function _pickType(cfg, phase, rngFn) {
  const types = cfg && cfg.types ? cfg.types : null;
  if (!types) return "clear";
  const phaseWeights = cfg.phaseWeights || {};
  const phaseCfg = phase && phaseWeights[phase] ? phaseWeights[phase] : null;

  let entries = [];
  let total = 0;
  for (const k in types) {
    if (!Object.prototype.hasOwnProperty.call(types, k)) continue;
    const t = types[k] || {};
    let w = Number(t.baseWeight) || 0;
    if (phaseCfg && Object.prototype.hasOwnProperty.call(phaseCfg, k)) {
      const mul = Number(phaseCfg[k]);
      if (Number.isFinite(mul) && mul > 0) w *= mul;
    }
    if (w <= 0) continue;
    total += w;
    entries.push({ id: k, w });
  }
  if (!entries.length || !Number.isFinite(total) || total <= 0) return "clear";

  const r = rngFn() * total;
  let acc = 0;
  for (let i = 0; i < entries.length; i++) {
    acc += entries[i].w;
    if (r <= acc) return entries[i].id;
  }
  return entries[entries.length - 1].id;
}

function _randInt(min, max, rngFn) {
  const r = rngFn();
  const lo = (min | 0), hi = (max | 0);
  if (hi <= lo) return lo;
  return lo + ((r * (hi - lo + 1)) | 0);
}

export function create(opts = {}) {
  const cfg = _getConfig();

  function tick(state, time, rngMaybe) {
    const rngFn = (typeof rngMaybe === "function") ? rngMaybe : Math.random;
    const cur = state && typeof state === "object" ? state : { type: "clear", turnsLeft: 0 };
    const phase = time && typeof time.phase === "string" ? time.phase : "day";

    // If we still have turns left in this weather phase, just decrement and keep it.
    if ((cur.turnsLeft | 0) > 0) {
      return { type: cur.type || "clear", turnsLeft: (cur.turnsLeft | 0) - 1 };
    }

    // Pick a new type based on weights and phase.
    const nextType = _pickType(cfg, phase, rngFn);
    const durCfg = cfg.durationTurns || {};
    const dMin = Number.isFinite(durCfg.min) ? Math.max(5, durCfg.min | 0) : 40;
    const dMax = Number.isFinite(durCfg.max) ? Math.max(dMin, durCfg.max | 0) : 140;
    const turns = _randInt(dMin, dMax, rngFn);

    return { type: nextType, turnsLeft: turns };
  }

  function describe(state, time) {
    const types = cfg && cfg.types ? cfg.types : null;
    const type = state && state.type ? String(state.type) : "clear";
    const def = types && types[type] ? types[type] : null;
    const label = def && def.label ? String(def.label) : (type === "clear" ? "Clear" : type);
    const intensity = def && Number.isFinite(def.intensity) ? Math.max(0, Math.min(1, Number(def.intensity))) : 0;
    return { type, label, intensity };
  }

  return { tick, describe };
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.WeatherService = { create };
}