/**
 * Inventory / equipment decay facade.
 *
 * Centralizes:
 * - initialDecay: starting wear for new equipment
 * - decayEquipped: decay and breakage handling for a single slot
 * - rerenderInventoryIfOpen: HUD-only inventory refresh
 * - usingTwoHanded: whether the player is currently wielding a two-handed weapon
 * - decayAttackHands / decayBlockingHands: wrappers around EquipmentDecay with safe fallbacks
 * - describeItem / equipIfBetter: thin ctx-first helpers around Player / Items
 *
 * All functions are ctx-first and avoid hard-coding window.* where possible.
 */

import { getMod, getRNGUtils, getUIOrchestration } from "../../utils/access.js";

function randFloat(ctx, min, max, decimals = 1) {
  // Prefer RNGUtils.float when available so decay uses shared RNG deterministically.
  try {
    const RU = getRNGUtils(ctx);
    if (RU && typeof RU.float === "function") {
      const rfn = (typeof ctx.rng === "function") ? ctx.rng : undefined;
      return RU.float(min, max, decimals, rfn);
    }
  } catch (_) {}
  if (typeof ctx.randFloat === "function") {
    try { return ctx.randFloat(min, max, decimals); } catch (_) {}
  }
  if (typeof ctx.rng === "function") {
    try {
      const r = ctx.rng();
      const v = min + r * (max - min);
      const p = Math.pow(10, decimals);
      return Math.round(v * p) / p;
    } catch (_) {}
  }
  // Deterministic midpoint when RNG is unavailable
  const v = (min + max) / 2;
  const p = Math.pow(10, decimals);
  return Math.round(v * p) / p;
}

function round1Local(ctx, n) {
  try {
    if (ctx.utils && typeof ctx.utils.round1 === "function") {
      return ctx.utils.round1(n);
    }
  } catch (_) {}
  return Math.round(n * 10) / 10;
}

function capitalizeName(name) {
  const s = name || "item";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// initialDecay: starting wear in percent for generated items.
// Prefer Items.initialDecay(tier, rng) when available for consistency with item generation.
// Fallback to simple tier-based ranges when Items is unavailable.
export function initialDecay(ctx, tier) {
  const ItemsMod = getMod(ctx, "Items");
  if (ItemsMod && typeof ItemsMod.initialDecay === "function") {
    try {
      const rng = (typeof ctx.rng === "function") ? ctx.rng : undefined;
      return ItemsMod.initialDecay(tier, rng);
    } catch (_) {}
  }

  if (tier <= 1) return randFloat(ctx, 10, 35, 0);
  if (tier === 2) return randFloat(ctx, 5, 20, 0);
  return randFloat(ctx, 0, 10, 0);
}

// HUD-only inventory refresh when the panel is open.
export function rerenderInventoryIfOpen(ctx) {
  const UIO = getUIOrchestration(ctx);
  let open = false;
  try {
    if (UIO && typeof UIO.isInventoryOpen === "function") {
      open = !!UIO.isInventoryOpen(ctx);
    }
  } catch (_) {}
  if (!open) return;

  try {
    if (UIO && typeof UIO.renderInventory === "function") {
      UIO.renderInventory(ctx);
      return;
    }
  } catch (_) {}

  // Fallback: use ctx.renderInventory if provided by orchestrator
  try {
    if (typeof ctx.renderInventory === "function") ctx.renderInventory();
  } catch (_) {}
}

// Core helper for decaying a specific equipped slot.
export function decayEquipped(ctx, slot, amount) {
  if (!ctx || !ctx.player || !ctx.player.equipment) return;
  const P = getMod(ctx, "Player");

  const hooks = {
    log: (msg, type) => {
      try {
        if (typeof ctx.log === "function") ctx.log(msg, type);
      } catch (_) {}
    },
    updateUI: () => {
      try {
        if (typeof ctx.updateUI === "function") ctx.updateUI();
      } catch (_) {}
    },
    onInventoryChange: () => rerenderInventoryIfOpen(ctx),
  };

  if (P && typeof P.decayEquipped === "function") {
    try {
      P.decayEquipped(ctx.player, slot, amount, hooks);
      return;
    } catch (_) {}
  }

  const it = ctx.player.equipment && ctx.player.equipment[slot];
  if (!it) return;
  const before = it.decay || 0;
  it.decay = Math.min(100, round1Local(ctx, before + amount));
  if (it.decay >= 100) {
    hooks.log(`${capitalizeName(it.name)} breaks and is destroyed.`, "info");
    // Optional flavor for breakage
    try {
      const F = getMod(ctx, "Flavor");
      if (F && typeof F.onBreak === "function") {
        F.onBreak(ctx, { side: "player", slot, item: it });
      }
    } catch (_) {}
    ctx.player.equipment[slot] = null;
    hooks.updateUI();
    hooks.onInventoryChange();
  } else if (Math.floor(before) !== Math.floor(it.decay)) {
    hooks.onInventoryChange();
  }
}

// Whether the player is currently wielding a two-handed weapon.
export function usingTwoHanded(ctx) {
  try {
    const eq = (ctx.player && ctx.player.equipment) ? ctx.player.equipment : null;
    return !!(eq && eq.left && eq.right && eq.left === eq.right && eq.left.twoHanded);
  } catch (_) {
    return false;
  }
}

// Hand decay helpers: attack-side decay.
export function decayAttackHands(ctx, light = false) {
  const ED = getMod(ctx, "EquipmentDecay");
  const twoHanded = usingTwoHanded(ctx);
  const hooks = {
    log: (msg, type) => {
      try {
        if (typeof ctx.log === "function") ctx.log(msg, type);
      } catch (_) {}
    },
    updateUI: () => {
      try {
        if (typeof ctx.updateUI === "function") ctx.updateUI();
      } catch (_) {}
    },
    onInventoryChange: () => rerenderInventoryIfOpen(ctx),
  };

  if (ED && typeof ED.decayAttackHands === "function") {
    try {
      const rng = (typeof ctx.rng === "function") ? ctx.rng : undefined;
      ED.decayAttackHands(ctx.player, rng, { twoHanded, light }, hooks);
      return;
    } catch (_) {}
  }

  // Fallback: decay the "hands" slot directly.
  const amt = light ? randFloat(ctx, 0.2, 0.7, 1) : randFloat(ctx, 0.3, 1.0, 1);
  decayEquipped(ctx, "hands", amt);
  hooks.log("Equipment decay system not available; applied fallback decay to hands.", "warn");
}

// Hand decay helpers: blocking-side decay.
export function decayBlockingHands(ctx) {
  const ED = getMod(ctx, "EquipmentDecay");
  const twoHanded = usingTwoHanded(ctx);
  const hooks = {
    log: (msg, type) => {
      try {
        if (typeof ctx.log === "function") ctx.log(msg, type);
      } catch (_) {}
    },
    updateUI: () => {
      try {
        if (typeof ctx.updateUI === "function") ctx.updateUI();
      } catch (_) {}
    },
    onInventoryChange: () => rerenderInventoryIfOpen(ctx),
  };

  if (ED && typeof ED.decayBlockingHands === "function") {
    try {
      const rng = (typeof ctx.rng === "function") ? ctx.rng : undefined;
      ED.decayBlockingHands(ctx.player, rng, { twoHanded }, hooks);
      return;
    } catch (_) {}
  }

  // Fallback: small direct decay on "hands" when blocking.
  const amt = randFloat(ctx, 0.2, 0.7, 1);
  decayEquipped(ctx, "hands", amt);
  hooks.log("Equipment decay system not available; applied fallback blocking decay to hands.", "warn");
}

// Single source of truth for item description: Player.describeItem, then Items.describe.
export function describeItem(ctx, item) {
  const P = getMod(ctx, "Player");
  if (P && typeof P.describeItem === "function") {
    try { return P.describeItem(item); } catch (_) {}
  }
  const ItemsMod = getMod(ctx, "Items");
  if (ItemsMod && typeof ItemsMod.describe === "function") {
    try { return ItemsMod.describe(item); } catch (_) {}
  }
  if (!item) return "";
  return item.name || "item";
}

// Equip item if it's strictly better than current gear; delegates to Player.equipIfBetter.
export function equipIfBetter(ctx, item) {
  const P = getMod(ctx, "Player");
  if (!P || typeof P.equipIfBetter !== "function") {
    throw new Error("Player.equipIfBetter missing; equip system cannot proceed");
  }
  const hooks = {
    log: (msg, type) => {
      try {
        if (typeof ctx.log === "function") ctx.log(msg, type);
      } catch (_) {}
    },
    updateUI: () => {
      try {
        if (typeof ctx.updateUI === "function") ctx.updateUI();
      } catch (_) {}
    },
    renderInventory: () => {
      try {
        if (typeof ctx.renderInventory === "function") ctx.renderInventory();
      } catch (_) {}
    },
    describeItem: (it) => describeItem(ctx, it),
  };
  return P.equipIfBetter(ctx.player, item, hooks);
}

// Optional back-compat: attach to window for diagnostics
if (typeof window !== "undefined") {
  window.InventoryDecayFacade = {
    initialDecay,
    rerenderInventoryIfOpen,
    decayEquipped,
    usingTwoHanded,
    decayAttackHands,
    decayBlockingHands,
    describeItem,
    equipIfBetter,
  };
}