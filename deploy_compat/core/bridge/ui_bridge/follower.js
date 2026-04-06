import { hasUI } from "./shared.js";

export function isFollowerOpen() {
  try { return !!(hasUI() && window.UI.isFollowerOpen && window.UI.isFollowerOpen()); } catch (_) { return false; }
}

export function showFollower(ctx, view) {
  if (!hasUI()) return;
  try { window.UI.showFollower && window.UI.showFollower(ctx, view); } catch (_) {}
}

export function hideFollower(ctx) {
  if (!hasUI()) return;
  try { window.UI.hideFollower && window.UI.hideFollower(); } catch (_) {}
}
