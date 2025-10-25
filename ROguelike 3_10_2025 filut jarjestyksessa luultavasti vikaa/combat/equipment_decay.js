/**
 * EquipmentDecayService: centralized equipment wear/decay functions.
 *
 * Exports (ESM + window.EquipmentDecay):
 * - initialDecay(tier, rng?)
 * - decayEquipped(player, slot, amount, hooks?)
 * - decayAttackHands(player, rng, opts?, hooks?)  // opts: { twoHanded?: boolean, light?: boolean }
 * - decayBlockingHands(player, rng, opts?, hooks?)
 */

import { attachGlobal } from "../utils/global.js";

function round1(n) { return Math.round(n * 10) / 10; }

export function initialDecay(tier, rng) {
  try {
    if (typeof window !== "undefined" && window.Items && typeof window.Items.initialDecay === "function") {
      return window.Items.initialDecay(tier, rng);
    }
  } catch (_) {}
  // RNGUtils mandatory
  let r = null;
  try {
    r = (typeof rng === "function") ? rng
      : (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function")
        ? window.RNGUtils.getRng()
        : null;
  } catch (_) { r = (typeof rng === "function") ? rng : null; }
  const float = (min, max, decimals = 0) => {
    try {
      if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.float === "function") {
        return window.RNGUtils.float(min, max, decimals, r);
      }
    } catch (_) {}
    // Deterministic midpoint when RNG unavailable
    const v = (min + max) / 2;
    const p = Math.pow(10, decimals);
    return Math.round(v * p) / p;
  };
  if (tier <= 1) return float(10, 35, 0);
  if (tier === 2) return float(5, 20, 0);
  return float(0, 10, 0);
}

export function decayEquipped(player, slot, amount, hooks) {
  hooks = hooks || {};
  const log = hooks.log || (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function" ? window.Logger.log : (() => {}));
  const updateUI = hooks.updateUI || (() => {});
  const onInventoryChange = hooks.onInventoryChange || (() => {});
  const Flavor = (typeof window !== "undefined") ? window.Flavor : null;

  try {
    if (typeof window !== "undefined" && window.Player && typeof window.Player.decayEquipped === "function") {
      window.Player.decayEquipped(player, slot, amount, { log, updateUI, onInventoryChange });
      return;
    }
  } catch (_) {}

  const it = player.equipment?.[slot];
  if (!it) return;

  const before = it.decay || 0;
  it.decay = Math.min(100, round1(before + amount));
  if (it.decay >= 100) {
    log(`${(it.name || "item")[0].toUpperCase()}${(it.name || "item").slice(1)} breaks and is destroyed.`, "bad");
    try {
      if (Flavor && typeof Flavor.onBreak === "function") {
        Flavor.onBreak({ player }, { side: "player", slot, item: it });
      }
    } catch (_) {}
    player.equipment[slot] = null;
    updateUI();
    onInventoryChange();
  } else if (Math.floor(before) !== Math.floor(it.decay)) {
    onInventoryChange();
  }
}

export function decayAttackHands(player, rng, opts, hooks) {
  opts = opts || {};
  hooks = hooks || {};
  const twoHanded = !!opts.twoHanded;
  const light = !!opts.light;

  const eq = player.equipment || {};
  const rfn = (typeof rng === "function")
    ? rng
    : ((typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function")
        ? window.RNGUtils.getRng()
        : null);
  const float = (min, max) => {
    try {
      if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.float === "function") {
        return window.RNGUtils.float(min, max, 1, rfn);
      }
    } catch (_) {}
    // Deterministic midpoint when RNG unavailable
    const v = (min + max) / 2;
    return Math.round(v * 10) / 10;
  };
  const amtMain = light ? float(0.6, 1.6) : float(1.0, 2.2);

  if (twoHanded) {
    if (eq.left) decayEquipped(player, "left", amtMain, hooks);
    if (eq.right) decayEquipped(player, "right", amtMain, hooks);
    return;
  }
  const leftAtk = (eq.left && typeof eq.left.atk === "number") ? eq.left.atk : 0;
  const rightAtk = (eq.right && typeof eq.right.atk === "number") ? eq.right.atk : 0;
  if (leftAtk >= rightAtk && leftAtk > 0) {
    decayEquipped(player, "left", amtMain, hooks);
  } else if (rightAtk > 0) {
    decayEquipped(player, "right", amtMain, hooks);
  } else if (eq.left) {
    decayEquipped(player, "left", amtMain, hooks);
  } else if (eq.right) {
    decayEquipped(player, "right", amtMain, hooks);
  }
}

export function decayBlockingHands(player, rng, opts, hooks) {
  opts = opts || {};
  hooks = hooks || {};
  const twoHanded = !!opts.twoHanded;

  const eq = player.equipment || {};
  const rfn = (typeof rng === "function")
    ? rng
    : ((typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function")
        ? window.RNGUtils.getRng()
        : null);
  const float = (min, max) => {
    try {
      if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.float === "function") {
        return window.RNGUtils.float(min, max, 1, rfn);
      }
    } catch (_) {}
    // Deterministic midpoint when RNG unavailable
    const v = (min + max) / 2;
    return Math.round(v * 10) / 10;
  };
  const amt = float(0.6, 1.6);

  if (twoHanded) {
    if (eq.left) decayEquipped(player, "left", amt, hooks);
    if (eq.right) decayEquipped(player, "right", amt, hooks);
    return;
  }
  const leftDef = (eq.left && typeof eq.left.def === "number") ? eq.left.def : 0;
  const rightDef = (eq.right && typeof eq.right.def === "number") ? eq.right.def : 0;
  if (rightDef >= leftDef && eq.right) {
    decayEquipped(player, "right", amt, hooks);
  } else if (eq.left) {
    decayEquipped(player, "left", amt, hooks);
  }
}

// Back-compat: attach to window via helper
attachGlobal("EquipmentDecay", {
  initialDecay,
  decayEquipped,
  decayAttackHands,
  decayBlockingHands,
});