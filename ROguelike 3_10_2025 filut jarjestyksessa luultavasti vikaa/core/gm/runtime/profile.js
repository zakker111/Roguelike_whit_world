/**
 * GMRuntime profile helpers.
 *
 * This module is intentionally pure-ish: it computes a summarized profile from
 * the passed gm state bag, without relying on GMRuntime module-local state.
 */

import { ensureStats } from "./state_ensure.js";
import { localClamp } from "./turn_utils.js";

export function buildProfile(gm) {
  const stats = ensureStats(gm);

  const profile = {
    totalTurns: stats.totalTurns | 0,
    boredomLevel:
      gm.boredom && typeof gm.boredom.level === "number" && Number.isFinite(gm.boredom.level)
        ? localClamp(gm.boredom.level, 0, 1)
        : 0,
    topModes: [],
    topFamilies: [],
  };

  const mt = stats.modeTurns && typeof stats.modeTurns === "object" ? stats.modeTurns : {};
  const topModes = [];
  for (const key in mt) {
    if (!Object.prototype.hasOwnProperty.call(mt, key)) continue;
    topModes.push({ mode: key, turns: mt[key] | 0 });
  }
  topModes.sort((a, b) => {
    if ((b.turns | 0) !== (a.turns | 0)) return (b.turns | 0) - (a.turns | 0);
    if (a.mode < b.mode) return -1;
    if (a.mode > b.mode) return 1;
    return 0;
  });
  profile.topModes = topModes;

  const families = gm.families && typeof gm.families === "object" ? gm.families : {};
  const topFamilies = [];
  for (const key in families) {
    if (!Object.prototype.hasOwnProperty.call(families, key)) continue;
    const f = families[key];
    if (!f || typeof f !== "object") continue;
    const seen = f.seen | 0;
    if (seen <= 0) continue;
    topFamilies.push({ key, seen });
  }
  topFamilies.sort((a, b) => {
    if ((b.seen | 0) !== (a.seen | 0)) return (b.seen | 0) - (a.seen | 0);
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    return 0;
  });
  profile.topFamilies = topFamilies;

  return profile;
}
