/**
 * GMRuntime tick implementation.
 *
 * Extracted from `core/gm/runtime.js` so the public runtime wrapper can focus on
 * state setup and persistence.
 *
 * This module must not touch localStorage (persistence is handled by runtime.js).
 */

import {
  BOREDOM_SMOOTHING_ALPHA,
  MOOD_TRANSIENT_DECAY_PER_TURN,
} from "./constants.js";

import { createDefaultMood } from "./state_defaults.js";

import {
  ensureStats,
  normalizeMood,
  labelMood,
} from "./state_ensure.js";

/**
 * Advance GM bookkeeping for the current engine tick.
 *
 * Mutates `gm` in-place and may call `helpers.markDirty(gm)`.
 *
 * @param {object} ctx Engine context.
 * @param {object} gm Normalized GM state object to update.
 * @param {object} helpers
 * @param {(gm: object) => void} helpers.markDirty Callback provided by runtime.js.
 * @param {(v: number, lo: number, hi: number) => number} helpers.clamp Clamp helper.
 */
export function tickImpl(ctx, gm, helpers) {
  const clamp = helpers.clamp;
  const markDirty = helpers.markDirty;

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
  }

  // Normalize boredom level into [0, 1] based on turns since last interesting event.
  //
  // Note: We intentionally smooth boredom level on every tick, even when the turn
  // counter is held constant (e.g., in sims/tests). The underlying driver
  // `turnsSinceLastInterestingEvent` only advances on new turns.
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

  if (isNewTurn) {
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
}
