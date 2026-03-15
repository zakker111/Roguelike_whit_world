import { getMod } from "../../../utils/access.js";
import { isGmEnabled } from "./shared.js";

export function onWorldScanRect(ctx, { x0, y0, w, h } = {}) {
  if (!ctx) return;
  if (!isGmEnabled(ctx)) return;

  const GM = getMod(ctx, "GMRuntime");
  const MS = getMod(ctx, "MarkerService");
  if (!GM || !MS || typeof MS.add !== "function" || typeof GM.getState !== "function") return;

  const gm = GM.getState(ctx);
  if (!gm || gm.enabled === false) return;

  // Delegate Survey Cache spawn decisions to GMRuntime; GMBridge only applies effects.
  try {
    if (typeof GM.surveyCache_worldScanRect === "function") {
      const res = GM.surveyCache_worldScanRect(ctx, { x0, y0, w, h }) || {};
      const markers = Array.isArray(res.markers) ? res.markers : [];
      for (const m of markers) {
        let placed = null;
        try { placed = MS.add(ctx, m); } catch (_) { placed = null; }
        if (placed && typeof GM.surveyCache_onMarkerPlaced === "function") {
          try { GM.surveyCache_onMarkerPlaced(ctx); } catch (_) {}
        }
      }
    }
  } catch (_) {}

  // Hybrid thread: guarantee spawn should be safe to call repeatedly.
  try { ensureGuaranteedSurveyCache(ctx); } catch (_) {}
}

// Backwards-compatible 1-tile hook.
export function onWorldScanTile(ctx, { wx, wy } = {}) {
  return onWorldScanRect(ctx, {
    x0: (wx | 0) - ((ctx.world && ctx.world.originX) | 0),
    y0: (wy | 0) - ((ctx.world && ctx.world.originY) | 0),
    w: 1,
    h: 1
  });
}

export function ensureGuaranteedSurveyCache(ctx) {
  if (!ctx) return;
  if (!isGmEnabled(ctx)) return;

  const GM = getMod(ctx, "GMRuntime");
  const MS = getMod(ctx, "MarkerService");
  if (!GM || !MS || typeof MS.add !== "function" || typeof GM.getState !== "function") return;

  const gm = GM.getState(ctx);
  if (!gm || gm.enabled === false) return;

  if (typeof GM.surveyCache_ensureGuaranteed !== "function") return;

  const res = GM.surveyCache_ensureGuaranteed(ctx) || {};
  const marker = res.marker || null;
  if (!marker) return;

  let placed = null;
  try { placed = MS.add(ctx, marker); } catch (_) { placed = null; }

  if (placed && typeof GM.surveyCache_onMarkerPlaced === "function") {
    try { GM.surveyCache_onMarkerPlaced(ctx); } catch (_) {}
  }
}
