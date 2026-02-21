/**
 * GMRuntime state normalization helpers.
 *
 * These helpers are intentionally deterministic and mutation-only on the provided
 * `gm` state bag. They do not access module-local GMRuntime state.
 */

import {
  MAX_DEBUG_EVENTS,
  MAX_INTENT_HISTORY,
  MECH_RECENT_TURNS,
  MECH_DISINTEREST_DISMISS,
  MECH_DISINTEREST_AGE,
} from "./constants.js";

import {
  createDefaultStats,
  createDefaultTraits,
  createDefaultMechanics,
  createDefaultMood,
} from "./state_defaults.js";

import { localClamp, normalizeTurn } from "./turn_utils.js";

export function ensureStats(gm) {
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

export function ensureTraitsAndMechanics(gm) {
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

export function ensureFactionEvents(gm) {
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
export function getMechanicKnowledge(m, currentTurn) {
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

  if (seen <= 0 && tried <= 0) {
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

export function normalizeFamilyTrait(family) {
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

export function normalizeMood(gm) {
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

export function labelMood(gm, turn) {
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
