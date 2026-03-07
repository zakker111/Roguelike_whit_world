/**
 * GMBridge: central wrapper for GMRuntime-driven side effects.
 *
 * Exports (ESM + window.GMBridge):
 * - maybeHandleWorldStep(ctx): boolean
 * - handleMarkerAction(ctx): boolean
 * - useInventoryItem(ctx, item, idx): boolean
 * - onEncounterComplete(ctx, { encounterId, outcome }): void
 * - onWorldScanRect(ctx, { x0, y0, w, h }): void   // procedural gm.* marker spawns (scan-time)
 * - onWorldScanTile(ctx, { wx, wy, tile }): void   // backwards-compatible 1-tile scan hook
 * - ensureGuaranteedSurveyCache(ctx): void          // hybrid guarantee spawn
 */

import { getMod } from "../../utils/access.js";
import { attachGlobal } from "../../utils/global.js";
import { gmRngFloat } from "../gm/runtime/rng.js";
import { grantBottleMapRewards, startGmFactionEncounter } from "./gm_bridge_effects.js";

// ------------------------
// Survey Cache (gm.surveyCache)
// ------------------------
// NOTE: Survey Cache decisions + persistent bookkeeping now live in GMRuntime.
// GMBridge only applies effects (marker add/remove, UI prompts, encounter start, reward grant).

function isGmEnabled(ctx) {
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



function removeSurveyCacheMarker(ctx, MS, { instanceId, absX, absY } = {}) {
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

// ------------------------
// Existing GMBridge functionality
// ------------------------

export function maybeHandleWorldStep(ctx) {
  if (!ctx) return false;

  // Travel events are overworld-only. Guard against accidental calls from other modes.
  if (typeof ctx.mode === "string" && ctx.mode !== "world") return false;

  // Respect gm.enabled: if GM is disabled, do not run any GM-driven world-step intents.
  if (!isGmEnabled(ctx)) return false;

  // Phase 7: keep Bottle Map marker/thread state consistent as you move.
  // This is a cheap integrity pass (no RNG consumption).
  try { ensureBottleMapMarkerIntegrity(ctx); } catch (_) {}

  try {
    const GM = getMod(ctx, "GMRuntime");
    if (!GM || typeof GM.getFactionTravelEvent !== "function") return false;

    const intent = GM.getFactionTravelEvent(ctx) || { kind: "none" };
    if (!intent || intent.kind === "none") return false;

    if (intent.kind === "guard_fine") {
      return handleGuardFineTravelEvent(ctx, GM);
    }

    if (intent.kind === "encounter") {
      const encId = intent.encounterId || intent.id || null;
      if (!encId) return false;

      const UIO = getMod(ctx, "UIOrchestration");
      if (!UIO || typeof UIO.showConfirm !== "function") {
        // Phase 5 direction: choices only. If we can't present a confirm UI, do not force-start.
        try { if (typeof ctx.log === "function") ctx.log("[GM] Travel encounter requires confirm UI; skipping.", "warn"); } catch (_) {}
        return false;
      }

      const MZ = ctx.Messages || getMod(ctx, "Messages");
      let prompt = "";
      try {
        if (MZ && typeof MZ.get === "function") {
          const k = encId === "gm_bandit_bounty" ? "gm.travel.banditBounty.prompt" : encId === "gm_troll_hunt" ? "gm.travel.trollHunt.prompt" : "";
          if (k) prompt = MZ.get(k, null) || "";
        }
      } catch (_) {}
      if (!prompt) {
        if (encId === "gm_bandit_bounty") prompt = "You spot signs of bandits nearby. Investigate?";
        else if (encId === "gm_troll_hunt") prompt = "You hear heavy tracks and guttural noises ahead. Hunt the troll?";
        else prompt = `A strange opportunity presents itself (${String(encId)}). Investigate?`;
      }

      // Phase 4 pacing: showing a choice prompt counts as an intervention.
      try {
        if (GM && typeof GM.recordIntervention === "function") {
          GM.recordIntervention(ctx, { kind: "confirm", channel: "factionTravel", id: String(encId) });
        }
      } catch (_) {}

      const onOk = () => {
        try { startGmFactionEncounter(ctx, encId); } catch (_) {}
      };
      const onCancel = () => {
        try { if (typeof ctx.log === "function") ctx.log("You decide not to get involved.", "info"); } catch (_) {}
      };

      UIO.showConfirm(ctx, prompt, null, onOk, onCancel);
      return true;
    }

    // Unknown intent kinds are ignored for forward compatibility.
    return false;
  } catch (_) {
    try {
      if (ctx && typeof ctx.log === "function") {
        ctx.log("[GM] Failed to process faction travel event intent.", "warn");
      }
    } catch (_) {}
    return false;
  }
}

function findGmMarkerAtPlayer(ctx) {
  if (!ctx || !ctx.world || !ctx.player) return null;

  const ox = (ctx.world && typeof ctx.world.originX === "number") ? (ctx.world.originX | 0) : 0;
  const oy = (ctx.world && typeof ctx.world.originY === "number") ? (ctx.world.originY | 0) : 0;
  const absX = (ox + (ctx.player.x | 0)) | 0;
  const absY = (oy + (ctx.player.y | 0)) | 0;

  let markers = [];

  // Prefer MarkerService (dedup + canonical behavior), but tolerate missing/late modules.
  try {
    const MS = getMod(ctx, "MarkerService");
    if (MS && typeof MS.findAt === "function") {
      const at = MS.findAt(ctx, absX, absY);
      markers = Array.isArray(at) ? at : (at ? [at] : []);
    }
  } catch (_) {}

  if (!markers.length) {
    try {
      const arr = Array.isArray(ctx.world.questMarkers) ? ctx.world.questMarkers : [];
      markers = arr.filter(m => m && (m.x | 0) === absX && (m.y | 0) === absY);
    } catch (_) {
      markers = [];
    }
  }

  return markers.find((m) => m && typeof m.kind === "string" && m.kind.startsWith("gm.")) || null;
}

export function handleMarkerAction(ctx) {
  if (!ctx) return false;

  const gmMarker = findGmMarkerAtPlayer(ctx);
  if (!gmMarker) return false;

  // Even when GM is disabled, consume input on gm.* markers so we don't fall
  // through to other world actions like opening the Region Map.
  if (!isGmEnabled(ctx)) {
    try {
      if (typeof ctx.log === "function") {
        ctx.log("[GM] GM is disabled; this marker cannot be used.", "warn");
      }
    } catch (_) {}
    return true;
  }

  try {
    const kind = String(gmMarker.kind || "");

    let ok = true;

    if (kind === "gm.bottleMap") {
      ok = !!handleBottleMapMarker(ctx, gmMarker);
    } else if (kind === "gm.surveyCache") {
      ok = !!handleSurveyCacheMarker(ctx, gmMarker);
    } else {
      // Unknown gm.* markers are consumed for forward compatibility.
      try {
        if (typeof ctx.log === "function") {
          const k = String(gmMarker.kind || "gm.?");
          ctx.log(`[GM] Marker '${k}' action not implemented yet.`, "notice");
        }
      } catch (_) {}
      ok = true;
    }

    if (!ok) {
      try {
        if (typeof ctx.log === "function") {
          ctx.log(`[GM] Failed to start marker action for '${kind}'.`, "warn");
        }
      } catch (_) {}
    }

    return true;
  } catch (_) {
    // Even if the handler crashes, consume the input so we don't open Region Map.
    return true;
  }
}

function handleSurveyCacheMarker(ctx, marker) {
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

function handleBottleMapMarker(ctx, marker) {
  try {
    const GM = getMod(ctx, "GMRuntime");
    const MS = getMod(ctx, "MarkerService");
    if (!GM || !MS) return true;

    const gm = GM.getState(ctx);
    if (gm && gm.enabled === false) return false;

    const thread = ensureBottleMapThread(gm);
    if (!thread || thread.active !== true) {
      try { if (typeof ctx.log === "function") ctx.log("The map's ink has faded.", "warn"); } catch (_) {}
      // Clean up orphaned marker.
      try {
        const inst = marker && marker.instanceId != null ? String(marker.instanceId) : "";
        if (inst) MS.remove(ctx, { instanceId: inst });
      } catch (_) {}
      return true;
    }

    // Only start encounter if this marker matches the active thread target.
    const inst = marker && marker.instanceId != null ? String(marker.instanceId) : "";
    if (thread.instanceId && String(thread.instanceId) !== inst) {
      return true;
    }

    if (thread.status === "claimed") {
      try { if (typeof ctx.log === "function") ctx.log("You've already claimed what's buried here.", "info"); } catch (_) {}
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
      if (thread.status !== "inEncounter") {
        thread.status = "inEncounter";
        thread.attempts = (thread.attempts | 0) + 1;
        try {
          GM.onEvent(ctx, { type: "gm.bottleMap.encounterStart", interesting: false, payload: { instanceId: thread.instanceId } });
        } catch (_) {}
      }

      const started = !!startGmBottleMapEncounter(ctx);
      if (!started) {
        if (thread.status === "inEncounter") thread.status = "active";
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

function startGmBottleMapEncounter(ctx) {
  // IMPORTANT (Phase 1 fix): marker actions must be ctx-first for mode transitions.
  // Do not use GameAPI here (it reacquires ctx and can desync mode/player coords).
  return startGmFactionEncounter(ctx, "gm_bottle_map_scene", { ctxFirst: true });
}

function ensureBottleMapThread(gm) {
  if (!gm || typeof gm !== "object") return null;
  if (!gm.threads || typeof gm.threads !== "object") gm.threads = {};
  if (!gm.threads.bottleMap || typeof gm.threads.bottleMap !== "object") gm.threads.bottleMap = { active: false };
  return gm.threads.bottleMap;
}

function isBottleMapItem(it) {
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

function getBottleMapFishingConfig(ctx) {
  const DEFAULTS = { S0: 60, Smax: 180, boredomMin: 0.2, boredomMultMax: 3.0, cooldownTurns: 400 };
  try {
    const cfg = (typeof window !== "undefined" && window.GameData && window.GameData.config)
      ? window.GameData.config
      : null;

    const f = cfg && cfg.gm && cfg.gm.bottleMap && cfg.gm.bottleMap.fishing && typeof cfg.gm.bottleMap.fishing === "object"
      ? cfg.gm.bottleMap.fishing
      : null;

    let S0 = f && typeof f.S0 === "number" && Number.isFinite(f.S0) ? (f.S0 | 0) : DEFAULTS.S0;
    let Smax = f && typeof f.Smax === "number" && Number.isFinite(f.Smax) ? (f.Smax | 0) : DEFAULTS.Smax;
    let boredomMin = f && typeof f.boredomMin === "number" && Number.isFinite(f.boredomMin) ? f.boredomMin : DEFAULTS.boredomMin;
    let boredomMultMax = f && typeof f.boredomMultMax === "number" && Number.isFinite(f.boredomMultMax) ? f.boredomMultMax : DEFAULTS.boredomMultMax;
    let cooldownTurns = f && typeof f.cooldownTurns === "number" && Number.isFinite(f.cooldownTurns) ? (f.cooldownTurns | 0) : DEFAULTS.cooldownTurns;

    if (S0 < 0) S0 = 0;
    if (Smax < S0) Smax = S0;
    if (boredomMin < 0) boredomMin = 0;
    if (boredomMin > 1) boredomMin = 1;
    if (boredomMultMax < 1) boredomMultMax = 1;
    if (cooldownTurns < 0) cooldownTurns = 0;

    return { S0, Smax, boredomMin, boredomMultMax, cooldownTurns };
  } catch (_) {
    return Object.assign({}, DEFAULTS);
  }
}

function hasBottleMapInInventory(ctx) {
  try {
    const inv = (ctx && ctx.player && Array.isArray(ctx.player.inventory)) ? ctx.player.inventory : [];
    return inv.some((it) => {
      if (!it) return false;
      const k = String(it.kind || "").toLowerCase();
      if (k !== "tool") return false;
      const id = String(it.type || it.id || it.key || it.name || "").toLowerCase();
      return id === "bottle_map" || id === "bottle map" || id.includes("bottle map") || id.includes("bottle_map");
    });
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

  // Only one active Bottle Map thread at a time, and don't award if the player already has one.
  try {
    const thread = gm.threads && gm.threads.bottleMap && typeof gm.threads.bottleMap === "object" ? gm.threads.bottleMap : null;
    if (!thread) return false;
    if (thread.active === true) return false;
    if (hasBottleMapInInventory(ctx)) return false;

    const cfg = getBottleMapFishingConfig(ctx);

    const turn = (ctx && ctx.time && typeof ctx.time.turnCounter === "number") ? (ctx.time.turnCounter | 0) : 0;

    // Cooldown after a map award.
    const lastAwardTurn = thread.fishing && typeof thread.fishing.lastAwardTurn === "number" ? (thread.fishing.lastAwardTurn | 0) : -9999;
    if ((turn - lastAwardTurn) < (cfg.cooldownTurns | 0)) {
      if (thread.fishing) thread.fishing.totalSuccesses = (thread.fishing.totalSuccesses | 0) + 1;
      try { if (typeof GM.onEvent === "function") GM.onEvent(ctx, { type: "gm.bottleMap.fishing.success", interesting: false, payload: { awarded: false, reason: "cooldown" } }); } catch (_) {}
      return false;
    }

    // Update counters
    if (!thread.fishing || typeof thread.fishing !== "object") {
      thread.fishing = { eligibleSuccesses: 0, totalSuccesses: 0, lastAwardTurn: -9999, awardCount: 0 };
    }

    thread.fishing.totalSuccesses = (thread.fishing.totalSuccesses | 0) + 1;

    let boredom = 0;
    try {
      boredom = (gm && gm.boredom && typeof gm.boredom.level === "number" && Number.isFinite(gm.boredom.level)) ? gm.boredom.level : 0;
    } catch (_) { boredom = 0; }
    if (boredom < 0) boredom = 0;
    if (boredom > 1) boredom = 1;

    const eligible = boredom >= cfg.boredomMin;
    if (eligible) thread.fishing.eligibleSuccesses = (thread.fishing.eligibleSuccesses | 0) + 1;

    const s = thread.fishing.eligibleSuccesses | 0;
    if (!eligible || s < (cfg.S0 | 0)) {
      try { if (typeof GM.onEvent === "function") GM.onEvent(ctx, { type: "gm.bottleMap.fishing.success", interesting: false, payload: { awarded: false, eligible, s } }); } catch (_) {}
      return false;
    }

    // Probability ramp: start very low at S0 and reach near-guaranteed by Smax.
    // Multiply by boredom factor (up to boredomMultMax at boredom=1).
    const denom = Math.max(1, (cfg.Smax | 0) - (cfg.S0 | 0));
    const t = Math.max(0, Math.min(1, (s - (cfg.S0 | 0)) / denom));

    const baseChance = 0.002; // 0.2% at ramp start
    const maxChance = 0.10;   // up to 10%
    let chance = baseChance + t * (maxChance - baseChance);

    const boredomMult = 1 + boredom * (cfg.boredomMultMax - 1);
    chance *= boredomMult;

    // Hard guarantee at Smax.
    const force = s >= (cfg.Smax | 0);
    const roll = gmRngFloat(gm, null);
    const win = force || roll < chance;

    if (!win) {
      try { if (typeof GM.onEvent === "function") GM.onEvent(ctx, { type: "gm.bottleMap.fishing.success", interesting: false, payload: { awarded: false, eligible, s, chance, roll } }); } catch (_) {}
      return false;
    }

    // Award the bottle map item.
    try {
      const inv = (ctx.player && Array.isArray(ctx.player.inventory)) ? ctx.player.inventory : (ctx.player.inventory = []);
      inv.push({ kind: "tool", type: "bottle_map", id: "bottle_map", name: "bottle map", decay: 0, usable: true });
    } catch (_) {
      return false;
    }

    thread.fishing.lastAwardTurn = turn;
    thread.fishing.awardCount = (thread.fishing.awardCount | 0) + 1;
    thread.fishing.eligibleSuccesses = 0;

    try { if (typeof ctx.updateUI === "function") ctx.updateUI(); } catch (_) {}
    try { if (typeof ctx.rerenderInventoryIfOpen === "function") ctx.rerenderInventoryIfOpen(); } catch (_) {}
    try { if (typeof ctx.log === "function") ctx.log("You fished up a bottle map in a sealed bottle!", "good"); } catch (_) {}

    try { if (typeof GM.onEvent === "function") GM.onEvent(ctx, { type: "gm.bottleMap.fishing.awarded", interesting: true, payload: { turn, awardCount: thread.fishing.awardCount } }); } catch (_) {}

    return true;
  } catch (_) {
    return false;
  }
}

function pickBottleMapTarget(ctx, gm) {
  const w = (ctx && ctx.world) ? ctx.world : null;
  const map = w && Array.isArray(w.map) ? w.map : null;
  if (!map || !map.length || !map[0]) return null;

  const H = map.length | 0;
  const W = map[0].length | 0;

  const ox = (w && typeof w.originX === "number") ? (w.originX | 0) : 0;
  const oy = (w && typeof w.originY === "number") ? (w.originY | 0) : 0;

  const px = (ctx.player && typeof ctx.player.x === "number") ? (ctx.player.x | 0) : 0;
  const py = (ctx.player && typeof ctx.player.y === "number") ? (ctx.player.y | 0) : 0;
  const pAbsX = ox + px;
  const pAbsY = oy + py;

  const WorldMod = (typeof window !== "undefined" ? window.World : null) || (ctx && ctx.World ? ctx.World : null);
  const T = WorldMod && WorldMod.TILES ? WorldMod.TILES : null;

  // IMPORTANT:
  // Bottle Map targets must be walkable in the overworld.
  // Do NOT use ctx.isWalkable here: that is defined in core/game.js and is primarily for
  // town/dungeon tile ids (via Utils.isWalkableTile). Instead, validate using overworld tile rules.
  const isWalkableOverworldTile = (tile) => {
    try {
      const gen = w && w.gen;
      if (gen && typeof gen.isWalkable === "function") return !!gen.isWalkable(tile);
    } catch (_) {}
    try {
      if (WorldMod && typeof WorldMod.isWalkable === "function") return !!WorldMod.isWalkable(tile);
    } catch (_) {}
    // Conservative fallback: treat unknown as not walkable.
    return false;
  };

  const isDisallowed = (tile) => {
    if (!T) return false;
    return tile === T.WATER
      || tile === T.RIVER
      || tile === T.MOUNTAIN
      || tile === T.RUINS
      || tile === T.TOWN
      || tile === T.DUNGEON
      || (T.CASTLE != null && tile === T.CASTLE)
      || (T.TOWER != null && tile === T.TOWER);
  };

  const tries = 80;
  for (let n = 0; n < tries; n++) {
    // Distance 12..32, biased a bit farther.
    const r = 12 + Math.floor(Math.pow(gmRngFloat(gm), 0.65) * 20);
    const ang = gmRngFloat(gm) * Math.PI * 2;
    const dx = Math.round(Math.cos(ang) * r);
    const dy = Math.round(Math.sin(ang) * r);

    const absX = (pAbsX + dx) | 0;
    const absY = (pAbsY + dy) | 0;

    const lx = absX - ox;
    const ly = absY - oy;
    if (lx < 0 || ly < 0 || lx >= W || ly >= H) continue;

    const tile = map[ly] ? map[ly][lx] : null;
    if (tile == null) continue;

    if (T && isDisallowed(tile)) continue;
    if (!isWalkableOverworldTile(tile)) continue;

    return { absX, absY, tries: n + 1 };
  }

  return null;
}

function ensureBottleMapMarkerIntegrity(ctx) {
  if (!ctx || !isGmEnabled(ctx)) return false;

  const GM = getMod(ctx, "GMRuntime");
  const MS = getMod(ctx, "MarkerService");
  if (!GM || !MS || typeof MS.add !== "function" || typeof MS.remove !== "function") return false;

  const gm = GM.getState(ctx);
  if (!gm || gm.enabled === false) return false;

  const thread = ensureBottleMapThread(gm);
  if (!thread) return false;

  const active = thread.active === true && thread.status !== "claimed";
  const iid = thread.instanceId != null ? String(thread.instanceId) : "";

  // If no active thread, remove orphan bottle map markers.
  if (!active || !iid) {
    try { MS.remove(ctx, (m) => m && String(m.kind || "") === "gm.bottleMap"); } catch (_) {}
    return true;
  }

  // Remove any mismatched bottle map markers (stale instanceId, including legacy markers
  // missing an instanceId). This prevents claiming the active thread reward from the wrong marker.
  try {
    MS.remove(ctx, (m) => {
      if (!m) return false;
      if (String(m.kind || "") !== "gm.bottleMap") return false;
      return String(m.instanceId || "") !== iid;
    });
  } catch (_) {}

  const target = thread.target && typeof thread.target === "object" ? thread.target : null;
  const tx = target && typeof target.absX === "number" ? (target.absX | 0) : null;
  const ty = target && typeof target.absY === "number" ? (target.absY | 0) : null;

  if (tx == null || ty == null) {
    // Thread is broken; expire it and remove marker(s).
    thread.active = false;
    thread.status = "expired";
    thread.failureReason = thread.failureReason || "missingTarget";
    try { MS.remove(ctx, (m) => m && String(m.kind || "") === "gm.bottleMap"); } catch (_) {}
    return true;
  }

  // Ensure marker exists.
  let found = false;
  try {
    const list = (ctx.world && Array.isArray(ctx.world.questMarkers)) ? ctx.world.questMarkers : [];
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m) continue;
      if (String(m.kind || "") !== "gm.bottleMap") continue;
      if (String(m.instanceId || "") !== iid) continue;
      found = true;
      break;
    }
  } catch (_) { found = false; }

  if (!found) {
    try {
      MS.add(ctx, { x: tx, y: ty, kind: "gm.bottleMap", glyph: "X", paletteKey: "gmMarker", instanceId: iid });
    } catch (_) {}
  }

  return true;
}

function ensureUniqueGranted(gm) {
  if (!gm || typeof gm !== "object") return null;

  const runSeed = (typeof gm.runSeed === "number" && Number.isFinite(gm.runSeed)) ? (gm.runSeed >>> 0) : 0;

  if (!gm.uniqueGranted || typeof gm.uniqueGranted !== "object" || gm.uniqueGrantedRunSeed !== runSeed) {
    gm.uniqueGranted = {};
    gm.uniqueGrantedRunSeed = runSeed;
  }

  return gm.uniqueGranted;
}

function rollBottleMapReward(ctx, gm) {
  // NOTE: This roll should be deterministic and stable across retries.
  // It is computed once at Bottle Map activation and stored on the thread.

  // Gold: uniform 60..80 inclusive.
  const gold = 60 + Math.floor(gmRngFloat(gm) * 21);
  const grants = [{ kind: "gold", amount: gold }];

  // Always grant exactly 1 tier-2 equipment item.
  try {
    const Items = (typeof window !== "undefined" ? window.Items : null) || (ctx && ctx.Items ? ctx.Items : null);
    if (Items && typeof Items.createEquipment === "function") {
      const it = Items.createEquipment(2, () => gmRngFloat(gm));
      if (it) grants.push({ kind: "item", item: it });
    } else {
      // Fallback: create a minimal equip-shaped item so inventory/equip code can handle it.
      grants.push({ kind: "item", item: { kind: "equip", slot: "hand", name: "iron gear", tier: 2, atk: 0, def: 0, decay: 0 } });
    }
  } catch (_) {
    grants.push({ kind: "item", item: { kind: "equip", slot: "hand", name: "iron gear", tier: 2, atk: 0, def: 0, decay: 0 } });
  }

  // Unique drop: 2–3% per Bottle Map resolution. Enforced unique per-run via gm.uniqueGranted.
  try {
    const uniqueChance = 0.02 + (gmRngFloat(gm) * 0.01);
    const roll = gmRngFloat(gm);
    if (roll < uniqueChance) {
      const granted = ensureUniqueGranted(gm) || {};
      const pool = ["skeleton_key"]; // Expandable.
      const available = pool.filter((id) => !granted[String(id)]);

      if (available.length) {
        const pick = available[Math.floor(gmRngFloat(gm) * available.length)] || available[0];
        granted[String(pick)] = true;

        if (pick === "skeleton_key") {
          grants.push({
            kind: "tool",
            tool: {
              kind: "tool",
              type: "skeleton_key",
              id: "skeleton_key",
              name: "skeleton key",
              uses: 1,
              unique: true,
              decay: 0,
              usable: false,
            },
          });
        }
      }
    }
  } catch (_) {}

  return { grants };
}



/**
 * GMBridge hook: called by encounter completion flow.
 */
export function onEncounterComplete(ctx, info) {
  try {
    const id = info && info.encounterId != null ? String(info.encounterId).trim().toLowerCase() : "";
    if (!id) return;

    // If GM is disabled, don't apply any GM side effects.
    if (!isGmEnabled(ctx)) return;

    if (id === "gm_bottle_map_scene") {
      const GM = getMod(ctx, "GMRuntime");
      const MS = getMod(ctx, "MarkerService");
      if (!GM || !MS) return;

      const gm = GM.getState(ctx);
      const thread = ensureBottleMapThread(gm);
      if (!thread || thread.active !== true) return;

      const outcome = info && info.outcome ? String(info.outcome).trim().toLowerCase() : "";
      if (outcome !== "victory") {
        thread.status = "active";
        try { GM.onEvent(ctx, { type: "gm.bottleMap.encounterExit", interesting: false, payload: { outcome } }); } catch (_) {}
        return;
      }

      // Victory: pay out and clear marker.
      const reward = thread.reward || null;
      try { grantBottleMapRewards(ctx, reward); } catch (_) {}

      try {
        if (thread.instanceId != null) {
          const iid = String(thread.instanceId);
          const removed = (typeof MS.remove === "function") ? (MS.remove(ctx, { instanceId: iid }) | 0) : 0;
          // Fallback: some legacy markers may not carry instanceId as expected; do a best-effort remove.
          if (!removed && typeof MS.remove === "function") {
            MS.remove(ctx, (m) => m && String(m.kind || "") === "gm.bottleMap" && String(m.instanceId || "") === iid);
          }
        }
      } catch (_) {}

      thread.status = "claimed";
      thread.active = false;
      thread.claimedTurn = (ctx && ctx.time && typeof ctx.time.turnCounter === "number") ? (ctx.time.turnCounter | 0) : 0;

      try { if (typeof ctx.log === "function") ctx.log("You unearth a hidden cache from the Bottle Map.", "good"); } catch (_) {}
      try { GM.onEvent(ctx, { type: "gm.bottleMap.claimed", interesting: true, payload: { instanceId: thread.instanceId } }); } catch (_) {}

      // Ensure UI refresh after granting rewards.
      try {
        const UIO = getMod(ctx, "UIOrchestration");
        if (UIO && typeof UIO.renderInventory === "function") UIO.renderInventory(ctx);
      } catch (_) {}

      return;
    }

    if (id === "gm_survey_cache_scene") {
      const GM = getMod(ctx, "GMRuntime");
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

      let instanceId = res && res.instanceId != null ? String(res.instanceId) : null;
      let absX = res && typeof res.absX === "number" && Number.isFinite(res.absX) ? (res.absX | 0) : null;
      let absY = res && typeof res.absY === "number" && Number.isFinite(res.absY) ? (res.absY | 0) : null;

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

/**
 * Inventory "use" hook: called from InventoryFlow.useItemByIndex.
 */
export function useInventoryItem(ctx, item, idx) {
  if (!ctx || !item) return false;
  if (!isBottleMapItem(item)) return false;

  if (!isGmEnabled(ctx)) return false;

  if (ctx.mode !== "world") {
    try { if (typeof ctx.log === "function") ctx.log("The map can only be used in the overworld.", "warn"); } catch (_) {}
    return true;
  }

  const GM = getMod(ctx, "GMRuntime");
  const MS = getMod(ctx, "MarkerService");
  if (!GM || !MS) {
    try { if (typeof ctx.log === "function") ctx.log("Nothing happens.", "warn"); } catch (_) {}
    return true;
  }

  const gm = GM.getState(ctx);
  const thread = ensureBottleMapThread(gm);

  // Disallow stacking multiple active Bottle Maps.
  if (thread.active === true && thread.status !== "claimed") {
    try { if (typeof ctx.log === "function") ctx.log("The Bottle Map already points to a location.", "info"); } catch (_) {}
    return true;
  }

  // Consume the item.
  // Defensive: InventoryFlow should pass a valid idx, but avoid (idx|0) pitfalls
  // (e.g. undefined|0 === 0) which could delete the wrong inventory slot.
  let consumed = false;
  try {
    const inv = Array.isArray(ctx.player.inventory) ? ctx.player.inventory : (ctx.player.inventory = []);

    let i = -1;
    if (typeof idx === "number" && Number.isFinite(idx)) i = (idx | 0);

    // Prefer strict identity match to avoid consuming the wrong item.
    if (i < 0 || i >= inv.length || inv[i] !== item) {
      const byRef = inv.indexOf(item);
      if (byRef >= 0) i = byRef;
    }

    // If the resolved index isn't a bottle map, abort.
    if (i >= 0 && i < inv.length && inv[i] && !isBottleMapItem(inv[i])) i = -1;

    if (i < 0 || i >= inv.length) {
      try { if (typeof ctx.log === "function") ctx.log("The Bottle Map slips from your fingers. Nothing happens.", "warn"); } catch (_) {}
      return true;
    }

    inv.splice(i, 1);
    consumed = true;
  } catch (_) {
    return true;
  }

  // Safety: never start a Bottle Map thread if we failed to consume the map.
  if (!consumed) return true;

  // Roll deterministic target + reward using GM RNG.
  const target = pickBottleMapTarget(ctx, gm);
  if (!target) {
    // Graceful expiry: if we can't find a valid target, do not start the thread.
    // Refund the item if we consumed it.
    try {
      if (consumed) {
        const inv = Array.isArray(ctx.player.inventory) ? ctx.player.inventory : (ctx.player.inventory = []);
        inv.push({ kind: "tool", type: "bottle_map", id: "bottle_map", name: "bottle map", decay: 0, usable: true });
      }
    } catch (_) {}

    thread.active = false;
    thread.status = "expired";
    thread.failureReason = "targetPlacementFailed";

    try { if (typeof ctx.log === "function") ctx.log("The Bottle Map's ink runs and becomes unreadable.", "warn"); } catch (_) {}
    try { GM.onEvent(ctx, { type: "gm.bottleMap.expired", interesting: false, payload: { reason: "targetPlacementFailed" } }); } catch (_) {}
    return true;
  }

  const reward = rollBottleMapReward(ctx, gm);

  const turn = (ctx && ctx.time && typeof ctx.time.turnCounter === "number") ? (ctx.time.turnCounter | 0) : 0;
  const id = `bottleMap:${turn}:${(gm && gm.rng ? (gm.rng.calls | 0) : 0)}`;

  thread.active = true;
  thread.instanceId = id;
  thread.createdTurn = turn;
  thread.status = "active";
  thread.attempts = 0;
  thread.target = { absX: target.absX, absY: target.absY };
  thread.reward = reward;
  thread.failureReason = null;
  thread.placementTries = target.tries | 0;

  try {
    MS.add(ctx, {
      x: target.absX,
      y: target.absY,
      kind: "gm.bottleMap",
      glyph: "X",
      paletteKey: "gmMarker",
      instanceId: id,
      createdTurn: turn,
    });
  } catch (_) {}

  // Ensure marker is present and stale markers are cleaned.
  try { ensureBottleMapMarkerIntegrity(ctx); } catch (_) {}

  try { GM.onEvent(ctx, { type: "gm.bottleMap.activated", interesting: true, payload: { instanceId: id } }); } catch (_) {}
  try { if (typeof ctx.log === "function") ctx.log("You study the Bottle Map. An X appears on your world map.", "notice"); } catch (_) {}
  try { if (typeof ctx.updateUI === "function") ctx.updateUI(); } catch (_) {}

  return true;
}

function handleGuardFineTravelEvent(ctx, GM) {
  if (!ctx || !ctx.player) return false;

  try {
    const MZ = getMod(ctx, "Messages");
    const UIO = getMod(ctx, "UIOrchestration");

    if (!GM || typeof GM.onEvent !== "function") return false;

    const inv = Array.isArray(ctx.player.inventory) ? ctx.player.inventory : (ctx.player.inventory = []);
    let goldObj = inv.find(it => it && String(it.kind || it.type || "").toLowerCase() === "gold");
    if (!goldObj) {
      goldObj = { kind: "gold", amount: 0, name: "gold" };
      inv.push(goldObj);
    }

    const currentGold = (typeof goldObj.amount === "number" ? goldObj.amount : 0) | 0;

    const level = (typeof ctx.player.level === "number" ? (ctx.player.level | 0) : 1);
    let fine = level * 10;
    if (fine < 30) fine = 30;
    if (fine > 300) fine = 300;

    if (currentGold < fine) {
      try {
        if (MZ && typeof MZ.log === "function") {
          MZ.log(ctx, "gm.guardFine.noMoney", null, "warn");
        } else if (typeof ctx.log === "function") {
          ctx.log("A patrol of guards demands a fine you cannot afford. They let you go with a warning this time.", "warn");
        }
      } catch (_) {}

      try { GM.onEvent(ctx, { type: "gm.guardFine.refuse" }); } catch (_) {}
      return true;
    }

    const vars = { amount: fine };
    let prompt = "";
    try {
      if (MZ && typeof MZ.get === "function") {
        prompt = MZ.get("gm.guardFine.prompt", vars) || "";
      }
    } catch (_) {}
    if (!prompt) prompt = `A patrol of guards demands a fine of ${fine} gold for your crimes.\nPay?`;

    const onPay = () => {
      try { goldObj.amount = Math.max(0, currentGold - fine); } catch (_) {}
      try { GM.onEvent(ctx, { type: "gm.guardFine.pay" }); } catch (_) {}
      try {
        if (MZ && typeof MZ.log === "function") MZ.log(ctx, "gm.guardFine.paid", { amount: fine }, "good");
        else if (typeof ctx.log === "function") ctx.log(`You pay ${fine} gold to settle your fines with the guards.`, "info");
      } catch (_) {}
      try { if (typeof ctx.updateUI === "function") ctx.updateUI(); } catch (_) {}
    };

    const onRefuse = () => {
      try { GM.onEvent(ctx, { type: "gm.guardFine.refuse" }); } catch (_) {}
      try {
        if (MZ && typeof MZ.log === "function") MZ.log(ctx, "gm.guardFine.refused", null, "warn");
        else if (typeof ctx.log === "function") ctx.log("You refuse to pay the fine. The guards will remember this.", "warn");
      } catch (_) {}
    };

    if (UIO && typeof UIO.showConfirm === "function") {
      // Phase 4 (v0.3 pacing): showing a choice prompt counts as an intervention.
      try {
        if (GM && typeof GM.recordIntervention === "function") {
          GM.recordIntervention(ctx, { kind: "confirm", channel: "factionTravel", id: "guardFine" });
        }
      } catch (_) {}

      UIO.showConfirm(ctx, prompt, null, onPay, onRefuse);
      return true;
    }

    // v0.3 direction: choices only (no forced outcomes).
    // If we cannot present a confirm UI, do not auto-pay or auto-refuse.
    try {
      if (typeof ctx.log === "function") {
        ctx.log("[GM] Guard fine requires confirm UI; skipping (no forced outcome).", "warn");
      }
    } catch (_) {}

    return false;
  } catch (_) {
    try { if (ctx && typeof ctx.log === "function") ctx.log("[GM] Error handling guard fine travel event.", "warn"); } catch (_) {}
    return false;
  }
}





export function reconcileMarkers(ctx) {
  try { return !!ensureBottleMapMarkerIntegrity(ctx); } catch (_) { return false; }
}

attachGlobal("GMBridge", {
  maybeHandleWorldStep,
  handleMarkerAction,
  onEncounterComplete,
  useInventoryItem,
  maybeAwardBottleMapFromFishing,
  onWorldScanRect,
  onWorldScanTile,
  ensureGuaranteedSurveyCache,
  reconcileMarkers,
});
