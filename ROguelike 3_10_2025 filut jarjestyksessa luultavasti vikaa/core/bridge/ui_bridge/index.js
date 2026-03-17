import { updateStats } from "./stats.js";
import { renderInventory, showInventory, hideInventory, isInventoryOpen } from "./inventory.js";
import { showLoot, hideLoot, isLootOpen } from "./loot.js";
import { showGameOver, hideGameOver, showGod, hideGod, isGodOpen, showHelp, hideHelp, isHelpOpen, showCharacter, hideCharacter, isCharacterOpen } from "./panels.js";
import { isFollowerOpen, showFollower, hideFollower } from "./follower.js";
import { isShopOpen, showShop, hideShop, buyShopIndex } from "./shop.js";
import { isSmokeOpen, showSmoke, hideSmoke } from "./smoke.js";
import { isSleepOpen, showSleep, hideSleep, animateSleep } from "./sleep.js";
import { isQuestBoardOpen, showQuestBoard, hideQuestBoard } from "./quest_board.js";
import { isFishingOpen, showFishing, hideFishing } from "./fishing.js";
import { isLockpickOpen, showLockpick, hideLockpick } from "./lockpick.js";
import { isConfirmOpen, cancelConfirm, showConfirm } from "./confirm.js";
import { isAnyModalOpen } from "./modals.js";

export {
  updateStats,
  renderInventory,
  showInventory,
  hideInventory,
  isInventoryOpen,
  showLoot,
  hideLoot,
  isLootOpen,
  showGameOver,
  hideGameOver,
  showGod,
  hideGod,
  isGodOpen,
  // Follower inspect panel
  isFollowerOpen,
  showFollower,
  hideFollower,
  isShopOpen,
  showShop,
  hideShop,
  buyShopIndex,
  isSmokeOpen,
  showSmoke,
  hideSmoke,
  // Help/Controls and Character Sheet
  isHelpOpen,
  showHelp,
  hideHelp,
  isCharacterOpen,
  showCharacter,
  hideCharacter,
  // Sleep panel (Inn)
  isSleepOpen,
  showSleep,
  hideSleep,
  // Quest Board panel
  isQuestBoardOpen,
  showQuestBoard,
  hideQuestBoard,
  // Fishing mini-game
  isFishingOpen,
  showFishing,
  hideFishing,
  // Lockpicking mini-game
  isLockpickOpen,
  showLockpick,
  hideLockpick,
  // Confirm modal
  isConfirmOpen,
  cancelConfirm,
  // Aggregate
  isAnyModalOpen,
  showConfirm,
  // Sleep animation
  animateSleep,
};

// Back-compat: attach to window for classic scripts
if (typeof window !== "undefined") {
  window.UIBridge = {
    updateStats,
    renderInventory,
    showInventory,
    hideInventory,
    isInventoryOpen,
    showLoot,
    hideLoot,
    isLootOpen,
    showGameOver,
    hideGameOver,
    showGod,
    hideGod,
    isGodOpen,
    // Follower inspect panel
    isFollowerOpen,
    showFollower,
    hideFollower,
    isShopOpen,
    showShop,
    hideShop,
    buyShopIndex,
    isSmokeOpen,
    showSmoke,
    hideSmoke,
    // Help/Controls and Character Sheet
    isHelpOpen,
    showHelp,
    hideHelp,
    isCharacterOpen,
    showCharacter,
    hideCharacter,
    // Sleep panel (Inn)
    isSleepOpen,
    showSleep,
    hideSleep,
    // Quest Board panel
    isQuestBoardOpen,
    showQuestBoard,
    hideQuestBoard,
    // Fishing mini-game
    isFishingOpen,
    showFishing,
    hideFishing,
    // Lockpicking mini-game
    isLockpickOpen,
    showLockpick,
    hideLockpick,
    // Confirm modal
    isConfirmOpen,
    cancelConfirm,
    // Aggregate
    isAnyModalOpen,
    showConfirm,
    // Sleep animation
    animateSleep,
  };
}
