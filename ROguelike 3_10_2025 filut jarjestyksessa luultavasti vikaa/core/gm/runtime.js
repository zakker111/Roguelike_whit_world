/**
 * GMRuntime: Phase 0–1 scaffolding for a ctx-first "Game Master" runtime.
 *
 * Scope:
 * - Owns a single module-local GM state bag for the current session.
 * - Exposes read-only observability via ctx.gm (mood, boredom, debug counters).
 * - Provides init/tick/onEvent/getState/reset helpers and attaches via window.GMRuntime.
 *
 * Notes:
 * - Deterministic: no RNG usage; all behavior is derived from ctx/time/events.
 * - No gameplay side effects in Phase 0–1: this module never mutates game rules,
 *   mode, RNG, entities, or persistence; it only writes under ctx.gm.
 * - State is in-memory only; save/load integration may be added in later phases.
 */

import { attachGlobal } from "../../utils/global.js";

let _state = null;
const SCHEMA_VERSION = 2;

function createDefaultStats() {
  return {
    totalTurns: 0,
    // turns spent in each mode/scope, e.g. { world: 123, town: 45, dungeon: 67, ... }
    modeTurns: {},
    // number of times we entered each mode/scope via events, e.g. { world: 10, town: 5, ... }
    modeEntries: {},
    // encounter counts
    encounterStarts: 0,
    encounterCompletions: 0,
  };
}

function createDefaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    enabled: true,
    mood: {
      primary: "neutral",
      valence: 0.0,
      arousal: 0.0,
      lastUpdatedTurn: null,
    },
    boredom: {
      level: 0.0,
      turnsSinceLastInterestingEvent: 0,
      lastInterestingEvent: null,
    },
    debug: {
      enabled: false,
      logTicks: false,
      logEvents: false,
      lastTickTurn: -1,
      lastEvent: null,
      counters: {
        ticks: 0,
        events: 0,
        interestingEvents: 0,
      },
    },
    stats: createDefaultStats(),
    lastMode: "world",
  };
}

function localClamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function ensureStats(gm) {
  if (!gm || typeof gm !== "object") {
    return createDefaultStats();
  }

  let stats = gm.stats;
  if (!stats || typeof stats !== "object") {
    stats = createDefaultStats();
    gm.stats = stats;
  }

  // Normalize fields to simple integer counters and plain-object maps.
  stats.totalTurns = stats.totalTurns | 0;
  if (!stats.modeTurns || typeof stats.modeTurns !== "object") {
    stats.modeTurns = {};
  }
  if (!stats.modeEntries || typeof stats.modeEntries !== "object") {
    stats.modeEntries = {};
  }
  stats.encounterStarts = stats.encounterStarts | 0;
  stats.encounterCompletions = stats.encounterCompletions | 0;

  return stats;
}

function _ensureState(ctx) {
  if (!_state || _state.schemaVersion !== SCHEMA_VERSION) {
    _state = createDefaultState();
  }
  if (ctx) {
    // Always mirror the current GM state onto the ctx for callers that rely on ctx.gm.
    ctx.gm = _state;
  }
  return _state;
}

export function init(ctx, opts = {}) {
  if (opts && opts.reset === true) {
    _state = createDefaultState();
    if (ctx) ctx.gm = _state;
    return _state;
  }
  return _ensureState(ctx);
}

export function tick(ctx) {
  if (!ctx) return;

  const gm = _ensureState(ctx);

  if (gm.enabled === false) {
    // GM is disabled: keep ctx.gm attached but do not advance any counters or log.
    return;
  }

  const utils = ctx.utils || null;
  const clamp = utils && typeof utils.clamp === "function" ? utils.clamp : localClamp;

  const lastTurn = gm.debug.lastTickTurn | 0;
  const turn = (ctx.time && typeof ctx.time.turnCounter === "number")
    ? (ctx.time.turnCounter | 0)
    : (lastTurn + 1);

  const isNewTurn = turn !== lastTurn;

  // Tick counters are strictly per-unique turn.
  if (isNewTurn) {
    gm.debug.counters.ticks = (gm.debug.counters.ticks | 0) + 1;

    const lastInteresting = gm.boredom.lastInterestingEvent;
    const hadInterestingThisTurn =
      !!(lastInteresting && typeof lastInteresting.turn === "number" && (lastInteresting.turn | 0) === turn);

    if (!hadInterestingThisTurn) {
      gm.boredom.turnsSinceLastInterestingEvent =
        (gm.boredom.turnsSinceLastInterestingEvent | 0) + 1;
    }
  }

  // Normalize boredom level into [0, 1] based on turns since last interesting event.
  const MAX_TURNS_BORED = 200;
  const rawTurns = gm.boredom.turnsSinceLastInterestingEvent | 0;
  const clampedTurns = clamp(rawTurns, 0, MAX_TURNS_BORED);
  gm.boredom.level = clampedTurns / MAX_TURNS_BORED;

  // Lightweight, deterministic stats tracking for turns and modes.
  if (isNewTurn) {
    const stats = ensureStats(gm);
    const modeKey =
      typeof ctx.mode === "string" && ctx.mode ? ctx.mode : (gm.lastMode || "unknown");
    stats.totalTurns = (stats.totalTurns | 0) + 1;
    const mt = stats.modeTurns;
    mt[modeKey] = (mt[modeKey] | 0) + 1;
  }

  // Mood fields remain placeholders in Phase 0–1; we only track when they were last updated.
  gm.mood.lastUpdatedTurn = turn;

  // Track the last observed mode without mutating any mode logic.
  if (ctx.mode) {
    gm.lastMode = ctx.mode;
  }

  // Optional low-frequency debug logging for ticks.
  if (gm.debug.enabled && gm.debug.logTicks && isNewTurn && typeof ctx.log === "function") {
    // Log at most once every 50 turns to avoid spam in long runs.
    if (turn > 0 && turn % 50 === 0) {
      try {
        ctx.log(`[GM] tick ${turn}`, "info", { category: "gm" });
      } catch (_) {}
    }
  }

  gm.debug.lastTickTurn = turn;
}

export function onEvent(ctx, event) {
  if (!ctx || !event) return;

  const gm = _ensureState(ctx);

  const explicitTurn = event.turn;
  const turn = explicitTurn != null
    ? (explicitTurn | 0)
    : (ctx.time && typeof ctx.time.turnCounter === "number")
      ? (ctx.time.turnCounter | 0)
      : gm.debug.lastTickTurn;

  const type = String(event.type || "");
  const scope = event.scope || ctx.mode || "unknown";
  const interesting = event.interesting !== false;

  const stats = ensureStats(gm);

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

  gm.debug.lastEvent = {
    type,
    scope,
    turn,
    payload: Object.prototype.hasOwnProperty.call(event, "payload") ? event.payload : null,
  };

  if (interesting) {
    gm.boredom.turnsSinceLastInterestingEvent = 0;
    gm.boredom.lastInterestingEvent = { type, scope, turn };
  }

  // Optional concise debug logging for events.
  if (gm.debug.enabled && gm.debug.logEvents && typeof ctx.log === "function") {
    try {
      const label = type || "?";
      ctx.log(`[GM] event ${label} @${scope}`, "info", { category: "gm" });
    } catch (_) {}
  }
}

export function getState(ctx) {
  return _ensureState(ctx);
}

export function reset(ctx, opts = {}) {
  _state = null;
  const nextOpts = Object.assign({}, opts, { reset: true });
  return init(ctx, nextOpts);
}

// Back-compat: attach to window via helper
attachGlobal("GMRuntime", { init, tick, onEvent, getState, reset });
