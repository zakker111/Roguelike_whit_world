import { hasUI } from "./shared.js";

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
