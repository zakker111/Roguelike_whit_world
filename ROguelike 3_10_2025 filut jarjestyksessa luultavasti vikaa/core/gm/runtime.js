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
 */

import { attachGlobal } from "../../utils/global.js";

import { SCHEMA_VERSION, MAX_DEBUG_EVENTS } from "./runtime/constants.js";

import { deriveRunSeed, ensureSeededGmRng } from "./runtime/rng.js";

import { createDefaultMood, createDefaultState } from "./runtime/state_defaults.js";

import {
  ensureStats,
  ensureTraitsAndMechanics,
  ensureFactionEvents,
  ensureRng,
  ensureScheduler,
} from "./runtime/state_ensure.js";

import { localClamp, normalizeTurn, getCurrentTurn } from "./runtime/turn_utils.js";
import { addMoodImpulse, pushIntentDebug } from "./runtime/debug.js";
import { tickImpl } from "./runtime/tick.js";

import { getEntranceIntentImpl } from "./runtime/intents/entrance.js";
import { getMechanicHintImpl } from "./runtime/intents/mechanic_hint.js";

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
  ensureFactionEvents(gm);
  ensureRng(gm);
  ensureScheduler(gm);
  migrateFactionEventSlotsToScheduler(gm, markDirty);

  if (!gm.mood || typeof gm.mood !== "object") gm.mood = createDefaultMood();
  if (!gm.boredom || typeof gm.boredom !== "object") {
    gm.boredom = { level: 0, turnsSinceLastInterestingEvent: 0, lastInterestingEvent: null };
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
  if (!_state) {
    _state = createDefaultState();
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
  const interesting = event.interesting !== false;

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
  if (interesting) {
    gm.debug.counters.interestingEvents = (gm.debug.counters.interestingEvents | 0) + 1;
  }

  const hasPayload = Object.prototype.hasOwnProperty.call(event, "payload");
  const snapshot = {
    type,
    scope,
    turn,
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

  if (interesting) {
    gm.boredom.turnsSinceLastInterestingEvent = 0;
    gm.boredom.lastInterestingEvent = { type, scope, turn };
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

// Back-compat: attach to window
attachGlobal("GMRuntime", {
  init,
  tick,
  onEvent,
  getState,
  reset,
  getEntranceIntent,
  getMechanicHint,
  getFactionTravelEvent,
  forceFactionTravelEvent,
  __getRawState,
  __setRawState,
});
