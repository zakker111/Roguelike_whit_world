/**
 * GameFOV: recompute FOV with guard/caching to avoid redundant work.
 *
 * Exports (ESM + window.GameFOV):
 * - recomputeWithGuard(ctx): runs FOV.recomputeFOV(ctx) only when inputs changed.
 *
 * Cache keys per ctx:
 * - lastX, lastY, lastRadius, lastMode, lastCols, lastRows
 */
const _cache = new WeakMap();

function getCache(ctx) {
  let c = _cache.get(ctx);
  if (!c) {
    c = { lastX: -1, lastY: -1, lastRadius: -1, lastMode: "", lastCols: -1, lastRows: -1 };
    _cache.set(ctx, c);
  }
  return c;
}

function ensureVisibilityShape(ctx) {
  try {
    if (typeof window !== "undefined" && window.GameState && typeof window.GameState.ensureVisibilityShape === "function") {
      window.GameState.ensureVisibilityShape(ctx);
      return;
    }
  } catch (_) {}
  const rows = ctx.map.length;
  const cols = ctx.map[0] ? ctx.map[0].length : 0;
  const okVis = Array.isArray(ctx.visible) && ctx.visible.length === rows && (rows === 0 || (ctx.visible[0] && ctx.visible[0].length === cols));
  if (!okVis) ctx.visible = Array.from({ length: rows }, () => Array(cols).fill(false));
  const okSeen = Array.isArray(ctx.seen) && ctx.seen.length === rows && (rows === 0 || (ctx.seen[0] && ctx.seen[0].length === cols));
  if (!okSeen) ctx.seen = Array.from({ length: rows }, () => Array(cols).fill(false));
}

export function recomputeWithGuard(ctx) {
  if (!ctx || !Array.isArray(ctx.map)) return false;
  const rows = ctx.map.length;
  const cols = ctx.map[0] ? ctx.map[0].length : 0;
  const cache = getCache(ctx);
  const moved = (ctx.player.x !== cache.lastX) || (ctx.player.y !== cache.lastY);
  const fovChanged = (ctx.fovRadius !== cache.lastRadius);
  const modeChanged = (ctx.mode !== cache.lastMode);
  const mapChanged = (rows !== cache.lastRows) || (cols !== cache.lastCols);

  if (!modeChanged && !mapChanged && !fovChanged && !moved) {
    return false;
  }

  ensureVisibilityShape(ctx);
  try {
    const F = (typeof window !== "undefined" ? window.FOV : null);
    if (F && typeof F.recomputeFOV === "function") {
      F.recomputeFOV(ctx);
    }
  } catch (_) {}

  cache.lastX = ctx.player.x | 0;
  cache.lastY = ctx.player.y | 0;
  cache.lastRadius = ctx.fovRadius | 0;
  cache.lastMode = String(ctx.mode || "");
  cache.lastCols = cols | 0;
  cache.lastRows = rows | 0;
  return true;
}

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("GameFOV", { recomputeWithGuard });