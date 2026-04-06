/**
 * Small GMRuntime utilities around turn counters.
 *
 * These are kept separate from the main runtime module so they can be reused by
 * state normalization and intent generation without pulling in any module-local
 * runtime state.
 */

export function localClamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

// Normalize any turn-like value into a non-negative int.
export function normalizeTurn(turn) {
  let t = typeof turn === "number" ? (turn | 0) : 0;
  if (t < 0) t = 0;
  return t;
}

// Prefer ctx.time.turnCounter, else fall back to the last observed tick turn.
export function getCurrentTurn(ctx, gm) {
  if (ctx && ctx.time && typeof ctx.time.turnCounter === "number") {
    return ctx.time.turnCounter | 0;
  }
  if (gm && gm.debug && typeof gm.debug.lastTickTurn === "number") {
    return gm.debug.lastTickTurn | 0;
  }
  return 0;
}
