/**
 * UIBridge: central wrapper for UI interactions using ctx.
 *
 * Exports (window.UIBridge):
 * - updateStats(ctx)
 * - renderInventory(ctx)
 * - showInventory(ctx)
 * - hideInventory(ctx)
 * - isInventoryOpen()
 * - showLoot(ctx, list)
 * - hideLoot(ctx)
 * - isLootOpen()
 * - showGameOver(ctx)
 * - hideGameOver()
 * - showGod(ctx)
 * - hideGod(ctx)
 * - isGodOpen()
 * - showConfirm(ctx, text, pos, onOk, onCancel)
 * - showTownExitButton(ctx)
 * - hideTownExitButton(ctx)
 * - isShopOpen()
 * - showShop(ctx, npc)        // opens shop for a given NPC/spot
 * - hideShop(ctx)             // hides shop panel
 * - buyShopIndex(ctx, idx)    // triggers a buy by index
 *
 * Notes:
 * - Thin layer: delegates to window.UI if present (and window.ShopUI for shop panel).
 * - Keeps calls consistent and reduces direct UI wiring inside core/game.js.
 */
(function () {
  function hasUI() {
    return (typeof window !== "undefined" && window.UI);
  }

  function updateStats(ctx) {
    if (!hasUI() || typeof UI.updateStats !== "function") return;
    const atk = function () {
      try { return (typeof ctx.getPlayerAttack === "function") ? ctx.getPlayerAttack() : (ctx.player.atk || 1); }
      catch (_) { return ctx.player && ctx.player.atk || 1; }
    };
    const def = function () {
      try { return (typeof ctx.getPlayerDefense === "function") ? ctx.getPlayerDefense() : 0; }
      catch (_) { return 0; }
    };
    try {
      UI.updateStats(ctx.player, ctx.floor, atk, def, ctx.time);
    } catch (_) {}
  }

  function renderInventory(ctx) {
    if (!hasUI() || typeof UI.renderInventory !== "function") return;
    try {
      const desc = (typeof ctx.describeItem === "function")
        ? ctx.describeItem
        : (it) => (it && it.name) ? it.name : "item";
      UI.renderInventory(ctx.player, desc);
    } catch (_) {}
  }

  function showInventory(ctx) {
    if (!hasUI()) return;
    try { UI.showInventory && UI.showInventory(); } catch (_) {}
  }

  function hideInventory(ctx) {
    if (!hasUI()) return;
    try { UI.hideInventory && UI.hideInventory(); } catch (_) {}
  }

  function isInventoryOpen() {
    try { return !!(hasUI() && UI.isInventoryOpen && UI.isInventoryOpen()); } catch (_) { return false; }
  }

  function showLoot(ctx, list) {
    if (!hasUI()) return;
    try { UI.showLoot && UI.showLoot(list || []); } catch (_) {}
  }

  function hideLoot(ctx) {
    if (!hasUI()) return;
    try { UI.hideLoot && UI.hideLoot(); } catch (_) {}
  }

  function isLootOpen() {
    try { return !!(hasUI() && UI.isLootOpen && UI.isLootOpen()); } catch (_) { return false; }
  }

  function showGameOver(ctx) {
    if (!hasUI()) return;
    try { UI.showGameOver && UI.showGameOver(ctx.player, ctx.floor); } catch (_) {}
  }

  function hideGameOver(ctx) {
    if (!hasUI()) return;
    try { UI.hideGameOver && UI.hideGameOver(); } catch (_) {}
  }

  function showGod(ctx) {
    if (!hasUI()) return;
    try { UI.showGod && UI.showGod(); } catch (_) {}
  }

  function hideGod(ctx) {
    if (!hasUI()) return;
    try { UI.hideGod && UI.hideGod(); } catch (_) {}
  }

  function isGodOpen() {
    try { return !!(hasUI() && UI.isGodOpen && UI.isGodOpen()); } catch (_) { return false; }
  }

  // Shop UI wrappers
  function isShopOpen() {
    try {
      if (typeof window !== "undefined" && window.ShopUI && typeof window.ShopUI.isOpen === "function") {
        return !!window.ShopUI.isOpen();
      }
    } catch (_) {}
    try {
      const el = document.getElementById("shop-panel");
      return !!(el && el.hidden === false);
    } catch (_) { return false; }
  }
  function showShop(ctx, npc) {
    try {
      if (typeof window !== "undefined" && window.ShopUI && typeof window.ShopUI.openForNPC === "function") {
        window.ShopUI.openForNPC(ctx, npc);
        return;
      }
    } catch (_) {}
  }
  function hideShop(ctx) {
    try {
      if (typeof window !== "undefined" && window.ShopUI && typeof window.ShopUI.hide === "function") {
        window.ShopUI.hide();
        return;
      }
    } catch (_) {}
    try {
      const el = document.getElementById("shop-panel");
      if (el) el.hidden = true;
    } catch (_) {}
  }
  function buyShopIndex(ctx, idx) {
    try {
      if (typeof window !== "undefined" && window.ShopUI && typeof window.ShopUI.buyIndex === "function") {
        window.ShopUI.buyIndex(ctx, idx);
      }
    } catch (_) {}
  }

  // Smoke panel open-state (used by input gating)
  function isSmokeOpen() {
    try { return !!(hasUI() && UI.isSmokeOpen && UI.isSmokeOpen()); } catch (_) { return false; }
  }

  // Aggregate modal state for simple gating
  function isAnyModalOpen() {
    try {
      return !!(isLootOpen() || isInventoryOpen() || isGodOpen() || isShopOpen() || isSmokeOpen());
    } catch (_) { return false; }
  }

  function showConfirm(ctx, text, pos, onOk, onCancel) {
    if (hasUI() && typeof UI.showConfirm === "function") {
      try { UI.showConfirm(text, pos, onOk, onCancel); } catch (_) {}
      return;
    }
    // Fallback: simple browser confirm
    try {
      const ok = typeof window !== "undefined" && window.confirm ? window.confirm(text) : true;
      if (ok && typeof onOk === "function") onOk();
      else if (!ok && typeof onCancel === "function") onCancel();
    } catch (_) {}
  }

  function showTownExitButton(ctx) {
    if (!hasUI()) return;
    try { UI.showTownExitButton && UI.showTownExitButton(); } catch (_) {}
  }

  function hideTownExitButton(ctx) {
    if (!hasUI()) return;
    try { UI.hideTownExitButton && UI.hideTownExitButton(); } catch (_) {}
  }

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
    isShopOpen,
    showShop,
    hideShop,
    buyShopIndex,
    isSmokeOpen,
    isAnyModalOpen,
    showConfirm,
    showTownExitButton,
    hideTownExitButton
  };
})();