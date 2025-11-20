/**
 * Inventory facade: centralize UI/inventory operations via ctx-first calls.
 */
import { getMod } from "../../utils/access.js";

export function renderInventoryPanel(ctx) {
  const UIO = getMod(ctx, "UIOrchestration");
  if (UIO && typeof UIO.renderInventory === "function") UIO.renderInventory(ctx);
}

export function showInventoryPanel(ctx) {
  const UIO = getMod(ctx, "UIOrchestration");
  if (UIO && typeof UIO.showInventory === "function") {
    UIO.showInventory(ctx);
    const GL = getMod(ctx, "GameLoop");
    if (GL && typeof GL.requestDraw === "function") GL.requestDraw();
  }
}

export function hideInventoryPanel(ctx) {
  const UIO = getMod(ctx, "UIOrchestration");
  if (UIO && typeof UIO.hideInventory === "function") {
    UIO.hideInventory(ctx);
    const GL = getMod(ctx, "GameLoop");
    if (GL && typeof GL.requestDraw === "function") GL.requestDraw();
  }
}

export function equipItemByIndex(ctx, idx) {
  const IF = getMod(ctx, "InventoryFlow");
  if (IF && typeof IF.equipItemByIndex === "function") {
    IF.equipItemByIndex(ctx, idx);
    return;
  }
  const IC = getMod(ctx, "InventoryController");
  if (IC && typeof IC.equipByIndex === "function") {
    IC.equipByIndex(ctx, idx);
    return;
  }
}

export function equipItemByIndexHand(ctx, idx, hand) {
  const IF = getMod(ctx, "InventoryFlow");
  if (IF && typeof IF.equipItemByIndexHand === "function") {
    IF.equipItemByIndexHand(ctx, idx, hand);
    return;
  }
  const IC = getMod(ctx, "InventoryController");
  if (IC && typeof IC.equipByIndexHand === "function") {
    IC.equipByIndexHand(ctx, idx, hand);
    return;
  }
}

export function unequipSlot(ctx, slot) {
  const IF = getMod(ctx, "InventoryFlow");
  if (IF && typeof IF.unequipSlot === "function") {
    IF.unequipSlot(ctx, slot);
    return;
  }
  const IC = getMod(ctx, "InventoryController");
  if (IC && typeof IC.unequipSlot === "function") {
    IC.unequipSlot(ctx, slot);
    return;
  }
}

export function addPotionToInventory(ctx, heal = 3, name = `potion (+${heal} HP)`) {
  const IF = getMod(ctx, "InventoryFlow");
  if (IF && typeof IF.addPotionToInventory === "function") {
    IF.addPotionToInventory(ctx, heal, name);
    return;
  }
}

export function drinkPotionByIndex(ctx, idx) {
  const IF = getMod(ctx, "InventoryFlow");
  if (IF && typeof IF.drinkPotionByIndex === "function") {
    IF.drinkPotionByIndex(ctx, idx);
  }
}

export function eatFoodByIndex(ctx, idx) {
  const IF = getMod(ctx, "InventoryFlow");
  if (IF && typeof IF.eatByIndex === "function") {
    IF.eatByIndex(ctx, idx);
  }
}

// Back-compat
if (typeof window !== "undefined") {
  window.InventoryFacade = {
    renderInventoryPanel,
    showInventoryPanel,
    hideInventoryPanel,
    equipItemByIndex,
    equipItemByIndexHand,
    unequipSlot,
    addPotionToInventory,
    drinkPotionByIndex,
    eatFoodByIndex
  };
}