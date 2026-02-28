/**
 * Mechanic hint ("nudge") intent generation.
 *
 * Extracted from `core/gm/runtime.js` to keep the runtime module focused on
 * state management + persistence wiring.
 */

import { HINT_INTENT_COOLDOWN_TURNS } from "../constants.js";

import { localClamp } from "../turn_utils.js";

import {
  ensureStats,
  ensureTraitsAndMechanics,
  getMechanicKnowledge,
} from "../state_ensure.js";

/**
 * Implementation of `GMRuntime.getMechanicHint`.
 *
 * Note: this function must not access localStorage nor persist state directly.
 * It returns `{ intent, shouldWrite }` so the caller can decide whether to
 * persist.
 *
 * @param {object} ctx
 * @param {object} gm
 * @param {object} helpers
 * @param {(gm: object) => void} helpers.markDirty
 * @param {(gm: object, intent: object, turn: number) => boolean} helpers.pushIntentDebug
 * @param {number} helpers.turn Normalized current turn.
 * @returns {{ intent: object, shouldWrite: boolean }}
 */
export function getMechanicHintImpl(ctx, gm, helpers) {
  const turn = helpers.turn;
  const markDirty = helpers.markDirty;
  const pushIntentDebug = helpers.pushIntentDebug;

  function returnNone(reason) {
    if (pushIntentDebug(gm, { kind: "none", channel: "mechanicHint", reason }, turn)) markDirty(gm);
    return { intent: { kind: "none" }, shouldWrite: false };
  }

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
  const keys = ["questBoard", "followers", "fishing", "lockpicking"]; // town-friendly order for stable expectations

  let bestKey = null;
  let bestScore = -1;
  let bestSeen = -1;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const m = mechanics[key];
    if (!m || typeof m !== "object") continue;

    const tried = m.tried | 0;
    if (tried !== 0) continue;

    const state = getMechanicKnowledge(m, turn);
    if (state === "disinterested" || state === "triedRecently") continue;

    const seen = m.seen | 0;

    let score = 5;
    if (state === "seenNotTried") score += 3;
    if (isTown && (key === "questBoard" || key === "followers")) score += 1;
    score += Math.round(boredomLevel * 2);
    if (seen > 5) score += 1;

    if (score > bestScore || (score === bestScore && seen > bestSeen)) {
      bestScore = score;
      bestSeen = seen;
      bestKey = key;
    }
  }

  if (!bestKey) {
    return returnNone("no.mechanic");
  }

  const intent = { kind: "nudge", target: `mechanic:${bestKey}`, strength: "low" };
  gm.lastHintIntentTurn = turn;
  gm.lastHintIntentTownEntry = entriesTown;
  gm.lastActionTurn = turn;

  if (pushIntentDebug(gm, Object.assign({ channel: "mechanicHint" }, intent), turn)) markDirty(gm);

  return { intent, shouldWrite: true };
}
