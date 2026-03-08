/**
 * GMRuntime (v0.2 foundations)
 *
 * Goals:
 * - Deterministic, ctx-first GM bookkeeping and intent generation.
 * - Persist per-run GM state into localStorage (GM_STATE_V1) when available.
 * - Provide a dedicated GM RNG stream + deterministic scheduler for future GM actions.
 *
 * Public API:
 * - init(ctx, { reset?: boolean, forceReload?: boolean })
 * - tick(ctx)
 * - onEvent(ctx, event)
 * - getState(ctx)
 * - reset(ctx)
 * - getEntranceIntent(ctx, mode?)
 * - getMechanicHint(ctx)
 * - getFactionTravelEvent(ctx)
 * - forceFactionTravelEvent(ctx, id)
 * - surveyCache_worldScanRect(ctx, rect)
 * - surveyCache_ensureGuaranteed(ctx)
 * - surveyCache_onMarkerPlaced(ctx)
 * - surveyCache_isClaimed(ctx, instanceId)
 * - surveyCache_onEncounterStart(ctx, meta)
 * - surveyCache_onEncounterComplete(ctx, meta)
 * - bottleMap_onFishingSuccess(ctx)
 * - bottleMap_onUseItem(ctx, meta)
 * - bottleMap_reconcileMarkers(ctx, meta)
 * - bottleMap_onEncounterStart(ctx, meta)
 * - bottleMap_onEncounterComplete(ctx, meta)
 * - onWorldScanRect(ctx, rect)              // legacy wrappers (delegate to GMBridge)
 * - onWorldScanTile(ctx, meta)              // legacy wrappers
 * - ensureGuaranteedSurveyCache(ctx)        // legacy wrapper
 */

import { attachGlobal } from "../../utils/global.js";

import { SCHEMA_VERSION, MAX_DEBUG_EVENTS } from "./runtime/constants.js";

import { deriveRunSeed, ensureSeededGmRng } from "./runtime/rng.js";

import { createDefaultMood, createDefaultState } from "./runtime/state_defaults.js";

import {
  ensureStats,
  ensureTraitsAndMechanics,
  ensureThreads,
  ensureFactionEvents,
  ensureRng,
  ensureScheduler,
  ensurePacing,
} from "./runtime/state_ensure.js";

import { localClamp, normalizeTurn, getCurrentTurn } from "./runtime/turn_utils.js";
import { addMoodImpulse, pushIntentDebug } from "./runtime/debug.js";
import { tickImpl } from "./runtime/tick.js";

import { getEntranceIntentImpl } from "./runtime/intents/entrance.js";
import { getMechanicHintImpl } from "./runtime/intents/mechanic_hint.js";

import { consumeInterventionCooldown } from "./runtime/pacing.js";

import {
  migrateFactionEventSlotsToScheduler,
  maybeScheduleFactionEvents,
  getFactionTravelEventImpl,
  forceFactionTravelEventImpl,
} from "./runtime/faction_travel.js";

import {
  updateFamiliesFromCombatKill,
  updateFactionsFromCombatKill,
  updateTraitsFromCombatKill,
  updateTraitsFromQuestComplete,
  updateTraitsFromCaravanEvent,
  updateMechanicsUsage,
  applyGuardFineOutcome,
} from "./runtime/events/updates.js";

import {
  surveyCacheComputeScanSpawn,
  surveyCacheComputeGuaranteedSpawn,
  surveyCacheIsClaimed,
  surveyCacheSetNextSpawnTurn,
  surveyCacheOnEncounterStart as surveyCacheOnEncounterStartImpl,
  surveyCacheOnEncounterComplete as surveyCacheOnEncounterCompleteImpl,
} from "./runtime/threads/survey_cache.js";

import * as bottleMapThread from "./runtime/threads/bottle_map.js";

// HealthCheck registration for GMRuntime is handled centrally in core/capabilities.js.

// ------------------------
// Module-local state
// ------------------------

let _state = null;

// ------------------------
// Persistence (GM_STATE_V1)
// ------------------------

const LS_KEY = "GM_STATE_V1";
let _loadedOnce = false;
let _dirty = false;
let _lastSavedTurn = -1;
let _lastSaveMs = 0;

function isLocalStorageDisabled(ctx) {
  try {
    if (ctx && (ctx.NO_LOCALSTORAGE || ctx.noLocalStorage)) return true;
  } catch (_) {}
  try {
    if (typeof window !== "undefined" && window.NO_LOCALSTORAGE) return true;
  } catch (_) {}
  return false;
}



function bootLog(msg, level = "info", meta) {
  const m = meta && typeof meta === "object" ? meta : {};
  const line = msg == null ? "" : String(msg);

  try {
    if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") {
      window.Logger.log(line, level, m);
      return;
    }
  } catch (_) {}

  try {
    // eslint-disable-next-line no-console
    if (typeof console !== "undefined" && typeof console.log === "function") console.log(line);
  } catch (_) {}
}

function markDirty(gm) {
  _dirty = true;
  try {
    if (gm && typeof gm === "object") gm._dirty = true;
  } catch (_) {}
}

function clearDirty(gm) {
  _dirty = false;
  try {
    if (gm && typeof gm === "object") gm._dirty = false;
  } catch (_) {}
}

function readPersistedState(ctx) {
  if (isLocalStorageDisabled(ctx)) return null;
  try {
    const raw = (typeof localStorage !== "undefined") ? localStorage.getItem(LS_KEY) : null;
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    return obj;
  } catch (_) {
    return null;
  }
}

function writePersistedState(ctx, gm, { force = false } = {}) {
  if (!gm || typeof gm !== "object") return false;
  if (gm.enabled === false) return false;
  if (isLocalStorageDisabled(ctx)) return false;

  if (!force && !_dirty) return false;

  const turn = normalizeTurn(getCurrentTurn(ctx, gm));

  if (!force) {
    if (turn === _lastSavedTurn) return false;
    const now = Date.now();
    if ((now - _lastSaveMs) < 500) return false;
  }

  try {
    const json = JSON.stringify(gm);
    localStorage.setItem(LS_KEY, json);
    _lastSavedTurn = turn;
    _lastSaveMs = Date.now();
    clearDirty(gm);
    return true;
  } catch (_) {
    return false;
  }
}

function clearPersistedState(ctx) {
  if (isLocalStorageDisabled(ctx)) return;
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(LS_KEY);
  } catch (_) {}
}



// ------------------------
// Intents + debug bookkeeping
// ------------------------





// ------------------------
// State normalization
// ------------------------

function upgradeAndNormalizeState(ctx, gm) {
  if (!gm || typeof gm !== "object") gm = createDefaultState();

  const rawVer = gm.schemaVersion;
  const ver = (typeof rawVer === "number" && Number.isFinite(rawVer)) ? (rawVer | 0) : 0;
  if (ver > SCHEMA_VERSION) {
    gm = createDefaultState();
  }

  // Ensure core containers exist.
  ensureStats(gm);
  ensureTraitsAndMechanics(gm);
  ensureThreads(gm);
  ensureFactionEvents(gm);
  ensureRng(gm);
  ensureScheduler(gm);
  ensurePacing(gm);
  migrateFactionEventSlotsToScheduler(gm, markDirty);

  if (!gm.mood || typeof gm.mood !== "object") gm.mood = createDefaultMood();
  if (!gm.boredom || typeof gm.boredom !== "object") {
    gm.boredom = {
      level: 0,
      turnsSinceLastInterestingEvent: 0,
      lastInterestingEvent: null,
      // Phase 3: interest-based nudges (minor/medium) should only apply once per turn.
      lastNudgeTurn: -1,
    };
  } else {
    if (typeof gm.boredom.lastNudgeTurn !== "number" || !Number.isFinite(gm.boredom.lastNudgeTurn)) {
      gm.boredom.lastNudgeTurn = -1;
    }
  }

  // Normalize schema + seed.
  gm.schemaVersion = SCHEMA_VERSION;
  const runSeed = deriveRunSeed();
  gm.runSeed = (typeof gm.runSeed === "number" && Number.isFinite(gm.runSeed)) ? (gm.runSeed >>> 0) : (runSeed >>> 0);

  ensureSeededGmRng(gm);

  if (ctx) ctx.gm = gm;

  return gm;
}

function _ensureState(ctx) {
  // Seed-boundary guard: GM_STATE_V1 is treated as *per-run* state.
  // If the global run seed changes while the page is still alive (e.g. GOD applySeed,
  // rerollSeed, or any other seed reset), we must drop in-memory GM state as well.
  //
  // Without this guard, GMRuntime can keep serving a stale _state even though the
  // run seed (window.RNG.getSeed()/localStorage.SEED) changed, which breaks:
  // - smoketest gm_seed_reset (probe not cleared, runSeed not updated)
  // - downstream gm.* marker/encounter flows that rely on runSeed + fresh threads.
  let runSeedNow = 0;
  try { runSeedNow = (deriveRunSeed() >>> 0); } catch (_) { runSeedNow = 0; }

  try {
    const prev = (_state && typeof _state.runSeed === "number" && Number.isFinite(_state.runSeed))
      ? (_state.runSeed >>> 0)
      : null;
    if (prev != null && prev !== runSeedNow) {
      // Hard reset state on seed change.
      _state = createDefaultState();
      _state.runSeed = runSeedNow;
      // Best-effort: clear persisted per-run GM state so it can't be reloaded later.
      try { clearPersistedState(ctx); } catch (_) {}
      // Reset persistence throttles as well.
      _dirty = false;
      _lastSavedTurn = -1;
      _lastSaveMs = 0;
      _loadedOnce = true;
    }
  } catch (_) {}

  if (!_state) {
    _state = createDefaultState();
    _state.runSeed = runSeedNow;
  }

  _state = upgradeAndNormalizeState(ctx, _state);
  if (ctx) ctx.gm = _state;
  return _state;
}

// ------------------------
// Public API
// ------------------------

export function init(ctx, opts = {}) {
  const reset = !!(opts && opts.reset === true);
  const forceReload = !!(opts && opts.forceReload === true);

  // Persistence is best-effort and should never block boot.
  const persistenceAllowed = !isLocalStorageDisabled(ctx);

  const runSeed = deriveRunSeed();

  if (reset) {
    _state = createDefaultState();
    _state.runSeed = runSeed >>> 0;
    _state = upgradeAndNormalizeState(ctx, _state);

    if (persistenceAllowed) clearPersistedState(ctx);
    _loadedOnce = true;

    const enabled = _state && _state.enabled === false ? "off" : "on";
    bootLog(`[GMRuntime] init: reset (enabled=${enabled}, persist=${persistenceAllowed ? "on" : "off"})`, "info", { category: "gm" });

    return _state;
  }

  if (!_loadedOnce || !_state || forceReload) {
    let status = "defaults";
    const loaded = persistenceAllowed ? readPersistedState(ctx) : null;

    if (loaded && typeof loaded === "object") {
      const loadedSeed = (typeof loaded.runSeed === "number" && Number.isFinite(loaded.runSeed)) ? (loaded.runSeed >>> 0) : null;
      const loadedVer = (typeof loaded.schemaVersion === "number" && Number.isFinite(loaded.schemaVersion)) ? (loaded.schemaVersion | 0) : 0;

      if (loadedSeed != null && loadedSeed === (runSeed >>> 0) && loadedVer <= SCHEMA_VERSION) {
        _state = loaded;
        status = "restored";
      } else {
        _state = createDefaultState();
        _state.runSeed = runSeed >>> 0;
      }
    } else {
      _state = createDefaultState();
      _state.runSeed = runSeed >>> 0;
    }

    _loadedOnce = true;

    const enabled = _state && _state.enabled === false ? "off" : "on";
    bootLog(`[GMRuntime] init: ${status} (enabled=${enabled}, persist=${persistenceAllowed ? "on" : "off"})`, "info", { category: "gm" });
  }

  return _ensureState(ctx);
}

/**
 * Advance GM runtime bookkeeping once per engine tick.
 *
 * This is a small wrapper around `tickImpl` that handles state setup and persistence.
 */
export function tick(ctx) {
  if (!ctx) return;

  const gm = _ensureState(ctx);

  if (gm.enabled === false) {
    return;
  }

  // Defensive: malformed states injected via __setRawState may omit gm.debug/counters.
  if (!gm.debug || typeof gm.debug !== "object" || !gm.debug.counters || typeof gm.debug.counters !== "object") {
    const def = createDefaultState().debug;
    if (!gm.debug || typeof gm.debug !== "object") gm.debug = def;
    if (!gm.debug.counters || typeof gm.debug.counters !== "object") gm.debug.counters = def.counters;
  }

  const utils = ctx.utils || null;
  const clamp = utils && typeof utils.clamp === "function" ? utils.clamp : localClamp;

  tickImpl(ctx, gm, { markDirty, clamp });
  writePersistedState(ctx, gm);
}

export function onEvent(ctx, event) {
  if (!ctx || !event) return;

  const gm = _ensureState(ctx);

  if (gm.enabled === false) {
    return;
  }

  // Defensive.
  if (!gm.debug || typeof gm.debug !== "object" || !gm.debug.counters || typeof gm.debug.counters !== "object") {
    const def = createDefaultState().debug;
    if (!gm.debug || typeof gm.debug !== "object") gm.debug = def;
    if (!gm.debug.counters || typeof gm.debug.counters !== "object") gm.debug.counters = def.counters;
  }

  const turn = normalizeTurn(event.turn != null ? event.turn : getCurrentTurn(ctx, gm));

  const type = String(event.type || "");
  const scope = event.scope || ctx.mode || "unknown";

  // Phase 3: graded interest -> boredom recovery.
  //
  // Rules:
  // - event.interesting === false => no boredom relief.
  // - event.interestWeight: number in [0, 1] (overrides tier)
  //     - 0 => no relief
  //     - 1 => "major" (hard reset)
  //     - (0, 1) => partial nudge (reduce turnsSinceLastInterestingEvent by weight)
  // - event.interestTier: 'minor'|'medium'|'major' (case-insensitive)
  // - Default tier (conservative) when none provided:
  //     quest.complete => major
  //     encounter.exit => medium
  //     combat.kill / mechanic / other => minor
  //
  // Emitter hygiene (Phase 3): "mechanic" telemetry is high-frequency and UI-driven.
  // Treat it as NOT interesting by default so it doesn't suppress boredom simply by
  // opening/closing panels. Callers can still explicitly set `interesting:true`.
  const hasInteresting = Object.prototype.hasOwnProperty.call(event, "interesting");
  const interesting = hasInteresting ? (event.interesting !== false) : (type !== "mechanic");

  const utils = ctx.utils || null;
  const clamp = utils && typeof utils.clamp === "function" ? utils.clamp : localClamp;

  let resolvedInterestTier = null;
  let resolvedInterestWeight = null;
  let interestMode = "none"; // "none" | "partial" | "major"
  let partialReliefFactor = 0;

  if (interesting) {
    const hasInterestWeight = Object.prototype.hasOwnProperty.call(event, "interestWeight");

    if (hasInterestWeight) {
      const w = (typeof event.interestWeight === "number") ? event.interestWeight : Number(event.interestWeight);
      if (Number.isFinite(w)) {
        resolvedInterestWeight = clamp(w, 0, 1);
      } else {
        // Weight overrides tier, so malformed weights intentionally produce no relief.
        resolvedInterestWeight = 0;
      }

      if (resolvedInterestWeight >= 1) {
        interestMode = "major";
        resolvedInterestTier = "major";
      } else if (resolvedInterestWeight > 0) {
        interestMode = "partial";
        partialReliefFactor = resolvedInterestWeight;
      }
    } else {
      const rawTier = (typeof event.interestTier === "string") ? event.interestTier : "";
      const t = rawTier ? rawTier.trim().toLowerCase() : "";
      let tier = t;

      if (tier !== "minor" && tier !== "medium" && tier !== "major") {
        if (type === "quest.complete") tier = "major";
        else if (type === "encounter.exit") tier = "medium";
        else if (type === "combat.kill") tier = "minor";
        else if (type === "mechanic") tier = "minor";
        else tier = "minor";
      }

      resolvedInterestTier = tier;

      if (tier === "major") {
        interestMode = "major";
      } else if (tier === "medium") {
        interestMode = "partial";
        partialReliefFactor = 0.30;
      } else if (tier === "minor") {
        interestMode = "partial";
        partialReliefFactor = 0.10;
      }
    }
  }

  const stats = ensureStats(gm);
  ensureTraitsAndMechanics(gm);

  if (type === "mode.enter" && scope) {
    const me = stats.modeEntries;
    me[scope] = (me[scope] | 0) + 1;
  }

  if (type === "encounter.enter") {
    stats.encounterStarts = (stats.encounterStarts | 0) + 1;
  } else if (type === "encounter.exit") {
    stats.encounterCompletions = (stats.encounterCompletions | 0) + 1;
  }

  gm.debug.counters.events = (gm.debug.counters.events | 0) + 1;
  if (interestMode !== "none") {
    gm.debug.counters.interestingEvents = (gm.debug.counters.interestingEvents | 0) + 1;
  }

  const hasPayload = Object.prototype.hasOwnProperty.call(event, "payload");
  const snapshot = {
    type,
    scope,
    turn,
    interesting,
    interestTier: resolvedInterestTier,
    interestWeight: resolvedInterestWeight,
    payload: hasPayload ? event.payload : null,
  };

  gm.debug.lastEvent = snapshot;
  const buf = gm.debug.lastEvents;
  if (Array.isArray(buf)) {
    buf.unshift(snapshot);
    if (buf.length > MAX_DEBUG_EVENTS) buf.length = MAX_DEBUG_EVENTS;
  } else {
    gm.debug.lastEvents = [snapshot];
  }

  // Phase 3 boredom handling:
  // - "major" events hard reset boredom and mark the turn as interesting.
  // - "minor"/"medium" events apply a partial deterministic nudge once per turn,
  //   reducing turnsSinceLastInterestingEvent by a factor but never to 0.
  //   (We intentionally do NOT set lastInterestingEvent.turn for partial nudges so
  //    boredom can still increase normally per turn.)
  if (interestMode === "major") {
    gm.boredom.turnsSinceLastInterestingEvent = 0;
    gm.boredom.lastInterestingEvent = { type, scope, turn };
    gm.boredom.lastNudgeTurn = turn;
  } else if (interestMode === "partial") {
    const lastNudgeTurn = (typeof gm.boredom.lastNudgeTurn === "number" && Number.isFinite(gm.boredom.lastNudgeTurn))
      ? (gm.boredom.lastNudgeTurn | 0)
      : -1;

    if (lastNudgeTurn !== turn) {
      const rawTurns = gm.boredom.turnsSinceLastInterestingEvent | 0;
      if (rawTurns > 0) {
        let removed = Math.floor(rawTurns * partialReliefFactor);
        if (removed < 1) removed = 1;
        let nextTurns = rawTurns - removed;
        if (nextTurns < 1) nextTurns = 1;
        gm.boredom.turnsSinceLastInterestingEvent = nextTurns;
      }

      gm.boredom.lastNudgeTurn = turn;
    }
  }

  // Simple mood impulses.
  if (type === "encounter.exit") {
    addMoodImpulse(gm, 0.02, 0.01);
  } else if (type === "quest.complete") {
    addMoodImpulse(gm, 0.03, 0.0);
  }

  // Trait/family/faction updates.
  if (type === "combat.kill") {
    updateTraitsFromCombatKill(gm.traits, event, turn);
    updateFamiliesFromCombatKill(gm.families || (gm.families = {}), event, turn);
    updateFactionsFromCombatKill(gm.factions || (gm.factions = {}), event, turn);
  } else if (type === "quest.complete") {
    updateTraitsFromQuestComplete(gm.traits, event, turn);
  }

  if (type === "caravan.accepted" || type === "caravan.completed" || type === "caravan.attacked") {
    updateTraitsFromCaravanEvent(gm.traits, event, turn);
  }

  if (type === "mechanic") {
    updateMechanicsUsage(gm.mechanics, event, turn);
  }

  if (type === "gm.guardFine.pay" || type === "gm.guardFine.refuse") {
    applyGuardFineOutcome(gm, type, turn);
  }

  maybeScheduleFactionEvents(ctx, gm, turn, markDirty);

  markDirty(gm);
  writePersistedState(ctx, gm);
}

export function getState(ctx) {
  return _ensureState(ctx);
}

export function getEntranceIntent(ctx, mode) {
  const gm = _ensureState(ctx);
  const turn = normalizeTurn(getCurrentTurn(ctx, gm));

  if (gm.enabled === false) {
    return { kind: "none" };
  }

  const { intent, shouldWrite } = getEntranceIntentImpl(ctx, gm, mode, { markDirty, pushIntentDebug, turn });
  if (shouldWrite) writePersistedState(ctx, gm);
  return intent;
}

export function getMechanicHint(ctx) {
  const gm = _ensureState(ctx);
  const turn = normalizeTurn(getCurrentTurn(ctx, gm));

  if (gm.enabled === false) {
    return { kind: "none" };
  }

  const { intent, shouldWrite } = getMechanicHintImpl(ctx, gm, { markDirty, pushIntentDebug, turn });
  if (shouldWrite) writePersistedState(ctx, gm);
  return intent;
}

/**
 * Record that the GM showed a player-facing choice prompt (an "intervention").
 *
 * v0.3 contract: only choice prompts spend pacing budget.
 */
export function recordIntervention(ctx, meta = {}) {
  const gm = _ensureState(ctx);
  if (!ctx) return false;
  if (!gm || gm.enabled === false) return false;

  const turn = normalizeTurn(getCurrentTurn(ctx, gm));
  const res = consumeInterventionCooldown(ctx, gm, turn, meta, markDirty);
  if (!res) return false;

  try {
    pushIntentDebug(gm, {
      kind: "intervention",
      channel: "pacing",
      reason: (meta && meta.kind) ? String(meta.kind) : "choice",
      cooldownTurns: res.cooldownTurns | 0,
      nextEligibleTurn: res.nextEligibleTurn | 0,
    }, turn);
  } catch (_) {}

  writePersistedState(ctx, gm, { force: true });
  return true;
}

// ------------------------
// Faction travel events (scheduler-backed)
// ------------------------
// Moved to ./runtime/faction_travel.js

export function getFactionTravelEvent(ctx) {
  const gm = _ensureState(ctx);

  if (gm.enabled === false) return { kind: "none" };

  const { intent, shouldWrite, writeOptions } = getFactionTravelEventImpl(ctx, gm, { markDirty, pushIntentDebug });
  if (shouldWrite) writePersistedState(ctx, gm, writeOptions);

  return intent;
}

export function forceFactionTravelEvent(ctx, id) {
  const gm = _ensureState(ctx);
  if (!ctx) return { kind: "none" };
  if (gm.enabled === false) return { kind: "none" };

  const { intent, shouldWrite, writeOptions } = forceFactionTravelEventImpl(ctx, gm, id, { markDirty, pushIntentDebug });
  if (shouldWrite) writePersistedState(ctx, gm, writeOptions);

  return intent;
}

// ------------------------
// Survey Cache (thread-owned; bridge applies effects)
// ------------------------

export function surveyCache_worldScanRect(ctx, rect) {
  const gm = _ensureState(ctx);
  if (!ctx || !gm || gm.enabled === false) return { markers: [] };

  const sc = gm.threads && gm.threads.surveyCache ? gm.threads.surveyCache : null;
  if (!sc) return { markers: [] };

  const markers = surveyCacheComputeScanSpawn(ctx, gm, sc, rect);
  return { markers: Array.isArray(markers) ? markers : [] };
}

export function surveyCache_ensureGuaranteed(ctx) {
  const gm = _ensureState(ctx);
  if (!ctx || !gm || gm.enabled === false) return { marker: null };

  const sc = gm.threads && gm.threads.surveyCache ? gm.threads.surveyCache : null;
  if (!sc) return { marker: null };

  const marker = surveyCacheComputeGuaranteedSpawn(ctx, gm, sc);
  return { marker: marker || null };
}

// NOTE: cooldown should only advance when a marker was actually placed.
export function surveyCache_onMarkerPlaced(ctx) {
  const gm = _ensureState(ctx);
  if (!ctx || !gm || gm.enabled === false) return false;

  const sc = gm.threads && gm.threads.surveyCache ? gm.threads.surveyCache : null;
  if (!sc) return false;

  try {
    surveyCacheSetNextSpawnTurn(ctx, gm, sc);
    markDirty(gm);
    writePersistedState(ctx, gm, { force: true });
    return true;
  } catch (_) {
    return false;
  }
}

export function surveyCache_isClaimed(ctx, instanceId) {
  const gm = _ensureState(ctx);
  if (!gm || gm.enabled === false) return false;
  const sc = gm.threads && gm.threads.surveyCache ? gm.threads.surveyCache : null;
  if (!sc) return false;
  return surveyCacheIsClaimed(sc, instanceId);
}

export function surveyCache_onEncounterStart(ctx, meta) {
  const gm = _ensureState(ctx);
  if (!ctx || !gm || gm.enabled === false) return null;
  const sc = gm.threads && gm.threads.surveyCache ? gm.threads.surveyCache : null;
  if (!sc) return null;

  const res = surveyCacheOnEncounterStartImpl(gm, sc, meta, ctx);
  if (res) {
    markDirty(gm);
    writePersistedState(ctx, gm, { force: true });
  }
  return res;
}

export function surveyCache_onEncounterComplete(ctx, meta) {
  const gm = _ensureState(ctx);
  if (!ctx || !gm || gm.enabled === false) return null;
  const sc = gm.threads && gm.threads.surveyCache ? gm.threads.surveyCache : null;
  if (!sc) return null;

  const res = surveyCacheOnEncounterCompleteImpl(gm, sc, meta, ctx);
  if (res) {
    markDirty(gm);
    writePersistedState(ctx, gm, { force: true });
  }
  return res;
}

// ------------------------
// Bottle Map (fishing award; bridge applies effects)
// ------------------------

export function bottleMap_onFishingSuccess(ctx) {
  const gm = _ensureState(ctx);
  if (!ctx || !gm || gm.enabled === false) return { awarded: false };

  const thread = gm.threads && gm.threads.bottleMap && typeof gm.threads.bottleMap === "object" ? gm.threads.bottleMap : null;
  if (!thread) return { awarded: false };

  const res = (bottleMapThread && typeof bottleMapThread.bottleMapOnFishingSuccess === "function")
    ? (bottleMapThread.bottleMapOnFishingSuccess(ctx, gm, thread, { onDirty: markDirty }) || { awarded: false, changed: false })
    : { awarded: false, changed: false };

  // Persist any mutation (counters and/or GM RNG stream).
  if (res && res.changed) {
    try {
      markDirty(gm);
      writePersistedState(ctx, gm, { force: true });
    } catch (_) {}
  }

  // Do not leak internal flag.
  if (res && Object.prototype.hasOwnProperty.call(res, "changed")) {
    const { changed, ...pub } = res;
    return pub;
  }

  return res;
}

function stripChanged(res) {
  if (!res || typeof res !== "object") return res;
  if (!Object.prototype.hasOwnProperty.call(res, "changed")) return res;
  const { changed, ...pub } = res;
  return pub;
}

function bottleMapCallThread(ctx, gm, thread, fn, meta) {
  if (typeof fn !== "function") return null;

  // Contract: bottle map thread impls use GM RNG; pass onDirty so RNG calls mark state dirty.
  const opts = { onDirty: markDirty };

  // Preferred signature: (ctx, gm, thread, meta, opts)
  if (meta !== undefined && fn.length >= 5) return fn(ctx, gm, thread, meta, opts);

  // Fallback signatures.
  if (meta === undefined) return fn(ctx, gm, thread, opts);
  if (fn.length === 4) return fn(ctx, gm, thread, Object.assign({ meta }, opts));

  return fn(ctx, gm, thread, meta, opts);
}

function bottleMapPersistIfChanged(ctx, gm, res) {
  if (!res || res.changed !== true) return;
  markDirty(gm);
  writePersistedState(ctx, gm, { force: true });
}

export function bottleMap_onUseItem(ctx, meta) {
  const gm = _ensureState(ctx);
  if (!ctx || !gm || gm.enabled === false) return null;

  const thread = gm.threads && gm.threads.bottleMap && typeof gm.threads.bottleMap === "object" ? gm.threads.bottleMap : null;
  if (!thread) return null;

  const res = bottleMapCallThread(ctx, gm, thread, bottleMapThread && bottleMapThread.bottleMapOnUseItem, meta);
  bottleMapPersistIfChanged(ctx, gm, res);
  return stripChanged(res);
}

export function bottleMap_reconcileMarkers(ctx, meta) {
  const gm = _ensureState(ctx);
  if (!ctx || !gm || gm.enabled === false) return null;

  const thread = gm.threads && gm.threads.bottleMap && typeof gm.threads.bottleMap === "object" ? gm.threads.bottleMap : null;
  if (!thread) return null;

  const res = bottleMapCallThread(ctx, gm, thread, bottleMapThread && bottleMapThread.bottleMapReconcileMarkers, meta);
  bottleMapPersistIfChanged(ctx, gm, res);
  return stripChanged(res);
}

export function bottleMap_onEncounterStart(ctx, meta) {
  const gm = _ensureState(ctx);
  if (!ctx || !gm || gm.enabled === false) return null;

  const thread = gm.threads && gm.threads.bottleMap && typeof gm.threads.bottleMap === "object" ? gm.threads.bottleMap : null;
  if (!thread) return null;

  const res = bottleMapCallThread(ctx, gm, thread, bottleMapThread && bottleMapThread.bottleMapOnEncounterStart, meta);
  bottleMapPersistIfChanged(ctx, gm, res);
  return stripChanged(res);
}

export function bottleMap_onEncounterComplete(ctx, meta) {
  const gm = _ensureState(ctx);
  if (!ctx || !gm || gm.enabled === false) return null;

  const thread = gm.threads && gm.threads.bottleMap && typeof gm.threads.bottleMap === "object" ? gm.threads.bottleMap : null;
  if (!thread) return null;

  const res = bottleMapCallThread(ctx, gm, thread, bottleMapThread && bottleMapThread.bottleMapOnEncounterComplete, meta);
  bottleMapPersistIfChanged(ctx, gm, res);
  return stripChanged(res);
}

export function bottleMap_activateFromItem(ctx, meta) {
  return bottleMap_onUseItem(ctx, meta);
}

export function bottleMap_getReconcilePlan(ctx, meta) {
  return bottleMap_reconcileMarkers(ctx, meta);
}

export function bottleMap_onEncounterAttempt(ctx, meta) {
  return bottleMap_onEncounterStart(ctx, meta);
}

// ------------------------
// Survey Cache marker helpers (bridge wrappers)
// ------------------------

// Back-compat: for older callers that still route scan-time spawns through GMBridge.
export function onWorldScanRect(ctx, rect) {
  try {
    const GB = (typeof window !== "undefined") ? window.GMBridge : null;
    if (GB && typeof GB.onWorldScanRect === "function") {
      return GB.onWorldScanRect(ctx, rect);
    }
  } catch (_) {}
  return false;
}

export function onWorldScanTile(ctx, meta) {
  try {
    const GB = (typeof window !== "undefined") ? window.GMBridge : null;
    if (GB && typeof GB.onWorldScanTile === "function") {
      return GB.onWorldScanTile(ctx, meta);
    }
  } catch (_) {}
  return false;
}

export function ensureGuaranteedSurveyCache(ctx) {
  try {
    const GB = (typeof window !== "undefined") ? window.GMBridge : null;
    if (GB && typeof GB.ensureGuaranteedSurveyCache === "function") {
      return GB.ensureGuaranteedSurveyCache(ctx);
    }
  } catch (_) {}
  return false;
}

// ------------------------
// Event update helpers (traits/families/factions/mechanics)
// ------------------------
// Moved to ./runtime/events/updates.js

// ------------------------
// Reset + raw state helpers
// ------------------------

export function reset(ctx, opts = {}) {
  // Treat reset as a new-run boundary: clear persisted GM state.
  try {
    clearPersistedState(ctx);
  } catch (_) {}

  _state = null;
  _loadedOnce = false;
  _dirty = false;

  const nextOpts = Object.assign({}, opts, { reset: true });
  return init(ctx, nextOpts);
}

export function __getRawState() {
  return _state;
}

export function __setRawState(nextState, ctx) {
  _state = nextState;
  if (ctx) ctx.gm = _state;
  return _state;
}

export function exportState(ctx) {
  // Stable snapshot for debugging/UI export (avoid leaking live references)
  try {
    const gm = getState(ctx);
    if (!gm || typeof gm !== "object") return null;
    return JSON.parse(JSON.stringify(gm));
  } catch (_) {
    return null;
  }
}

export function clearPersisted(ctx) {
  try { clearPersistedState(ctx); } catch (_) {}
  return true;
}

// Back-compat: attach to window
attachGlobal("GMRuntime", {
  init,
  tick,
  onEvent,
  getState,
  reset,
  exportState,
  clearPersisted,
  getEntranceIntent,
  getMechanicHint,
  recordIntervention,
  getFactionTravelEvent,
  forceFactionTravelEvent,
  surveyCache_worldScanRect,
  surveyCache_ensureGuaranteed,
  surveyCache_onMarkerPlaced,
  surveyCache_isClaimed,
  surveyCache_onEncounterStart,
  surveyCache_onEncounterComplete,
  bottleMap_onFishingSuccess,
  bottleMap_onUseItem,
  bottleMap_activateFromItem,
  bottleMap_reconcileMarkers,
  bottleMap_getReconcilePlan,
  bottleMap_onEncounterStart,
  bottleMap_onEncounterAttempt,
  bottleMap_onEncounterComplete,
  onWorldScanRect,
  onWorldScanTile,
  ensureGuaranteedSurveyCache,
  __getRawState,
  __setRawState,
});
