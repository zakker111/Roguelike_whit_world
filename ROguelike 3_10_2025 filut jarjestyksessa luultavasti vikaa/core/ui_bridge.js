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
 * - showRegionMap(ctx)        // opens Region Map modal
 * - hideRegionMap(ctx)        // hides Region Map modal
 * - isRegionMapOpen()         // query open state
 * - showHelp(ctx)             // opens Help/Controls + Character Sheet
 * - hideHelp(ctx)             // hides Help panel
 * - isHelpOpen()              // query open state
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
  const perf = (typeof ctx.getPerfStats === "function") ? ctx.getPerfStats() : null;
  try {
    window.UI.updateStats(ctx.player, ctx.floor, atk, def, ctx.time, perf);
  } catch (_) {}
}

export function renderInventory(ctx) {
  if (!hasUI() || typeof window.UI.renderInventory !== "function") return;
  try {
    // Avoid DOM work when panel is closed
    const open = (typeof window.UI.isInventoryOpen === "function") ? !!window.UI.isInventoryOpen() : true;
    if (!open) return;
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

export function showRegionMap(ctx) {
  if (!hasUI()) return;
  try { window.UI.showRegionMap && window.UI.showRegionMap(ctx); } catch (_) {}
}
export function hideRegionMap(ctx) {
  if (!hasUI()) return;
  try { window.UI.hideRegionMap && window.UI.hideRegionMap(); } catch (_) {}
}
export function isRegionMapOpen() {
  try { return !!(hasUI() && window.UI.isRegionMapOpen && window.UI.isRegionMapOpen()); } catch (_) { return false; }
}

export function showHelp(ctx) {
  if (!hasUI()) return;
  try { window.UI.showHelp && window.UI.showHelp(ctx); } catch (_) {}
}
export function hideHelp(ctx) {
  if (!hasUI()) return;
  try { window.UI.hideHelp && window.UI.hideHelp(); } catch (_) {}
}
export function isHelpOpen() {
  try { return !!(hasUI() && window.UI.isHelpOpen && window.UI.isHelpOpen()); } catch (_) { return false; }
}

// ---- Sleep panel (Inn beds) ----
// Implemented directly in UIBridge to avoid broader UI refactors.
// Provides a slider to choose minutes to sleep and calls a callback to advance time and heal.
let _sleepPanel = null;
let _sleepSlider = null;
let _sleepValueEl = null;
let _sleepConfirmCb = null;

function ensureSleepPanel() {
  if (_sleepPanel) return _sleepPanel;
  const panel = document.createElement("div");
  panel.id = "sleep-panel";
  panel.style.position = "fixed";
  panel.style.left = "50%";
  panel.style.top = "50%";
  panel.style.transform = "translate(-50%, -50%)";
  panel.style.zIndex = "40000";
  panel.style.background = "rgba(20,24,33,0.98)";
  panel.style.border = "1px solid rgba(80,90,120,0.6)";
  panel.style.borderRadius = "8px";
  panel.style.padding = "12px";
  panel.style.boxShadow = "0 10px 30px rgba(0,0,0,0.5)";
  panel.style.minWidth = "360px";
  panel.style.maxWidth = "92vw";
  panel.style.display = "none";

  const title = document.createElement("div");
  title.textContent = "Inn — Sleep";
  title.style.color = "#e5e7eb";
  title.style.fontSize = "16px";
  title.style.fontWeight = "600";
  title.style.marginBottom = "8px";

  const desc = document.createElement("div");
  desc.textContent = "Choose how long to sleep.";
  desc.style.color = "#94a3b8";
  desc.style.fontSize = "12px";
  desc.style.marginBottom = "8px";

  const value = document.createElement("div");
  value.id = "sleep-value";
  value.style.color = "#cbd5e1";
  value.style.fontSize = "13px";
  value.style.marginBottom = "8px";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.id = "sleep-minutes";
  slider.min = "30";
  slider.max = "720";
  slider.step = "30";
  slider.value = "240";
  slider.style.width = "100%";
  slider.style.margin = "8px 0 12px 0";

  const btnRow = document.createElement("div");
  btnRow.style.display = "flex";
  btnRow.style.gap = "8px";
  btnRow.style.justifyContent = "flex-end";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.style.padding = "6px 10px";
  cancelBtn.style.background = "#111827";
  cancelBtn.style.color = "#9ca3af";
  cancelBtn.style.border = "1px solid #374151";
  cancelBtn.style.borderRadius = "4px";
  cancelBtn.style.cursor = "pointer";

  const okBtn = document.createElement("button");
  okBtn.textContent = "Sleep";
  okBtn.style.padding = "6px 12px";
  okBtn.style.background = "#1f2937";
  okBtn.style.color = "#e5e7eb";
  okBtn.style.border = "1px solid #334155";
  okBtn.style.borderRadius = "4px";
  okBtn.style.cursor = "pointer";

  const updateLabel = () => {
    const mins = parseInt(slider.value, 10) || 0;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const hh = String(h).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    value.textContent = `Sleep for ${mins} minutes (${hh}:${mm})`;
  };

  slider.addEventListener("input", updateLabel);
  slider.addEventListener("change", updateLabel);

  cancelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    hideSleep();
  });
  okBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const mins = parseInt(slider.value, 10) || 0;
    const cb = _sleepConfirmCb;
    hideSleep();
    if (typeof cb === "function") cb(mins);
  });

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(okBtn);

  panel.appendChild(title);
  panel.appendChild(desc);
  panel.appendChild(value);
  panel.appendChild(slider);
  panel.appendChild(btnRow);

  document.body.appendChild(panel);

  _sleepPanel = panel;
  _sleepSlider = slider;
  _sleepValueEl = value;

  // Click outside to close
  panel.addEventListener("click", (e) => {
    if (e.target === panel) {
      hideSleep();
      e.stopPropagation();
    }
  });

  updateLabel();
  return panel;
}

export function isSleepOpen() {
  try {
    return !!(_sleepPanel && _sleepPanel.style.display !== "none");
  } catch (_) { return false; }
}

export function showSleep(ctx, opts = {}) {
  const panel = ensureSleepPanel();
  // Configure slider from opts: { min, max, step, value, onConfirm }
  try {
    const min = Math.max(10, Math.min(1440, parseInt(opts.min, 10) || 30));
    const max = Math.max(min, Math.min(1440, parseInt(opts.max, 10) || 720));
    const step = Math.max(5, Math.min(120, parseInt(opts.step, 10) || 30));
    const value = Math.max(min, Math.min(max, parseInt(opts.value, 10) || 240));
    _sleepSlider.min = String(min);
    _sleepSlider.max = String(max);
    _sleepSlider.step = String(step);
    _sleepSlider.value = String(value);
    _sleepConfirmCb = (typeof opts.onConfirm === "function") ? opts.onConfirm : null;
    // Update label for initial value
    const mins = parseInt(_sleepSlider.value, 10) || 0;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const hh = String(h).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    _sleepValueEl.textContent = `Sleep for ${mins} minutes (${hh}:${mm})`;
  } catch (_) {}

  panel.style.display = "block";
}

export function hideSleep(ctx) {
  try {
    if (_sleepPanel) _sleepPanel.style.display = "none";
    _sleepConfirmCb = null;
  } catch (_) {}
}

// Confirm modal wrappers
export function isConfirmOpen() {
  try { return !!(hasUI() && window.UI.isConfirmOpen && window.UI.isConfirmOpen()); } catch (_) { return false; }
}
export function cancelConfirm(ctx) {
  try { if (hasUI() && window.UI.cancelConfirm) window.UI.cancelConfirm(); } catch (_) {}
}

// Aggregate modal state for simple gating
export function isAnyModalOpen() {
  try {
    return !!(isConfirmOpen() || isLootOpen() || isInventoryOpen() || isGodOpen() || isShopOpen() || isSmokeOpen() || isRegionMapOpen() || isHelpOpen() || is catch (_) { return false; }
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
    isRegionMapOpen,
    showRegionMap,
    hideRegionMap,
    // Help/Controls + Character Sheet
    isHelpOpen,
    showHelp,
    hideHelp,
    // Sleep panel (Inn)
    isSleepOpen,
    showSleep,
    hideSleep,
    // Confirm modal
    isConfirmOpen,
    cancelConfirm,
    // Aggregate
    isAnyModalOpen,
    showConfirm,
    showTownExitButton,
    hideTownExitButton
  };
}