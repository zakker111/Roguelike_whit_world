/**
 * Bottle Map thread helpers (gm.threads.bottleMap) — fishing award + pity only.
 *
 * This module owns the deterministic decision and persistent bookkeeping for
 * awarding a "bottle map" item on successful fishing attempts.
 *
 * IMPORTANT:
 * - No inventory mutation here. Caller applies the returned item spec.
 * - Uses GM RNG stream (gmRngFloat), never ctx.rng.
 */

import { gmRngFloat } from "../rng.js";

function clamp01(x) {
  const v = typeof x === "number" && Number.isFinite(x) ? x : 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function bottleMapGetFishingConfig(ctx) {
  const DEFAULTS = { S0: 60, Smax: 180, boredomMin: 0.2, boredomMultMax: 3.0, cooldownTurns: 400 };
  try {
    const cfg = (typeof window !== "undefined" && window.GameData && window.GameData.config)
      ? window.GameData.config
      : null;

    const f = cfg && cfg.gm && cfg.gm.bottleMap && cfg.gm.bottleMap.fishing && typeof cfg.gm.bottleMap.fishing === "object"
      ? cfg.gm.bottleMap.fishing
      : null;

    let S0 = f && typeof f.S0 === "number" && Number.isFinite(f.S0) ? (f.S0 | 0) : DEFAULTS.S0;
    let Smax = f && typeof f.Smax === "number" && Number.isFinite(f.Smax) ? (f.Smax | 0) : DEFAULTS.Smax;
    let boredomMin = f && typeof f.boredomMin === "number" && Number.isFinite(f.boredomMin) ? f.boredomMin : DEFAULTS.boredomMin;
    let boredomMultMax = f && typeof f.boredomMultMax === "number" && Number.isFinite(f.boredomMultMax) ? f.boredomMultMax : DEFAULTS.boredomMultMax;
    let cooldownTurns = f && typeof f.cooldownTurns === "number" && Number.isFinite(f.cooldownTurns) ? (f.cooldownTurns | 0) : DEFAULTS.cooldownTurns;

    if (S0 < 0) S0 = 0;
    if (Smax < S0) Smax = S0;
    boredomMin = clamp01(boredomMin);
    if (boredomMultMax < 1) boredomMultMax = 1;
    if (cooldownTurns < 0) cooldownTurns = 0;

    return { S0, Smax, boredomMin, boredomMultMax, cooldownTurns };
  } catch (_) {
    return Object.assign({}, DEFAULTS);
  }
}

export function bottleMapHasBottleMapInInventory(ctx) {
  try {
    const inv = (ctx && ctx.player && Array.isArray(ctx.player.inventory)) ? ctx.player.inventory : [];
    return inv.some((it) => {
      if (!it) return false;
      // Match legacy behavior: only treat actual tools as Bottle Maps.
      const k = String(it.kind || "").toLowerCase();
      if (k !== "tool") return false;
      const id = String(it.type || it.id || it.key || it.name || "").toLowerCase();
      return id === "bottle_map" || id === "bottle map" || id.includes("bottle map") || id.includes("bottle_map");
    });
  } catch (_) {
    return false;
  }
}

export function bottleMapMakeItemSpec() {
  return { kind: "tool", type: "bottle_map", id: "bottle_map", name: "bottle map", decay: 0, usable: true };
}

/**
 * Compute and apply Bottle Map fishing award bookkeeping.
 *
 * @param {object} ctx
 * @param {object} gm
 * @param {object} thread gm.threads.bottleMap
 * @param {object} [opts]
 * @param {(gm:object)=>void} [opts.onDirty] passed into gmRngFloat to mark GM dirty when RNG advances
 * @returns {object} result
 */
export function bottleMapOnFishingSuccess(ctx, gm, thread, opts = {}) {
  const onDirty = opts && typeof opts.onDirty === "function" ? opts.onDirty : null;

  if (!ctx || !gm || !thread || typeof thread !== "object") return { awarded: false, changed: false };

  // Only one active Bottle Map thread at a time.
  if (thread.active === true) return { awarded: false, changed: false };

  // Do not award if the player already has one.
  if (bottleMapHasBottleMapInInventory(ctx)) return { awarded: false, changed: false };

  const cfg = bottleMapGetFishingConfig(ctx);

  const turn = (ctx && ctx.time && typeof ctx.time.turnCounter === "number" && Number.isFinite(ctx.time.turnCounter))
    ? (ctx.time.turnCounter | 0)
    : 0;

  // Ensure fishing state exists.
  const fishing = (thread.fishing && typeof thread.fishing === "object")
    ? thread.fishing
    : (thread.fishing = { eligibleSuccesses: 0, totalSuccesses: 0, lastAwardTurn: -9999, awardCount: 0 });

  // Cooldown after a map award.
  const lastAwardTurn = (typeof fishing.lastAwardTurn === "number" && Number.isFinite(fishing.lastAwardTurn))
    ? (fishing.lastAwardTurn | 0)
    : -9999;

  if ((turn - lastAwardTurn) < (cfg.cooldownTurns | 0)) {
    fishing.totalSuccesses = (fishing.totalSuccesses | 0) + 1;
    return { awarded: false, changed: true, successEventPayload: { awarded: false, reason: "cooldown" } };
  }

  // Update counters
  fishing.totalSuccesses = (fishing.totalSuccesses | 0) + 1;

  const boredom = clamp01(gm && gm.boredom && typeof gm.boredom.level === "number" ? gm.boredom.level : 0);
  const eligible = boredom >= cfg.boredomMin;
  if (eligible) fishing.eligibleSuccesses = (fishing.eligibleSuccesses | 0) + 1;

  const s = (fishing.eligibleSuccesses | 0);
  if (!eligible || s < (cfg.S0 | 0)) {
    return { awarded: false, changed: true, successEventPayload: { awarded: false, eligible, s } };
  }

  // Probability ramp: start very low at S0 and reach near-guaranteed by Smax.
  // Multiply by boredom factor (up to boredomMultMax at boredom=1).
  const denom = Math.max(1, (cfg.Smax | 0) - (cfg.S0 | 0));
  const t = Math.max(0, Math.min(1, (s - (cfg.S0 | 0)) / denom));

  const baseChance = 0.002; // 0.2% at ramp start
  const maxChance = 0.10;   // up to 10%
  let chance = baseChance + t * (maxChance - baseChance);

  const boredomMult = 1 + boredom * (cfg.boredomMultMax - 1);
  chance *= boredomMult;

  // Hard guarantee at Smax.
  const force = s >= (cfg.Smax | 0);
  const roll = gmRngFloat(gm, onDirty);
  const win = force || roll < chance;

  if (!win) {
    return { awarded: false, changed: true, successEventPayload: { awarded: false, eligible, s, chance, roll } };
  }

  // Award bookkeeping.
  fishing.lastAwardTurn = turn;
  fishing.awardCount = (fishing.awardCount | 0) + 1;
  fishing.eligibleSuccesses = 0;

  return {
    awarded: true,
    changed: true,
    turn,
    awardCount: fishing.awardCount | 0,
    item: bottleMapMakeItemSpec(),
  };
}
