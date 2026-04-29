import {
  renderInventoryPanel as renderInventoryPanelFacade,
  showInventoryPanel as showInventoryPanelFacade,
  hideInventoryPanel as hideInventoryPanelFacade,
  equipItemByIndex as equipItemByIndexFacade,
  equipItemByIndexHand as equipItemByIndexHandFacade,
  unequipSlot as unequipSlotFacade,
  addPotionToInventory as addPotionToInventoryFacade,
  drinkPotionByIndex as drinkPotionByIndexFacade,
  eatFoodByIndex as eatFoodByIndexFacade,
  useItemByIndex as useItemByIndexFacade
} from "../facades/inventory.js";

import {
  initialDecay as invInitialDecay,
  rerenderInventoryIfOpen as invRerenderInventoryIfOpen,
  decayEquipped as invDecayEquipped,
  usingTwoHanded as invUsingTwoHanded,
  decayAttackHands as invDecayAttackHands,
  decayBlockingHands as invDecayBlockingHands,
  describeItem as invDescribeItem,
  equipIfBetter as invEquipIfBetter
} from "../facades/inventory_decay.js";

export function createInventoryOps(getCtx) {
  const ctx = () => (typeof getCtx === "function" ? getCtx() : null);

  function initialDecay(tier) {
    return invInitialDecay(ctx(), tier);
  }

  function rerenderInventoryIfOpen() {
    invRerenderInventoryIfOpen(ctx());
  }

  function decayEquipped(slot, amount) {
    invDecayEquipped(ctx(), slot, amount);
  }

  function usingTwoHanded() {
    return invUsingTwoHanded(ctx());
  }

  function decayAttackHands(light = false) {
    invDecayAttackHands(ctx(), light);
  }

  function decayBlockingHands() {
    invDecayBlockingHands(ctx());
  }

  function describeItem(item) {
    return invDescribeItem(ctx(), item);
  }

  function equipIfBetter(item) {
    return invEquipIfBetter(ctx(), item);
  }

  function addPotionToInventory(heal = 3, name = `potion (+${heal} HP)`) {
    addPotionToInventoryFacade(ctx(), heal, name);
  }

  function drinkPotionByIndex(idx) {
    drinkPotionByIndexFacade(ctx(), idx);
  }

  function eatFoodByIndex(idx) {
    eatFoodByIndexFacade(ctx(), idx);
  }

  function useItemByIndex(idx) {
    useItemByIndexFacade(ctx(), idx);
  }

  function renderInventoryPanel() {
    try { renderInventoryPanelFacade(ctx()); } catch (_) {}
  }

  function showInventoryPanel() {
    try { showInventoryPanelFacade(ctx()); } catch (_) {}
  }

  function hideInventoryPanel() {
    try { hideInventoryPanelFacade(ctx()); } catch (_) {}
  }

  function equipItemByIndex(idx) {
    return !!equipItemByIndexFacade(ctx(), idx);
  }

  function equipItemByIndexHand(idx, hand) {
    return !!equipItemByIndexHandFacade(ctx(), idx, hand);
  }

  function unequipSlot(slot) {
    return !!unequipSlotFacade(ctx(), slot);
  }

  return {
    initialDecay,
    rerenderInventoryIfOpen,
    decayEquipped,
    usingTwoHanded,
    decayAttackHands,
    decayBlockingHands,
    describeItem,
    equipIfBetter,
    addPotionToInventory,
    drinkPotionByIndex,
    eatFoodByIndex,
    useItemByIndex,
    renderInventoryPanel,
    showInventoryPanel,
    hideInventoryPanel,
    equipItemByIndex,
    equipItemByIndexHand,
    unequipSlot,
  };
}

// Back-compat alias (core/game.js originally imported createGameInventoryOps)
export const createGameInventoryOps = createInventoryOps;
