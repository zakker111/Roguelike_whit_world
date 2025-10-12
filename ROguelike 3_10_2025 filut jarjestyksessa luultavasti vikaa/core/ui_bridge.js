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
 *
 * Notes:
 * - Thin layer: delegates to window.UI if present.
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
    isGodOpen
  };
})();