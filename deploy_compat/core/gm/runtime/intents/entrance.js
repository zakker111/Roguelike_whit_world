/**
 * Entrance intent generation.
 *
 * Extracted from `core/gm/runtime.js` to keep the runtime module focused on
 * state management + persistence wiring.
 */

import { ENTRANCE_INTENT_COOLDOWN_TURNS } from "../constants.js";

import { buildProfile } from "../profile.js";
import { createDefaultState } from "../state_defaults.js";

import {
  ensureStats,
  normalizeMood,
  labelMood,
} from "../state_ensure.js";

/**
 * Implementation of `GMRuntime.getEntranceIntent`.
 *
 * Note: this function must not access localStorage nor persist state directly.
 * It returns `{ intent, shouldWrite }` so the caller can decide whether to
 * persist.
 *
 * @param {object} ctx
 * @param {object} gm
 * @param {string=} mode
 * @param {object} helpers
 * @param {(gm: object) => void} helpers.markDirty
 * @param {(gm: object, intent: object, turn: number) => boolean} helpers.pushIntentDebug
 * @param {number} helpers.turn Normalized current turn.
 * @returns {{ intent: object, shouldWrite: boolean }}
 */
export function getEntranceIntentImpl(ctx, gm, mode, helpers) {
  const turn = helpers.turn;
  const markDirty = helpers.markDirty;
  const pushIntentDebug = helpers.pushIntentDebug;

  function returnNone(reason) {
    if (pushIntentDebug(gm, { kind: "none", channel: "entrance", reason }, turn)) markDirty(gm);
    return { intent: { kind: "none" }, shouldWrite: false };
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

  // Rarity gating for town/tavern entries.
  try {
    const stats = ensureStats(gm);
    const modeEntries = stats.modeEntries && typeof stats.modeEntries === "object" ? stats.modeEntries : {};
    const entriesForMode = modeEntries[modeKey] != null ? (modeEntries[modeKey] | 0) : 0;

    if ((modeKey === "town" || modeKey === "tavern") && entriesForMode > 1) {
      const ENTRY_PERIOD = 4; // 1st, 5th, 9th, ...
      if ((entriesForMode - 1) % ENTRY_PERIOD !== 0) {
        return returnNone("rarity.entryPeriod");
      }
    }
  } catch (_) {}

  // Variety topic based on dominant mode.
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

  if ((!intent || intent.kind === "none")
    && (moodLabel === "stern" || moodLabel === "restless" || moodLabel === "bored")
    && boredomLevel > 0.5) {
    const topic = varietyTopic || "general_rumor";
    intent = { kind: "flavor", topic, strength: "low", mode: modeKey };
  }

  if ((!intent || intent.kind === "none")
    && (moodLabel === "curious" || moodLabel === "playful" || moodLabel === "neutral")
    && boredomLevel > 0.3) {
    const topic = varietyTopic || "general_rumor";
    intent = { kind: "flavor", topic, strength: "low", mode: modeKey };
  }

  if ((!intent || intent.kind === "none")
    && profile.totalTurns < 50
    && boredomLevel > 0.2) {
    if (!gm.storyFlags || typeof gm.storyFlags !== "object") gm.storyFlags = {};
    if (gm.storyFlags.firstEntranceFlavorShown !== true) {
      intent = { kind: "flavor", topic: "general_rumor", strength: "low", mode: modeKey };
      gm.storyFlags.firstEntranceFlavorShown = true;
    }
  }

  if (!intent || intent.kind === "none") {
    return returnNone("no.intent");
  }

  gm.lastEntranceIntentTurn = turn;
  gm.lastActionTurn = turn;
  if (pushIntentDebug(gm, Object.assign({ channel: "entrance" }, intent), turn)) markDirty(gm);

  return { intent, shouldWrite: true };
}
