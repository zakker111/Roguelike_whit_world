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
const SCHEMA_VERSION = 4;
const MAX_DEBUG_EVENTS = 50;
const MAX_INTENT_HISTORY = 20;
const ACTION_COOLDOWN_TURNS = 80;
const MOOD_DECAY_PER_TURN = 0.98;
const MOOD_BOREDOM_HIGH = 0.8;
const MOOD_BOREDOM_LOW = 0.2;
const MOOD_RECENT_INTERESTING_TURNS = 30;
const MOOD_NUDGE_DELTA = 0.01;
const MOOD_NUDGE_DELTA_SMALL = 0.005;

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

function createDefaultTraits() {
  return {
    trollSlayer: { seen: 0, positive: 0, negative: 0, lastUpdatedTurn: null },
    townProtector: { seen: 0, positive: 0, negative: 0, lastUpdatedTurn: null },
    caravanAlly: { seen: 0, positive: 0, negative: 0, lastUpdatedTurn: null },
  };
}

function createDefaultMechanics() {
  return {
    fishing: { seen: 0, tried: 0, success: 0, failure: 0, dismiss: 0, firstSeenTurn: null, lastUsedTurn: null },
    lockpicking: { seen: 0, tried: 0, success: 0, failure: 0, dismiss: 0, firstSeenTurn: null, lastUsedTurn: null },
    questBoard: { seen: 0, tried: 0, success: 0, failure: 0, dismiss: 0, firstSeenTurn: null, lastUsedTurn: null },
    followers: { seen: 0, tried: 0, success: 0, failure: 0, dismiss: 0, firstSeenTurn: null, lastUsedTurn: null },
  };
}

function createDefaultMood() {
  return {
    primary: "neutral",
    valence: 0.0,
    arousal: 0.0,
    lastUpdatedTurn: null,
  };
}

function createDefaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    enabled: true,
    mood: createDefaultMood(),
    boredom: {
      level: 0.0,
      turnsSinceLastInterestingEvent: 0,
      lastInterestingEvent: null,
    },
    storyFlags: {},
    debug: {
      enabled: false,
      logTicks: false,
      logEvents: false,
      lastTickTurn: -1,
      lastEvent: null,
      lastEvents: [],
      counters: {
        ticks: 0,
        events: 0,
        interestingEvents: 0,
      },
      lastIntent: null,
      intentHistory: [],
    },
    stats: createDefaultStats(),
    traits: createDefaultTraits(),
    mechanics: createDefaultMechanics(),
    families: {},
    lastMode: "world",
    lastActionTurn: -1,
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

function ensureTraitsAndMechanics(gm) {
  if (!gm || typeof gm !== "object") return;

  if (!gm.storyFlags || typeof gm.storyFlags !== "object") {
    gm.storyFlags = {};
  }

  // Traits
  let traits = gm.traits;
  if (!traits || typeof traits !== "object") {
    traits = createDefaultTraits();
    gm.traits = traits;
  }

  function normalizeNonNegative(obj, key) {
    let v = obj[key] | 0;
    if (v < 0) v = 0;
    obj[key] = v;
  }

  function normalizeTurnField(obj, key) {
    const raw = obj[key];
    if (raw == null) {
      obj[key] = null;
      return;
    }
    let v = typeof raw === "number" ? (raw | 0) : NaN;
    if (!Number.isFinite(v) || v < 0) {
      obj[key] = null;
    } else {
      obj[key] = v;
    }
  }

  function ensureTrait(key) {
    if (!traits[key] || typeof traits[key] !== "object") {
      traits[key] = {
        seen: 0,
        positive: 0,
        negative: 0,
        lastUpdatedTurn: null,
      };
    }
    const t = traits[key];
    normalizeNonNegative(t, "seen");
    normalizeNonNegative(t, "positive");
    normalizeNonNegative(t, "negative");
    normalizeTurnField(t, "lastUpdatedTurn");
  }

  ensureTrait("trollSlayer");
  ensureTrait("townProtector");
  ensureTrait("caravanAlly");

  // Mechanics
  let mechanics = gm.mechanics;
  if (!mechanics || typeof mechanics !== "object") {
    mechanics = createDefaultMechanics();
    gm.mechanics = mechanics;
  }

  function ensureMechanic(key) {
    if (!mechanics[key] || typeof mechanics[key] !== "object") {
      mechanics[key] = {
        seen: 0,
        tried: 0,
        success: 0,
        failure: 0,
        dismiss: 0,
        firstSeenTurn: null,
        lastUsedTurn: null,
      };
    }
    const m = mechanics[key];
    normalizeNonNegative(m, "seen");
    normalizeNonNegative(m, "tried");
    normalizeNonNegative(m, "success");
    normalizeNonNegative(m, "failure");
    normalizeNonNegative(m, "dismiss");
    normalizeTurnField(m, "firstSeenTurn");
    normalizeTurnField(m, "lastUsedTurn");
  }

  ensureMechanic("fishing");
  ensureMechanic("lockpicking");
  ensureMechanic("questBoard");
  ensureMechanic("followers");

  // Families: ensure container exists and normalize existing entries.
  let families = gm.families;
  if (!families || typeof families !== "object") {
    families = {};
    gm.families = families;
  } else {
    for (const key in families) {
      if (Object.prototype.hasOwnProperty.call(families, key)) {
        normalizeFamilyTrait(families[key]);
      }
    }
  }

  // Debug ring buffers
  if (gm.debug && typeof gm.debug === "object") {
    const dbg = gm.debug;
    if (!Array.isArray(dbg.lastEvents)) {
      dbg.lastEvents = [];
    }
    if (dbg.lastEvents.length > MAX_DEBUG_EVENTS) {
      dbg.lastEvents.length = MAX_DEBUG_EVENTS;
    }
    if (!Array.isArray(dbg.intentHistory)) {
      dbg.intentHistory = [];
    }
    if (dbg.intentHistory.length > MAX_INTENT_HISTORY) {
      dbg.intentHistory.length = MAX_INTENT_HISTORY;
    }
  }
}

function normalizeFamilyTrait(family) {
  if (!family || typeof family !== "object") return;
  family.seen = (family.seen | 0);
  if (family.seen < 0) family.seen = 0;
  family.positive = (family.positive | 0);
  if (family.positive < 0) family.positive = 0;
  family.negative = (family.negative | 0);
  if (family.negative < 0) family.negative = 0;
  const rawTurn = family.lastUpdatedTurn;
  if (rawTurn == null) {
    family.lastUpdatedTurn = null;
  } else {
    let t = typeof rawTurn === "number" ? (rawTurn | 0) : NaN;
    if (!Number.isFinite(t) || t < 0) family.lastUpdatedTurn = null;
    else family.lastUpdatedTurn = t;
  }
}

function normalizeMood(gm) {
  if (!gm || typeof gm !== "object") return;
  let mood = gm.mood;
  if (!mood || typeof mood !== "object") {
    mood = createDefaultMood();
    gm.mood = mood;
  }

  let v = Number(mood.valence);
  let a = Number(mood.arousal);
  if (!Number.isFinite(v)) v = 0;
  if (!Number.isFinite(a)) a = 0;

  v = localClamp(v, -1, 1);
  a = localClamp(a, 0, 1);

  mood.valence = v;
  mood.arousal = a;
  if (typeof mood.primary !== "string") {
    mood.primary = "neutral";
  }
}

function labelMood(gm, turn) {
  if (!gm || typeof gm !== "object") return;
  const mood = gm.mood;
  if (!mood || typeof mood !== "object") return;

  const v = typeof mood.valence === "number" && Number.isFinite(mood.valence) ? mood.valence : 0;
  const a = typeof mood.arousal === "number" && Number.isFinite(mood.arousal) ? mood.arousal : 0;

  let primary = "neutral";
  if (a < 0.2) {
    primary = "calm";
  } else if (a < 0.6) {
    if (v > 0.2) primary = "curious";
    else if (v < -0.2) primary = "bored";
    else primary = "neutral";
  } else {
    if (v > 0.2) primary = "playful";
    else if (v < -0.2) primary = "stern";
    else primary = "restless";
  }

  mood.primary = primary;
  mood.lastUpdatedTurn = normalizeTurn(turn);
}

function pushIntentDebug(gm, intent, turn) {
  if (!gm || typeof gm !== "object") return;
  let dbg = gm.debug;
  if (!dbg || typeof dbg !== "object") {
    dbg = {
      enabled: false,
      logTicks: false,
      logEvents: false,
      lastTickTurn: -1,
      lastEvent: null,
      lastEvents: [],
      counters: {
        ticks: 0,
        events: 0,
        interestingEvents: 0,
      },
      lastIntent: null,
      intentHistory: [],
    };
    gm.debug = dbg;
  }

  const src = intent && typeof intent === "object" ? intent : {};
  const normalized = {
    kind: src.kind || "none",
    topic: src.topic != null ? src.topic : null,
    target: src.target != null ? src.target : null,
    id: src.id != null ? src.id : null,
    turn: normalizeTurn(turn),
    mood: gm.mood && typeof gm.mood.primary === "string" ? gm.mood.primary : "unknown",
    boredom: gm.boredom && typeof gm.boredom.level === "number" && Number.isFinite(gm.boredom.level)
      ? gm.boredom.level
      : 0,
  };

  dbg.lastIntent = normalized;
  const buf = Array.isArray(dbg.intentHistory) ? dbg.intentHistory : (dbg.intentHistory = []);
  buf.unshift(normalized);
  if (buf.length > MAX_INTENT_HISTORY) buf.length = MAX_INTENT_HISTORY;
}

function buildProfile(gm) {
  const profile = {
    boredomLevel: 0,
    totalTurns: 0,
    topModes: [],
    topFamilies: [],
    activeTraits: [],
  };

  if (!gm || typeof gm !== "object") return profile;

  const stats = ensureStats(gm);
  const boredomLevelRaw = gm.boredom && typeof gm.boredom.level === "number" && Number.isFinite(gm.boredom.level)
    ? gm.boredom.level
    : 0;
  profile.boredomLevel = localClamp(boredomLevelRaw, 0, 1);
  profile.totalTurns = stats.totalTurns | 0;

  // Top modes: sort by turns desc, then mode name for determinism.
  const modeTurns = stats.modeTurns && typeof stats.modeTurns === "object" ? stats.modeTurns : {};
  const topModes = [];
  for (const key in modeTurns) {
    if (!Object.prototype.hasOwnProperty.call(modeTurns, key)) continue;
    const turns = modeTurns[key] | 0;
    if (turns <= 0) continue;
    topModes.push({ mode: key, turns });
  }
  topModes.sort((a, b) => {
    if (b.turns !== a.turns) return b.turns - a.turns;
    if (a.mode < b.mode) return -1;
    if (a.mode > b.mode) return 1;
    return 0;
  });
  profile.topModes = topModes.slice(0, 3);

  // Families: derive top families by seen count, then score.
  ensureTraitsAndMechanics(gm);
  const families = gm.families && typeof gm.families === "object" ? gm.families : {};
  const topFamilies = [];
  for (const key in families) {
    if (!Object.prototype.hasOwnProperty.call(families, key)) continue;
    const fam = families[key];
    if (!fam || typeof fam !== "object") continue;
    const seen = fam.seen | 0;
    if (seen < 1) continue;
    const pos = fam.positive | 0;
    const neg = fam.negative | 0;
    const samples = pos + neg;
    const score = samples > 0 ? (pos - neg) / samples : 0;
    topFamilies.push({ key, seen, score });
  }
  topFamilies.sort((a, b) => {
    if (b.seen !== a.seen) return b.seen - a.seen;
    const absA = Math.abs(a.score);
    const absB = Math.abs(b.score);
    if (absB !== absA) return absB - absA;
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    return 0;
  });
  profile.topFamilies = topFamilies.slice(0, 5);

  // Active named traits: mirror GM panel gating (evidence + bias + memory).
  const traits = gm.traits && typeof gm.traits === "object" ? gm.traits : {};
  const dbg = gm.debug && typeof gm.debug === "object" ? gm.debug : {};
  const currentTurn = typeof dbg.lastTickTurn === "number" ? (dbg.lastTickTurn | 0) : null;
  const TRAIT_MIN_SAMPLES = 3;
  const TRAIT_MIN_SCORE = 0.4;
  const TRAIT_FORGET_TURNS = 300;

  const traitDefs = [
    { key: "trollSlayer", label: "Troll Slayer" },
    { key: "townProtector", label: "Town Protector" },
    { key: "caravanAlly", label: "Caravan Ally" },
  ];

  const activeTraits = [];
  for (let i = 0; i < traitDefs.length; i++) {
    const def = traitDefs[i];
    const tr = traits[def.key];
    if (!tr || typeof tr !== "object") continue;
    const seen = tr.seen | 0;
    const pos = tr.positive | 0;
    const neg = tr.negative | 0;
    const samples = pos + neg;
    const score = samples > 0 ? (pos - neg) / samples : 0;
    const lastTurn = tr.lastUpdatedTurn == null ? null : (tr.lastUpdatedTurn | 0);

    const hasEnoughSamples = seen >= TRAIT_MIN_SAMPLES;
    const hasStrongBias = Math.abs(score) >= TRAIT_MIN_SCORE;
    let remembered = true;
    if (currentTurn != null && lastTurn != null) {
      const delta = currentTurn - lastTurn;
      if (delta > TRAIT_FORGET_TURNS) remembered = false;
    }

    if (!hasEnoughSamples || !hasStrongBias || !remembered) continue;

    activeTraits.push({ key: def.key, label: def.label, score });
  }

  activeTraits.sort((a, b) => {
    const absA = Math.abs(a.score);
    const absB = Math.abs(b.score);
    if (absB !== absA) return absB - absA;
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    return 0;
  });
  profile.activeTraits = activeTraits;

  return profile;
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

  // Mood: decay gently toward neutral each turn and respond to boredom.
  let valence = gm.mood && typeof gm.mood.valence === "number" ? gm.mood.valence : 0;
  let arousal = gm.mood && typeof gm.mood.arousal === "number" ? gm.mood.arousal : 0;

  if (isNewTurn) {
    valence *= MOOD_DECAY_PER_TURN;
    arousal *= MOOD_DECAY_PER_TURN;
  }

  const boredomLevel = gm.boredom && typeof gm.boredom.level === "number" ? gm.boredom.level : 0;
  if (boredomLevel > MOOD_BOREDOM_HIGH) {
    // High boredom: mood drifts slightly negative and more restless.
    valence -= MOOD_NUDGE_DELTA;
    arousal += MOOD_NUDGE_DELTA;
  } else if (boredomLevel < MOOD_BOREDOM_LOW) {
    const lastInteresting = gm.boredom.lastInterestingEvent;
    const lastInterestingTurn =
      lastInteresting && typeof lastInteresting.turn === "number"
        ? (lastInteresting.turn | 0)
        : null;
    if (lastInterestingTurn != null && (turn - lastInterestingTurn) <= MOOD_RECENT_INTERESTING_TURNS) {
      // Recent interesting events with low boredom: slightly more positive and a bit calmer.
      valence += MOOD_NUDGE_DELTA;
      arousal -= MOOD_NUDGE_DELTA_SMALL;
    }
  }

  gm.mood.valence = valence;
  gm.mood.arousal = arousal;
  normalizeMood(gm);
  labelMood(gm, turn);

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

  // Event-driven mood nudges for a few coarse outcomes (Phase 1 flavor only).
  if (!gm.mood || typeof gm.mood !== "object") {
    gm.mood = createDefaultMood();
  }
  if (type === "encounter.exit") {
    const baseValence = typeof gm.mood.valence === "number" ? gm.mood.valence : 0;
    const baseArousal = typeof gm.mood.arousal === "number" ? gm.mood.arousal : 0;
    gm.mood.valence = baseValence + 0.02;
    gm.mood.arousal = baseArousal + 0.01;
  } else if (type === "quest.complete") {
    const baseValence = typeof gm.mood.valence === "number" ? gm.mood.valence : 0;
    gm.mood.valence = baseValence + 0.03;
  }
  normalizeMood(gm);
  labelMood(gm, turn);

  if (gm.enabled !== false) {
    if (type === "combat.kill") {
      const traits = gm.traits;
      updateTraitsFromCombatKill(traits, event, turn);
      const families = gm.families || (gm.families = {});
      updateFamiliesFromCombatKill(families, event, turn);
    } else if (type === "quest.complete") {
      const traits = gm.traits;
      updateTraitsFromQuestComplete(traits, event, turn);
    }

    if (type === "caravan.accepted" || type === "caravan.completed" || type === "caravan.attacked") {
      updateTraitsFromCaravanEvent(gm.traits, event, turn);
    }

    if (type === "mechanic") {
      updateMechanicsUsage(gm.mechanics, event, turn);
    }
  }

  // Optional concise debug logging for events.
  if (gm.debug.enabled && gm.debug.logEvents && typeof ctx.log === "function") {
    try {
      const label = type || "?";
      ctx.log(`[GM] event ${label} @${scope}`, "info", { category: "gm" });
    } catch (_) {}
  }
}

function normalizeTurn(turn) {
  let t = typeof turn === "number" ? (turn | 0) : 0;
  if (t < 0) t = 0;
  return t;
}

function getCurrentTurn(ctx, gm) {
  if (ctx && ctx.time && typeof ctx.time.turnCounter === "number") {
    return ctx.time.turnCounter | 0;
  }
  if (gm && gm.debug && typeof gm.debug.lastTickTurn === "number") {
    return gm.debug.lastTickTurn | 0;
  }
  return 0;
}

function extractFamilyKeyFromTags(rawTags) {
  if (!Array.isArray(rawTags) || rawTags.length === 0) return null;
  const tags = [];
  for (let i = 0; i < rawTags.length; i++) {
    const tag = rawTags[i];
    if (tag == null) continue;
    tags.push(String(tag).toLowerCase());
  }
  if (!tags.length) return null;

  // Prefer kind:*
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (t.startsWith("kind:")) {
      const fam = t.slice(5).trim();
      if (fam) return fam;
    }
  }
  // Fallback to race:*
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (t.startsWith("race:")) {
      const fam = t.slice(5).trim();
      if (fam) return fam;
    }
  }
  return null;
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

  // For now: killing a member of a family is always "positive" evidence that the player is a slayer of that family.
  fam.seen = (fam.seen | 0) + 1;
  if (fam.seen < 0) fam.seen = 0;
  fam.positive = (fam.positive | 0) + 1;
  if (fam.positive < 0) fam.positive = 0;
  fam.lastUpdatedTurn = normalizeTurn(turn);
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
  if (!m) return; // unknown mechanic

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

export function getState(ctx) {
  return _ensureState(ctx);
}

export function getEntranceIntent(ctx, mode) {
  const gm = _ensureState(ctx);
  const turn = normalizeTurn(getCurrentTurn(ctx, gm));

  if (gm.enabled === false) {
    return { kind: "none" };
  }

  if (!gm.debug || typeof gm.debug !== "object") {
    gm.debug = createDefaultState().debug;
  }
  if (!gm.config || typeof gm.config !== "object") {
    gm.config = {};
  }

  const lastActionTurn = typeof gm.lastActionTurn === "number" ? (gm.lastActionTurn | 0) : -1;
  if (lastActionTurn >= 0 && (turn - lastActionTurn) < ACTION_COOLDOWN_TURNS) {
    return { kind: "none" };
  }

  normalizeMood(gm);
  labelMood(gm, turn);

  const profile = buildProfile(gm);
  const moodLabel = gm.mood && typeof gm.mood.primary === "string" ? gm.mood.primary : "neutral";
  const modeKey = typeof mode === "string" && mode ? mode : (ctx && typeof ctx.mode === "string" && ctx.mode ? ctx.mode : (gm.lastMode || "unknown"));

  let intent = { kind: "none" };

  if ((moodLabel === "stern" || moodLabel === "restless") && profile.boredomLevel > 0.7) {
    const fam = Array.isArray(profile.topFamilies) && profile.topFamilies.length ? profile.topFamilies[0] : null;
    if (fam && fam.key) {
      intent = {
        kind: "flavor",
        topic: `family:${fam.key}`,
        strength: "medium",
        mode: modeKey,
      };
    }
  } else if ((moodLabel === "curious" || moodLabel === "playful") && profile.boredomLevel > 0.5) {
    intent = {
      kind: "flavor",
      topic: "general_rumor",
      strength: "low",
      mode: modeKey,
    };
  }

  if (!intent || intent.kind === "none") {
    return { kind: "none" };
  }

  gm.lastActionTurn = turn;
  pushIntentDebug(gm, intent, turn);
  return intent;
}

export function getMechanicHint(ctx) {
  const gm = _ensureState(ctx);
  const turn = normalizeTurn(getCurrentTurn(ctx, gm));

  if (gm.enabled === false) {
    return { kind: "none" };
  }

  const boredomLevel = gm.boredom && typeof gm.boredom.level === "number" && Number.isFinite(gm.boredom.level)
    ? gm.boredom.level
    : 0;
  if (boredomLevel <= 0.6) {
    return { kind: "none" };
  }

  ensureTraitsAndMechanics(gm);

  const lastActionTurn = typeof gm.lastActionTurn === "number" ? (gm.lastActionTurn | 0) : -1;
  if (lastActionTurn >= 0 && (turn - lastActionTurn) < ACTION_COOLDOWN_TURNS) {
    return { kind: "none" };
  }

  const mechanics = gm.mechanics && typeof gm.mechanics === "object" ? gm.mechanics : {};
  const keys = ["fishing", "lockpicking", "questBoard", "followers"];

  let bestKey = null;
  let bestSeen = -1;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const m = mechanics[key];
    if (!m || typeof m !== "object") continue;
    const seen = m.seen | 0;
    const tried = m.tried | 0;
    if (seen > 0 && tried === 0) {
      if (seen > bestSeen) {
        bestSeen = seen;
        bestKey = key;
      }
    }
  }

  if (!bestKey) {
    return { kind: "none" };
  }

  const intent = {
    kind: "nudge",
    target: `mechanic:${bestKey}`,
    strength: "low",
  };

  gm.lastActionTurn = turn;
  pushIntentDebug(gm, intent, turn);
  return intent;
}

export function reset(ctx, opts = {}) {
  _state = null;
  const nextOpts = Object.assign({}, opts, { reset: true });
  return init(ctx, nextOpts);
}

// Back-compat: attach to window via helper
attachGlobal("GMRuntime", { init, tick, onEvent, getState, reset, getEntranceIntent, getMechanicHint });
