// Stable UIBridge entry-point.
//
// Keep existing call sites importing `core/bridge/ui_bridge.js` working while
// the implementation lives in `core/bridge/ui_bridge/`.

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
} from "./ui_bridge/index.js";
