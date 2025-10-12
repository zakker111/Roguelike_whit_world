/**
 * LOS: Lightweight line-of-sight helpers.
 *
 * Exports (ESM + window.LOS):
 * - tileTransparent(ctx, x, y)
 * - hasLOS(ctx, x0, y0, x1, y1)
 *
 * Notes:
 * - Expects a ctx with { inBounds(x,y), map, TILES }.
 * - hasLOS uses a Bresenham-style step; checks transparency along the segment,
 *   excluding the start and exact target tile.
 */

export function tileTransparent(ctx, x, y) {
  if (!ctx || typeof ctx.inBounds !== "function") return false;
  if (!ctx.inBounds(x, y)) return false;
  return ctx.map[y][x] !== ctx.TILES.WALL;
}

export function hasLOS(ctx, x0, y0, x1, y1) {
  // Bresenham; check transparency along the line excluding the end tile.
  let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, e2;
  while (!(x0 === x1 && y0 === y1)) {
    e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
    if (x0 === x1 && y0 === y1) break;
    if (!tileTransparent(ctx, x0, y0)) return false;
  }
  return true;
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.LOS = { tileTransparent, hasLOS };
}