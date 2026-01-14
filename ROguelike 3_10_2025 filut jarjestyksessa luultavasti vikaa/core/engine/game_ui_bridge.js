/**
 * GameUIBridge: wiring between core/game.js and UI/Input modules.
 *
 * This pulls the heavier UI wiring out of core/game.js so that file can stay
 * focused on orchestration and state, while preserving behavior exactly.
 *
 * Exports:
 * - setupInputBridge(opts): configure core/input.js with handlers and state queries
 * - initUIHandlersBridge(opts): initialize UI and register high-level handlers
 */

import { attachGlobal } from "../../utils/global.js";

/**
 * Wire keyboard/input handlers via core/input.js.
 *
 * opts:
 * - modHandle(name): resolve modules from ctx/window
 * - getCtx(): current ctx
 * - isDead(): boolean
 * - getFovRadius(): current FOV radius
 * - restartGame(): restart the run
 * - showInventoryPanel(), hideInventoryPanel(), hideLootPanel()
 * - tryMovePlayer(dx, dy), turn(), doAction(), descendIfPossible(), brace(), adjustFov(delta)
 */
export function setupInputBridge(opts) {
  if (!opts || typeof opts.modHandle !== "function") return;
  const {
    modHandle,
    getCtx,
    isDead,
    getFovRadius,
    restartGame,
    showInventoryPanel,
    hideInventoryPanel,
    hideLootPanel,
    tryMovePlayer,
    turn,
    doAction,
    descendIfPossible,
    brace,
    adjustFov,
  } = opts;

  const I = modHandle("Input");
  if (!I || typeof I.init !== "function") return;

  I.init({
    // state queries
    isDead: () => {
      try {
        return typeof isDead === "function" ? !!isDead() : false;
      } catch (_) {
        return false;
      }
    },
    isInventoryOpen: () => {
      const UIO = modHandle("UIOrchestration");
      return !!(
        UIO &&
        typeof UIO.isInventoryOpen === "function" &&
        UIO.isInventoryOpen(getCtx())
      );
    },
    isLootOpen: () => {
      const UIO = modHandle("UIOrchestration");
      return !!(
        UIO &&
        typeof UIO.isLootOpen === "function" &&
        UIO.isLootOpen(getCtx())
      );
    },
    isGodOpen: () => {
      const UIO = modHandle("UIOrchestration");
      return !!(
        UIO &&
        typeof UIO.isGodOpen === "function" &&
        UIO.isGodOpen(getCtx())
      );
    },
    // Ensure shop modal is part of the modal stack priority
    isShopOpen: () => {
      const UIO = modHandle("UIOrchestration");
      return !!(
        UIO &&
        typeof UIO.isShopOpen === "function" &&
        UIO.isShopOpen(getCtx())
      );
    },
    // Smoke config modal priority after Shop
    isSmokeOpen: () => {
      const UIO = modHandle("UIOrchestration");
      return !!(
        UIO &&
        typeof UIO.isSmokeOpen === "function" &&
        UIO.isSmokeOpen(getCtx())
      );
    },
    // Sleep modal (Inn beds)
    isSleepOpen: () => {
      const UIO = modHandle("UIOrchestration");
      return !!(
        UIO &&
        typeof UIO.isSleepOpen === "function" &&
        UIO.isSleepOpen(getCtx())
      );
    },
    // Confirm dialog gating
    isConfirmOpen: () => {
      const UIO = modHandle("UIOrchestration");
      return !!(
        UIO &&
        typeof UIO.isConfirmOpen === "function" &&
        UIO.isConfirmOpen(getCtx())
      );
    },
    // actions
    onRestart: () => {
      try {
        if (typeof restartGame === "function") restartGame();
      } catch (_) {}
    },
    onShowInventory: () => {
      try {
        if (typeof showInventoryPanel === "function") showInventoryPanel();
      } catch (_) {}
    },
    onHideInventory: () => {
      try {
        if (typeof hideInventoryPanel === "function") hideInventoryPanel();
      } catch (_) {}
    },
    onHideLoot: () => {
      try {
        if (typeof hideLootPanel === "function") hideLootPanel();
      } catch (_) {}
    },
    onHideGod: () => {
      const UIO = modHandle("UIOrchestration");
      if (UIO && typeof UIO.hideGod === "function") {
        UIO.hideGod(getCtx());
      }
    },
    onHideShop: () => {
      const UIO = modHandle("UIOrchestration");
      if (UIO && typeof UIO.hideShop === "function") {
        UIO.hideShop(getCtx());
      }
    },
    onHideSmoke: () => {
      const UIO = modHandle("UIOrchestration");
      if (UIO && typeof UIO.hideSmoke === "function") {
        UIO.hideSmoke(getCtx());
      }
    },
    onHideSleep: () => {
      const UIO = modHandle("UIOrchestration");
      if (UIO && typeof UIO.hideSleep === "function") {
        UIO.hideSleep(getCtx());
      }
    },
    onCancelConfirm: () => {
      const UIO = modHandle("UIOrchestration");
      if (UIO && typeof UIO.cancelConfirm === "function") {
        UIO.cancelConfirm(getCtx());
      }
    },
    onShowGod: () => {
      const UIO = modHandle("UIOrchestration");
      if (UIO && typeof UIO.showGod === "function") {
        UIO.showGod(getCtx());
      }
      const UIH = modHandle("UI");
      if (UIH && typeof UIH.setGodFov === "function") {
        try {
          const r =
            typeof getFovRadius === "function" ? getFovRadius() : undefined;
          if (typeof r !== "undefined") {
            UIH.setGodFov(r);
          }
        } catch (_) {
          // keep going even if radius retrieval fails
        }
      }
    },

    // Help / Controls + Character Sheet (F1)
    isHelpOpen: () => {
      const UIO = modHandle("UIOrchestration");
      return !!(
        UIO &&
        typeof UIO.isHelpOpen === "function" &&
        UIO.isHelpOpen(getCtx())
      );
    },
    onShowHelp: () => {
      const UIO = modHandle("UIOrchestration");
      if (UIO && typeof UIO.showHelp === "function") {
        UIO.showHelp(getCtx());
      }
    },
    onHideHelp: () => {
      const UIO = modHandle("UIOrchestration");
      if (UIO && typeof UIO.hideHelp === "function") {
        UIO.hideHelp(getCtx());
      }
    },
    // Character Sheet (C)
    isCharacterOpen: () => {
      const UIO = modHandle("UIOrchestration");
      return !!(
        UIO &&
        typeof UIO.isCharacterOpen === "function" &&
        UIO.isCharacterOpen(getCtx())
      );
    },
    onShowCharacter: () => {
      const UIO = modHandle("UIOrchestration");
      if (UIO && typeof UIO.showCharacter === "function") {
        UIO.showCharacter(getCtx());
      }
    },
    onHideCharacter: () => {
      const UIO = modHandle("UIOrchestration");
      if (UIO && typeof UIO.hideCharacter === "function") {
        UIO.hideCharacter(getCtx());
      }
    },
    // Follower inspect panel
    isFollowerOpen: () => {
      const UIO = modHandle("UIOrchestration");
      return !!(
        UIO &&
        typeof UIO.isFollowerOpen === "function" &&
        UIO.isFollowerOpen(getCtx())
      );
    },
    onHideFollower: () => {
      const UIO = modHandle("UIOrchestration");
      if (UIO && typeof UIO.hideFollower === "function") {
        UIO.hideFollower(getCtx());
      }
    },

    // core actions
    onMove: (dx, dy) => {
      try {
        if (typeof tryMovePlayer === "function") tryMovePlayer(dx, dy);
      } catch (_) {}
    },
    onWait: () => {
      try {
        if (typeof turn === "function") turn();
      } catch (_) {}
    },
    onLoot: () => {
      try {
        if (typeof doAction === "function") doAction();
      } catch (_) {}
    },
    onDescend: () => {
      try {
        if (typeof descendIfPossible === "function") descendIfPossible();
      } catch (_) {}
    },
    onBrace: () => {
      try {
        if (typeof brace === "function") brace();
      } catch (_) {}
    },
    adjustFov: (delta) => {
      try {
        if (typeof adjustFov === "function") adjustFov(delta);
      } catch (_) {}
    },
  });
}

/**
 * Initialize UI and set up high-level handlers via core/ui/ui.js.
 *
 * opts:
 * - modHandle(name): resolve modules
 * - getCtx(): current ctx
 * - equipItemByIndex(idx), equipItemByIndexHand(idx, hand), unequipSlot(slot)
 * - drinkPotionByIndex(idx), eatFoodByIndex(idx)
 * - restartGame(), turn()
 * - getFovRadius(): current FOV radius (for GOD panel integration)
 */
export function initUIHandlersBridge(opts) {
  if (!opts || typeof opts.modHandle !== "function") return;

  const {
    modHandle,
    getCtx,
    equipItemByIndex,
    equipItemByIndexHand,
    unequipSlot,
    drinkPotionByIndex,
    eatFoodByIndex,
    restartGame,
    turn,
    getFovRadius,
  } = opts;

  const UIH = modHandle("UI");
  if (!UIH || typeof UIH.init !== "function") return;

  UIH.init();
  if (typeof UIH.setHandlers === "function") {
    UIH.setHandlers({
      onEquip: (idx) => {
        try {
          if (typeof equipItemByIndex === "function") {
            equipItemByIndex(idx);
          }
        } catch (_) {}
      },
      onEquipHand: (idx, hand) => {
        try {
          if (typeof equipItemByIndexHand === "function") {
            equipItemByIndexHand(idx, hand);
          }
        } catch (_) {}
      },
      onUnequip: (slot) => {
        try {
          if (typeof unequipSlot === "function") {
            unequipSlot(slot);
          }
        } catch (_) {}
      },
      onDrink: (idx) => {
        try {
          if (typeof drinkPotionByIndex === "function") {
            drinkPotionByIndex(idx);
          }
        } catch (_) {}
      },
      onEat: (idx) => {
        try {
          if (typeof eatFoodByIndex === "function") {
            eatFoodByIndex(idx);
          }
        } catch (_) {}
      },
      onRestart: () => {
        try {
          if (typeof restartGame === "function") {
            restartGame();
          }
        } catch (_) {}
      },
      onWait: () => {
        try {
          if (typeof turn === "function") turn();
        } catch (_) {}
      },
    });
  }

  // Install GOD-specific handlers via dedicated module
  try {
    const GH = modHandle("GodHandlers");
    if (GH && typeof GH.install === "function") {
      GH.install(() => getCtx());
    }
  } catch (_) {}

  // Optionally, update GOD FOV indicator once on init if UI supports it
  try {
    const radius =
      typeof getFovRadius === "function" ? getFovRadius() : undefined;
    if (typeof radius !== "undefined") {
      if (UIH && typeof UIH.setGodFov === "function") {
        UIH.setGodFov(radius);
      }
    }
  } catch (_) {}
}

// Back-compat / debug handle
attachGlobal("GameUIBridge", {
  setupInputBridge,
  initUIHandlersBridge,
});