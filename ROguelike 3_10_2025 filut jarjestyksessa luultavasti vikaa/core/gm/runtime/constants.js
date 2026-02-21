export const SCHEMA_VERSION = 6;
export const MAX_DEBUG_EVENTS = 50;
export const MAX_INTENT_HISTORY = 20;
export const ACTION_COOLDOWN_TURNS = 80;
// Entrance flavor can be a bit more frequent than mechanics hints, but we still keep it rare.
export const ENTRANCE_INTENT_COOLDOWN_TURNS = 60;
// Hints stay on the original, rarer cadence.
export const HINT_INTENT_COOLDOWN_TURNS = ACTION_COOLDOWN_TURNS;
export const MOOD_DECAY_PER_TURN = 0.98;
export const MOOD_BOREDOM_HIGH = 0.8;
export const MOOD_BOREDOM_LOW = 0.2;
export const MOOD_RECENT_INTERESTING_TURNS = 30;
export const MOOD_NUDGE_DELTA = 0.01;
export const MOOD_NUDGE_DELTA_SMALL = 0.005;
export const BOREDOM_SMOOTHING_ALPHA = 0.15; // how fast boredom reacts to changes
export const MOOD_TRANSIENT_DECAY_PER_TURN = 0.9; // transients decay faster than base mood

// Mechanic knowledge thresholds; see getMechanicKnowledge.
export const MECH_RECENT_TURNS = 200;
export const MECH_DISINTEREST_DISMISS = 3;
export const MECH_DISINTEREST_AGE = 600;
// Guard fine "heat" forget window; same scale as trait forgetting.
export const GUARD_FINE_HEAT_TURNS = 300;
