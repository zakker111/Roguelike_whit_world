import { getMod } from "../../../utils/access.js";
import { isGmEnabled, applySyncAfterGmTransition, hasEncounterTemplate } from "./shared.js";
import { startGmFactionEncounter } from "../gm_bridge_effects.js";

export function getBottleMapActivateFromItemFn(GM) {
  if (!GM) return null;
  if (typeof GM.bottleMap_activateFromItem === "function") return GM.bottleMap_activateFromItem;
  if (typeof GM.bottleMapActivateFromItem === "function") return GM.bottleMapActivateFromItem;
  return null;
}

export function getBottleMapReconcilePlanFn(GM) {
  if (!GM) return null;
  if (typeof GM.bottleMap_getReconcilePlan === "function") return GM.bottleMap_getReconcilePlan;
  if (typeof GM.bottleMapGetReconcilePlan === "function") return GM.bottleMapGetReconcilePlan;
  return null;
}

export function getBottleMapOnEncounterAttemptFn(GM) {
  if (!GM) return null;
  if (typeof GM.bottleMap_onEncounterAttempt === "function") return GM.bottleMap_onEncounterAttempt;
  if (typeof GM.bottleMapOnEncounterAttempt === "function") return GM.bottleMapOnEncounterAttempt;
  return null;
}

export function getBottleMapOnEncounterCompleteFn(GM) {
  if (!GM) return null;
  if (typeof GM.bottleMap_onEncounterComplete === "function") return GM.bottleMap_onEncounterComplete;
  if (typeof GM.bottleMapOnEncounterComplete === "function") return GM.bottleMapOnEncounterComplete;
  return null;
}

export function normalizeBottleMapInstanceId(instanceId) {
  try {
    const s = instanceId != null ? String(instanceId) : "";
    return s ? s.trim() : "";
  } catch (_) {
    return "";
  }
}

export function bottleMapExtractActiveInstanceId(plan) {
  if (!plan || typeof plan !== "object") return "";

  const direct = plan.activeInstanceId != null ? plan.activeInstanceId
    : plan.instanceId != null ? plan.instanceId
      : plan.threadInstanceId != null ? plan.threadInstanceId
        : (plan.active && typeof plan.active === "object" && plan.active.instanceId != null) ? plan.active.instanceId
          : null;

  return normalizeBottleMapInstanceId(direct);
}

export function bottleMapGetReconcilePlan(ctx, GM) {
  const fn = getBottleMapReconcilePlanFn(GM);
  if (!fn) return null;
  try {
    return fn(ctx) || null;
  } catch (_) {
    return null;
  }
}

export function bottleMapRemoveEntryMatchesInstanceId(entry, instanceId) {
  const iid = normalizeBottleMapInstanceId(instanceId);
  if (!iid) return false;

  try {
    if (!entry) return false;
    if (typeof entry === "string") return normalizeBottleMapInstanceId(entry) === iid;
    if (typeof entry === "object") {
      if (entry.instanceId != null) return normalizeBottleMapInstanceId(entry.instanceId) === iid;
      if (entry.criteria && typeof entry.criteria === "object" && entry.criteria.instanceId != null) {
        return normalizeBottleMapInstanceId(entry.criteria.instanceId) === iid;
      }
    }
  } catch (_) {}

  return false;
}

export function applyBottleMapReconcilePlan(ctx, MS, plan) {
  if (!ctx || !MS || !plan || typeof plan !== "object") return { removed: 0, added: 0 };

  let removed = 0;
  let added = 0;

  const removeAll = plan.removeAll === true || plan.removeAllMarkers === true || plan.removeAllBottleMap === true;

  if (removeAll) {
    try { removed += (MS.remove(ctx, (m) => m && String(m.kind || "") === "gm.bottleMap") | 0); } catch (_) {}
  }

  const removeList = Array.isArray(plan.remove) ? plan.remove
    : Array.isArray(plan.toRemove) ? plan.toRemove
      : Array.isArray(plan.removeMarkers) ? plan.removeMarkers
        : Array.isArray(plan.removeByInstanceId) ? plan.removeByInstanceId
          : [];

  for (const r of removeList) {
    if (!r) continue;

    if (typeof r === "function") {
      try { removed += (MS.remove(ctx, r) | 0); } catch (_) {}
      continue;
    }

    if (r === "all" || (r && typeof r === "object" && (r.all === true || r.removeAll === true))) {
      try { removed += (MS.remove(ctx, (m) => m && String(m.kind || "") === "gm.bottleMap") | 0); } catch (_) {}
      continue;
    }

    if (typeof r === "string") {
      const iid = normalizeBottleMapInstanceId(r);
      if (!iid) continue;
      try { removed += (MS.remove(ctx, { kind: "gm.bottleMap", instanceId: iid }) | 0); } catch (_) {}
      continue;
    }

    if (typeof r === "object") {
      const base = (r.criteria && typeof r.criteria === "object") ? r.criteria : r;
      const criteria = (base && base.instanceId != null && base.kind == null)
        ? Object.assign({ kind: "gm.bottleMap" }, base)
        : base;

      try { removed += (MS.remove(ctx, criteria) | 0); } catch (_) {}
    }
  }

  const addList = Array.isArray(plan.add) ? plan.add
    : Array.isArray(plan.toAdd) ? plan.toAdd
      : Array.isArray(plan.addMarkers) ? plan.addMarkers
        : Array.isArray(plan.markersToAdd) ? plan.markersToAdd
          : (plan.markerSpec ? [plan.markerSpec] : (plan.marker ? [plan.marker] : []));

  for (const m of addList) {
    if (!m) continue;
    try {
      const placed = MS.add(ctx, m);
      if (placed) added++;
    } catch (_) {}
  }

  return { removed, added };
}

export function handleBottleMapMarker(ctx, marker) {
  try {
    const GM = getMod(ctx, "GMRuntime");
    const MS = getMod(ctx, "MarkerService");
    if (!GM || !MS) return true;

    const gm = GM.getState(ctx);
    if (gm && gm.enabled === false) return false;

    const inst = normalizeBottleMapInstanceId(marker && marker.instanceId);

    // Prefer GMRuntime-driven marker reconciliation + validity checks.
    const reconcilePlanFn = getBottleMapReconcilePlanFn(GM);
    if (reconcilePlanFn) {
      const plan = bottleMapGetReconcilePlan(ctx, GM);
      if (plan) {
        try { applyBottleMapReconcilePlan(ctx, MS, plan); } catch (_) {}
      }

      const activeId = bottleMapExtractActiveInstanceId(plan);
      const isExplicitlyInactive = !!(plan && typeof plan === "object" && (plan.active === false || plan.hasActive === false || plan.status === "inactive"));

      if (!inst || isExplicitlyInactive || (activeId && activeId !== inst) || (plan && Array.isArray(plan.remove) && plan.remove.some((r) => bottleMapRemoveEntryMatchesInstanceId(r, inst)))) {
        try { if (typeof ctx.log === "function") ctx.log("The map's ink has faded.", "warn"); } catch (_) {}
        return true;
      }
    } else {
      // GMRuntime does not expose bottle-map reconciliation; do not attempt legacy bridge-owned behavior.
      try { if (typeof ctx.log === "function") ctx.log("[GM] Bottle Map runtime not available; cannot use this marker.", "warn"); } catch (_) {}
      return true;
    }

    // No fallbacks: if the specific encounter template isn't loaded yet, defer cleanly.
    if (!hasEncounterTemplate(ctx, "gm_bottle_map_scene")) {
      try { if (typeof ctx.log === "function") ctx.log("[GM] Bottle Map encounter template not ready yet; try again in a moment.", "info"); } catch (_) {}
      return true;
    }

    const UIO = getMod(ctx, "UIOrchestration");
    if (!UIO || typeof UIO.showConfirm !== "function") {
      try { if (typeof ctx.log === "function") ctx.log("[GM] Bottle Map requires confirm UI; skipping.", "warn"); } catch (_) {}
      return true;
    }

    // Phase 4 pacing: showing a choice prompt counts as an intervention.
    try {
      if (GM && typeof GM.recordIntervention === "function") {
        GM.recordIntervention(ctx, { kind: "confirm", channel: "marker", id: "gm.bottleMap" });
      }
    } catch (_) {}

    const onOk = () => {
      const started = !!startGmBottleMapEncounter(ctx);

      // Notify GMRuntime of the attempt (status/attempt bookkeeping lives there).
      try {
        const fn = getBottleMapOnEncounterAttemptFn(GM);
        if (fn) fn(ctx, { instanceId: inst, started });
      } catch (_) {}

      if (started) {
        try {
          GM.onEvent(ctx, { type: "gm.bottleMap.encounterStart", interesting: false, payload: { instanceId: inst } });
        } catch (_) {}

        // Phase 2 rule: caller applies the single sync boundary after mode changes.
        applySyncAfterGmTransition(ctx);
      }
    };

    const onCancel = () => {
      try { if (typeof ctx.log === "function") ctx.log("You decide not to follow the Bottle Map right now.", "info"); } catch (_) {}
    };

    UIO.showConfirm(ctx, "Follow the Bottle Map?", null, onOk, onCancel);
    return true;
  } catch (_) {
    return true;
  }
}

export function startGmBottleMapEncounter(ctx) {
  // IMPORTANT (Phase 1 fix): marker actions must be ctx-first for mode transitions.
  // Do not use GameAPI here (it reacquires ctx and can desync mode/player coords).
  return startGmFactionEncounter(ctx, "gm_bottle_map_scene", { ctxFirst: true });
}

export function isBottleMapItem(it) {
  try {
    if (!it) return false;
    if (it.usable !== true) return false;
    const k = String(it.kind || "").toLowerCase();
    if (k !== "tool" && k !== "item" && k !== "use") {
      // Allow custom kinds, but keep it narrow.
    }
    const id = String(it.type || it.id || it.key || it.name || "").toLowerCase();
    return id === "bottle_map" || id === "bottle map" || id.includes("bottle map") || id.includes("bottle_map");
  } catch (_) {
    return false;
  }
}

export function maybeAwardBottleMapFromFishing(ctx) {
  if (!ctx || !isGmEnabled(ctx)) return false;

  const GM = getMod(ctx, "GMRuntime");
  if (!GM || typeof GM.getState !== "function") return false;

  const gm = GM.getState(ctx);
  if (!gm || gm.enabled === false) return false;

  try {
    if (typeof GM.bottleMap_onFishingSuccess !== "function") return false;

    const res = GM.bottleMap_onFishingSuccess(ctx) || null;

    const successPayload = res && res.successEventPayload && typeof res.successEventPayload === "object" ? res.successEventPayload : null;
    if (!res || res.awarded !== true) {
      if (successPayload) {
        try { if (typeof GM.onEvent === "function") GM.onEvent(ctx, { type: "gm.bottleMap.fishing.success", interesting: false, payload: successPayload }); } catch (_) {}
      }
      return false;
    }

    const item = res && res.item ? res.item : null;
    if (!item) return false;

    // Award the bottle map item.
    try {
      const inv = (ctx.player && Array.isArray(ctx.player.inventory)) ? ctx.player.inventory : (ctx.player.inventory = []);
      inv.push(item);
    } catch (_) {
      return false;
    }

    const turn = (res && typeof res.turn === "number" && Number.isFinite(res.turn))
      ? (res.turn | 0)
      : (ctx && ctx.time && typeof ctx.time.turnCounter === "number") ? (ctx.time.turnCounter | 0) : 0;

    let awardCount = (res && typeof res.awardCount === "number" && Number.isFinite(res.awardCount))
      ? (res.awardCount | 0)
      : null;

    // Defensive fallback: read from GM state (should already be updated by GMRuntime).
    if (awardCount == null) {
      try {
        const t = gm.threads && gm.threads.bottleMap && typeof gm.threads.bottleMap === "object" ? gm.threads.bottleMap : null;
        const f = t && t.fishing && typeof t.fishing === "object" ? t.fishing : null;
        if (f && typeof f.awardCount === "number" && Number.isFinite(f.awardCount)) awardCount = (f.awardCount | 0);
      } catch (_) {}
    }

    try { if (typeof ctx.updateUI === "function") ctx.updateUI(); } catch (_) {}
    try { if (typeof ctx.rerenderInventoryIfOpen === "function") ctx.rerenderInventoryIfOpen(); } catch (_) {}
    try { if (typeof ctx.log === "function") ctx.log("You fished up a bottle map in a sealed bottle!", "good"); } catch (_) {}

    try {
      if (typeof GM.onEvent === "function") {
        const payload = { turn };
        if (awardCount != null) payload.awardCount = awardCount;
        GM.onEvent(ctx, {
          type: "gm.bottleMap.fishing.awarded",
          interesting: true,
          payload,
        });
      }
    } catch (_) {}

    return true;
  } catch (_) {
    return false;
  }
}

export function reconcileMarkers(ctx) {
  try {
    if (!ctx || !isGmEnabled(ctx)) return false;

    const GM = getMod(ctx, "GMRuntime");
    const MS = getMod(ctx, "MarkerService");
    if (!GM || !MS || typeof MS.add !== "function" || typeof MS.remove !== "function") return false;

    const plan = bottleMapGetReconcilePlan(ctx, GM);
    if (plan) {
      try { applyBottleMapReconcilePlan(ctx, MS, plan); } catch (_) {}
      return true;
    }

    return false;
  } catch (_) {
    return false;
  }
}


