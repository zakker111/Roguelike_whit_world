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

import {
  SCHEMA_VERSION,
  MAX_DEBUG_EVENTS,
  MAX_INTENT_HISTORY,
  ENTRANCE_INTENT_COOLDOWN_TURNS,
  HINT_INTENT_COOLDOWN_TURNS,
  BOREDOM_SMOOTHING_ALPHA,
  MOOD_TRANSIENT_DECAY_PER_TURN,
  GUARD_FINE_HEAT_TURNS,
  GM_RNG_ALGO,
  GM_SEED_SALT,
  GM_SCHED_MIN_AUTO_SPACING_TURNS,
  GM_SCHED_MAX_ACTIONS_PER_WINDOW,
  GM_SCHED_WINDOW_TURNS,
} from "./runtime/constants.js";

import { createDefaultMood, createDefaultState } from "./runtime/state_defaults.js";

import {
  ensureStats,
  ensureTraitsAndMechanics,
  ensureFactionEvents,
  ensureRng,
  ensureScheduler,
  getMechanicKnowledge,
  normalizeMood,
  labelMood,
} from "./runtime/state_ensure.js";

import { localClamp, normalizeTurn, getCurrentTurn } from "./runtime/turn_utils.js";

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
// Run seed + GM RNG stream
// ------------------------

function hash32(x) {
  let v = (x >>> 0);
  v ^= v >>> 16;
  v = Math.imul(v, 0x7feb352d);
  v ^= v >>> 15;
  v = Math.imul(v, 0x846ca68b);
  v ^= v >>> 16;
  return v >>> 0;
}

function deriveRunSeed() {
  try {
    if (typeof window !== "undefined" && window.RNG && typeof window.RNG.getSeed === "function") {
      const s = window.RNG.getSeed();
      if (s != null) return (Number(s) >>> 0);
    }
  } catch (_) {}

  try {
    const raw = (typeof localStorage !== "undefined") ? localStorage.getItem("SEED") : null;
    if (raw != null) return (Number(raw) >>> 0);
  } catch (_) {}

  return 0;
}

function ensureSeededGmRng(gm) {
  const rng = ensureRng(gm);
  if (!rng) return null;

  const calls = rng.calls | 0;
  const state = rng.state >>> 0;
  if (calls === 0 && state === 0 && rng.algo === GM_RNG_ALGO) {
    const runSeed = (typeof gm.runSeed === "number" && Number.isFinite(gm.runSeed)) ? (gm.runSeed >>> 0) : (deriveRunSeed() >>> 0);
    rng.state = hash32((runSeed ^ GM_SEED_SALT ^ 0x9e3779b9) >>> 0);
  }

  return rng;
}

function gmRngNextUint32(gm) {
  const rng = ensureSeededGmRng(gm);
  if (!rng) return 0;

  // mulberry32 step; mirrored from core/rng_service.js.
  let a = (rng.state >>> 0);
  a = (a + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const out = (t ^ (t >>> 14)) >>> 0;

  rng.state = a;
  rng.calls = (rng.calls | 0) + 1;
  markDirty(gm);

  return out;
}

function gmRngFloat(gm) {
  return gmRngNextUint32(gm) / 4294967296;
}

// ------------------------
// Deterministic scheduler (minimal)
// ------------------------

function schedulerUpsertAction(gm, id, fields) {
  const sched = ensureScheduler(gm);
  if (!sched) return null;

  const key = String(id || "");
  if (!key) return null;

  const actions = sched.actions;
  let a = actions[key];
  const isNew = !a || typeof a !== "object";
  if (isNew) {
    a = { id: key };
    actions[key] = a;
  }

  if (fields && typeof fields === "object") {
    for (const k in fields) {
      if (Object.prototype.hasOwnProperty.call(fields, k)) a[k] = fields[k];
    }
  }

  if (isNew) {
    if (!Array.isArray(sched.queue)) sched.queue = [];
    sched.queue.push(key);
  }

  markDirty(gm);
  return actions[key];
}

function schedulerCountRecent(sched, turn) {
  const hist = Array.isArray(sched.history) ? sched.history : [];
  const t = normalizeTurn(turn);
  const lo = t - GM_SCHED_WINDOW_TURNS;
  let count = 0;
  for (let i = 0; i < hist.length; i++) {
    const h = hist[i];
    if (!h || typeof h !== "object") continue;
    const ht = h.turn | 0;
    if (ht >= lo && ht <= t) count++;
  }
  return count;
}

function schedulerCanDeliver(gm, sched, action, turn) {
  const t = normalizeTurn(turn);

  const lastActionTurn = typeof gm.lastActionTurn === "number" ? (gm.lastActionTurn | 0) : -1;
  if (!action.allowMultiplePerTurn && lastActionTurn === t) return false;

  if (action.delivery === "auto") {
    const lastAuto = typeof sched.lastAutoTurn === "number" ? (sched.lastAutoTurn | 0) : -9999;
    if ((t - lastAuto) < GM_SCHED_MIN_AUTO_SPACING_TURNS) return false;
  }

  const recent = schedulerCountRecent(sched, t);
  if (recent >= GM_SCHED_MAX_ACTIONS_PER_WINDOW) return false;

  return true;
}

function schedulerPickNext(gm, turn) {
  const sched = ensureScheduler(gm);
  if (!sched) return null;

  const t = normalizeTurn(turn);
  const actions = sched.actions || {};
  const ids = Array.isArray(sched.queue) ? sched.queue : [];

  let best = null;

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const a = actions[id];
    if (!a || typeof a !== "object") continue;
    if (a.status !== "scheduled" && a.status !== "ready") continue;

    const earliest = a.earliestTurn | 0;
    const latest = a.latestTurn | 0;
    if (t < earliest) continue;
    if (latest !== 0 && t > latest) continue;

    if (!schedulerCanDeliver(gm, sched, a, t)) continue;

    if (!best) {
      best = a;
      continue;
    }

    const ap = a.priority | 0;
    const bp = best.priority | 0;
    if (ap !== bp) {
      if (ap > bp) best = a;
      continue;
    }

    const ae = a.earliestTurn | 0;
    const be = best.earliestTurn | 0;
    if (ae !== be) {
      if (ae < be) best = a;
      continue;
    }

    const ac = a.createdTurn | 0;
    const bc = best.createdTurn | 0;
    if (ac !== bc) {
      if (ac < bc) best = a;
      continue;
    }

    const aid = String(a.id || "");
    const bid = String(best.id || "");
    if (aid && bid && aid < bid) best = a;
  }

  return best;
}

function schedulerConsume(gm, action, turn) {
  if (!gm || !action) return;
  const sched = ensureScheduler(gm);
  if (!sched) return;

  const t = normalizeTurn(turn);
  action.status = "consumed";
  action.consumedTurn = t;

  gm.lastActionTurn = t;

  if (!Array.isArray(sched.history)) sched.history = [];
  sched.history.unshift({ turn: t, id: String(action.id || "") });
  if (sched.history.length > GM_SCHED_WINDOW_TURNS) sched.history.length = GM_SCHED_WINDOW_TURNS;

  if (action.delivery === "auto") {
    sched.lastAutoTurn = t;
  }

  markDirty(gm);
}

// ------------------------
// Intents + debug bookkeeping
// ------------------------

function addMoodImpulse(gm, baseValence, baseArousal) {
  if (!gm || typeof gm !== "object") return;

  let mood = gm.mood;
  if (!mood || typeof mood !== "object") {
    mood = createDefaultMood();
    gm.mood = mood;
  }

  const boredomLevel = gm.boredom && typeof gm.boredom.level === "number" && Number.isFinite(gm.boredom.level)
    ? gm.boredom.level
    : 0;
  const b = boredomLevel < 0 ? 0 : (boredomLevel > 1 ? 1 : boredomLevel);

  let scale = 1.0;
  if (baseValence < 0) {
    scale = 0.5 + b;
  } else if (baseValence > 0) {
    scale = 1.0 - 0.5 * b;
  }

  const dv = baseValence * scale;
  const da = baseArousal * scale;

  const prevTv = typeof mood.transientValence === "number" && Number.isFinite(mood.transientValence)
    ? mood.transientValence
    : 0;
  const prevTa = typeof mood.transientArousal === "number" && Number.isFinite(mood.transientArousal)
    ? mood.transientArousal
    : 0;

  mood.transientValence = prevTv + dv;
  mood.transientArousal = prevTa + da;
}

function pushIntentDebug(gm, intent, turn) {
  if (!gm || typeof gm !== "object") return;

  if (!gm.debug || typeof gm.debug !== "object") gm.debug = createDefaultState().debug;
  if (!Array.isArray(gm.debug.intentHistory)) gm.debug.intentHistory = [];

  const entry = Object.assign({}, intent || {});
  entry.turn = normalizeTurn(turn);

  gm.debug.lastIntent = entry;
  gm.debug.intentHistory.unshift(entry);
  if (gm.debug.intentHistory.length > MAX_INTENT_HISTORY) gm.debug.intentHistory.length = MAX_INTENT_HISTORY;

  markDirty(gm);
}

function buildProfile(gm) {
  const stats = ensureStats(gm);

  const profile = {
    totalTurns: stats.totalTurns | 0,
    boredomLevel: (gm.boredom && typeof gm.boredom.level === "number" && Number.isFinite(gm.boredom.level)) ? localClamp(gm.boredom.level, 0, 1) : 0,
    topModes: [],
    topFamilies: [],
  };

  const mt = stats.modeTurns && typeof stats.modeTurns === "object" ? stats.modeTurns : {};
  const topModes = [];
  for (const key in mt) {
    if (!Object.prototype.hasOwnProperty.call(mt, key)) continue;
    topModes.push({ mode: key, turns: mt[key] | 0 });
  }
  topModes.sort((a, b) => {
    if ((b.turns | 0) !== (a.turns | 0)) return (b.turns | 0) - (a.turns | 0);
    if (a.mode < b.mode) return -1;
    if (a.mode > b.mode) return 1;
    return 0;
  });
  profile.topModes = topModes;

  const families = gm.families && typeof gm.families === "object" ? gm.families : {};
  const topFamilies = [];
  for (const key in families) {
    if (!Object.prototype.hasOwnProperty.call(families, key)) continue;
    const f = families[key];
    if (!f || typeof f !== "object") continue;
    const seen = f.seen | 0;
    if (seen <= 0) continue;
    topFamilies.push({ key, seen });
  }
  topFamilies.sort((a, b) => {
    if ((b.seen | 0) !== (a.seen | 0)) return (b.seen | 0) - (a.seen | 0);
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    return 0;
  });
  profile.topFamilies = topFamilies;

  return profile;
}

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
  migrateFactionEventSlotsToScheduler(gm);

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

  const runSeed = deriveRunSeed();

  if (reset) {
    _state = createDefaultState();
    _state.runSeed = runSeed >>> 0;
    _state = upgradeAndNormalizeState(ctx, _state);

    clearPersistedState(ctx);
    _loadedOnce = true;

    bootLog(`[GMRuntime] init: reset (seed=${_state.runSeed})`, "info", { category: "gm" });
    return _state;
  }

  if (!_loadedOnce || !_state || forceReload) {
    const loaded = readPersistedState(ctx);

    if (loaded && typeof loaded === "object") {
      const loadedSeed = (typeof loaded.runSeed === "number" && Number.isFinite(loaded.runSeed)) ? (loaded.runSeed >>> 0) : null;
      const loadedVer = (typeof loaded.schemaVersion === "number" && Number.isFinite(loaded.schemaVersion)) ? (loaded.schemaVersion | 0) : 0;

      if (loadedSeed != null && loadedSeed === (runSeed >>> 0) && loadedVer <= SCHEMA_VERSION) {
        _state = loaded;
        bootLog(`[GMRuntime] init: restored GM_STATE_V1 (seed=${runSeed}, schema=${loadedVer})`, "info", { category: "gm" });
      } else {
        _state = createDefaultState();
        _state.runSeed = runSeed >>> 0;
        const reason = (loadedSeed != null && loadedSeed !== (runSeed >>> 0))
          ? `seedMismatch(saved=${loadedSeed}, run=${runSeed})`
          : (loadedVer > SCHEMA_VERSION ? `futureSchema(saved=${loadedVer})` : "invalidSavedState");
        bootLog(`[GMRuntime] init: starting fresh (${reason})`, "warn", { category: "gm" });
      }
    } else {
      _state = createDefaultState();
      _state.runSeed = runSeed >>> 0;
      bootLog(`[GMRuntime] init: no saved GM_STATE_V1; starting fresh (seed=${runSeed})`, "info", { category: "gm" });
    }

    _loadedOnce = true;
  }

  return _ensureState(ctx);
}

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

  const lastTurn = gm.debug.lastTickTurn | 0;
  const turn = (ctx.time && typeof ctx.time.turnCounter === "number")
    ? (ctx.time.turnCounter | 0)
    : (lastTurn + 1);

  const isNewTurn = turn !== lastTurn;

  if (isNewTurn) {
    gm.debug.counters.ticks = (gm.debug.counters.ticks | 0) + 1;

    const lastInteresting = gm.boredom.lastInterestingEvent;
    const hadInterestingThisTurn =
      !!(lastInteresting && typeof lastInteresting.turn === "number" && (lastInteresting.turn | 0) === turn);

    if (!hadInterestingThisTurn) {
      gm.boredom.turnsSinceLastInterestingEvent = (gm.boredom.turnsSinceLastInterestingEvent | 0) + 1;
    }

    // Normalize boredom level into [0, 1] based on turns since last interesting event.
    const MAX_TURNS_BORED = 200;
    const rawTurns = gm.boredom.turnsSinceLastInterestingEvent | 0;
    const clampedTurns = clamp(rawTurns, 0, MAX_TURNS_BORED);
    const normalized = clampedTurns / MAX_TURNS_BORED;

    const prevLevel = (gm.boredom && typeof gm.boredom.level === "number" && Number.isFinite(gm.boredom.level))
      ? gm.boredom.level
      : 0;

    const alpha = BOREDOM_SMOOTHING_ALPHA;
    let nextLevel = prevLevel + alpha * (normalized - prevLevel);
    nextLevel = clamp(nextLevel, 0, 1);
    gm.boredom.level = nextLevel;

    // Deterministic stats tracking.
    const stats = ensureStats(gm);
    const modeKey = typeof ctx.mode === "string" && ctx.mode ? ctx.mode : (gm.lastMode || "unknown");
    stats.totalTurns = (stats.totalTurns | 0) + 1;
    const mt = stats.modeTurns;
    mt[modeKey] = (mt[modeKey] | 0) + 1;
  }

  // Mood update.
  if (!gm.mood || typeof gm.mood !== "object") gm.mood = createDefaultMood();
  const mood = gm.mood;

  if (isNewTurn) {
    const decay = MOOD_TRANSIENT_DECAY_PER_TURN;
    const tv = typeof mood.transientValence === "number" && Number.isFinite(mood.transientValence) ? mood.transientValence : 0;
    const ta = typeof mood.transientArousal === "number" && Number.isFinite(mood.transientArousal) ? mood.transientArousal : 0;
    mood.transientValence = tv * decay;
    mood.transientArousal = ta * decay;
  }

  const boredomLevel = (gm.boredom && typeof gm.boredom.level === "number" && Number.isFinite(gm.boredom.level))
    ? gm.boredom.level
    : 0;
  const b = clamp(boredomLevel, 0, 1);

  // Low boredom -> slightly positive/calm. High boredom -> negative/restless.
  const baseValLow = 0.15;
  const baseValHigh = -0.5;
  const baseArLow = 0.25;
  const baseArHigh = 0.75;

  const baselineValence = baseValLow + (baseValHigh - baseValLow) * b;
  const baselineArousal = baseArLow + (baseArHigh - baseArLow) * b;

  mood.baselineValence = baselineValence;
  mood.baselineArousal = baselineArousal;

  const tv2 = typeof mood.transientValence === "number" && Number.isFinite(mood.transientValence) ? mood.transientValence : 0;
  const ta2 = typeof mood.transientArousal === "number" && Number.isFinite(mood.transientArousal) ? mood.transientArousal : 0;

  let v = baselineValence + tv2;
  let a = baselineArousal + ta2;

  v = clamp(v, -1, 1);
  a = clamp(a, 0, 1);

  mood.valence = v;
  mood.arousal = a;

  normalizeMood(gm);
  labelMood(gm, turn);

  if (ctx.mode) gm.lastMode = ctx.mode;

  gm.debug.lastTickTurn = turn;

  if (isNewTurn) markDirty(gm);
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

  maybeScheduleFactionEvents(ctx, gm, turn);

  markDirty(gm);
  writePersistedState(ctx, gm);
}

export function getState(ctx) {
  return _ensureState(ctx);
}

export function getEntranceIntent(ctx, mode) {
  const gm = _ensureState(ctx);
  const turn = normalizeTurn(getCurrentTurn(ctx, gm));

  function returnNone(reason) {
    pushIntentDebug(gm, { kind: "none", channel: "entrance", reason }, turn);
    return { kind: "none" };
  }

  if (gm.enabled === false) {
    return { kind: "none" };
  }

  if (!gm.debug || typeof gm.debug !== "object") {
    gm.debug = createDefaultState().debug;
  }
  if (!gm.config || typeof gm.config !== "object") {
    gm.config = {};
  }

  const modeKey = typeof mode === "string" && mode
    ? mode
    : (ctx && typeof ctx.mode === "string" && ctx.mode ? ctx.mode : (gm.lastMode || "unknown"));

  const lastEntranceTurn = typeof gm.lastEntranceIntentTurn === "number" ? (gm.lastEntranceIntentTurn | 0) : -1;
  if (modeKey !== "town" && modeKey !== "tavern") {
    if (lastEntranceTurn >= 0 && (turn - lastEntranceTurn) < ENTRANCE_INTENT_COOLDOWN_TURNS) {
      return returnNone("cooldown.turn");
    }
  }

  normalizeMood(gm);
  labelMood(gm, turn);

  const profile = buildProfile(gm);
  const moodLabel = gm.mood && typeof gm.mood.primary === "string" ? gm.mood.primary : "neutral";
  const boredomLevel = profile.boredomLevel;

  // Rarity gating for town/tavern entries.
  try {
    const stats = ensureStats(gm);
    const modeEntries = stats.modeEntries && typeof stats.modeEntries === "object" ? stats.modeEntries : {};
    const entriesForMode = modeEntries[modeKey] != null ? (modeEntries[modeKey] | 0) : 0;

    if ((modeKey === "town" || modeKey === "tavern") && entriesForMode > 1) {
      const ENTRY_PERIOD = 4; // 1st, 5th, 9th, ...
      if ((entriesForMode - 1) % ENTRY_PERIOD !== 0) {
        return returnNone("rarity.entryPeriod");
      }
    }
  } catch (_) {}

  // Variety topic based on dominant mode.
  let varietyTopic = null;
  const topModes = Array.isArray(profile.topModes) ? profile.topModes : [];
  if (profile.totalTurns >= 100 && boredomLevel > 0.5 && topModes.length > 0) {
    const dominantEntry = topModes[0];
    const dominantTurns = dominantEntry.turns | 0;
    if (dominantTurns > 0) {
      const ratio = dominantTurns / profile.totalTurns;
      if (ratio >= 0.7) {
        const dominantMode = dominantEntry.mode;
        if (dominantMode === "dungeon" && modeKey !== "town") {
          varietyTopic = "variety:try_town";
        } else if (dominantMode === "town" && modeKey !== "dungeon") {
          varietyTopic = "variety:try_dungeon";
        } else if ((dominantMode === "town" || dominantMode === "dungeon") && modeKey !== "world") {
          varietyTopic = "variety:try_world";
        }
      }
    }
  }

  let intent = { kind: "none" };

  if ((moodLabel === "stern" || moodLabel === "restless" || moodLabel === "bored") && boredomLevel > 0.5) {
    const fam = Array.isArray(profile.topFamilies) && profile.topFamilies.length ? profile.topFamilies[0] : null;
    if (fam && fam.key) {
      intent = {
        kind: "flavor",
        topic: `family:${fam.key}`,
        strength: "medium",
        mode: modeKey,
      };
    }
  }

  if ((!intent || intent.kind === "none")
    && (moodLabel === "stern" || moodLabel === "restless" || moodLabel === "bored")
    && boredomLevel > 0.5) {
    const topic = varietyTopic || "general_rumor";
    intent = { kind: "flavor", topic, strength: "low", mode: modeKey };
  }

  if ((!intent || intent.kind === "none")
    && (moodLabel === "curious" || moodLabel === "playful" || moodLabel === "neutral")
    && boredomLevel > 0.3) {
    const topic = varietyTopic || "general_rumor";
    intent = { kind: "flavor", topic, strength: "low", mode: modeKey };
  }

  if ((!intent || intent.kind === "none")
    && profile.totalTurns < 50
    && boredomLevel > 0.2) {
    if (!gm.storyFlags || typeof gm.storyFlags !== "object") gm.storyFlags = {};
    if (gm.storyFlags.firstEntranceFlavorShown !== true) {
      intent = { kind: "flavor", topic: "general_rumor", strength: "low", mode: modeKey };
      gm.storyFlags.firstEntranceFlavorShown = true;
    }
  }

  if (!intent || intent.kind === "none") {
    return returnNone("no.intent");
  }

  gm.lastEntranceIntentTurn = turn;
  gm.lastActionTurn = turn;
  pushIntentDebug(gm, Object.assign({ channel: "entrance" }, intent), turn);
  writePersistedState(ctx, gm);
  return intent;
}

export function getMechanicHint(ctx) {
  const gm = _ensureState(ctx);
  const turn = normalizeTurn(getCurrentTurn(ctx, gm));

  function returnNone(reason) {
    pushIntentDebug(gm, { kind: "none", channel: "mechanicHint", reason }, turn);
    return { kind: "none" };
  }

  if (gm.enabled === false) {
    return { kind: "none" };
  }

  const stats = ensureStats(gm);
  const modeEntries = stats.modeEntries && typeof stats.modeEntries === "object" ? stats.modeEntries : {};
  const entriesTown = modeEntries.town != null ? (modeEntries.town | 0) : 0;
  if ((stats.totalTurns | 0) < 30 && entriesTown < 2) {
    return returnNone("earlyGame");
  }

  ensureTraitsAndMechanics(gm);

  const lastHintTurn = typeof gm.lastHintIntentTurn === "number" ? (gm.lastHintIntentTurn | 0) : -1;
  if (lastHintTurn >= 0) {
    if (turn === lastHintTurn) {
      const lastEntry = typeof gm.lastHintIntentTownEntry === "number" ? (gm.lastHintIntentTownEntry | 0) : entriesTown;
      if ((entriesTown - lastEntry) < 4) {
        return returnNone("cooldown.entry");
      }
    } else if ((turn - lastHintTurn) < HINT_INTENT_COOLDOWN_TURNS) {
      return returnNone("cooldown.turn");
    }
  }

  const boredomLevelRaw = gm.boredom && typeof gm.boredom.level === "number" && Number.isFinite(gm.boredom.level)
    ? gm.boredom.level
    : 0;
  const boredomLevel = localClamp(boredomLevelRaw, 0, 1);

  const modeKey = ctx && typeof ctx.mode === "string" && ctx.mode ? ctx.mode : (gm.lastMode || "unknown");
  const isTown = modeKey === "town";

  const mechanics = gm.mechanics && typeof gm.mechanics === "object" ? gm.mechanics : {};
  const keys = ["questBoard", "followers", "fishing", "lockpicking"]; // town-friendly order for stable expectations

  let bestKey = null;
  let bestScore = -1;
  let bestSeen = -1;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const m = mechanics[key];
    if (!m || typeof m !== "object") continue;

    const tried = m.tried | 0;
    if (tried !== 0) continue;

    const state = getMechanicKnowledge(m, turn);
    if (state === "disinterested" || state === "triedRecently") continue;

    const seen = m.seen | 0;

    let score = 5;
    if (state === "seenNotTried") score += 3;
    if (isTown && (key === "questBoard" || key === "followers")) score += 1;
    score += Math.round(boredomLevel * 2);
    if (seen > 5) score += 1;

    if (score > bestScore || (score === bestScore && seen > bestSeen)) {
      bestScore = score;
      bestSeen = seen;
      bestKey = key;
    }
  }

  if (!bestKey) {
    return returnNone("no.mechanic");
  }

  const intent = { kind: "nudge", target: `mechanic:${bestKey}`, strength: "low" };
  gm.lastHintIntentTurn = turn;
  gm.lastHintIntentTownEntry = entriesTown;
  gm.lastActionTurn = turn;

  pushIntentDebug(gm, Object.assign({ channel: "mechanicHint" }, intent), turn);
  writePersistedState(ctx, gm);

  return intent;
}

// ------------------------
// Faction travel events (scheduler-backed)
// ------------------------

const FE_ACTION_ID_GUARD = "fe:guardFine";
const FE_ACTION_ID_BANDIT = "fe:banditBounty";
const FE_ACTION_ID_TROLL = "fe:trollHunt";

function migrateFactionEventSlotsToScheduler(gm) {
  if (!gm || typeof gm !== "object") return;

  ensureFactionEvents(gm);
  ensureScheduler(gm);

  const flags = gm.storyFlags && typeof gm.storyFlags === "object" ? gm.storyFlags : null;
  const fe = flags && flags.factionEvents && typeof flags.factionEvents === "object" ? flags.factionEvents : null;
  if (!fe) return;

  const mapping = [
    {
      slot: "guardFine",
      id: FE_ACTION_ID_GUARD,
      kind: "travel.guardFine",
      priority: 300,
      delivery: "confirm",
      payload: { kind: "guard_fine" },
    },
    {
      slot: "banditBounty",
      id: FE_ACTION_ID_BANDIT,
      kind: "travel.banditBounty",
      priority: 200,
      delivery: "auto",
      payload: { encounterId: "gm_bandit_bounty" },
    },
    {
      slot: "trollHunt",
      id: FE_ACTION_ID_TROLL,
      kind: "travel.trollHunt",
      priority: 100,
      delivery: "auto",
      payload: { encounterId: "gm_troll_hunt" },
    },
  ];

  const sched = ensureScheduler(gm);
  const actions = sched && sched.actions && typeof sched.actions === "object" ? sched.actions : null;
  if (!actions) return;

  for (let i = 0; i < mapping.length; i++) {
    const m = mapping[i];
    const slot = fe[m.slot];
    if (!slot || typeof slot !== "object") continue;

    const existing = actions[m.id];
    if (existing && typeof existing === "object") continue;

    const st = typeof slot.status === "string" ? slot.status : "none";
    const status = (st === "scheduled" || st === "consumed") ? st : "none";

    const earliest = normalizeTurn(slot.earliestTurn);
    const latestRaw = slot.latestTurn;
    const latest = normalizeTurn(latestRaw != null ? latestRaw : earliest);

    schedulerUpsertAction(gm, m.id, {
      kind: m.kind,
      status,
      priority: m.priority,
      delivery: m.delivery,
      allowMultiplePerTurn: false,
      createdTurn: earliest,
      earliestTurn: earliest,
      latestTurn: latest,
      payload: Object.assign({}, m.payload),
    });
  }
}

function maybeScheduleFactionEvents(ctx, gm, turn) {
  if (!gm || typeof gm !== "object") return;

  ensureTraitsAndMechanics(gm);
  ensureFactionEvents(gm);
  ensureScheduler(gm);
  migrateFactionEventSlotsToScheduler(gm);

  const storyFlags = gm.storyFlags && typeof gm.storyFlags === "object" ? gm.storyFlags : null;
  const factionEvents = storyFlags && storyFlags.factionEvents && typeof storyFlags.factionEvents === "object"
    ? storyFlags.factionEvents
    : null;
  if (!factionEvents) return;

  const safeTurn = normalizeTurn(turn);

  function slotIsFree(slot) {
    if (!slot || typeof slot !== "object") return false;
    const status = typeof slot.status === "string" ? slot.status : "none";
    return status !== "scheduled" && status !== "consumed";
  }

  function extractSeenAndScore(entry) {
    if (!entry || typeof entry !== "object") return { seen: 0, score: 0 };
    let seen = entry.seen | 0;
    if (seen < 0) seen = 0;
    let positive = entry.positive | 0;
    if (positive < 0) positive = 0;
    let negative = entry.negative | 0;
    if (negative < 0) negative = 0;
    const samples = positive + negative;
    const score = samples > 0 ? (positive - negative) / samples : 0;
    return { seen, score };
  }

  const factions = gm.factions && typeof gm.factions === "object" ? gm.factions : {};
  const families = gm.families && typeof gm.families === "object" ? gm.families : {};

  const banditSlot = factionEvents.banditBounty;
  if (slotIsFree(banditSlot)) {
    const metrics = extractSeenAndScore(factions.bandit);
    if (metrics.seen >= 8 && metrics.score >= 0.8) {
      banditSlot.status = "scheduled";
      banditSlot.earliestTurn = normalizeTurn(safeTurn + 50);
      banditSlot.latestTurn = normalizeTurn(safeTurn + 300);

      schedulerUpsertAction(gm, FE_ACTION_ID_BANDIT, {
        kind: "travel.banditBounty",
        status: "scheduled",
        priority: 200,
        delivery: "auto",
        allowMultiplePerTurn: false,
        createdTurn: safeTurn,
        earliestTurn: banditSlot.earliestTurn | 0,
        latestTurn: banditSlot.latestTurn | 0,
        payload: { encounterId: "gm_bandit_bounty" },
      });
    }
  }

  const guardSlot = factionEvents.guardFine;
  if (slotIsFree(guardSlot)) {
    let bestSeen = 0;
    let bestScore = -1;

    const g1 = extractSeenAndScore(factions.guard);
    if (g1.seen > bestSeen || (g1.seen === bestSeen && g1.score > bestScore)) {
      bestSeen = g1.seen;
      bestScore = g1.score;
    }

    const g2 = extractSeenAndScore(factions.town);
    if (g2.seen > bestSeen || (g2.seen === bestSeen && g2.score > bestScore)) {
      bestSeen = g2.seen;
      bestScore = g2.score;
    }

    if (bestSeen >= 3 && bestScore >= 0.6) {
      guardSlot.status = "scheduled";
      guardSlot.earliestTurn = normalizeTurn(safeTurn + 30);
      guardSlot.latestTurn = normalizeTurn(safeTurn + 240);

      schedulerUpsertAction(gm, FE_ACTION_ID_GUARD, {
        kind: "travel.guardFine",
        status: "scheduled",
        priority: 300,
        delivery: "confirm",
        allowMultiplePerTurn: false,
        createdTurn: safeTurn,
        earliestTurn: guardSlot.earliestTurn | 0,
        latestTurn: guardSlot.latestTurn | 0,
        payload: { kind: "guard_fine" },
      });
    }
  }

  const trollSlot = factionEvents.trollHunt;
  if (slotIsFree(trollSlot)) {
    let source = null;
    if (families.troll && typeof families.troll === "object") source = families.troll;
    else if (factions.trolls && typeof factions.trolls === "object") source = factions.trolls;

    if (source) {
      const metrics = extractSeenAndScore(source);
      if (metrics.seen >= 4 && metrics.score >= 0.7) {
        trollSlot.status = "scheduled";
        trollSlot.earliestTurn = normalizeTurn(safeTurn + 40);
        trollSlot.latestTurn = normalizeTurn(safeTurn + 260);

        schedulerUpsertAction(gm, FE_ACTION_ID_TROLL, {
          kind: "travel.trollHunt",
          status: "scheduled",
          priority: 100,
          delivery: "auto",
          allowMultiplePerTurn: false,
          createdTurn: safeTurn,
          earliestTurn: trollSlot.earliestTurn | 0,
          latestTurn: trollSlot.latestTurn | 0,
          payload: { encounterId: "gm_troll_hunt" },
        });
      }
    }
  }
}

export function getFactionTravelEvent(ctx) {
  const gm = _ensureState(ctx);

  if (gm.enabled === false) return { kind: "none" };

  ensureTraitsAndMechanics(gm);
  ensureFactionEvents(gm);
  ensureScheduler(gm);

  const turn = normalizeTurn(getCurrentTurn(ctx, gm));

  // If slots exist (old view) but scheduler does not, schedule will be rebuilt by onEvent.
  // We'll still try to pick from scheduler if possible.
  const action = schedulerPickNext(gm, turn);
  if (!action) return { kind: "none" };

  let intent = { kind: "none" };
  if (action.id === FE_ACTION_ID_GUARD) {
    intent = { kind: "guard_fine" };
  } else if (action.id === FE_ACTION_ID_BANDIT) {
    intent = { kind: "encounter", encounterId: "gm_bandit_bounty" };
  } else if (action.id === FE_ACTION_ID_TROLL) {
    intent = { kind: "encounter", encounterId: "gm_troll_hunt" };
  } else {
    return { kind: "none" };
  }

  // Consume scheduler + legacy slot.
  schedulerConsume(gm, action, turn);

  try {
    const flags = gm.storyFlags && typeof gm.storyFlags === "object" ? gm.storyFlags : null;
    const fe = flags && flags.factionEvents && typeof flags.factionEvents === "object" ? flags.factionEvents : null;
    if (fe) {
      const slotName = (action.id === FE_ACTION_ID_GUARD) ? "guardFine" : (action.id === FE_ACTION_ID_BANDIT) ? "banditBounty" : "trollHunt";
      const slot = fe[slotName];
      if (slot && typeof slot === "object") slot.status = "consumed";
    }
  } catch (_) {}

  pushIntentDebug(gm, Object.assign({ channel: "factionTravel" }, intent), turn);
  writePersistedState(ctx, gm, { force: true });

  return intent;
}

export function forceFactionTravelEvent(ctx, id) {
  const gm = _ensureState(ctx);
  if (!ctx) return { kind: "none" };
  if (gm.enabled === false) return { kind: "none" };

  ensureTraitsAndMechanics(gm);
  ensureFactionEvents(gm);
  ensureScheduler(gm);

  const key = String(id || "").toLowerCase();
  if (!key) return { kind: "none" };

  const flags = gm.storyFlags && typeof gm.storyFlags === "object" ? gm.storyFlags : (gm.storyFlags = {});
  const fe = flags.factionEvents && typeof flags.factionEvents === "object" ? flags.factionEvents : (flags.factionEvents = {});

  const turn = normalizeTurn(getCurrentTurn(ctx, gm));

  function ensureSlot(name) {
    let slot = fe[name];
    if (!slot || typeof slot !== "object") {
      slot = {};
      fe[name] = slot;
    }
    slot.status = "scheduled";
    slot.earliestTurn = turn;
    slot.latestTurn = turn;
    return slot;
  }

  let intent = { kind: "none" };

  if (key === "guard_fine" || key === "guard" || key === "guard_fine_event") {
    ensureSlot("guardFine");
    schedulerUpsertAction(gm, FE_ACTION_ID_GUARD, {
      kind: "travel.guardFine",
      status: "scheduled",
      priority: 300,
      delivery: "confirm",
      allowMultiplePerTurn: false,
      createdTurn: turn,
      earliestTurn: turn,
      latestTurn: turn,
      payload: { kind: "guard_fine" },
    });
    intent = { kind: "guard_fine" };
  } else if (key === "bandit_bounty" || key === "bandit" || key === "bounty") {
    ensureSlot("banditBounty");
    schedulerUpsertAction(gm, FE_ACTION_ID_BANDIT, {
      kind: "travel.banditBounty",
      status: "scheduled",
      priority: 200,
      delivery: "auto",
      allowMultiplePerTurn: false,
      createdTurn: turn,
      earliestTurn: turn,
      latestTurn: turn,
      payload: { encounterId: "gm_bandit_bounty" },
    });
    intent = { kind: "encounter", encounterId: "gm_bandit_bounty" };
  } else if (key === "troll_hunt" || key === "troll" || key === "trolls") {
    ensureSlot("trollHunt");
    schedulerUpsertAction(gm, FE_ACTION_ID_TROLL, {
      kind: "travel.trollHunt",
      status: "scheduled",
      priority: 100,
      delivery: "auto",
      allowMultiplePerTurn: false,
      createdTurn: turn,
      earliestTurn: turn,
      latestTurn: turn,
      payload: { encounterId: "gm_troll_hunt" },
    });
    intent = { kind: "encounter", encounterId: "gm_troll_hunt" };
  } else {
    return { kind: "none" };
  }

  gm.lastActionTurn = turn;
  pushIntentDebug(gm, Object.assign({ channel: "factionTravel" }, intent), turn);
  writePersistedState(ctx, gm, { force: true });
  return intent;
}

// ------------------------
// Traits/families/factions extraction
// ------------------------

function extractFamilyKeyFromTags(rawTags) {
  if (!Array.isArray(rawTags) || rawTags.length === 0) return null;
  const tags = [];
  for (let i = 0; i < rawTags.length; i++) {
    const tag = rawTags[i];
    if (tag == null) continue;
    tags.push(String(tag).toLowerCase());
  }
  if (!tags.length) return null;

  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (t.startsWith("kind:")) {
      const fam = t.slice(5).trim();
      if (fam) return fam;
    }
  }
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (t.startsWith("race:")) {
      const fam = t.slice(5).trim();
      if (fam) return fam;
    }
  }
  return null;
}

function extractFactionKeysFromTags(rawTags) {
  if (!rawTags) return [];

  let length = 0;
  if (Array.isArray(rawTags)) length = rawTags.length;
  else if (typeof rawTags.length === "number") {
    length = rawTags.length | 0;
    if (length < 0) length = 0;
  }

  if (length === 0) return [];

  const keys = [];
  const seen = Object.create(null);
  for (let i = 0; i < length; i++) {
    const tag = rawTags[i];
    if (tag == null) continue;
    const t = String(tag).toLowerCase();
    if (!t || !t.startsWith("faction:")) continue;
    const key = t.slice(8).trim();
    if (!key || seen[key]) continue;
    seen[key] = true;
    keys.push(key);
  }

  return keys;
}

function updateFamiliesFromCombatKill(families, event, turn) {
  if (!families || !event) return;
  const famKey = extractFamilyKeyFromTags(event.tags);
  if (!famKey) return;

  let fam = families[famKey];
  if (!fam || typeof fam !== "object") {
    fam = { seen: 0, positive: 0, negative: 0, lastUpdatedTurn: null };
    families[famKey] = fam;
  }

  fam.seen = (fam.seen | 0) + 1;
  if (fam.seen < 0) fam.seen = 0;
  fam.positive = (fam.positive | 0) + 1;
  if (fam.positive < 0) fam.positive = 0;
  fam.lastUpdatedTurn = normalizeTurn(turn);
}

function updateFactionsFromCombatKill(factions, event, turn) {
  if (!factions || !event) return;
  const keys = extractFactionKeysFromTags(event.tags);
  if (!keys.length) return;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    let entry = factions[key];
    if (!entry || typeof entry !== "object") {
      entry = { seen: 0, positive: 0, negative: 0, lastUpdatedTurn: null };
      factions[key] = entry;
    }

    entry.seen = (entry.seen | 0) + 1;
    if (entry.seen < 0) entry.seen = 0;
    entry.positive = (entry.positive | 0) + 1;
    if (entry.positive < 0) entry.positive = 0;
    entry.lastUpdatedTurn = normalizeTurn(turn);
  }
}

function applyTraitDelta(trait, deltaSeen, deltaPositive, deltaNegative, turn) {
  if (!trait) return;
  const hasDelta = (deltaSeen | 0) !== 0 || (deltaPositive | 0) !== 0 || (deltaNegative | 0) !== 0;
  if (!hasDelta) return;

  if (deltaSeen) {
    let v = (trait.seen | 0) + (deltaSeen | 0);
    if (v < 0) v = 0;
    trait.seen = v;
  }
  if (deltaPositive) {
    let v = (trait.positive | 0) + (deltaPositive | 0);
    if (v < 0) v = 0;
    trait.positive = v;
  }
  if (deltaNegative) {
    let v = (trait.negative | 0) + (deltaNegative | 0);
    if (v < 0) v = 0;
    trait.negative = v;
  }

  trait.lastUpdatedTurn = normalizeTurn(turn);
}

function updateTraitsFromCombatKill(traits, event, turn) {
  if (!traits || !event) return;
  const rawTags = Array.isArray(event.tags) ? event.tags : [];
  if (!rawTags.length) return;

  const tags = [];
  for (let i = 0; i < rawTags.length; i++) {
    const tag = rawTags[i];
    if (tag == null) continue;
    tags.push(String(tag).toLowerCase());
  }
  if (!tags.length) return;

  const hasKindTroll = tags.indexOf("kind:troll") !== -1;
  const hasRaceTroll = tags.indexOf("race:troll") !== -1;
  if (hasKindTroll || hasRaceTroll) {
    applyTraitDelta(traits.trollSlayer, 1, 1, 0, turn);
  }

  const hasBandit = tags.indexOf("faction:bandit") !== -1;
  const hasGuard = tags.indexOf("faction:guard") !== -1;
  const hasTownFaction = tags.indexOf("faction:town") !== -1;
  const hasContextTown = tags.indexOf("context:town") !== -1;
  const hasContextCastle = tags.indexOf("context:castle") !== -1;

  if (hasBandit && (hasContextTown || hasContextCastle)) {
    applyTraitDelta(traits.townProtector, 1, 1, 0, turn);
  }

  if ((hasGuard || hasTownFaction) && (hasContextTown || hasContextCastle)) {
    applyTraitDelta(traits.townProtector, 1, 0, 1, turn);
  }

  const hasCaravanTag = tags.indexOf("caravan") !== -1;
  const hasCaravanGuardTag = tags.indexOf("caravanguard") !== -1;
  if (hasCaravanTag || hasCaravanGuardTag) {
    applyTraitDelta(traits.caravanAlly, 1, 0, 1, turn);
  }
}

function updateTraitsFromQuestComplete(traits, event, turn) {
  if (!traits || !event) return;
  const rawTags = Array.isArray(event.tags) ? event.tags : [];
  if (!rawTags.length) return;

  const tags = [];
  for (let i = 0; i < rawTags.length; i++) {
    const tag = rawTags[i];
    if (tag == null) continue;
    tags.push(String(tag).toLowerCase());
  }
  if (!tags.length) return;

  const hasTrollHunt = tags.indexOf("trollhunt") !== -1;
  const hasTrollSlayerTag = tags.indexOf("trollslayer") !== -1;
  const hasTrollHelp = tags.indexOf("trollhelp") !== -1;
  if (hasTrollHunt || hasTrollSlayerTag || hasTrollHelp) {
    let deltaPositive = 0;
    let deltaNegative = 0;
    if (hasTrollHunt || hasTrollSlayerTag) deltaPositive += 1;
    if (hasTrollHelp) deltaNegative += 1;
    applyTraitDelta(traits.trollSlayer, 1, deltaPositive, deltaNegative, turn);
  }

  const hasTownDefense = tags.indexOf("towndefense") !== -1;
  const hasTownHelp = tags.indexOf("townhelp") !== -1;
  const hasAttackTown = tags.indexOf("attacktown") !== -1;
  if (hasTownDefense || hasTownHelp || hasAttackTown) {
    let deltaPositive = 0;
    let deltaNegative = 0;
    if (hasTownDefense || hasTownHelp) deltaPositive += 1;
    if (hasAttackTown) deltaNegative += 1;
    applyTraitDelta(traits.townProtector, 1, deltaPositive, deltaNegative, turn);
  }

  const hasCaravanHelp = tags.indexOf("caravanhelp") !== -1;
  const hasEscortCaravan = tags.indexOf("escortcaravan") !== -1;
  if (hasCaravanHelp || hasEscortCaravan) {
    applyTraitDelta(traits.caravanAlly, 1, 1, 0, turn);
  }
}

function updateTraitsFromCaravanEvent(traits, event, turn) {
  if (!traits || !event) return;
  const trait = traits.caravanAlly;
  if (!trait) return;

  const type = String(event.type || "");
  let deltaSeen = 0;
  let deltaPositive = 0;
  let deltaNegative = 0;

  if (type === "caravan.accepted") {
    const reason = String(event.reason || "");
    if (reason === "escort") {
      deltaSeen += 1;
      deltaPositive += 1;
    }
  } else if (type === "caravan.completed") {
    if (event.success === true) {
      deltaSeen += 1;
      deltaPositive += 2;
    } else if (event.success === false) {
      deltaSeen += 1;
      deltaNegative += 1;
    }
  } else if (type === "caravan.attacked") {
    deltaSeen += 1;
    deltaNegative += 1;
  }

  applyTraitDelta(trait, deltaSeen, deltaPositive, deltaNegative, turn);
}

function updateMechanicsUsage(mechanics, event, turn) {
  if (!mechanics || !event) return;

  const mechanic = String(event.mechanic || "");
  const action = String(event.action || "");
  const m = mechanics[mechanic];
  if (!m || typeof m !== "object") return;

  function inc(key) {
    let v = (m[key] | 0) + 1;
    if (v < 0) v = 0;
    m[key] = v;
  }

  let changed = false;

  if (action === "seen") {
    inc("seen");
    changed = true;
  } else if (action === "tried") {
    inc("tried");
    changed = true;
  } else if (action === "success") {
    inc("tried");
    inc("success");
    changed = true;
  } else if (action === "failure") {
    inc("tried");
    inc("failure");
    changed = true;
  } else if (action === "dismiss") {
    inc("dismiss");
    changed = true;
  }

  if (!changed) return;

  const safeTurn = normalizeTurn(turn);
  if (m.firstSeenTurn == null || (m.firstSeenTurn | 0) < 0) {
    m.firstSeenTurn = safeTurn;
  }
  m.lastUsedTurn = safeTurn;
}

function applyGuardFineOutcome(gm, type, turn) {
  if (!gm || typeof gm !== "object") return;

  ensureTraitsAndMechanics(gm);
  ensureFactionEvents(gm);

  const factions = gm.factions && typeof gm.factions === "object" ? gm.factions : {};
  const guard = factions.guard && typeof factions.guard === "object" ? factions.guard : null;
  const town = factions.town && typeof factions.town === "object" ? factions.town : null;

  const storyFlags = gm.storyFlags && typeof gm.storyFlags === "object" ? gm.storyFlags : (gm.storyFlags = {});
  const safeTurn = normalizeTurn(turn);

  function bump(entry, deltaPositive, deltaNegative) {
    if (!entry || typeof entry !== "object") return;
    entry.seen = Math.max(0, (entry.seen | 0) + 1);
    entry.positive = Math.max(0, (entry.positive | 0) + (deltaPositive | 0));
    entry.negative = Math.max(0, (entry.negative | 0) + (deltaNegative | 0));
    entry.lastUpdatedTurn = safeTurn;
  }

  function maybeDecayGuardFineHeat() {
    const totalRefusals = storyFlags.guardFineRefusals | 0;
    if (totalRefusals <= 0) return;

    const rawLastRefusalTurn = storyFlags.guardFineLastRefusalTurn;
    if (typeof rawLastRefusalTurn !== "number") return;
    let lastRefusalTurn = rawLastRefusalTurn | 0;
    if (lastRefusalTurn < 0) lastRefusalTurn = 0;

    const age = safeTurn - lastRefusalTurn;
    if (age <= GUARD_FINE_HEAT_TURNS) return;

    const decayedRefusalsRaw = storyFlags.guardFineRefusalsDecayed;
    const decayedRefusals = decayedRefusalsRaw == null ? 0 : (decayedRefusalsRaw | 0);
    let pendingRefusals = totalRefusals - decayedRefusals;
    if (pendingRefusals <= 0) return;
    if (pendingRefusals > totalRefusals) pendingRefusals = totalRefusals;

    bump(guard, 0, pendingRefusals);
    bump(town, 0, pendingRefusals);

    storyFlags.guardFineRefusalsDecayed = decayedRefusals + pendingRefusals;
    storyFlags.guardFineHeatLastDecayTurn = safeTurn;
  }

  maybeDecayGuardFineHeat();

  if (type === "gm.guardFine.pay") {
    bump(guard, 0, 1);
    bump(town, 0, 1);
    storyFlags.guardFinePaid = true;
  } else if (type === "gm.guardFine.refuse") {
    bump(guard, 1, 0);
    bump(town, 1, 0);

    storyFlags.guardFineRefusals = (storyFlags.guardFineRefusals | 0) + 1;
    storyFlags.guardFineLastRefusalTurn = safeTurn;
  }
}

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
