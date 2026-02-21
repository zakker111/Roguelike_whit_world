/**
 * GMRuntime state defaults.
 *
 * These helpers define the canonical shape for gm state bags created at runtime
 * (and are also used as a source of truth when repairing malformed states).
 */

import { SCHEMA_VERSION } from "./constants.js";

export function createDefaultStats() {
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

export function createDefaultTraits() {
  return {
    trollSlayer: { seen: 0, positive: 0, negative: 0, lastUpdatedTurn: null },
    townProtector: { seen: 0, positive: 0, negative: 0, lastUpdatedTurn: null },
    caravanAlly: { seen: 0, positive: 0, negative: 0, lastUpdatedTurn: null },
  };
}

export function createDefaultMechanics() {
  return {
    fishing: { seen: 0, tried: 0, success: 0, failure: 0, dismiss: 0, firstSeenTurn: null, lastUsedTurn: null },
    lockpicking: { seen: 0, tried: 0, success: 0, failure: 0, dismiss: 0, firstSeenTurn: null, lastUsedTurn: null },
    questBoard: { seen: 0, tried: 0, success: 0, failure: 0, dismiss: 0, firstSeenTurn: null, lastUsedTurn: null },
    followers: { seen: 0, tried: 0, success: 0, failure: 0, dismiss: 0, firstSeenTurn: null, lastUsedTurn: null },
  };
}

export function createDefaultMood() {
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

export function createDefaultState() {
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
    lastHintIntentTownEntry: -1,
  };
}
