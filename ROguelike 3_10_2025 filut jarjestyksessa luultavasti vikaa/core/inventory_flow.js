/**
 * InventoryFlow: ctx-first wrappers around inventory and equipment actions.
 *
 * Exports (ESM + window.InventoryFlow):
 * - render(ctx)
 * - show(ctx)
 * - hide(ctx)
 * - equipItemByIndex(ctx, idx)
 * - equipItemByIndexHand(ctx, idx, hand)
 * - unequipSlot(ctx, slot)
 * - drinkPotionByIndex(ctx, idx)
 * - addPotionToInventory(ctx, heal, name)
 */

function mod(name) {
  try {
    const w = (typeof window !== "undefined") ? window : {};
    return w[name] || null;
  } catch (_) { return null; }
}

function requestDraw(ctx) {
  try {
    const UIO = mod("UIOrchestration");
    if (UIO && typeof UIO.requestDraw === "function") {
      UIO.requestDraw(ctx);
      return;
    }
  } catch (_) {}
  try {
    const GL = mod("GameLoop");
    if (GL && typeof GL.requestDraw === "function") {
      GL.requestDraw();
      return;
    }
  } catch (_) {}
}

export function render(ctx) {
  const IC = mod("InventoryController");
  if (IC && typeof IC.render === "function") { IC.render(ctx); return; }
  try {
    const UIO = mod("UIOrchestration");
    if (UIO && typeof UIO.renderInventory === "function") {
      UIO.renderInventory(ctx);
      return;
    }
  } catch (_) {}
}

export function show(ctx) {
  let wasOpen = false;
  try {
    const UIO = mod("UIOrchestration");
    if (UIO && typeof UIO.isInventoryOpen === "function") wasOpen = !!UIO.isInventoryOpen(ctx);
  } catch (_) {}
  const IC = mod("InventoryController");
  if (IC && typeof IC.show === "function") {
    IC.show(ctx);
  } else {
    render(ctx);
    try {
      const UIO = mod("UIOrchestration");
      if (UIO && typeof UIO.showInventory === "function") {
        UIO.showInventory(ctx);
      }
    } catch (_) {}
  }
  if (!wasOpen) requestDraw(ctx);
}

export function hide(ctx) {
  let wasOpen = false;
  try {
    const UIO = mod("UIOrchestration");
    if (UIO && typeof UIO.isInventoryOpen === "function") wasOpen = !!UIO.isInventoryOpen(ctx);
  } catch (_) {}
  const IC = mod("InventoryController");
  if (IC && typeof IC.hide === "function") {
    IC.hide(ctx);
    if (wasOpen) requestDraw(ctx);
    return;
  }
  try {
    const UIO = mod("UIOrchestration");
    if (UIO && typeof UIO.hideInventory === "function") {
      UIO.hideInventory(ctx);
      if (wasOpen) requestDraw(ctx);
      return;
    }
  } catch (_) {}
  if (wasOpen) requestDraw(ctx);
}

export function equipItemByIndex(ctx, idx) {
  const IC = mod("InventoryController");
  if (IC && typeof IC.equipByIndex === "function") { IC.equipByIndex(ctx, idx); return; }
  const P = mod("Player");
  if (P && typeof P.equipItemByIndex === "function") {
    const describeItem = (it) => {
      try {
        const ID = ctx.ItemDescribe || mod("ItemDescribe");
        if (ID && typeof ID.describe === "function") return ID.describe(it);
      } catch (_) {}
      const Items = ctx.Items || mod("Items");
      if (Items && typeof Items.describe === "function") return Items.describe(it);
      return (it && it.name) ? it.name : "item";
    };
    const renderInventory = () => {
      try {
        const UIO = mod("UIOrchestration");
        if (UIO && typeof UIO.renderInventory === "function") UIO.renderInventory(ctx);
      } catch (_) {}
    };
    P.equipItemByIndex(ctx.player, idx, { log: ctx.log, updateUI: ctx.updateUI, renderInventory, describeItem });
    return;
  }
  try { ctx.log && ctx.log("Equip system not available.", "warn"); } catch (_) {}
}

export function equipItemByIndexHand(ctx, idx, hand) {
  const IC = mod("InventoryController");
  if (IC && typeof IC.equipByIndexHand === "function") { IC.equipByIndexHand(ctx, idx, hand); return; }
  const P = mod("Player");
  if (P && typeof P.equipItemByIndex === "function") {
    const describeItem = (it) => {
      try {
        const ID = ctx.ItemDescribe || mod("ItemDescribe");
        if (ID && typeof ID.describe === "function") return ID.describe(it);
      } catch (_) {}
      const Items = ctx.Items || mod("Items");
      if (Items && typeof Items.describe === "function") return Items.describe(it);
      return (it && it.name) ? it.name : "item";
    };
    const renderInventory = () => {
      try {
        const UIO = mod("UIOrchestration");
        if (UIO && typeof UIO.renderInventory === "function") UIO.renderInventory(ctx);
      } catch (_) {}
    };
    P.equipItemByIndex(ctx.player, idx, { log: ctx.log, updateUI: ctx.updateUI, renderInventory, describeItem, preferredHand: hand });
    return;
  }
  try { ctx.log && ctx.log("Equip system not available.", "warn"); } catch (_) {}
}

export function unequipSlot(ctx, slot) {
  const IC = mod("InventoryController");
  if (IC && typeof IC.unequipSlot === "function") { IC.unequipSlot(ctx, slot); return; }
  const P = mod("Player");
  if (P && typeof P.unequipSlot === "function") {
    const renderInventory = () => {
      try {
        const UIO = mod("UIOrchestration");
        if (UIO && typeof UIO.renderInventory === "function") UIO.renderInventory(ctx);
      } catch (_) {}
    };
    P.unequipSlot(ctx.player, slot, { log: ctx.log, updateUI: ctx.updateUI, renderInventory });
    return;
  }
  try { ctx.log && ctx.log("Equip system not available.", "warn"); } catch (_) {}
}

export function drinkPotionByIndex(ctx, idx) {
  const IC = mod("InventoryController");
  if (IC && typeof IC.drinkByIndex === "function") { IC.drinkByIndex(ctx, idx); return; }
  const P = mod("Player");
  if (P && typeof P.drinkPotionByIndex === "function") {
    const renderInventory = () => {
      try {
        const UIO = mod("UIOrchestration");
        if (UIO && typeof UIO.renderInventory === "function") UIO.renderInventory(ctx);
      } catch (_) {}
    };
    P.drinkPotionByIndex(ctx.player, idx, { log: ctx.log, updateUI: ctx.updateUI, renderInventory });
    return;
  }
  const inv = ctx.player.inventory || [];
  if (!inv || idx < 0 || idx >= inv.length) return;
  const it = inv[idx];
  if (!it || (it.kind !== "potion" && it.kind !== "drink")) return;
  const heal = (typeof it.heal === "number") ? it.heal : (it.kind === "drink" ? 2 : 3);
  const prev = ctx.player.hp;
  ctx.player.hp = Math.min(ctx.player.maxHp, ctx.player.hp + heal);
  const gained = ctx.player.hp - prev;
  const label = it.name ? it.name : (it.kind === "drink" ? "drink" : "potion");
  try {
    if (gained > 0) ctx.log && ctx.log(`You drink ${label} and restore ${gained.toFixed(1)} HP (HP ${ctx.player.hp.toFixed(1)}/${ctx.player.maxHp.toFixed(1)}).`, "good");
    else ctx.log && ctx.log(`You drink ${label} but feel no different (HP ${ctx.player.hp.toFixed(1)}/${ctx.player.maxHp.toFixed(1)}).`, "warn");
  } catch (_) {}
  if (it.count && it.count > 1) it.count -= 1;
  else inv.splice(idx, 1);
  try { ctx.updateUI && ctx.updateUI(); } catch (_) {}
  try {
    const UIO = mod("UIOrchestration");
    if (UIO && typeof UIO.renderInventory === "function") UIO.renderInventory(ctx);
  } catch (_) {}
}

export function addPotionToInventory(ctx, heal = 3, name = `potion (+${heal} HP)`) {
  const IC = mod("InventoryController");
  if (IC && typeof IC.addPotion === "function") { IC.addPotion(ctx, heal, name); return; }
  const P = mod("Player");
  if (P && typeof P.addPotion === "function") { P.addPotion(ctx.player, heal, name); return; }
  const existing = (ctx.player.inventory || []).find(i => i && i.kind === "potion" && ((typeof i.heal === "number" ? i.heal : 3) === heal));
  if (existing) existing.count = (existing.count || 1) + 1;
  else {
    if (!Array.isArray(ctx.player.inventory)) ctx.player.inventory = [];
    ctx.player.inventory.push({ kind: "potion", heal, count: 1, name });
  }
}

import { attachGlobal } from "../utils/global.js";
attachGlobal("InventoryFlow", {
  render, show, hide,
  equipItemByIndex,
  equipItemByIndexHand,
  unequipSlot,
  drinkPotionByIndex,
  addPotionToInventory
});