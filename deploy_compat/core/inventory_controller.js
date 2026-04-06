/**
 * InventoryController: UI and inventory glue centralized away from core/game.js.
 *
 * Exports (ESM + window.InventoryController):
 * - addPotion(ctx, heal, name)
 * - drinkByIndex(ctx, idx, hooks?)
 * - equipByIndex(ctx, idx, hooks?)
 * - equipByIndexHand(ctx, idx, hand, hooks?)
 * - unequipSlot(ctx, slot, hooks?)
 * - render(ctx)
 * - show(ctx)
 * - hide(ctx)
 */

export function render(ctx) {
  try {
    if (ctx.UI && typeof ctx.UI.renderInventory === "function") {
      // Only render when the panel is open to avoid unnecessary DOM work
      const open = (typeof ctx.UI.isInventoryOpen === "function") ? ctx.UI.isInventoryOpen() : true;
      if (open) {
        ctx.UI.renderInventory(ctx.player, ctx.describeItem);
      }
    }
  } catch (_) {}
}

export function show(ctx) {
  try {
    // Open panel first so render() can populate content when checking open-state
    if (ctx.UI && typeof ctx.UI.showInventory === "function") {
      ctx.UI.showInventory();
    } else {
      const panel = document.getElementById("inv-panel");
      if (panel) panel.hidden = false;
    }
    render(ctx);
  } catch (_) {}
}

export function hide(ctx) {
  try {
    if (ctx.UI && typeof ctx.UI.hideInventory === "function") {
      ctx.UI.hideInventory();
    } else {
      const panel = document.getElementById("inv-panel");
      if (panel) panel.hidden = true;
    }
  } catch (_) {}
}

export function addPotion(ctx, heal = 3, name = `potion (+${heal} HP)`) {
  const P = (ctx && ctx.Player) || (typeof window !== "undefined" ? window.Player : null);
  if (P && typeof P.addPotion === "function") {
    P.addPotion(ctx.player, heal, name);
    return;
  }
  const inv = ctx.player.inventory || (ctx.player.inventory = []);
  const existing = inv.find(i => i.kind === "potion" && (i.heal ?? 3) === heal);
  if (existing) {
    existing.count = (existing.count || 1) + 1;
  } else {
    inv.push({ kind: "potion", heal, count: 1, name });
  }
}

export function drinkByIndex(ctx, idx, hooks) {
  const P = (ctx && ctx.Player) || (typeof window !== "undefined" ? window.Player : null);
  if (P && typeof P.drinkPotionByIndex === "function") {
    P.drinkPotionByIndex(ctx.player, idx, {
      log: ctx.log,
      updateUI: ctx.updateUI,
      renderInventory: () => render(ctx),
      ...(hooks || {})
    });
    return;
  }
  const inv = ctx.player.inventory || [];
  if (!inv || idx < 0 || idx >= inv.length) return;
  const it = inv[idx];
  if (!it || (it.kind !== "potion" && it.kind !== "drink")) return;

  const heal = it.heal ?? (it.kind === "drink" ? 2 : 3);
  const prev = ctx.player.hp;
  ctx.player.hp = Math.min(ctx.player.maxHp, ctx.player.hp + heal);
  const gained = ctx.player.hp - prev;
  const label = it.name ? it.name : (it.kind === "drink" ? "drink" : "potion");
  if (gained > 0) ctx.log(`You drink ${label} and restore ${gained.toFixed(1)} HP (HP ${ctx.player.hp.toFixed(1)}/${ctx.player.maxHp.toFixed(1)}).`, "good");
  else ctx.log(`You drink ${label} but feel no different (HP ${ctx.player.hp.toFixed(1)}/${ctx.player.maxHp.toFixed(1)}).`, "warn");

  if (it.count && it.count > 1) it.count -= 1;
  else inv.splice(idx, 1);

  ctx.updateUI();
  render(ctx);
}

export function equipByIndex(ctx, idx, hooks) {
  const P = (ctx && ctx.Player) || (typeof window !== "undefined" ? window.Player : null);
  if (!P || typeof P.equipItemByIndex !== "function") {
    throw new Error("Player.equipItemByIndex missing; equip system cannot proceed");
  }
  P.equipItemByIndex(ctx.player, idx, {
    log: ctx.log,
    updateUI: ctx.updateUI,
    renderInventory: () => render(ctx),
    describeItem: (it) => ctx.describeItem(it),
    ...(hooks || {})
  });
}

export function equipByIndexHand(ctx, idx, hand, hooks) {
  const P = (ctx && ctx.Player) || (typeof window !== "undefined" ? window.Player : null);
  if (!P || typeof P.equipItemByIndex !== "function") {
    throw new Error("Player.equipItemByIndex missing; equip system cannot proceed");
  }
  P.equipItemByIndex(ctx.player, idx, {
    log: ctx.log,
    updateUI: ctx.updateUI,
    renderInventory: () => render(ctx),
    describeItem: (it) => ctx.describeItem(it),
    preferredHand: hand,
    ...(hooks || {})
  });
}

export function unequipSlot(ctx, slot, hooks) {
  const P = (ctx && ctx.Player) || (typeof window !== "undefined" ? window.Player : null);
  if (!P || typeof P.unequipSlot !== "function") {
    throw new Error("Player.unequipSlot missing; equip system cannot proceed");
  }
  P.unequipSlot(ctx.player, slot, {
    log: ctx.log,
    updateUI: ctx.updateUI,
    renderInventory: () => render(ctx),
    ...(hooks || {})
  });
}

// Back-compat: attach to window for classic scripts
if (typeof window !== "undefined") {
  window.InventoryController = {
    addPotion,
    drinkByIndex,
    equipByIndex,
    equipByIndexHand,
    unequipSlot,
    render,
    show,
    hide,
  };
}