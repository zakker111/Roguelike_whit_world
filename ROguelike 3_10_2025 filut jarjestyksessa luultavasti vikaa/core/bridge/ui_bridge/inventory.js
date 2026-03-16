import { hasUI } from "./shared.js";

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
