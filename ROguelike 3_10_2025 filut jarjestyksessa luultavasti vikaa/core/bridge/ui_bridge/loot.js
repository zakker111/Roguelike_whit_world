import { hasUI } from "./shared.js";

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
