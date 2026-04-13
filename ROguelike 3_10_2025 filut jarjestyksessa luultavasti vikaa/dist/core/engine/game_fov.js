/**
 * GameFOV: recompute FOV with guard/caching to avoid redundant work.
 *
 * Exports (ESM + window.GameFOV):
 * - recomputeWithGuard(ctx): runs FOV.recomputeFOV(ctx) only when inputs changed.
 *
 * Cache keys per ctx:
 * - lastX, lastY, lastRadius, lastMode, lastCols, lastRows
 */
import { fogSet } from "./fog.js";

const _cache = {
  lastX: -1,
  lastY: -1,
  lastRadius: -1,
  lastMode: "",
  lastCols: -1,
  lastRows: -1,
};

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

function updateCache(cache, ctx, rows, cols, radius) {
  cache.lastX = ctx.player.x | 0;
  cache.lastY = ctx.player.y | 0;
  cache.lastRadius = radius | 0;
  cache.lastMode = String(ctx.mode || "");
  cache.lastCols = cols | 0;
  cache.lastRows = rows | 0;
}

function paintWorldVisibilityRadius(ctx, centerX, centerY, radius, value, markSeen) {
  if (!ctx || !Array.isArray(ctx.visible) || !Array.isArray(ctx.seen)) return;
  const rows = ctx.map.length;
  const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
  const cx = centerX | 0;
  const cy = centerY | 0;
  const rr = Math.max(1, radius | 0);
  const radius2 = rr * rr;
  const y0 = Math.max(0, cy - rr);
  const y1 = Math.min(rows - 1, cy + rr);
  const x0Base = Math.max(0, cx - rr);
  const x1Base = Math.min(cols - 1, cx + rr);

  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    for (let x = x0Base; x <= x1Base; x++) {
      const dx = x - cx;
      if ((dx * dx + dy * dy) > radius2) continue;
      fogSet(ctx.visible, x, y, value);
      if (markSeen) fogSet(ctx.seen, x, y, true);
    }
  }
}

export function recomputeWithGuard(ctx) {
  if (!ctx || !Array.isArray(ctx.map)) return false;
  const rows = ctx.map.length;
  const cols = ctx.map[0] ? ctx.map[0].length : 0;

  // Base radius from ctx; apply small equipment-based bonuses (e.g., torch in hand)
  // in all modes except the overworld (world map).
  const baseRadius = (ctx.fovRadius | 0) || 1;
  let equipBonus = 0;
  try {
    if (ctx.mode !== "world") {
      const p = ctx.player || null;
      const eq = p && p.equipment ? p.equipment : null;
      if (eq) {
        const hasTorch = (it) => !!(it && typeof it.name === "string" && /torch/i.test(it.name));
        if (hasTorch(eq.left) || hasTorch(eq.right)) {
          equipBonus += 1;
        }
      }
    }
  } catch (_) {}
  const effectiveRadius = Math.max(1, baseRadius + equipBonus);

  const moved = (ctx.player.x !== _cache.lastX) || (ctx.player.y !== _cache.lastY);
  const fovChanged = (effectiveRadius !== _cache.lastRadius);
  const modeChanged = (ctx.mode !== _cache.lastMode);
  const mapChanged = (rows !== _cache.lastRows) || (cols !== _cache.lastCols);

  if (ctx.mode === "world" && moved && !modeChanged && !mapChanged && !fovChanged) {
    ensureVisibilityShape(ctx);
    if (_cache.lastX >= 0 && _cache.lastY >= 0) {
      paintWorldVisibilityRadius(ctx, _cache.lastX, _cache.lastY, effectiveRadius, false, false);
    }
    paintWorldVisibilityRadius(ctx, ctx.player.x, ctx.player.y, effectiveRadius, true, true);
    updateCache(_cache, ctx, rows, cols, effectiveRadius);
    return true;
  }

  if (!modeChanged && !mapChanged && !fovChanged && !moved) {
    return false;
  }

  ensureVisibilityShape(ctx);
  try {
    const F = (typeof window !== "undefined" ? window.FOV : null);
    if (F && typeof F.recomputeFOV === "function") {
      const prevRadius = ctx.fovRadius;
      ctx.fovRadius = effectiveRadius;
      try {
        F.recomputeFOV(ctx);
      } finally {
        ctx.fovRadius = prevRadius;
      }
    }
  } catch (_) {}

  updateCache(_cache, ctx, rows, cols, effectiveRadius);
  return true;
}

import { attachGlobal } from "../../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("GameFOV", { recomputeWithGuard });
