/**
 * EquipCommon: shared helpers for equipment scoring, curses, and follower stats.
 *
 * Exports (ESM + window.EquipCommon):
 * - equipmentScoreBase(item)
 * - isCursedSeppoBlade(item)
 * - aggregateFollowerAtkDef(def, record)
 */

import { attachGlobal } from "../utils/global.js";

/**
 * Base equipment score used for generic comparisons.
 * Currently atk + def; can be extended later if we add more stats.
 */
export function equipmentScoreBase(item) {
  if (!item || typeof item !== "object") return -Infinity;
  if (item.kind !== "equip") return -Infinity;
  const atk = typeof item.atk === "number" ? item.atk : 0;
  const def = typeof item.def === "number" ? item.def : 0;
  return atk + def;
}

/**
 * Detect Seppo's True Blade (cursed, hands-locking weapon).
 * Shared between player and followers.
 */
export function isCursedSeppoBlade(item) {
  if (!item) return false;
  try {
    const id = String(item.id || "").toLowerCase();
    const name = String(item.name || "");
    if (id === "seppos_true_blade") return true;
    if (/seppo's true blade/i.test(name)) return true;
  } catch (_) {}
  return false;
}

/**
 * Aggregate follower Attack/Defense from base stats and equipped items.
 * This is the single source of truth for follower gear stat contribution.
 *
 * def: follower archetype definition from data/entities/followers.json
 * record: follower record from player.followers (with .equipment)
 */
export function aggregateFollowerAtkDef(def, record) {
  const baseAtk = (def && typeof def.baseAtk === "number") ? def.baseAtk : 0;
  const baseDef = (def && typeof def.baseDef === "number") ? def.baseDef : 0;

  const eq = record && record.equipment && typeof record.equipment === "object"
    ? record.equipment
    : {};

  let atk = baseAtk;
  let defense = baseDef;

  const slots = ["left", "right", "head", "torso", "legs", "hands"];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const it = eq[s];
    if (!it) continue;
    if (typeof it.atk === "number") atk += it.atk;
    if (typeof it.def === "number") defense += it.def;
  }

  return { atk, def: defense };
}

// Optional back-compat: attach to window for diagnostics / GOD panel use.
attachGlobal("EquipCommon", {
  equipmentScoreBase,
  isCursedSeppoBlade,
  aggregateFollowerAtkDef,
});