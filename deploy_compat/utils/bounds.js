/**
 * Bounds: shared in-bounds and clamp helpers.
 *
 * Exports (ESM + window.Bounds):
 * - inBounds(ctx, x, y)
 * - clamp(v, lo, hi)
 */
export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function inBounds(ctx, x, y) {
  try {
    if (ctx && typeof ctx.inBounds === "function") return !!ctx.inBounds(x, y);
  } catch (_) {}
  if (!ctx || !Array.isArray(ctx.map) || !ctx.map.length) return false;
  const rows = ctx.map.length;
  const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
  return x >= 0 && y >= 0 && x < cols && y < rows;
}

import { attachGlobal } from "./global.js";
// Back-compat: attach to window via helper
attachGlobal("Bounds", { inBounds, clamp });