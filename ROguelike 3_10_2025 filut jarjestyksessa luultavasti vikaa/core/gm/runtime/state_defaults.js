/**
 * GMRuntime state defaults.
 *
 * These helpers define the canonical shape for gm state bags created at runtime
 * (and are also used as a source of truth when repairing malformed states).
 */

import { SCHEMA_VERSION, GM_RNG_ALGO } from "./constants.js";

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

    // Captured run seed used to detect when a new run has started.
    // GM_STATE_V1 is treated as per-run; if the runSeed doesn't match, we reset.
    runSeed: 0,

    // v0.2 foundations: dedicated GM RNG stream. This is separate from ctx.rng so
    // GM decisions can be deterministic and persisted without consuming run RNG.
    rng: {
      algo: GM_RNG_ALGO,
      state: 0,
      calls: 0,
    },

    // v0.2 foundations: general deterministic scheduler. Currently used to
    // back the faction travel events (guard fine / bandit bounty / troll hunt).
    scheduler: {
      nextId: 1,
      actions: {},
      queue: [],
      // last turn we delivered an auto action (used for min spacing rail)
      lastAutoTurn: -9999,
      // recent deliveries for rate limiting (bounded by ensure helpers)
      history: [],
    },

    mood: createDefaultMood(),
    boredom: {
      level: 0.0,
      turnsSinceLastInterestingEvent: 0,
      lastInterestingEvent: null,
    },
    storyFlags: {
      // Back-compat: the old "factionEvents" slots are still kept around as a
      // stable, easy-to-inspect view for the GM panel and for migration.
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
