/**
 * Perf helpers: track turn/draw times and provide EMA-smoothed stats.
 */
const state = {
  lastTurnMs: 0,
  lastDrawMs: 0,
  avgTurnMs: 0,
  avgDrawMs: 0,
};
const A = 0.35; // EMA smoothing factor

export function measureDraw(ms) {
  state.lastDrawMs = ms;
  if (typeof state.avgDrawMs !== "number" || state.avgDrawMs === 0) state.avgDrawMs = ms;
  else state.avgDrawMs = (A * ms) + ((1 - A) * state.avgDrawMs);
}

export function measureTurn(ms) {
  state.lastTurnMs = ms;
  if (typeof state.avgTurnMs !== "number" || state.avgTurnMs === 0) state.avgTurnMs = ms;
  else state.avgTurnMs = (A * ms) + ((1 - A) * state.avgTurnMs);
}

export function getPerfStats() {
  return {
    lastTurnMs: (typeof state.avgTurnMs === "number" && state.avgTurnMs > 0 ? state.avgTurnMs : (state.lastTurnMs || 0)),
    lastDrawMs: (typeof state.avgDrawMs === "number" && state.avgDrawMs > 0 ? state.avgDrawMs : (state.lastDrawMs || 0)),
  };
}

// Optional back-compat for debugging
if (typeof window !== "undefined") {
  window.Perf = {
    measureDraw,
    measureTurn,
    getPerfStats,
    _state: state
  };
}