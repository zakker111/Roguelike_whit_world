import { getGameData, getMod } from "../../../utils/access.js";

export function isGmEnabled(ctx) {
  try {
    const gm = (ctx && ctx.gm && typeof ctx.gm === "object") ? ctx.gm : null;
    if (gm) return !(gm.enabled === false);
  } catch (_) {}

  try {
    const GM = getMod(ctx, "GMRuntime");
    if (!GM || typeof GM.getState !== "function") return false;
    const gm = GM.getState(ctx);
    return !(gm && gm.enabled === false);
  } catch (_) {
    return false;
  }
}

export function applySyncAfterGmTransition(ctx) {
  try {
    const GA = getMod(ctx, "GameAPI");
    if (GA && typeof GA.applyCtxSyncAndRefresh === "function") {
      GA.applyCtxSyncAndRefresh(ctx);
      return true;
    }
  } catch (_) {}

  try {
    const SS = getMod(ctx, "StateSync");
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
      return true;
    }
  } catch (_) {}

  return false;
}

export function hasEncounterTemplate(ctx, id) {
  try {
    const want = String(id || "").trim().toLowerCase();
    if (!want) return false;
    const GD = getGameData(ctx);
    const reg = GD && GD.encounters && Array.isArray(GD.encounters.templates) ? GD.encounters.templates : null;
    if (!reg || !reg.length) return false;
    return !!reg.find((t) => t && String(t.id || "").toLowerCase() === want);
  } catch (_) {
    return false;
  }
}
