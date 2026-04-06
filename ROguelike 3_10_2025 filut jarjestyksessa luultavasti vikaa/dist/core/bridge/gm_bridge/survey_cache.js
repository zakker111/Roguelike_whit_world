import { getMod } from "../../../utils/access.js";
import { applySyncAfterGmTransition, hasEncounterTemplate } from "./shared.js";
import { startGmFactionEncounter } from "../gm_bridge_effects.js";

export function removeSurveyCacheMarker(ctx, MS, { instanceId, absX, absY } = {}) {
  if (!MS || typeof MS.remove !== "function") return 0;

  const iid = (instanceId != null) ? String(instanceId) : "";
  const x = (typeof absX === "number" && Number.isFinite(absX)) ? (absX | 0) : null;
  const y = (typeof absY === "number" && Number.isFinite(absY)) ? (absY | 0) : null;

  let removed = 0;

  if (iid) {
    // Prefer criteria object with kind+instanceId to avoid accidental collisions.
    try { removed = (MS.remove(ctx, { kind: "gm.surveyCache", instanceId: iid }) | 0); } catch (_) {}
    if (!removed) {
      try {
        removed = (MS.remove(ctx, (m) => m && String(m.kind || "") === "gm.surveyCache" && String(m.instanceId || "") === iid) | 0);
      } catch (_) {}
    }
  }

  if (!removed && x != null && y != null) {
    try {
      removed = (MS.remove(ctx, (m) => m && String(m.kind || "") === "gm.surveyCache" && (m.x | 0) === x && (m.y | 0) === y) | 0);
    } catch (_) {}
  }

  return removed;
}

export function handleSurveyCacheMarker(ctx, marker) {
  try {
    const GM = getMod(ctx, "GMRuntime");
    const MS = getMod(ctx, "MarkerService");
    if (!GM || !MS) return true;

    const gm = (typeof GM.getState === "function") ? GM.getState(ctx) : null;
    if (gm && gm.enabled === false) return false;

    const absX = marker && typeof marker.x === "number" ? (marker.x | 0) : 0;
    const absY = marker && typeof marker.y === "number" ? (marker.y | 0) : 0;
    const instanceId = (marker && marker.instanceId != null)
      ? String(marker.instanceId)
      : `surveyCache:${absX},${absY}`;

    // Delegate claim bookkeeping to GMRuntime.
    try {
      if (typeof GM.surveyCache_isClaimed === "function" && GM.surveyCache_isClaimed(ctx, instanceId)) {
        try { if (typeof ctx.log === "function") ctx.log("This cache has already been picked clean.", "info"); } catch (_) {}
        try {
          const iid = String(instanceId);
          if (typeof MS.remove === "function") {
            MS.remove(ctx, (m) => m && String(m.kind || "") === "gm.surveyCache" && (String(m.instanceId || "") === iid || ((m.x | 0) === absX && (m.y | 0) === absY)));
          }
        } catch (_) {}
        return true;
      }
    } catch (_) {}

    // No fallbacks: if the specific encounter template isn't loaded yet, defer cleanly.
    if (!hasEncounterTemplate(ctx, "gm_survey_cache_scene")) {
      try { if (typeof ctx.log === "function") ctx.log("[GM] Survey Cache encounter template not ready yet; try again in a moment.", "info"); } catch (_) {}
      return true;
    }

    const UIO = getMod(ctx, "UIOrchestration");
    if (!UIO || typeof UIO.showConfirm !== "function") {
      try { if (typeof ctx.log === "function") ctx.log("[GM] Survey Cache requires confirm UI; skipping.", "warn"); } catch (_) {}
      return true;
    }

    // Phase 4 pacing: showing a choice prompt counts as an intervention.
    try {
      if (typeof GM.recordIntervention === "function") {
        GM.recordIntervention(ctx, { kind: "confirm", channel: "marker", id: "gm.surveyCache" });
      }
    } catch (_) {}

    const onOk = () => {
      try {
        const started = !!startGmFactionEncounter(ctx, "gm_survey_cache_scene", { ctxFirst: true });
        if (!started) {
          try { if (typeof ctx.log === "function") ctx.log("Nothing happens.", "warn"); } catch (_) {}
          try { if (typeof ctx.log === "function") ctx.log("[GM] Failed to start Survey Cache encounter.", "warn"); } catch (_) {}
          return;
        }

        // Persist encounter start + claim immediately so fleeing/withdrawing cannot re-enter.
        try {
          if (typeof GM.surveyCache_onEncounterStart === "function") {
            GM.surveyCache_onEncounterStart(ctx, { instanceId, absX, absY });
          }
        } catch (_) {}

        // Consume marker on successful start.
        try { removeSurveyCacheMarker(ctx, MS, { instanceId, absX, absY }); } catch (_) {}

        try {
          GM.onEvent(ctx, { type: "gm.surveyCache.encounterStart", interesting: false, payload: { instanceId } });
        } catch (_) {}

        // Phase 2 rule: caller applies the single sync boundary after mode changes.
        applySyncAfterGmTransition(ctx);
      } catch (err) {
        try { if (typeof ctx.log === "function") ctx.log("[GM] Error while starting Survey Cache encounter.", "warn"); } catch (_) {}
        try { if (typeof console !== "undefined" && console && typeof console.error === "function") console.error(err); } catch (_) {}
      }
    };

    const onCancel = () => {
      try { if (typeof ctx.log === "function") ctx.log("You leave the cache alone.", "info"); } catch (_) {}
    };

    UIO.showConfirm(ctx, "Investigate the Surveyor's Cache?", null, onOk, onCancel);
    return true;
  } catch (_) {
    return true;
  }
}
