import { getMod } from "../../../utils/access.js";
import { isGmEnabled, mirrorGmState } from "./shared.js";
import { grantBottleMapRewards } from "../gm_bridge_effects.js";
import { removeSurveyCacheMarker } from "./survey_cache.js";
import { normalizeBottleMapInstanceId, getBottleMapOnEncounterCompleteFn } from "./bottle_map.js";

function getBottleMapThreadState(GM, ctx) {
  try {
    const gm = mirrorGmState(ctx) || (GM && typeof GM.getState === "function" ? GM.getState(ctx) : null);
    const threads = gm && gm.threads && typeof gm.threads === "object" ? gm.threads : null;
    const thread = threads && threads.bottleMap && typeof threads.bottleMap === "object" ? threads.bottleMap : null;
    return thread || null;
  } catch (_) {
    return null;
  }
}

function getSurveyCacheActiveState(GM, ctx) {
  try {
    const gm = mirrorGmState(ctx) || (GM && typeof GM.getState === "function" ? GM.getState(ctx) : null);
    const threads = gm && gm.threads && typeof gm.threads === "object" ? gm.threads : null;
    const sc = threads && threads.surveyCache && typeof threads.surveyCache === "object" ? threads.surveyCache : null;
    const active = sc && sc.active && typeof sc.active === "object" ? sc.active : null;
    return active || null;
  } catch (_) {
    return null;
  }
}

/**
 * GMBridge hook: called by encounter completion flow.
 */
export function onEncounterComplete(ctx, info) {
  try {
    const id = info && info.encounterId != null ? String(info.encounterId).trim().toLowerCase() : "";

    // If GM is disabled, don't apply any GM side effects.
    if (!isGmEnabled(ctx)) return;

    const GM = getMod(ctx, "GMRuntime");
    const bottleThreadBefore = getBottleMapThreadState(GM, ctx);
    const bottleStatusBefore = bottleThreadBefore && bottleThreadBefore.status != null ? String(bottleThreadBefore.status).trim().toLowerCase() : "";
    const bottleTargetBefore = bottleThreadBefore && bottleThreadBefore.target && typeof bottleThreadBefore.target === "object" ? bottleThreadBefore.target : null;
    const worldReturnPos = ctx && ctx.worldReturnPos && typeof ctx.worldReturnPos === "object" ? ctx.worldReturnPos : null;
    const bottleMatchesWorldReturn = !!(bottleTargetBefore && worldReturnPos
      && typeof bottleTargetBefore.absX === "number"
      && typeof bottleTargetBefore.absY === "number"
      && typeof worldReturnPos.x === "number"
      && typeof worldReturnPos.y === "number"
      && (bottleTargetBefore.absX | 0) === (worldReturnPos.x | 0)
      && (bottleTargetBefore.absY | 0) === (worldReturnPos.y | 0));
    const surveyActiveBefore = getSurveyCacheActiveState(GM, ctx);

    if (id === "gm_bottle_map_scene" || bottleStatusBefore === "inencounter" || bottleMatchesWorldReturn) {
      const MS = getMod(ctx, "MarkerService");
      if (!GM || !MS) return;

      const outcome = info && info.outcome ? String(info.outcome).trim().toLowerCase() : "";

      const onCompleteFn = getBottleMapOnEncounterCompleteFn(GM);
      if (!onCompleteFn) return;

      let res = null;
      try {
        res = onCompleteFn(ctx, { outcome, worldReturnPos: ctx.worldReturnPos }) || null;
      } catch (_) {
        res = null;
      }

      const bottleThreadAfter = getBottleMapThreadState(GM, ctx);

      const instanceId = normalizeBottleMapInstanceId(res && (res.instanceId || res.activeInstanceId || res.threadInstanceId || res.removeMarkerInstanceId));

      if (outcome !== "victory") {
        mirrorGmState(ctx);
        try { GM.onEvent(ctx, { type: "gm.bottleMap.encounterExit", interesting: false, payload: { outcome } }); } catch (_) {}
        return;
      }

      const reward = (res && (res.reward || res.rewardSpec || res.payout || res.rewardGrant || null))
        || (bottleThreadAfter && bottleThreadAfter.reward ? bottleThreadAfter.reward : null);

      let shouldGrant = !!reward;
      try {
        if (res && (res.grantRewards === false || res.shouldGrantRewards === false || res.grantReward === false)) shouldGrant = false;
      } catch (_) {}

      if (shouldGrant && reward) {
        try { grantBottleMapRewards(ctx, reward); } catch (_) {}
      }

      let removeId = normalizeBottleMapInstanceId(res && (res.removeMarkerInstanceId || res.removeInstanceId || res.removeMarkerId));
      try {
        if (!removeId && res && res.removeMarker === true) removeId = instanceId;
      } catch (_) {}
      if (!removeId) removeId = normalizeBottleMapInstanceId(bottleThreadAfter && bottleThreadAfter.instanceId);
      if (!removeId) removeId = normalizeBottleMapInstanceId(bottleThreadBefore && bottleThreadBefore.instanceId);

      if (removeId) {
        try {
          const removed = (typeof MS.remove === "function") ? (MS.remove(ctx, { kind: "gm.bottleMap", instanceId: removeId }) | 0) : 0;
          if (!removed && typeof MS.remove === "function") {
            MS.remove(ctx, (m) => m && String(m.kind || "") === "gm.bottleMap" && String(m.instanceId || "") === removeId);
          }
        } catch (_) {}
      }

      mirrorGmState(ctx);
      try { if (typeof ctx.log === "function") ctx.log("You unearth a hidden cache from the Bottle Map.", "good"); } catch (_) {}
      if (instanceId) {
        try { GM.onEvent(ctx, { type: "gm.bottleMap.claimed", interesting: true, payload: { instanceId } }); } catch (_) {}
      }

      // Ensure UI refresh after granting rewards.
      try {
        const UIO = getMod(ctx, "UIOrchestration");
        if (UIO && typeof UIO.renderInventory === "function") UIO.renderInventory(ctx);
      } catch (_) {}

      return;
    }

    if (id === "gm_survey_cache_scene" || !!surveyActiveBefore) {
      const MS = getMod(ctx, "MarkerService");
      if (!GM || !MS) return;

      const outcome = info && info.outcome ? String(info.outcome).trim().toLowerCase() : "";

      let res = null;
      try {
        if (typeof GM.surveyCache_onEncounterComplete === "function") {
          res = GM.surveyCache_onEncounterComplete(ctx, { outcome, worldReturnPos: ctx.worldReturnPos });
        }
      } catch (_) {
        res = null;
      }

      mirrorGmState(ctx);

      let instanceId = res && res.instanceId != null ? String(res.instanceId) : null;
      let absX = res && typeof res.absX === "number" && Number.isFinite(res.absX) ? (res.absX | 0) : null;
      let absY = res && typeof res.absY === "number" && Number.isFinite(res.absY) ? (res.absY | 0) : null;

      if ((!instanceId || absX == null || absY == null) && surveyActiveBefore) {
        instanceId = surveyActiveBefore.instanceId != null ? String(surveyActiveBefore.instanceId) : instanceId;
        absX = absX == null && typeof surveyActiveBefore.absX === "number" ? (surveyActiveBefore.absX | 0) : absX;
        absY = absY == null && typeof surveyActiveBefore.absY === "number" ? (surveyActiveBefore.absY | 0) : absY;
      }

      if (!instanceId || absX == null || absY == null) {
        // Fallback: best-effort derive from worldReturnPos.
        try {
          const pos = ctx.worldReturnPos || null;
          if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
            absX = pos.x | 0;
            absY = pos.y | 0;
            instanceId = `surveyCache:${absX},${absY}`;
          }
        } catch (_) {}
      }

      if (instanceId && absX != null && absY != null) {
        try { removeSurveyCacheMarker(ctx, MS, { instanceId, absX, absY }); } catch (_) {}
      }

      try {
        if (instanceId) {
          GM.onEvent(ctx, { type: "gm.surveyCache.encounterExit", interesting: false, payload: { outcome, instanceId } });
        }
      } catch (_) {}

      if (outcome !== "victory") return;

      const reward = res && res.reward ? res.reward : null;
      if (reward) {
        try { grantBottleMapRewards(ctx, reward); } catch (_) {}
      }

      try { if (typeof ctx.log === "function") ctx.log("You pry open a forgotten surveyor's cache.", "good"); } catch (_) {}
      try {
        if (instanceId) GM.onEvent(ctx, { type: "gm.surveyCache.claimed", interesting: true, payload: { instanceId } });
      } catch (_) {}
      return;
    }
  } catch (_) {}
}
