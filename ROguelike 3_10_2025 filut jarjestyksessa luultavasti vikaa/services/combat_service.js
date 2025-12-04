/**
 * CombatService: data-driven combat balance helpers.
 *
 * Exports (ESM + window.CombatRules):
 * - enemyDamageMultiplier(level): number
 *
 * Notes:
 * - Reads GameData.combat (data/balance/combat.json) when available.
 * - Falls back to the previous hardcoded curve when JSON is missing/invalid.
 */

import { getGameData } from "../utils/access.js";
import { attachGlobal } from "../utils/global.js";

function getCombatConfig() {
  const GD = getGameData(null);
  if (!GD || !GD.combat || typeof GD.combat !== "object") return null;
  return GD.combat;
}

export function enemyDamageMultiplier(level) {
  const n = Number(level);
  const lvl = Number.isFinite(n) ? (n | 0) : 1;
  const L = Math.max(1, lvl);

  try {
    const root = getCombatConfig();
    const cfg = root && root.enemyDamageMultiplier;
    if (cfg && typeof cfg === "object") {
      const base = typeof cfg.base === "number" ? cfg.base : 1.0;
      const per = typeof cfg.perLevel === "number" ? cfg.perLevel : 0.15;
      let v = base + per * Math.max(0, L - 1);

      if (typeof cfg.max === "number" && Number.isFinite(cfg.max)) {
        v = Math.min(cfg.max, v);
      }
      if (typeof cfg.min === "number" && Number.isFinite(cfg.min)) {
        v = Math.max(cfg.min, v);
      }
      if (!(v > 0)) v = 0.1;
      return v;
    }
  } catch (_) {
    // fall through to default behaviour
  }

  // Default curve (previous behaviour): 1 + 0.15 * max(0, level - 1)
  return 1 + 0.15 * Math.max(0, L - 1);
}

// Back-compat: attach rules to window for ctx/getMod consumers
attachGlobal("CombatRules", { enemyDamageMultiplier });