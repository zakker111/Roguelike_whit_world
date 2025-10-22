/**
 * GameState: small helpers for ctx state shape and refresh.
 *
 * Exports (ESM + window.GameState):
 * - ensureVisibilityShape(ctx)
 * - applySyncAndRefresh(ctx)
 */
export function ensureVisibilityShape(ctx) {
  if (!ctx || !Array.isArray(ctx.map)) return;
  const rows = ctx.map.length;
  const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;

  function okGrid(grid) {
    try {
      return Array.isArray(grid) && grid.length === rows && (rows === 0 || (Array.isArray(grid[0]) && grid[0].length === cols));
    } catch (_) { return false; }
  }

  if (!okGrid(ctx.visible)) {
    ctx.visible = Array.from({ length: rows }, () => Array(cols).fill(false));
  }
  if (!okGrid(ctx.seen)) {
    ctx.seen = Array.from({ length: rows }, () => Array(cols).fill(false));
  }
}

export function applySyncAndRefresh(ctx) {
  try { if (typeof ctx.updateCamera === "function") ctx.updateCamera(); } catch (_) {}
  try { if (typeof ctx.recomputeFOV === "function") ctx.recomputeFOV(); } catch (_) {}
  try { if (typeof ctx.updateUI === "function") ctx.updateUI(); } catch (_) {}
  try { if (typeof ctx.requestDraw === "function") ctx.requestDraw(); } catch (_) {}
}

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("GameState", { ensureVisibilityShape, applySyncAndRefresh });