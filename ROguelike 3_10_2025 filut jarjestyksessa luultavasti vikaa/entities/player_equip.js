/**
 * PlayerEquip: equipment handling split from Player.
 *
 * Exports (ESM + window.PlayerEquip):
 * - equipIfBetter(player, item, hooks?)
 * - equipItemByIndex(player, idx, hooks?)
 * - unequipSlot(player, slot, hooks?)
 *
 * Notes:
 * - Hooks: { log, updateUI, renderInventory, preferredHand, describeItem }
 * - UI-agnostic: only uses hooks for side effects.
 */

const round1 = (typeof window !== "undefined" && window.PlayerUtils && typeof window.PlayerUtils.round1 === "function")
  ? window.PlayerUtils.round1
  : (n) => Math.round(n * 10) / 10;

function defaultDescribe(item) {
  try {
    if (typeof window !== "undefined" && window.ItemDescribe && typeof window.ItemDescribe.describe === "function") {
      return window.ItemDescribe.describe(item);
    }
  } catch (_) {}
  if (!item) return "";
  if (item.kind === "equip") {
    const parts = [];
    if ("atk" in item) parts.push(`+${Number(item.atk).toFixed(1)} atk`);
    if ("def" in item) parts.push(`+${Number(item.def).toFixed(1)} def`);
    return `${item.name}${parts.length ? " (" + parts.join(", ") + ")" : ""}`;
  }
  if (item.kind === "potion") {
    const heal = item.heal ?? 3;
    const base = item.name || `potion (+${heal} HP)`;
    const count = item.count && item.count > 1 ? ` x${item.count}` : "";
    return `${base}${count}`;
  }
  return item.name || "item";
}

export function equipIfBetter(player, item, hooks = {}) {
  if (!item || item.kind !== "equip") return false;

  const describe = hooks.describeItem || (typeof window !== "undefined" && window.Player && typeof window.Player.describeItem === "function" ? window.Player.describeItem : null) || defaultDescribe;

  // Two-handed constraint
  const twoH = !!item.twoHanded;

  // Hand items: normalized to slot === "hand"
  const isHandItem = item.slot === "hand";

  if (isHandItem) {
    const eq = player.equipment;
    const holdingTwoH = !!(eq.left && eq.right && eq.left === eq.right && eq.left.twoHanded);

    const score = (it) => (it ? (it.atk || 0) + (it.def || 0) : 0);

    if (twoH) {
      // Compare against the combined score of current two hands; only auto-equip if strictly better
      const newScore = score(item);
      const curSum = score(eq.left) + score(eq.right);
      if (!(newScore > curSum + 1e-9)) {
        return false;
      }
      const prevL = eq.left, prevR = eq.right;
      eq.left = item; eq.right = item;
      if (hooks.log) {
        const parts = [];
        if ("atk" in item) parts.push(`+${Number(item.atk).toFixed(1)} atk`);
        if ("def" in item) parts.push(`+${Number(item.def).toFixed(1)} def`);
        const statStr = parts.join(", ");
        hooks.log(`You equip ${item.name} (two-handed${statStr ? ", " + statStr : ""}).`);
      }
      if (prevL && prevL !== item) player.inventory.push(prevL);
      if (prevR && prevR !== item) player.inventory.push(prevR);
      if (hooks.updateUI) hooks.updateUI();
      if (hooks.renderInventory) hooks.renderInventory();
      return true;
    }

    if (!eq.left && !eq.right) {
      eq.left = item;
    } else if (!eq.left) {
      if (holdingTwoH) {
        player.inventory.push(eq.left);
        eq.right = null;
        eq.left = item;
      } else {
        eq.left = item;
      }
    } else if (!eq.right) {
      if (holdingTwoH) {
        player.inventory.push(eq.right);
        eq.left = item;
        eq.right = null;
      } else {
        eq.right = item;
      }
    } else {
      const worse = score(eq.left) <= score(eq.right) ? "left" : "right";
      player.inventory.push(eq[worse]);
      eq[worse] = item;
    }

    if (hooks.log) {
      const parts = [];
      if ("atk" in item) parts.push(`+${Number(item.atk).toFixed(1)} atk`);
      if ("def" in item) parts.push(`+${Number(item.def).toFixed(1)} def`);
      const statStr = parts.join(", ");
      hooks.log(`You equip ${item.name} (${statStr || "hand item"}).`);
    }
    if (hooks.updateUI) hooks.updateUI();
    if (hooks.renderInventory) hooks.renderInventory();
    return true;
  }

  // Non-hand items
  const slot = item.slot;
  const current = player.equipment[slot];
  const newScore = (item.atk || 0) + (item.def || 0);
  const curScore = current ? ((current.atk || 0) + (current.def || 0)) : -Infinity;
  const better = !current || newScore > curScore + 1e-9;

  if (better) {
    player.equipment[slot] = item;
    if (hooks.log) {
      const parts = [];
      if ("atk" in item) parts.push(`+${Number(item.atk).toFixed(1)} atk`);
      if ("def" in item) parts.push(`+${Number(item.def).toFixed(1)} def`);
      const statStr = parts.join(", ");
      hooks.log(`You equip ${item.name} (${slot}${statStr ? ", " + statStr : ""}).`);
    }
    if (hooks.updateUI) hooks.updateUI();
    if (hooks.renderInventory) hooks.renderInventory();
    return true;
  }
  return false;
}

export function equipItemByIndex(player, idx, hooks = {}) {
  if (!player.inventory || idx < 0 || idx >= player.inventory.length) return;
  const item = player.inventory[idx];
  if (!item || item.kind !== "equip") {
    if (hooks.log) hooks.log("That item cannot be equipped.");
    return;
  }
  // remove from inventory first
  player.inventory.splice(idx, 1);

  const eq = player.equipment;
  const twoH = !!item.twoHanded;
  const preferredHand = hooks.preferredHand === "left" || hooks.preferredHand === "right" ? hooks.preferredHand : null;

  if (item.slot === "hand") {
    if (twoH) {
      const prevL = eq.left, prevR = eq.right;
      eq.left = item; eq.right = item;
      if (hooks.log) {
        const parts = [];
        if ("atk" in item) parts.push(`+${Number(item.atk).toFixed(1)} atk`);
        if ("def" in item) parts.push(`+${Number(item.def).toFixed(1)} def`);
        const statStr = parts.join(", ");
        hooks.log(`You equip ${item.name} (two-handed${statStr ? ", " + statStr : ""}).`);
      }
      if (prevL && prevL !== item) player.inventory.push(prevL);
      if (prevR && prevR !== item) player.inventory.push(prevR);
    } else if (preferredHand) {
      const other = preferredHand === "left" ? "right" : "left";
      const wasTwoHanded = !!(eq.left && eq.right && eq.left === eq.right && eq.left.twoHanded);
      const prev = eq[preferredHand];

      eq[preferredHand] = item;

      if (hooks.log) {
        const parts = [];
        if ("atk" in item) parts.push(`+${Number(item.atk).toFixed(1)} atk`);
        if ("def" in item) parts.push(`+${Number(item.def).toFixed(1)} def`);
        const statStr = parts.join(", ");
        hooks.log(`You equip ${item.name} (${preferredHand}${statStr ? ", " + statStr : ""}).`);
      }

      if (prev) player.inventory.push(prev);

      if (wasTwoHanded) {
        if (eq[other]) player.inventory.push(eq[other]);
        eq[other] = null;
      }
    } else {
      // no preference -> use auto/better logic
      equipIfBetter(player, item, hooks);
    }
  } else {
    // Non-hand items -> simple replacement
    const slot = item.slot;
    const prev = eq[slot];
    eq[slot] = item;
    if (hooks.log) {
      const parts = [];
      if ("atk" in item) parts.push(`+${Number(item.atk).toFixed(1)} atk`);
      if ("def" in item) parts.push(`+${Number(item.def).toFixed(1)} def`);
      const statStr = parts.join(", ");
      hooks.log(`You equip ${item.name} (${slot}${statStr ? ", " + statStr : ""}).`);
    }
    if (prev) player.inventory.push(prev);
  }

  if (hooks.updateUI) hooks.updateUI();
  if (hooks.renderInventory) hooks.renderInventory();
}

export function unequipSlot(player, slot, hooks = {}) {
  if (!player || !player.equipment) return;
  const eq = player.equipment;
  const valid = ["left","right","head","torso","legs","hands"];
  if (!valid.includes(slot)) return;

  const describe = hooks.describeItem || (typeof window !== "undefined" && window.Player && typeof window.Player.describeItem === "function" ? window.Player.describeItem : null) || defaultDescribe;

  // Handle two-handed case if unequipping either hand and both reference same item
  if ((slot === "left" || slot === "right") && eq.left && eq.right && eq.left === eq.right && eq.left.twoHanded) {
    const item = eq.left;
    eq.left = null; eq.right = null;
    player.inventory.push(item);
    if (hooks.log) hooks.log(`You unequip ${describe(item)} (two-handed).`);
    if (hooks.updateUI) hooks.updateUI();
    if (hooks.renderInventory) hooks.renderInventory();
    return;
  }

  const it = eq[slot];
  if (!it) return;
  eq[slot] = null;
  player.inventory.push(it);
  if (hooks.log) hooks.log(`You unequip ${describe(it)} from ${slot}.`);
  if (hooks.updateUI) hooks.updateUI();
  if (hooks.renderInventory) hooks.renderInventory();
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.PlayerEquip = {
    equipIfBetter,
    equipItemByIndex,
    unequipSlot,
  };
}