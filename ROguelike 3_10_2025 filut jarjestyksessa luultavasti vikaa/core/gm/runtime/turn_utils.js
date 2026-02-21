export function localClamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

export function normalizeTurn(turn) {
  let t = typeof turn === "number" ? (turn | 0) : 0;
  if (t < 0) t = 0;
  return t;
}

export function getCurrentTurn(ctx, gm) {
  if (ctx && ctx.time && typeof ctx.time.turnCounter === "number") {
    return ctx.time.turnCounter | 0;
  }
  if (gm && gm.debug && typeof gm.debug.lastTickTurn === "number") {
    return gm.debug.lastTickTurn | 0;
  }
  return 0;
}
