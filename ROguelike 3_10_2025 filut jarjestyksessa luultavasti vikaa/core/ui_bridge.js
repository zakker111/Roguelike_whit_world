/**
 * UIBridge: central wrapper for UI interactions using ctx.
 *
 * Exports (ESM + window.UIBridge):
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
 * - showSmoke(ctx)            // opens Smoke Config panel
 * - hideSmoke(ctx)            // hides Smoke Config panel
 *
 * Notes:
 * - Thin layer: delegates to window.UI if present (and window.ShopUI for shop panel).
 * - Keeps calls consistent and reduces direct UI wiring inside core/game.js.
 */

function hasUI() {
  return (typeof window !== "undefined" && window.UI);
}

export function updateStats(ctx) {
  if (!hasUI() || typeof window.UI.updateStats !== "function") return;
  const atk = function () {
    try { return (typeof ctx.getPlayerAttack === "function") ? ctx.getPlayerAttack() : (ctx.player.atk || 1); }
    catch (_) { return ctx.player && ctx.player.atk || 1; }
  };
  const def = function () {
    try { return (typeof ctx.getPlayerDefense === "function") ? ctx.getPlayerDefense() : 0; }
    catch (_) { return 0; }
  };
  try {
    window.UI.updateStats(ctx.player, ctx.floor, atk, def, ctx.time);
  } catch (_) {}
}

export function renderInventory(ctx) {
  if (!hasUI() || typeof window.UI.renderInventory !== "function") return;
  try {
    const desc = (typeof ctx.describeItem === "function")
      ? ctx.describeItem
      : (it) => (it && it.name) ? it.name : "item";
    window.UI.renderInventory(ctx.player, desc);
  } catch (_) {}
}

export function showInventory(ctx) {
  if (!hasUI()) return;
  try { window.UI.showInventory && window.UI.showInventory(); } catch (_) {}
}

export function hideInventory(ctx) {
  if (!hasUI()) return;
  try { window.UI.hideInventory && window.UI.hideInventory(); } catch (_) {}
}

export function isInventoryOpen() {
  try { return !!(hasUI() && window.UI.isInventoryOpen && window.UI.isInventoryOpen()); } catch (_) { return false; }
}

export function showLoot(ctx, list) {
  if (!hasUI()) return;
  try { window.UI.showLoot && window.UI.showLoot(list || []); } catch (_) {}
}

export function hideLoot(ctx) {
  if (!hasUI()) return;
  try { window.UI.hideLoot && window.UI.hideLoot(); } catch (_) {}
}

export function isLootOpen() {
  try { return !!(hasUI() && window.UI.isLootOpen && window.UI.isLootOpen()); } catch (_) { return false; }
}

export function showGameOver(ctx) {
  if (!hasUI()) return;
  try { window.UI.showGameOver && window.UI.showGameOver(ctx.player, ctx.floor); } catch (_) {}
}

export function hideGameOver(ctx) {
  if (!hasUI()) return;
  try { window.UI.hideGameOver && window.UI.hideGameOver(); } catch (_) {}
}

export function showGod(ctx) {
  if (!hasUI()) return;
  try { window.UI.showGod && window.UI.showGod(); } catch (_) {}
}

export function hideGod(ctx) {
  if (!hasUI()) return;
  try { window.UI.hideGod && window.UI.hideGod(); } catch (_) {}
}

export function isGodOpen() {
  try { return !!(hasUI() && window.UI.isGodOpen && window.UI.isGodOpen()); } catch (_) { return false; }
}

// Shop UI wrappers
export function isShopOpen() {
  try {
    if (typeof window !== "undefined" && window.ShopUI && typeof window.ShopUI.isOpen === "function") {
      return !!window.ShopUI.isOpen();
    }
  } catch (_) {}
  return false;
}
export function showShop(ctx, npc) {
  try {
    if (typeof window !== "undefined" && window.ShopUI && typeof window.ShopUI.openForNPC === "function") {
      window.ShopUI.openForNPC(ctx, npc);
      return;
    }
  } catch (_) {}
}
export function hideShop(ctx) {
  try {
    if (typeof window !== "undefined" && window.ShopUI && typeof window.ShopUI.hide === "function") {
      window.ShopUI.hide();
      return;
    }
  } catch (_) {}
}
export function buyShopIndex(ctx, idx) {
  try {
    if (typeof window !== "undefined" && window.ShopUI && typeof window.ShopUI.buyIndex === "function") {
      window.ShopUI.buyIndex(ctx, idx);
    }
  } catch (_) {}
}

// Smoke panel open-state (used by input gating)
export function isSmokeOpen() {
  try { return !!(hasUI() && window.UI.isSmokeOpen && window.UI.isSmokeOpen()); } catch (_) { return false; }
}
export function showSmoke(ctx) {
  if (!hasUI()) return;
  try { window.UI.showSmoke && window.UI.showSmoke(); } catch (_) {}
}
export function hideSmoke(ctx) {
  if (!hasUI()) return;
  try { window.UI.hideSmoke && window.UI.hideSmoke(); } catch (_) {}
}

// Aggregate modal state for simple gating
export function isAnyModalOpen() {
  try {
    return !!(isLootOpen() || isInventoryOpen() || isGodOpen() || isShopOpen() || isSmokeOpen());
  } catch (_) { return false; }
}

export function showConfirm(ctx, text, pos, onOk, onCancel) {
  if (hasUI() && typeof window.UI.showConfirm === "function") {
    try { window.UI.showConfirm(text, pos, onOk, onCancel); } catch (_) {}
    return;
  }
  // Fallback: simple browser confirm
  try {
    const ok = typeof window !== "undefined" && window.confirm ? window.confirm(text) : true;
    if (ok && typeof onOk === "function") onOk();
    else if (!ok && typeof onCancel === "function") onCancel();
  } catch (_) {}
}

export function showTownExitButton(ctx) {
  if (!hasUI()) return;
  try { window.UI.showTownExitButton && window.UI.showTownExitButton(); } catch (_) {}
}

export function hideTownExitButton(ctx) {
  if (!hasUI()) return;
  try { window.UI.hideTownExitButton && window.UI.hideTownExitButton(); } catch (_) {}
}

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
    isShopOpen,
    showShop,
    hideShop,
    buyShopIndex,
    isSmokeOpen,
    showSmoke,
    hideSmoke,
    isAnyModalOpen,
    showConfirm,
    showTownExitButton,
    hideTownExitButton
  };
}