/**
 * Plaza helpers.
 * Export:
 *  - placePlazaPrefabStrict(ctx, plaza, plazaW, plazaH): stamps a plaza prefab if available (strict; no fallback)
 */
import * as Prefabs from "./prefabs.js";
import { attachGlobal } from "../utils/global.js";

export function placePlazaPrefabStrict(ctx, plaza, plazaW, plazaH) {
  try {
    // Guard: if a plaza prefab was already stamped in this generation cycle, skip
    try {
      if (ctx.townPrefabUsage && Array.isArray(ctx.townPrefabUsage.plazas) && ctx.townPrefabUsage.plazas.length > 0) return;
    } catch (_) {}
    const PFB = (typeof window !== "undefined" && window.GameData && window.GameData.prefabs) ? window.GameData.prefabs : null;
    const plazas = (PFB && Array.isArray(PFB.plazas)) ? PFB.plazas : [];
    if (!plazas.length) return;
    // Filter prefabs that fit inside current plaza rectangle
    const fit = plazas.filter(p => p && p.size && (p.size.w | 0) <= plazaW && (p.size.h | 0) <= plazaH);
    const list = (fit.length ? fit : plazas);
    const rng = (ctx && typeof ctx.rng === "function") ? ctx.rng : (() => 0.5);
    const pref = Prefabs.pickPrefab(list, rng);
    if (!pref || !pref.size) return;
    // Center the plaza prefab within the carved plaza rectangle
    const bx = ((plaza.x - ((pref.size.w / 2) | 0)) | 0);
    const by = ((plaza.y - ((pref.size.h / 2) | 0)) | 0);
    if (!Prefabs.stampPlazaPrefab(ctx, pref, bx, by)) {
      // Attempt slight slip only; no fallback
      Prefabs.trySlipStamp(ctx, pref, bx, by, 2);
    }
  } catch (_) {}
}

attachGlobal("PlazaGen", { placePlazaPrefabStrict });