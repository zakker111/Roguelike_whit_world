import { createDefaultMood, createDefaultState } from "./state_defaults.js";
import { normalizeTurn } from "./turn_utils.js";
import { MAX_INTENT_HISTORY } from "./constants.js";

export function addMoodImpulse(gm, baseValence, baseArousal) {
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
    scale = 0.5 + b;
  } else if (baseValence > 0) {
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

export function pushIntentDebug(gm, intent, turn) {
  if (!gm || typeof gm !== "object") return false;

  if (!gm.debug || typeof gm.debug !== "object") gm.debug = createDefaultState().debug;
  if (!Array.isArray(gm.debug.intentHistory)) gm.debug.intentHistory = [];

  const entry = Object.assign({}, intent || {});
  entry.turn = normalizeTurn(turn);

  gm.debug.lastIntent = entry;
  gm.debug.intentHistory.unshift(entry);
  if (gm.debug.intentHistory.length > MAX_INTENT_HISTORY) gm.debug.intentHistory.length = MAX_INTENT_HISTORY;

  return true;
}
