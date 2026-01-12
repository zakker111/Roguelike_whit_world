/**
 * ItemBuffs: lightweight item enchantment hooks (e.g., Seen life).
 *
 * Exports (ESM + window.ItemBuffs):
 * - incrementSeenLifeUse(ctx, item, kind)
 * - incrementSeenLifeUseForArmorSlot(ctx, slot)
 *
 * Notes:
 * - kind is a hint for which stat to buff: "weapon" (attack) or "armor" (defense).
 * - Uses a per-item counter (_seenLifeUses) so buffs are tied to the specific piece of gear.
 * - Buff is permanent and applied directly to item.atk/item.def.
 */

import { attachGlobal } from "../utils/global.js";

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Shared RNG helper (mirrors status_effects.js pattern)
function getRng(ctx) {
  try {
    if (ctx && typeof ctx.rng === "function") return ctx.rng;
  } catch (_) {}
  try {
    if (typeof window !== "undefined" && window.RNG && typeof window.RNG.rng === "function") {
      if (typeof window.RNG.getSeed !== "function" || window.RNG.getSeed() == null) {
        if (typeof window.RNG.autoInit === "function") window.RNG.autoInit();
      }
      return window.RNG.rng;
    }
  } catch (_) {}
  return Math.random;
}

function randFloat(ctx, min, max, decimals = 1) {
  const rng = getRng(ctx);
  let r = 0.5;
  try {
    r = rng();
  } catch (_) {
    try { r = Math.random(); } catch (_) { r = 0.5; }
  }
  const v = min + r * (max - min);
  const p = Math.pow(10, decimals);
  return Math.round(v * p) / p;
}

function chance(ctx, p) {
  const rng = getRng(ctx);
  let r = 0.5;
  try {
    r = rng();
  } catch (_) {
    try { r = Math.random(); } catch (_) { r = 0.5; }
  }
  return r < p;
}

/**
 * Increment Seen life usage counter on an item and, once eligible,
 * apply a small permanent buff to atk/def.
 *
 * kind:
 * - "weapon" → prefer atk
 * - "armor"  → prefer def
 * - anything else → fall back to atk, then def
 */
export function incrementSeenLifeUse(ctx, item, kind) {
  if (!ctx || !item || item.kind !== "equip") return;

  try {
    const prev = (item._seenLifeUses | 0);
    item._seenLifeUses = prev + 1;
  } catch (_) {}

  const uses = typeof item._seenLifeUses === "number" ? item._seenLifeUses : 0;
  if (uses < 100) return;

  // Ensure buffs container
  let buffs = null;
  try {
    if (item.buffs && typeof item.buffs === "object") {
      buffs = item.buffs;
    } else {
      buffs = {};
      item.buffs = buffs;
    }
  } catch (_) {
    // If we cannot attach a buffs object, still allow stat buff but skip metadata.
  }

  if (buffs && buffs.seenLife) return;

  // One-time chance after the item has seen enough use
  if (!chance(ctx, 0.3)) return; // ~30% once eligible

  const amount = randFloat(ctx, 0.3, 0.5, 1);
  let appliedKind = null;

  if (kind === "weapon") {
    if (typeof item.atk === "number") {
      item.atk = round1(item.atk + amount);
      appliedKind = "attack";
    }
  } else if (kind === "armor") {
    if (typeof item.def === "number") {
      item.def = round1(item.def + amount);
      appliedKind = "defense";
    }
  }

  // Fallback: prefer atk, then def
  if (!appliedKind) {
    if (typeof item.atk === "number") {
      item.atk = round1(item.atk + amount);
      appliedKind = "attack";
    } else if (typeof item.def === "number") {
      item.def = round1(item.def + amount);
      appliedKind = "defense";
    }
  }

  if (!appliedKind) return;

  try {
    if (buffs) {
      buffs.seenLife = {
        amount,
        kind: appliedKind,
      };
    }
  } catch (_) {}

  // Log a small flavor line for the player
  try {
    if (ctx.log) {
      const label = item.name || "item";
      const statLabel = appliedKind === "attack" ? "attack" : "defense";
      ctx.log(
        `Seen life: ${label} is tempered by battle (+${amount.toFixed(1)} ${statLabel}).`,
        "good",
        { category: "Items" }
      );
    }
  } catch (_) {}
}

/**
 * Convenience helper for armor hits: increments Seen life usage for
 * the equipped item in the given armor slot (head/torso/legs/hands).
 */
export function incrementSeenLifeUseForArmorSlot(ctx, slot) {
  if (!ctx || !ctx.player || !ctx.player.equipment) return;
  if (!slot) return;
  try {
    const eq = ctx.player.equipment;
    const it = eq[slot];
    if (!it || it.kind !== "equip") return;
    incrementSeenLifeUse(ctx, it, "armor");
  } catch (_) {}
}

// Back-compat / diagnostics: attach to window
attachGlobal("ItemBuffs", {
  incrementSeenLifeUse,
  incrementSeenLifeUseForArmorSlot,
});