import { hasUI } from "./shared.js";

export function isConfirmOpen() {
  try { return !!(hasUI() && window.UI.isConfirmOpen && window.UI.isConfirmOpen()); } catch (_) { return false; }
}

export function cancelConfirm(ctx) {
  try { if (hasUI() && window.UI.cancelConfirm) window.UI.cancelConfirm(); } catch (_) {}
}

export function showConfirm(ctx, text, pos, onOk, onCancel) {
  if (hasUI() && typeof window.UI.showConfirm === "function") {
    try { window.UI.showConfirm(text, pos, onOk, onCancel); } catch (_) {}
  }
}
