/**
 * FollowersItems: helper functions to move items between the player and a follower.
 *
 * Exports (ESM + window.FollowersItems):
 * - giveItemToFollower(ctx, followerId, playerIndex, opts?)
 * - takeInventoryItemFromFollower(ctx, followerId, followerIndex, opts?)
 * - equipFollowerItemFromInventory(ctx, followerId, followerIndex, slot, opts?)
 * - unequipFollowerSlot(ctx, followerId, slot, opts?)
 *
 * Notes:
 * - All functions are ctx-first and operate only on data (no rendering).
 * - Logging and UI updates are best-effort via ctx.log / ctx.updateUI.
 * - After each equipment change, follower runtime atk/def are recomputed so
 *   gear affects combat immediately (like player equipment).
 */

import { attachGlobal } from "../utils/global.js";
import { getFollowerDef } from "../entities/followers.js";
import { aggregateFollowerAtkDef } from "../entities/equip_common.js";
import { decayEquippedGeneric } from "../combat/equipment_decay.js";

function getFollowerRecord(ctx, followerId) {
  if (!ctx || !ctx.player || !Array.isArray(ctx.player.followers)) return null;
  const id = String(followerId || "").trim();
  if (!id) return null;
  for (let i = 0; i < ctx.player.followers.length; i++) {
    const f = ctx.player.followers[i];
    if (!f) continue;
    if (String(f.id || "").trim() === id) return f;
  }
  return null;
}

function ensureFollowerEquipment(rec) {
  const base = { left: null, right: null, head: null, torso: null, legs: null, hands: null };
  if (!rec || typeof rec !== "object") return base;
  const src = rec.equipment && typeof rec.equipment === "object" ? rec.equipment : {};
  const eq = {
    left: src.left || null,
    right: src.right || null,
    head: src.head || null,
    torso: src.torso || null,
    legs: src.legs || null,
    hands: src.hands || null,
  };
  try { rec.equipment = eq; } catch (_) {}
  return eq;
}

function ensureFollowerInventory(rec) {
  if (!rec || typeof rec !== "object") return [];
  if (!Array.isArray(rec.inventory)) {
    try { rec.inventory = []; } catch (_) {}
    return rec.inventory || [];
  }
  return rec.inventory;
}

// Recompute follower runtime atk/def based on their equipment so changes in
// follower gear affect combat immediately, similar to player equipment.
function recomputeFollowerRuntimeStats(ctx, followerId) {
  if (!ctx) return;
  const rec = getFollowerRecord(ctx, followerId);
  if (!rec) return;

  let def = null;
  try {
    def = getFollowerDef(ctx, followerId) || null;
  } catch (_) {}
  if (!def) return;

  const agg = aggregateFollowerAtkDef(def, rec);
  const atk = typeof agg.atk === "number" ? agg.atk : (def.baseAtk || 0);
  const defense = typeof agg.def === "number" ? agg.def : (def.baseDef || 0);

  try {
    if (Array.isArray(ctx.enemies)) {
      for (let i = 0; i < ctx.enemies.length; i++) {
        const e = ctx.enemies[i];
        if (!e || !e._isFollower) continue;
        const fid = e._followerId != null ? String(e._followerId) : "";
        if (fid && fid === String(followerId)) {
          e.atk = atk;
          e.def = defense;
        }
      }
    }
  } catch (_) {}
}

// Choose the best replacement item from follower inventory for a given slot
// and equip it, then update runtime stats. This is used when an equipped item
// breaks due to decay.
function autoEquipBestFollowerItem(ctx, rec, followerId, slot) {
  if (!ctx || !rec) return;
  const inv = ensureFollowerInventory(rec);
  if (!inv.length) return;

  const targetSlot = (slot === "left" || slot === "right") ? "hand" : slot;

  let def = null;
  try {
    def = getFollowerDef(ctx, followerId) || null;
  } catch (_) {}
  // Scoring does not currently depend on def, but we may extend it later.
  let bestIdx = -1;
  let bestScore = -Infinity;

  for (let i = 0; i < inv.length; i++) {
    const it = inv[i];
    if (!it || it.kind !== "equip") continue;
    if (it.slot !== targetSlot) continue;
    const atk = typeof it.atk === "number" ? it.atk : 0;
    const defVal = typeof it.def === "number" ? it.def : 0;
    const score = atk + defVal;
    if (score > bestScore + 1e-9) {
      bestScore = score;
      bestIdx = i;
    }
  }

  if (bestIdx < 0) return;
  const item = inv[bestIdx];
  inv.splice(bestIdx, 1);

  const eq = ensureFollowerEquipment(rec);
  // Put any existing item from that slot back into inventory
  if (eq[slot]) {
    inv.push(eq[slot]);
  }
  eq[slot] = item;

  try {
    if (ctx.log) {
      const label = describeItem(ctx, item);
      const who = followerLabel(rec);
      ctx.log(`${who} automatically equips ${label} in ${slot}.`, "info");
    }
  } catch (_) {}

  try {
    recomputeFollowerRuntimeStats(ctx, followerId);
  } catch (_) {}
}

// Decay a specific equipped slot on a follower record and auto-equip a
// replacement when the item breaks.
export function decayFollowerEquipped(ctx, followerId, slot, amount) {
  if (!ctx || !slot || typeof amount !== "number") return;
  const rec = getFollowerRecord(ctx, followerId);
  if (!rec) return;
  const eq = ensureFollowerEquipment(rec);
  if (!eq[slot]) return;

  const hooks = {
    log: (msg, type) => {
      try {
        if (ctx.log) ctx.log(msg, type);
      } catch (_) {}
    },
    updateUI: () => {
      try {
        if (ctx.updateUI) ctx.updateUI();
      } catch (_) {}
    },
    onInventoryChange: () => {},
    onBreak: () => {
      autoEquipBestFollowerItem(ctx, rec, followerId, slot);
    },
  };

  try {
    decayEquippedGeneric(rec, slot, amount, hooks);
    recomputeFollowerRuntimeStats(ctx, followerId);
  } catch (_) {}
}

// Convenience helper: decay follower hands (weapon) after an attack or block.
// Picks the hand with higher atk (or first non-null) and applies a light or
// normal decay amount.
export function decayFollowerHands(ctx, followerId, opts = {}) {
  if (!ctx) return;
  const rec = getFollowerRecord(ctx, followerId);
  if (!rec) return;
  const eq = ensureFollowerEquipment(rec);

  const left = eq.left;
  const right = eq.right;
  const leftAtk = left && typeof left.atk === "number" ? left.atk : 0;
  const rightAtk = right && typeof right.atk === "number" ? right.atk : 0;

  let slot = null;
  if (leftAtk >= rightAtk && left) slot = "left";
  else if (right) slot = "right";
  if (!slot) return;

  const light = !!opts.light;
  const amount = light ? 0.6 : 1.4;

  decayFollowerEquipped(ctx, followerId, slot, amount);
}

function describeItem(ctx, it) {
  if (!it) return "item";
  try {
    const ID = (ctx && (ctx.ItemDescribe || (typeof window !== "undefined" ? window.ItemDescribe : null))) || null;
    if (ID && typeof ID.describe === "function") {
      const s = ID.describe(it);
      if (s) return String(s);
    }
  } catch (_) {}
  try {
    const Items = (ctx && ctx.Items) || (typeof window !== "undefined" ? window.Items : null);
    if (Items && typeof Items.describe === "function") {
      const s = Items.describe(it);
      if (s) return String(s);
    }
  } catch (_) {}
  if (typeof it.name === "string" && it.name) return it.name;
  if (typeof it.id === "string" && it.id) return it.id;
  if (typeof it.type === "string" && it.type) return it.type;
  return "item";
}

function followerLabel(rec) {
  if (!rec) return "your follower";
  if (typeof rec.name === "string" && rec.name.trim()) return rec.name.trim();
  return "your follower";
}

/**
 * Move an item from the player's inventory to the follower.
 *
 * @param {object} ctx         Game context (must include player + followers).
 * @param {string} followerId  Follower record id.
 * @param {number} playerIndex Index into ctx.player.inventory.
 * @param {object} opts        { slot?: "left"|"right"|"head"|"torso"|"legs"|"hands" }
 */
export function giveItemToFollower(ctx, followerId, playerIndex, opts = {}) {
  if (!ctx || !ctx.player || !Array.isArray(ctx.player.inventory)) return false;
  const inv = ctx.player.inventory;
  const idx = playerIndex | 0;
  if (idx < 0 || idx >= inv.length) return false;
  const item = inv[idx];
  if (!item) return false;

  const rec = getFollowerRecord(ctx, followerId);
  if (!rec) return false;

  const eq = ensureFollowerEquipment(rec);
  const finv = ensureFollowerInventory(rec);
  const slot = typeof opts.slot === "string" ? opts.slot : null;

  // Remove from player inventory
  inv.splice(idx, 1);

  if (slot && Object.prototype.hasOwnProperty.call(eq, slot)) {
    // Move any existing equipment in the slot into follower inventory first.
    if (eq[slot]) {
      finv.push(eq[slot]);
    }
    eq[slot] = item;
  } else {
    finv.push(item);
  }

  // Update follower combat stats immediately when gear changes
  try { recomputeFollowerRuntimeStats(ctx, followerId); } catch (_) {}

  // Best-effort log + UI refresh
  try {
    if (ctx.log) {
      const label = describeItem(ctx, item);
      const who = followerLabel(rec);
      ctx.log(`You give ${label} to ${who}.`, "info");
    }
  } catch (_) {}
  try { ctx.updateUI && ctx.updateUI(); } catch (_) {}

  return true;
}

/**
 * Move an item from follower inventory back to the player.
 *
 * @param {object} ctx
 * @param {string} followerId
 * @param {number} followerIndex Index into follower.inventory.
 */
export function takeInventoryItemFromFollower(ctx, followerId, followerIndex, opts = {}) {
  if (!ctx || !ctx.player || !Array.isArray(ctx.player.inventory)) return false;
  const rec = getFollowerRecord(ctx, followerId);
  if (!rec) return false;
  const finv = ensureFollowerInventory(rec);
  const idx = followerIndex | 0;
  if (idx < 0 || idx >= finv.length) return false;
  const item = finv[idx];
  if (!item) return false;

  finv.splice(idx, 1);
  ctx.player.inventory.push(item);

  try {
    if (ctx.log) {
      const label = describeItem(ctx, item);
      const who = followerLabel(rec);
      ctx.log(`You take ${label} from ${who}.`, "info");
    }
  } catch (_) {}
  try { ctx.updateUI && ctx.updateUI(); } catch (_) {}

  return true;
}

/**
 * Equip a follower item from their inventory into a specific equipment slot.
 * Replaced gear is moved into follower inventory.
 *
 * @param {object} ctx
 * @param {string} followerId
 * @param {number} followerIndex Index into follower.inventory.
 * @param {string} slot          Equipment slot key: left/right/head/torso/legs/hands.
 */
export function equipFollowerItemFromInventory(ctx, followerId, followerIndex, slot, opts = {}) {
  if (!ctx) return false;
  const rec = getFollowerRecord(ctx, followerId);
  if (!rec) return false;
  const finv = ensureFollowerInventory(rec);
  const eq = ensureFollowerEquipment(rec);
  if (!slot || !Object.prototype.hasOwnProperty.call(eq, slot)) return false;

  const idx = followerIndex | 0;
  if (idx < 0 || idx >= finv.length) return false;
  const item = finv[idx];
  if (!item) return false;

  // Remove from inventory
  finv.splice(idx, 1);

  // Move existing equipment to inventory, then equip new item
  if (eq[slot]) {
    finv.push(eq[slot]);
  }
  eq[slot] = item;

  // Update runtime stats so follower damage/defense reflect new gear
  try { recomputeFollowerRuntimeStats(ctx, followerId); } catch (_) {}

  try {
    if (ctx.log) {
      const label = describeItem(ctx, item);
      const who = followerLabel(rec);
      ctx.log(`${who} equips ${label} (${slot}).`, "info");
    }
  } catch (_) {}
  try { ctx.updateUI && ctx.updateUI(); } catch (_) {}

  return true;
}

/**
 * Unequip a follower slot and move the item into the follower's inventory.
 *
 * @param {object} ctx
 * @param {string} followerId
 * @param {string} slot
 */
export function unequipFollowerSlot(ctx, followerId, slot, opts = {}) {
  if (!ctx) return false;
  const rec = getFollowerRecord(ctx, followerId);
  if (!rec) return false;
  const eq = ensureFollowerEquipment(rec);
  const finv = ensureFollowerInventory(rec);
  if (!slot || !Object.prototype.hasOwnProperty.call(eq, slot)) return false;
  const item = eq[slot];
  if (!item) return false;

  eq[slot] = null;
  finv.push(item);

  // Update runtime stats so follower damage/defense reflect loss of gear
  try { recomputeFollowerRuntimeStats(ctx, followerId); } catch (_) {}

  try {
    if (ctx.log) {
      const label = describeItem(ctx, item);
      const who = followerLabel(rec);
      ctx.log(`You remove ${label} from ${who}.`, "info");
    }
  } catch (_) {}
  try { ctx.updateUI && ctx.updateUI(); } catch (_) {}

  return true;
}

// Back-compat: attach to window for GOD/debug use.
attachGlobal("FollowersItems", {
  giveItemToFollower,
  takeInventoryItemFromFollower,
  equipFollowerItemFromInventory,
  unequipFollowerSlot,
  decayFollowerEquipped,
  decayFollowerHands,
});