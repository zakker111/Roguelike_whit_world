/**
 * ItemBuffs: helpers for permanent equipment buffs/affixes.
 *
 * Currently implemented:
 * - Seen Life:
 *   - Weapons (hand slot): small permanent attack buff only.
 *   - Armor (head/torso/legs/hands, including shields): permanent defense buff only.
 *   Applied once per item after a usage threshold.
 *
 * Exports (ESM + window.ItemBuffs):
 * - SEEN_LIFE_HIT_THRESHOLD: number (testing threshold; can be raised later)
 * - hasSeenLife(item): boolean
 * - applySeenLife(item, { isWeapon, randFloat }): { applied, defBonus, atkBonus }
 * - trackHitAndMaybeApplySeenLife(ctx, item, { kind, randFloat }): boolean
 * - describeItemBuffs(item, { short }): string | string[]
 */

import { attachGlobal } from "../utils/global.js";

const SEEN_LIFE_ID = "seen_life";

// Testing threshold: apply Seen Life after the first qualifying hit.
// When ready for production, this can be raised (e.g., to 100).
export const SEEN_LIFE_HIT_THRESHOLD = 1;

// Armor slots that can receive Seen Life from being hit.
const ARMOR_SLOTS = new Set(["head", "torso", "legs", "hands"]);
const WEAPON_SLOT = "hand";

const round1 = (n) => Math.round(n * 10) / 10;

function pickInRange(randFloat, min, max, decimals = 1) {
  if (typeof randFloat === "function") {
    try {
      const v = randFloat(min, max, decimals);
      if (typeof v === "number" && Number.isFinite(v)) {
        return v;
      }
    } catch (_) {}
  }
  const mid = (min + max) / 2;
  const p = Math.pow(10, decimals);
  return Math.round(mid * p) / p;
}

/**
 * Check whether the item already has the Seen Life buff.
 */
export function hasSeenLife(item) {
  if (!item || !Array.isArray(item.buffs)) return false;
  return item.buffs.some((b) => b && b.id === SEEN_LIFE_ID);
}

/**
 * Apply the Seen Life buff to an item in-place.
 *
 * - Weapons (slot "hand"): gain a small permanent attack bonus only.
 * - Armor (head/torso/legs/hands, including shields): gain permanent defense only.
 *
 * randFloat(min,max,decimals) is preferred for determinism; when absent,
 * a deterministic midpoint is used instead of Math.random.
 */
export function applySeenLife(item, opts = {}) {
  if (!item || item.kind !== "equip") return { applied: false };
  const slot = String(item.slot || "").toLowerCase();
  const isWeaponSlot = slot === WEAPON_SLOT;
  const isArmorSlot = ARMOR_SLOTS.has(slot);
  if (!isWeaponSlot && !isArmorSlot) {
    return { applied: false };
  }
  if (hasSeenLife(item)) {
    return { applied: false };
  }

  const isWeapon = opts.isWeapon != null ? !!opts.isWeapon : isWeaponSlot;
  const randFloat = opts.randFloat;

  // Defense bonus only for armor slots (including shields in "hands").
  const defBonus = isArmorSlot ? pickInRange(randFloat, 0.3, 0.5, 1) : 0;
  // Small attack bonus only for weapons.
  const atkBonus = isWeapon ? pickInRange(randFloat, 0.1, 0.2, 1) : 0;

  const res = { applied: false, defBonus, atkBonus };

  if (defBonus > 0) {
    const baseDef = typeof item.def === "number" ? item.def : 0;
    item.def = round1(baseDef + defBonus);
  }

  if (atkBonus > 0) {
    const baseAtk = typeof item.atk === "number" ? item.atk : 0;
    item.atk = round1(baseAtk + atkBonus);
  }

  item.buffs = Array.isArray(item.buffs) ? item.buffs : [];
  item.buffs.push({
    id: SEEN_LIFE_ID,
    defBonus: defBonus || undefined,
    atkBonus: atkBonus || undefined,
  });

  res.applied = true;
  return res;
}

/**
 * Track a single hit for an item (weapon or armor) and apply Seen Life
 * when the usage threshold is reached.
 *
 * kind: "weapon" | "armor" (optional; inferred from slot when omitted)
 * randFloat: function(min,max,decimals) used for buff roll; optional.
 *
 * Returns true if the buff was applied on this call.
 */
export function trackHitAndMaybeApplySeenLife(ctx, item, opts = {}) {
  if (!item || item.kind !== "equip") return false;
  const slot = String(item.slot || "").toLowerCase();
  const isWeapon = opts.kind === "weapon" || slot === WEAPON_SLOT;
  const isArmor = opts.kind === "armor" || ARMOR_SLOTS.has(slot);
  if (!isWeapon && !isArmor) return false;

  const counterKey = isWeapon ? "hitsDealt" : "hitsTaken";
  const prev = typeof item[counterKey] === "number" ? item[counterKey] : 0;
  const next = prev + 1;
  item[counterKey] = next;

  if (item.seenLifeRollUsed) return false;
  if (next < SEEN_LIFE_HIT_THRESHOLD) return false;

  item.seenLifeRollUsed = true;
  if (hasSeenLife(item)) return false;

  const randFloat = typeof opts.randFloat === "function" ? opts.randFloat : null;
  const result = applySeenLife(item, { isWeapon, randFloat });
  if (!result || !result.applied) return false;

  // Player-facing log only: no structured details, just a simple info message.
  try {
    const LG = (ctx && ctx.Logger) || (typeof window !== "undefined" ? window.Logger : null);
    const baseName = item.name || (isWeapon ? "weapon" : "armor");
    const name = String(baseName);
    const msg = `Your ${name} has Seen Life and grows stronger.`;
    if (LG && typeof LG.log === "function") {
      LG.log(msg, "info");
    } else if (ctx && typeof ctx.log === "function") {
      ctx.log(msg, "info");
    }
  } catch (_) {}

  return true;
}

/**
 * Describe buffs on an item in a human-readable way.
 *
 * - short === true: returns a single string summary (e.g., "Seen Life (+0.4 def, +0.1 atk)").
 * - short === false: returns an array of lines (one per buff).
 */
export function describeItemBuffs(item, opts = {}) {
  const short = !!opts.short;
  const buffsArr = Array.isArray(item && item.buffs) ? item.buffs : [];
  if (!buffsArr.length) {
    return short ? "" : [];
  }
  const lines = [];
  for (let i = 0; i < buffsArr.length; i++) {
    const b = buffsArr[i];
    if (!b || !b.id) continue;
    if (b.id === SEEN_LIFE_ID) {
      const def = typeof b.defBonus === "number" ? b.defBonus : null;
      const atk = typeof b.atkBonus === "number" ? b.atkBonus : null;
      const parts = [];
      if (def != null) parts.push(`+${def.toFixed(1)} def`);
      if (atk != null) parts.push(`+${atk.toFixed(1)} atk`);
      const label = parts.length ? `Seen Life (${parts.join(", ")})` : "Seen Life";
      lines.push(label);
    } else {
      const label = b.label || b.name || b.id;
      lines.push(String(label));
    }
  }
  if (short) {
    return lines.join(", ");
  }
  return lines;
}

// Back-compat / diagnostics: attach to window
attachGlobal("ItemBuffs", {
  SEEN_LIFE_HIT_THRESHOLD,
  hasSeenLife,
  applySeenLife,
  trackHitAndMaybeApplySeenLife,
  describeItemBuffs,
});