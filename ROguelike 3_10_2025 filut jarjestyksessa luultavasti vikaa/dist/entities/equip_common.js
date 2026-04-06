/**
 * EquipCommon: shared helpers for equipment scoring, curses, and follower stats.
 *
 * Exports (ESM + window.EquipCommon):
 * - equipmentScoreBase(item)
 * - isCursedSeppoBlade(item)
 * - aggregateFollowerAtkDef(def, record)
 * - followerPreferredScore(item, followerDef, followerRecord)
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
  const seen = new Set();

  for (let i = 0; i < slots.length; i++) {
    const it = eq[slots[i]];
    if (!it) continue;
    if (seen.has(it)) continue;
    seen.add(it);
    if (typeof it.atk === "number") atk += it.atk;
    if (typeof it.def === "number") defense += it.def;
  }

  return { atk, def: defense };
}

/**
 * Preference-aware score for follower equipment auto-choices.
 * Applies a small multiplier to base score when item tags match follower
 * archetype preferences (def.pref.weaponTags / armorTags).
 */
export function followerPreferredScore(item, followerDef, followerRecord) {
  const base = equipmentScoreBase(item);
  if (!isFinite(base)) return base;

  const pref = followerDef && followerDef.pref;
  if (!pref) return base;

  const tagsArr = Array.isArray(item.tags) ? item.tags : [];
  const tags = new Set(tagsArr.map((t) => String(t).toLowerCase()));

  const wTags = Array.isArray(pref.weaponTags)
    ? pref.weaponTags.map((t) => String(t).toLowerCase())
    : [];
  const aTags = Array.isArray(pref.armorTags)
    ? pref.armorTags.map((t) => String(t).toLowerCase())
    : [];

  let mult = 1.0;

  if (item.slot === "hand" && wTags.length && tags.size) {
    const matched = wTags.some((t) => tags.has(t));
    if (matched) {
      const m = pref.buffs && typeof pref.buffs.matchedWeaponAtkMult === "number"
        ? pref.buffs.matchedWeaponAtkMult
        : 0.08;
      mult += m;
    }
  } else if (item.slot !== "hand" && aTags.length && tags.size) {
    const matched = aTags.some((t) => tags.has(t));
    if (matched) {
      const m = pref.buffs && typeof pref.buffs.matchedArmorDefMult === "number"
        ? pref.buffs.matchedArmorDefMult
        : 0.05;
      mult += m;
    }
  }

  return base * mult;
}

// Optional back-compat: attach to window for diagnostics / GOD panel use.
attachGlobal("EquipCommon", {
  equipmentScoreBase,
  isCursedSeppoBlade,
  aggregateFollowerAtkDef,
  followerPreferredScore,
});