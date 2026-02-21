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

import {
  SCHEMA_VERSION,
  MAX_DEBUG_EVENTS,
  MAX_INTENT_HISTORY,
  ENTRANCE_INTENT_COOLDOWN_TURNS,
  HINT_INTENT_COOLDOWN_TURNS,
  BOREDOM_SMOOTHING_ALPHA,
  MOOD_TRANSIENT_DECAY_PER_TURN,
  GUARD_FINE_HEAT_TURNS,
} from "./runtime/constants.js";

import { createDefaultMood, createDefaultState } from "./runtime/state_defaults.js";

import {
  ensureStats,
  ensureTraitsAndMechanics,
  ensureFactionEvents,
  getMechanicKnowledge,
  normalizeMood,
  labelMood,
} from "./runtime/state_ensure.js";

import { localClamp, normalizeTurn, getCurrentTurn } from "./runtime/turn_utils.js";

let _state = null;



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
    channel: typeof src.channel === "string" ? src.channel : null,
    reason: typeof src.reason === "string" ? src.reason : null,
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

// Advance GM runtime state for the current ctx turn (deterministic, no gameplay side effects).
export function tick(ctx) {
  if (!ctx) return;

  const gm = _ensureState(ctx);

  if (gm.enabled === false) {
    // GM is disabled: keep ctx.gm attached but do not advance any counters or log.
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

// Observe an in-game event and update deterministic GM bookkeeping.
export function onEvent(ctx, event) {
  if (!ctx || !event) return;

  const gm = _ensureState(ctx);

  if (gm.enabled === false) {
    // Match tick(): when disabled, do not mutate counters/boredom/mood/debug.
    return;
  }

  // Defensive: malformed states injected via __setRawState may omit gm.debug/counters.
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

  // Additional rarity gating: do not fire entrance flavor on every town/tavern entry.
  // Allow it on the first entry, then at most once every few entries per scope.
  try {
    const stats = ensureStats(gm);
    const modeEntries = stats.modeEntries && typeof stats.modeEntries === "object" ? stats.modeEntries : {};
    const entriesForMode = modeEntries[modeKey] != null ? (modeEntries[modeKey] | 0) : 0;

    if ((modeKey === "town" || modeKey === "tavern") && entriesForMode > 1) {
      const ENTRY_PERIOD = 4; // 1st, 5th, 9th, ... entries into town/tavern.
      if ((entriesForMode - 1) % ENTRY_PERIOD !== 0) {
        return returnNone("rarity.entryPeriod");
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

  // Fallback: when we're bored/restless but have no family focus, still allow a generic/variety rumor.
  if ((!intent || intent.kind === "none")
    && (moodLabel === "stern" || moodLabel === "restless" || moodLabel === "bored")
    && boredomLevel > 0.5) {
    const topic = varietyTopic || "general_rumor";
    intent = {
      kind: "flavor",
      topic,
      strength: "low",
      mode: modeKey,
    };
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
    return returnNone("no.intent");
  }

  gm.lastEntranceIntentTurn = turn;
  gm.lastActionTurn = turn;
  pushIntentDebug(gm, Object.assign({ channel: "entrance" }, intent), turn);
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

  // Early game guard: don't start nudging mechanics immediately on the first few entries.
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
      // If the player is rapidly re-entering towns without consuming turns (turnCounter static),
      // apply a conservative entry-based cooldown to avoid hint spam.
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
  const keys = ["fishing", "lockpicking", "questBoard", "followers"];

  let bestKey = null;
  let bestScore = -1;
  let bestTried = 1e9;
  let bestSeen = -1;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const m = mechanics[key];
    if (!m || typeof m !== "object") continue;

    const state = getMechanicKnowledge(m, turn);
    if (state === "disinterested" || state === "triedRecently") continue;

    // Only nudge mechanics the player has NOT used yet.
    const tried = m.tried | 0;
    if (tried !== 0) continue;

    const seen = m.seen | 0;

    // Prefer mechanics the player has seen but not tried yet.
    // In town, lightly prefer town mechanics to avoid fixed-order tie-breaking.
    // Boredom does not hard-gate hints; it only increases priority deterministically.
    let score = 0;
    score += 5;
    if (state === "seenNotTried") score += 3;

    if (isTown && (key === "questBoard" || key === "followers")) score += 1;

    score += Math.round(boredomLevel * 2);
    if (seen > 5) score += 1;

    if (score > bestScore) {
      bestScore = score;
      bestTried = tried;
      bestSeen = seen;
      bestKey = key;
    } else if (score === bestScore && bestKey !== null) {
      if (tried < bestTried) {
        bestTried = tried;
        bestSeen = seen;
        bestKey = key;
      } else if (tried === bestTried) {
        if (seen > bestSeen) {
          bestSeen = seen;
          bestKey = key;
        }
        // If score/tried/seen are equal we keep the earlier key, preserving fixed ordering.
      }
    }
  }

  if (!bestKey) {
    return returnNone("no.mechanic");
  }

  const intent = {
    kind: "nudge",
    target: `mechanic:${bestKey}`,
    strength: "low",
  };

  gm.lastHintIntentTurn = turn;
  gm.lastHintIntentTownEntry = entriesTown;
  gm.lastActionTurn = turn;
  pushIntentDebug(gm, Object.assign({ channel: "mechanicHint" }, intent), turn);
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

  if (gm.enabled === false) {
    return { kind: "none" };
  }

  ensureTraitsAndMechanics(gm);
  ensureFactionEvents(gm);

  const turn = normalizeTurn(getCurrentTurn(ctx, gm));

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

  if (gm.enabled === false) {
    return { kind: "none" };
  }

  ensureTraitsAndMechanics(gm);
  ensureFactionEvents(gm);

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

// Internal/test helpers: allow dev tools to preserve and restore the module-local GM state.
export function __getRawState() {
  return _state;
}

export function __setRawState(nextState, ctx) {
  _state = nextState;
  if (ctx) {
    ctx.gm = _state;
  }
  return _state;
}

// Back-compat: attach to window via helper
attachGlobal("GMRuntime", { init, tick, onEvent, getState, reset, getEntranceIntent, getMechanicHint, getFactionTravelEvent, forceFactionTravelEvent, __getRawState, __setRawState });
