/**
 * InventoryActions: thin wrappers around InventoryController/Player APIs.
 *
 * Exports:
 * - addPotion(ctx, heal, name)
 * - drinkByIndex(ctx, idx)
 * - equipByIndex(ctx, idx)
 * - equipByIndexHand(ctx, idx, hand)
 * - unequipSlot(ctx, slot)
 */

export function addPotion(ctx, heal = 3, name = `potion (+${heal} HP)`) {
  const IC = ctx.InventoryController || (typeof window !== "undefined" ? window.InventoryController : null);
  if (IC && typeof IC.addPotion === "function") {
    return IC.addPotion(ctx, heal, name);
  }
  const P = ctx.Player || (typeof window !== "undefined" ? window.Player : null);
  if (P && typeof P.addPotion === "function") {
    P.addPotion(ctx.player, heal, name);
    return;
  }
  const inv = Array.isArray(ctx.player.inventory) ? ctx.player.inventory : (ctx.player.inventory = []);
  const existing = inv.find(i => i.kind === "potion" && (i.heal ?? 3) === heal);
  if (existing) {
    existing.count = (existing.count || 1) + 1;
  } else {
    inv.push({ kind: "potion", heal, count: 1, name });
  }
}

export function drinkByIndex(ctx, idx) {
  const IC = ctx.InventoryController || (typeof window !== "undefined" ? window.InventoryController : null);
  if (IC && typeof IC.drinkByIndex === "function") {
    return IC.drinkByIndex(ctx, idx);
  }
  const P = ctx.Player || (typeof window !== "undefined" ? window.Player : null);
  if (P && typeof P.drinkPotionByIndex === "function") {
    P.drinkPotionByIndex(ctx.player, idx, {
      log: ctx.log,
      updateUI: ctx.updateUI,
      renderInventory: () => ctx.renderInventory(),
    });
    return;
  }
  const inv = Array.isArray(ctx.player.inventory) ? ctx.player.inventory : [];
  if (!inv.length || idx < 0 || idx >= inv.length) return;
  const it = inv[idx];
  if (!it || it.kind !== "potion") return;

  const heal = it.heal ?? 3;
  const prev = ctx.player.hp;
  ctx.player.hp = Math.min(ctx.player.maxHp, ctx.player.hp + heal);
  const gained = ctx.player.hp - prev;
  if (gained > 0) {
    ctx.log(`You drink a potion and restore ${gained.toFixed(1)} HP (HP ${ctx.player.hp.toFixed(1)}/${ctx.player.maxHp.toFixed(1)}).`, "good");
  } else {
    ctx.log(`You drink a potion but feel no different (HP ${ctx.player.hp.toFixed(1)}/${ctx.player.maxHp.toFixed(1)}).`, "warn");
  }
  if (it.count && it.count > 1) {
    it.count -= 1;
  } else {
    inv.splice(idx, 1);
  }
  ctx.updateUI();
  ctx.renderInventory();
}

export function equipByIndex(ctx, idx) {
  const IC = ctx.InventoryController || (typeof window !== "undefined" ? window.InventoryController : null);
  if (IC && typeof IC.equipByIndex === "function") {
    IC.equipByIndex(ctx, idx);
    return;
  }
  const P = ctx.Player || (typeof window !== "undefined" ? window.Player : null);
  if (P && typeof P.equipItemByIndex === "function") {
    P.equipItemByIndex(ctx.player, idx, {
      log: ctx.log,
      updateUI: ctx.updateUI,
      renderInventory: () => ctx.renderInventory(),
      describeItem: (it) => ctx.describeItem(it),
    });
    return;
  }
  ctx.log("Equip system not available.", "warn");
}

export function equipByIndexHand(ctx, idx, hand) {
  const IC = ctx.InventoryController || (typeof window !== "undefined" ? window.InventoryController : null);
  if (IC && typeof IC.equipByIndexHand === "function") {
    IC.equipByIndexHand(ctx, idx, hand);
    return;
  }
  const P = ctx.Player || (typeof window !== "undefined" ? window.Player : null);
  if (P && typeof P.equipItemByIndex === "function") {
    P.equipItemByIndex(ctx.player, idx, {
      log: ctx.log,
      updateUI: ctx.updateUI,
      renderInventory: () => ctx.renderInventory(),
      describeItem: (it) => ctx.describeItem(it),
      preferredHand: hand,
    });
    return;
  }
  ctx.log("Equip system not available.", "warn");
}

export function unequipSlot(ctx, slot) {
  const IC = ctx.InventoryController || (typeof window !== "undefined" ? window.InventoryController : null);
  if (IC && typeof IC.unequipSlot === "function") {
    IC.unequipSlot(ctx, slot);
    return;
  }
  const P = ctx.Player || (typeof window !== "undefined" ? window.Player : null);
  if (P && typeof P.unequipSlot === "function") {
    P.unequipSlot(ctx.player, slot, {
      log: ctx.log,
      updateUI: ctx.updateUI,
      renderInventory: () => ctx.renderInventory(),
    });
    return;
  }
  ctx.log("Equip system not available.", "warn");
}