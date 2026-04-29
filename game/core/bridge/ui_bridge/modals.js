import { isConfirmOpen } from "./confirm.js";
import { isLootOpen } from "./loot.js";
import { isInventoryOpen } from "./inventory.js";
import { isGodOpen, isHelpOpen, isCharacterOpen } from "./panels.js";
import { isShopOpen } from "./shop.js";
import { isSmokeOpen } from "./smoke.js";
import { isFollowerOpen } from "./follower.js";
import { isSleepOpen } from "./sleep.js";
import { isQuestBoardOpen } from "./quest_board.js";
import { isFishingOpen } from "./fishing.js";
import { isLockpickOpen } from "./lockpick.js";

// Aggregate modal state for simple gating
export function isAnyModalOpen() {
  try {
    return !!(
      isConfirmOpen() ||
      isLootOpen() ||
      isInventoryOpen() ||
      isGodOpen() ||
      isShopOpen() ||
      isSmokeOpen() ||
      isHelpOpen() ||
      isCharacterOpen() ||
      isFollowerOpen() ||
      isSleepOpen() ||
      isQuestBoardOpen() ||
      isFishingOpen() ||
      isLockpickOpen()
    );
  } catch (_) {
    return false;
  }
}
