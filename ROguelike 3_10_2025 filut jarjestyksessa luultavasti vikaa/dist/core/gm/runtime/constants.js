/**
 * GMRuntime: shared tuning constants.
 *
 * This module is intentionally "data only" (no runtime state). It exists so the
 * GMRuntime behavior is easy to audit and tweak without touching logic.
 */

// Schema version for the persisted GM state bag (GM_STATE_V1).
// Increment when state shape changes in a way that requires a migration.
export const SCHEMA_VERSION = 7;

export const MAX_DEBUG_EVENTS = 50;
export const MAX_INTENT_HISTORY = 20;

// --- Intents / cadence ---
export const ACTION_COOLDOWN_TURNS = 80;
// Entrance flavor can be a bit more frequent than mechanics hints, but we still keep it rare.
export const ENTRANCE_INTENT_COOLDOWN_TURNS = 60;
// Hints stay on the original, rarer cadence.
export const HINT_INTENT_COOLDOWN_TURNS = ACTION_COOLDOWN_TURNS;

// --- Mood / boredom ---
export const MOOD_DECAY_PER_TURN = 0.98;
export const MOOD_BOREDOM_HIGH = 0.8;
export const MOOD_BOREDOM_LOW = 0.2;
export const MOOD_RECENT_INTERESTING_TURNS = 30;
export const MOOD_NUDGE_DELTA = 0.01;
export const MOOD_NUDGE_DELTA_SMALL = 0.005;
export const BOREDOM_SMOOTHING_ALPHA = 0.15; // how fast boredom reacts to changes
export const MOOD_TRANSIENT_DECAY_PER_TURN = 0.9; // transients decay faster than base mood

// --- Mechanic knowledge thresholds; see getMechanicKnowledge. ---
export const MECH_RECENT_TURNS = 200;
export const MECH_DISINTEREST_DISMISS = 3;
export const MECH_DISINTEREST_AGE = 600;

// Guard fine "heat" forget window; same scale as trait forgetting.
export const GUARD_FINE_HEAT_TURNS = 300;

// --- v0.2 foundations: scheduler + GM RNG stream ---
export const GM_RNG_ALGO = "mulberry32";
// Salt used when deriving a GM-specific RNG seed from the run seed.
export const GM_SEED_SALT = 0x4d47_5f30; // "MG_0" (roughly)

// Scheduler rails: keep conservative defaults; these are easy to tune later.
export const GM_SCHED_MIN_AUTO_SPACING_TURNS = 20;
export const GM_SCHED_MAX_ACTIONS_PER_WINDOW = 4;
export const GM_SCHED_WINDOW_TURNS = 200;
export const GM_SCHED_MAX_ACTIVE_THREADS = 1;
