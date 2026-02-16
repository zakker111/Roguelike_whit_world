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
const SCHEMA_VERSION = 6;
const MAX_DEBUG_EVENTS = 50;
const MAX_INTENT_HISTORY = 20;
const ACTION_COOLDOWN_TURNS = 80;
// Entrance flavor can be a bit more frequent than mechanics hints, but we still keep it rare.
const ENTRANCE_INTENT_COOLDOWN_TURNS = 60;
// Hints stay on the original, rarer cadence.
const HINT_INTENT_COOLDOWN_TURNS = ACTION_COOLDOWN_TURNS;
const MOOD_DECAY_PER_TURN = 0.98;
const MOOD_BOREDOM_HIGH = 0.8;
const MOOD_BOREDOM_LOW = 0.2;
const MOOD_RECENT_INTERESTING_TURNS = 30;
const MOOD_NUDGE_DELTA = 0.01;
const MOOD_NUDGE_DELTA_SMALL = 0.005;
const BOREDOM_SMOOTHING_ALPHA = 0.15; // how fast boredom reacts to changes
const MOOD_TRANSIENT_DECAY_PER_TURN = 0.9; // transients decay faster than base mood

// Mechanic knowledge thresholds; see getMechanicKnowledge.
const MECH_RECENT_TURNS = 200;
const MECH_DISINTEREST_DISMISS = 3;
const MECH_DISINTEREST_AGE = 600;
// Guard fine "heat" forget window; same scale as trait forgetting.
const GUARD_FINE_HEAT_TURNS = 300;

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
    baselineValence: 0.0,
    baselineArousal: 0.0,
    transientValence: 0.0,
    transientArousal: 0.0,
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
    storyFlags: {
      factionEvents: {},
    },
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
    factions: {},
    lastMode: "world",
    // Legacy/global last GM action turn; keep for back-compat and debugging.
    lastActionTurn: -1,
    // Separate cooldown tracking for entrance flavor vs mechanic hints.
    lastEntranceIntentTurn: -1,
    lastHintIntentTurn: -1,
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

  // Factions: ensure container exists and normalize existing entries.
  let factions = gm.factions;
  if (!factions || typeof factions !== "object" || Array.isArray(factions)) {
    factions = {};
    gm.factions = factions;
  } else {
    for (const key in factions) {
      if (Object.prototype.hasOwnProperty.call(factions, key)) {
        normalizeFamilyTrait(factions[key]);
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

function ensureFactionEvents(gm) {
  if (!gm || typeof gm !== "object") return;

  if (!gm.storyFlags || typeof gm.storyFlags !== "object") {
    gm.storyFlags = {};
  }

  let factionEvents = gm.storyFlags.factionEvents;
  if (!factionEvents || typeof factionEvents !== "object" || Array.isArray(factionEvents)) {
    factionEvents = {};
    gm.storyFlags.factionEvents = factionEvents;
  }

  function normalizeTurnField(value) {
    if (typeof value !== "number") return 0;
    let v = value | 0;
    if (v < 0) v = 0;
    return v;
  }

  function ensureSlot(key) {
    let slot = factionEvents[key];
    if (!slot || typeof slot !== "object") {
      slot = {};
      factionEvents[key] = slot;
    }

    let status = typeof slot.status === "string" ? slot.status : "none";
    if (status !== "none" && status !== "scheduled" && status !== "consumed") {
      status = "none";
    }
    slot.status = status;

    const earliest = normalizeTurnField(slot.earliestTurn);
    let latest = normalizeTurnField(slot.latestTurn);

    if (latest !== 0 && latest < earliest) {
      latest = earliest;
    }

    slot.earliestTurn = earliest;
    slot.latestTurn = latest;
  }

  ensureSlot("banditBounty");
  ensureSlot("guardFine");
  ensureSlot("trollHunt");
}

// Returns one of: "unseen", "seenNotTried", "triedRecently", "triedLongAgo", "disinterested".
// Derived from counts and lastUsedTurn; does not mutate the mechanic object.
function getMechanicKnowledge(m, currentTurn) {
  if (!m || typeof m !== "object") return "unseen";

  const seen = m.seen | 0;
  const tried = m.tried | 0;
  const dismiss = m.dismiss | 0;

  let turn = typeof currentTurn === "number" ? (currentTurn | 0) : 0;
  if (turn < 0) turn = 0;

  let normalizedLastUsed = null;
  const rawLastUsed = m.lastUsedTurn;
  if (rawLastUsed != null) {
    const num = typeof rawLastUsed === "number" ? (rawLastUsed | 0) : NaN;
    if (Number.isFinite(num) && num >= 0) {
      normalizedLastUsed = num;
    }
  }

  let age = null;
  if (normalizedLastUsed != null) {
    age = turn - normalizedLastUsed;
    if (age < 0) age = 0;
  }

  if (seen <= 0) {
    return "unseen";
  }

  if (tried === 0) {
    if (dismiss >= MECH_DISINTEREST_DISMISS) {
      return "disinterested";
    }
    return "seenNotTried";
  }

  // tried > 0
  if (normalizedLastUsed == null) {
    age = MECH_DISINTEREST_AGE + 1;
  }

  if (dismiss >= MECH_DISINTEREST_DISMISS && age != null && age > MECH_RECENT_TURNS) {
    return "disinterested";
  }

  if (age != null && age <= MECH_RECENT_TURNS) {
    return "triedRecently";
  }

  if (age != null && age > MECH_DISINTEREST_AGE) {
    return "disinterested";
  }

  return "triedLongAgo";
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

  // Ensure extended mood fields exist with safe defaults.
  if (!Number.isFinite(mood.baselineValence)) mood.baselineValence = 0;
  if (!Number.isFinite(mood.baselineArousal)) mood.baselineArousal = 0;
  if (!Number.isFinite(mood.transientValence)) mood.transientValence = 0;
  if (!Number.isFinite(mood.transientArousal)) mood.transientArousal = 0;

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
    // Negative impulses (annoyance) are amplified by boredom: 0.5x at low boredom, up to 1.5x at high boredom.
    scale = 0.5 + b;
  } else if (baseValence > 0) {
    // Positive impulses are slightly damped when very bored: 1.0x at low boredom, down to 0.5x at high boredom.
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
    topFactions: [],
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

  // Factions: derive top factions by seen count, then score.
  const factions = gm.factions && typeof gm.factions === "object" ? gm.factions : {};
  const topFactions = [];
  for (const key in factions) {
    if (!Object.prototype.hasOwnProperty.call(factions, key)) continue;
    const fac = factions[key];
    if (!fac || typeof fac !== "object") continue;
    const seen = fac.seen | 0;
    if (seen < 1) continue;
    const pos = fac.positive | 0;
    const neg = fac.negative | 0;
    const samples = pos + neg;
    const score = samples > 0 ? (pos - neg) / samples : 0;
    topFactions.push({ key, seen, score });
  }
  topFactions.sort((a, b) => {
    if (b.seen !== a.seen) return b.seen - a.seen;
    const absA = Math.abs(a.score);
    const absB = Math.abs(b.score);
    if (absB !== absA) return absB - absA;
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    return 0;
  });
  profile.topFactions = topFactions.slice(0, 5);

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
  const normalized = clampedTurns / MAX_TURNS_BORED;
  const prevLevel = (gm.boredom && typeof gm.boredom.level === "number" && Number.isFinite(gm.boredom.level))
    ? gm.boredom.level
    : 0;
  const alpha = BOREDOM_SMOOTHING_ALPHA;
  let nextLevel = prevLevel + alpha * (normalized - prevLevel);
  // Safety clamp to [0,1]
  nextLevel = clamp(nextLevel, 0, 1);
  gm.boredom.level = nextLevel;

  // Lightweight, deterministic stats tracking for turns and modes.
  if (isNewTurn) {
    const stats = ensureStats(gm);
    const modeKey =
      typeof ctx.mode === "string" && ctx.mode ? ctx.mode : (gm.lastMode || "unknown");
    stats.totalTurns = (stats.totalTurns | 0) + 1;
    const mt = stats.modeTurns;
    mt[modeKey] = (mt[modeKey] | 0) + 1;
  }

  // Mood: baseline from boredom plus transient impulses.
  if (!gm.mood || typeof gm.mood !== "object") {
    gm.mood = createDefaultMood();
  }
  const mood = gm.mood;

  // On new turns, decay transient mood components toward zero.
  if (isNewTurn) {
    const decay = MOOD_TRANSIENT_DECAY_PER_TURN;
    const tv = typeof mood.transientValence === "number" && Number.isFinite(mood.transientValence)
      ? mood.transientValence
      : 0;
    const ta = typeof mood.transientArousal === "number" && Number.isFinite(mood.transientArousal)
      ? mood.transientArousal
      : 0;
    mood.transientValence = tv * decay;
    mood.transientArousal = ta * decay;
  }

  // Baseline mood is driven by smoothed boredom level.
  const boredomLevel = gm.boredom && typeof gm.boredom.level === "number" && Number.isFinite(gm.boredom.level)
    ? gm.boredom.level
    : 0;
  const b = clamp(boredomLevel, 0, 1);

  // Low boredom (b≈0) → slightly positive, calm.
  // High boredom (b≈1) → more negative, more restless.
  const baseValLow = 0.15;
  const baseValHigh = -0.5;
  const baseArLow = 0.25;
  const baseArHigh = 0.75;

  const baselineValence = baseValLow + (baseValHigh - baseValLow) * b;
  const baselineArousal = baseArLow + (baseArHigh - baseArLow) * b;

  mood.baselineValence = baselineValence;
  mood.baselineArousal = baselineArousal;

  // Combine baseline and transient components for final mood.
  const tv2 = typeof mood.transientValence === "number" && Number.isFinite(mood.transientValence)
    ? mood.transientValence
    : 0;
  const ta2 = typeof mood.transientArousal === "number" && Number.isFinite(mood.transientArousal)
    ? mood.transientArousal
    : 0;

  let v = baselineValence + tv2;
  let a = baselineArousal + ta2;

  v = clamp(v, -1, 1);
  a = clamp(a, 0, 1);

  mood.valence = v;
  mood.arousal = a;
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

  // Event-driven mood impulses for a few coarse outcomes (Phase 1 flavor only).
  if (type === "encounter.exit") {
    // Small positive impulse: encounter completion.
    addMoodImpulse(gm, 0.02, 0.01);
  } else if (type === "quest.complete") {
    // Slightly stronger positive valence impulse for quests.
    addMoodImpulse(gm, 0.03, 0.0);
  }

  if (gm.enabled !== false) {
    if (type === "combat.kill") {
      const traits = gm.traits;
      updateTraitsFromCombatKill(traits, event, turn);
      const families = gm.families || (gm.families = {});
      updateFamiliesFromCombatKill(families, event, turn);
      const factions = gm.factions || (gm.factions = {});
      updateFactionsFromCombatKill(factions, event, turn);
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

    if (type === "gm.guardFine.pay" || type === "gm.guardFine.refuse") {
      applyGuardFineOutcome(gm, type, turn);
    }

    maybeScheduleFactionEvents(ctx, gm, turn);
  }

  // Optional concise debug logging for events.
  if (gm.debug.enabled && gm.debug.logEvents && typeof ctx.log === "function") {
    try {
      const label = type || "?";
      ctx.log(`[GM] event ${label} @${scope}`, "info", { category: "gm" });
    } catch (_) {}
  }
}

function maybeScheduleFactionEvents(ctx, gm, turn) {
  if (!gm || typeof gm !== "object") return;

  // Traits/factions/families and factionEvents should always be normalized before we
  // derive any scheduling from them. This keeps scheduling deterministic and
  // robust to partial/malformed GM states.
  ensureTraitsAndMechanics(gm);
  ensureFactionEvents(gm);

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
    if (!entry || typeof entry !== "object") {
      return { seen: 0, score: 0 };
    }
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

  // Bandit bounty hunters: driven purely by bandit faction reputation.
  const banditSlot = factionEvents.banditBounty;
  if (slotIsFree(banditSlot)) {
    const banditEntry = factions.bandit;
    const metrics = extractSeenAndScore(banditEntry);
    if (metrics.seen >= 8 && metrics.score >= 0.8) {
      banditSlot.status = "scheduled";
      banditSlot.earliestTurn = normalizeTurn(safeTurn + 50);
      banditSlot.latestTurn = normalizeTurn(safeTurn + 300);
    }
  }

  // Guard fine: aggregate hostility across guard/town related factions.
  const guardSlot = factionEvents.guardFine;
  if (slotIsFree(guardSlot)) {
    let bestGuardSeen = 0;
    let bestGuardScore = -1;

    const guardEntry = factions.guard;
    if (guardEntry && typeof guardEntry === "object") {
      const m = extractSeenAndScore(guardEntry);
      if (m.seen > bestGuardSeen || (m.seen === bestGuardSeen && m.score > bestGuardScore)) {
        bestGuardSeen = m.seen;
        bestGuardScore = m.score;
      }
    }

    const townEntry = factions.town;
    if (townEntry && typeof townEntry === "object") {
      const m = extractSeenAndScore(townEntry);
      if (m.seen > bestGuardSeen || (m.seen === bestGuardSeen && m.score > bestGuardScore)) {
        bestGuardSeen = m.seen;
        bestGuardScore = m.score;
      }
    }

    if (bestGuardSeen >= 3 && bestGuardScore >= 0.6) {
      guardSlot.status = "scheduled";
      guardSlot.earliestTurn = normalizeTurn(safeTurn + 30);
      guardSlot.latestTurn = normalizeTurn(safeTurn + 240);
    }
  }

  // Troll hunt: prefer family "troll" if present, else fall back to faction "trolls".
  const trollSlot = factionEvents.trollHunt;
  if (slotIsFree(trollSlot)) {
    let source = null;
    if (families && typeof families === "object" && families.troll && typeof families.troll === "object") {
      source = families.troll;
    } else if (factions && typeof factions === "object" && factions.trolls && typeof factions.trolls === "object") {
      source = factions.trolls;
    }

    if (source) {
      const metrics = extractSeenAndScore(source);
      if (metrics.seen >= 4 && metrics.score >= 0.7) {
        trollSlot.status = "scheduled";
        trollSlot.earliestTurn = normalizeTurn(safeTurn + 40);
        trollSlot.latestTurn = normalizeTurn(safeTurn + 260);
      }
    }
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

function extractFactionKeysFromTags(rawTags) {
  if (!rawTags) return [];

  let length = 0;
  if (Array.isArray(rawTags)) {
    length = rawTags.length;
  } else if (typeof rawTags.length === "number") {
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

  // For now: killing a member of a family is always "positive" evidence that the player is a slayer of that family.
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

/**
 * Apply outcomes for the GM-driven guard fine.
 *
 * Paying slightly improves guard/town attitude and records guardFinePaid.
 * Refusing increases hostility and records non-permanent "heat":
 * - guardFineRefusals: cumulative count of refusals.
 * - guardFineLastRefusalTurn: last turn a refusal happened.
 * Heat gradually cools off after GUARD_FINE_HEAT_TURNS so that guards
 * don't stay permanently hostile from a very old refusal.
 */
function applyGuardFineOutcome(gm, type, turn) {
  if (!gm || typeof gm !== "object") return;

  // Guard fine outcomes are deterministic bookkeeping on faction attitudes.
  ensureTraitsAndMechanics(gm);
  ensureFactionEvents(gm);

  const factions = gm.factions && typeof gm.factions === "object" ? gm.factions : {};
  const guard = factions.guard && typeof factions.guard === "object" ? factions.guard : null;
  const town = factions.town && typeof factions.town === "object" ? factions.town : null;

  const storyFlags = gm.storyFlags && typeof gm.storyFlags === "object" ? gm.storyFlags : (gm.storyFlags = {});
  const factionEvents = storyFlags.factionEvents && typeof storyFlags.factionEvents === "object"
    ? storyFlags.factionEvents
    : (storyFlags.factionEvents = {});
  let slot = factionEvents.guardFine;
  if (!slot || typeof slot !== "object") {
    slot = {};
    factionEvents.guardFine = slot;
  }
  slot.status = "consumed";

  const safeTurn = normalizeTurn(turn);

  function bump(entry, deltaPositive, deltaNegative) {
    if (!entry || typeof entry !== "object") return;
    let seen = (entry.seen | 0) + 1;
    if (seen < 0) seen = 0;
    entry.seen = seen;

    let positive = (entry.positive | 0) + (deltaPositive | 0);
    if (positive < 0) positive = 0;
    entry.positive = positive;

    let negative = (entry.negative | 0) + (deltaNegative | 0);
    if (negative < 0) negative = 0;
    entry.negative = negative;

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
    if (pendingRefusals > totalRefusals) {
      pendingRefusals = totalRefusals;
    }

    // Cool off hostility from old refusals by adding matching "good" samples.
    bump(guard, 0, pendingRefusals);
    bump(town, 0, pendingRefusals);

    storyFlags.guardFineRefusalsDecayed = decayedRefusals + pendingRefusals;
    storyFlags.guardFineHeatLastDecayTurn = safeTurn;
  }

  // Decay any long-expired guard fine heat before applying the new outcome.
  maybeDecayGuardFineHeat();

  if (type === "gm.guardFine.pay") {
    bump(guard, 0, 1);
    bump(town, 0, 1);
    storyFlags.guardFinePaid = true;
  } else if (type === "gm.guardFine.refuse") {
    bump(guard, 1, 0);
    bump(town, 1, 0);

    const prevRefusals = storyFlags.guardFineRefusals | 0;
    storyFlags.guardFineRefusals = prevRefusals + 1;
    storyFlags.guardFineLastRefusalTurn = safeTurn;
  }
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

  const lastEntranceTurn = typeof gm.lastEntranceIntentTurn === "number" ? (gm.lastEntranceIntentTurn | 0) : -1;
  if (lastEntranceTurn >= 0 && (turn - lastEntranceTurn) < ENTRANCE_INTENT_COOLDOWN_TURNS) {
    return { kind: "none" };
  }

  normalizeMood(gm);
  labelMood(gm, turn);

  const profile = buildProfile(gm);
  const moodLabel = gm.mood && typeof gm.mood.primary === "string" ? gm.mood.primary : "neutral";
  const modeKey = typeof mode === "string" && mode ? mode : (ctx && typeof ctx.mode === "string" && ctx.mode ? ctx.mode : (gm.lastMode || "unknown"));
  const boredomLevel = profile.boredomLevel;

  // Additional rarity gating: do not fire entrance flavor on every town/tavern entry.
  // Allow it on the first entry, then at most once every few entries per scope.
  try {
    const stats = ensureStats(gm);
    const modeEntries = stats.modeEntries && typeof stats.modeEntries === "object" ? stats.modeEntries : {};
    const entriesForMode = modeEntries[modeKey] != null ? (modeEntries[modeKey] | 0) : 0;

    if ((modeKey === "town" || modeKey === "tavern") && entriesForMode > 1) {
      const ENTRY_PERIOD = 4; // 1st, 5th, 9th, ... entries into town/tavern.
      if ((entriesForMode - 1) % ENTRY_PERIOD !== 0) {
        return { kind: "none" };
      }
    }
  } catch (_) {}

  // Precompute a variety topic based on long-term mode usage if the run looks monotonous.
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

  // Family flavor: moderately bored and focused on a known family.
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

  // Generic/variety flavor: slightly lower boredom gate and more moods.
  if ((!intent || intent.kind === "none")
    && (moodLabel === "curious" || moodLabel === "playful" || moodLabel === "neutral")
    && boredomLevel > 0.3) {
    const topic = varietyTopic || "general_rumor";
    intent = {
      kind: "flavor",
      topic,
      strength: "low",
      mode: modeKey,
    };
  }

  // First-run flavor: early game, mild boredom, and only once per run.
  if ((!intent || intent.kind === "none")
    && profile.totalTurns < 50
    && boredomLevel > 0.2) {
    if (!gm.storyFlags || typeof gm.storyFlags !== "object") {
      gm.storyFlags = {};
    }
    if (gm.storyFlags.firstEntranceFlavorShown !== true) {
      intent = {
        kind: "flavor",
        topic: "general_rumor",
        strength: "low",
        mode: modeKey,
      };
      gm.storyFlags.firstEntranceFlavorShown = true;
    }
  }

  if (!intent || intent.kind === "none") {
    return { kind: "none" };
  }

  gm.lastEntranceIntentTurn = turn;
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

  const lastHintTurn = typeof gm.lastHintIntentTurn === "number" ? (gm.lastHintIntentTurn | 0) : -1;
  if (lastHintTurn >= 0 && (turn - lastHintTurn) < HINT_INTENT_COOLDOWN_TURNS) {
    return { kind: "none" };
  }

  const mechanics = gm.mechanics && typeof gm.mechanics === "object" ? gm.mechanics : {};
  const keys = ["fishing", "lockpicking", "questBoard", "followers"];

  let bestKey = null;
  let bestScore = -1;
  let bestSeen = -1;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const m = mechanics[key];
    if (!m || typeof m !== "object") continue;

    const state = getMechanicKnowledge(m, turn);
    if (state !== "seenNotTried" && state !== "triedLongAgo") continue;

    const seen = m.seen | 0;

    let score = 0;
    if (state === "seenNotTried") {
      score += 3;
    } else if (state === "triedLongAgo") {
      score += 1;
    }

    score += Math.round(boredomLevel * 2);
    if (seen > 5) {
      score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestSeen = seen;
      bestKey = key;
    } else if (score === bestScore && bestKey !== null) {
      if (seen > bestSeen) {
        bestSeen = seen;
        bestKey = key;
      }
      // If score and seen are equal we keep the earlier key, preserving fixed key ordering.
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

  gm.lastHintIntentTurn = turn;
  gm.lastActionTurn = turn;
  pushIntentDebug(gm, intent, turn);
  return intent;
}

/**
 * Derive the next GM-driven faction travel event, if any.
 *
 * Contract:
 * - Purely inspects gm.storyFlags.factionEvents plus the current turn.
 * - Consumes a scheduled slot by marking it "consumed" when an intent is emitted.
 * - Returns { kind: "none" } when no eligible slot exists.
 *
 * This function does not perform gameplay side effects itself; callers (e.g.
 * core/world/move.maybeHandleGMFactionTravelEvent) are responsible for
 * interpreting the intent and driving any encounters or prompts.
 */
export function getFactionTravelEvent(ctx) {
  const gm = _ensureState(ctx);
  ensureTraitsAndMechanics(gm);
  ensureFactionEvents(gm);

  const turn = normalizeTurn(getCurrentTurn(ctx, gm));

  if (gm.enabled === false) {
    return { kind: "none" };
  }

  const storyFlags = gm.storyFlags && typeof gm.storyFlags === "object" ? gm.storyFlags : null;
  const factionEvents = storyFlags && storyFlags.factionEvents && typeof storyFlags.factionEvents === "object"
    ? storyFlags.factionEvents
    : null;
  if (!factionEvents) {
    return { kind: "none" };
  }

  function isEligible(slot) {
    if (!slot || typeof slot !== "object") return false;
    if (slot.status !== "scheduled") return false;
    const earliest = normalizeTurn(slot.earliestTurn);
    const latest = normalizeTurn(slot.latestTurn);
    if (turn < earliest) return false;
    if (turn > latest) return false;
    return true;
  }

  let intent = null;

  const guardSlot = factionEvents.guardFine;
  if (isEligible(guardSlot)) {
    guardSlot.status = "consumed";
    gm.lastActionTurn = turn;
    intent = { kind: "guard_fine" };
  }

  if (!intent) {
    const banditSlot = factionEvents.banditBounty;
    if (isEligible(banditSlot)) {
      banditSlot.status = "consumed";
      gm.lastActionTurn = turn;
      intent = { kind: "encounter", encounterId: "gm_bandit_bounty" };
    }
  }

  if (!intent) {
    const trollSlot = factionEvents.trollHunt;
    if (isEligible(trollSlot)) {
      trollSlot.status = "consumed";
      gm.lastActionTurn = turn;
      intent = { kind: "encounter", encounterId: "gm_troll_hunt" };
    }
  }

  if (!intent) {
    return { kind: "none" };
  }

  pushIntentDebug(gm, intent, turn);
  return intent;
}

/**
 * Force-trigger a specific faction travel event immediately.
 *
 * This is intended for GOD/debug usage only. It bypasses scheduling windows
 * and returns the same kind of intent object that getFactionTravelEvent()
 * would normally emit when a slot is eligible.
 *
 * Supported ids map to internal faction event slots:
 * - "bandit_bounty" -> bandit bounty encounter
 * - "guard_fine"    -> guard fine travel event
 * - "troll_hunt"    -> troll hunt encounter
 */
export function forceFactionTravelEvent(ctx, id) {
  const gm = _ensureState(ctx);
  if (!ctx) return { kind: "none" };

  ensureTraitsAndMechanics(gm);
  ensureFactionEvents(gm);

  if (gm.enabled === false) {
    return { kind: "none" };
  }

  const key = String(id || "").toLowerCase();
  if (!key) return { kind: "none" };

  const storyFlags = gm.storyFlags && typeof gm.storyFlags === "object" ? gm.storyFlags : (gm.storyFlags = {});
  const factionEvents = storyFlags.factionEvents && typeof storyFlags.factionEvents === "object"
    ? storyFlags.factionEvents
    : (storyFlags.factionEvents = {});

  const turn = normalizeTurn(getCurrentTurn(ctx, gm));

  function ensureSlot(name) {
    let slot = factionEvents[name];
    if (!slot || typeof slot !== "object") {
      slot = {};
      factionEvents[name] = slot;
    }
    slot.status = "scheduled";
    slot.earliestTurn = turn;
    slot.latestTurn = turn;
    return slot;
  }

  let intent = { kind: "none" };

  if (key === "guard_fine" || key === "guard" || key === "guard_fine_event") {
    ensureSlot("guardFine");
    intent = { kind: "guard_fine" };
  } else if (key === "bandit_bounty" || key === "bandit" || key === "bounty") {
    ensureSlot("banditBounty");
    intent = { kind: "encounter", encounterId: "gm_bandit_bounty" };
  } else if (key === "troll_hunt" || key === "troll" || key === "trolls") {
    ensureSlot("trollHunt");
    intent = { kind: "encounter", encounterId: "gm_troll_hunt" };
  } else {
    return { kind: "none" };
  }

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
attachGlobal("GMRuntime", { init, tick, onEvent, getState, reset, getEntranceIntent, getMechanicHint, getFactionTravelEvent, forceFactionTravelEvent });
