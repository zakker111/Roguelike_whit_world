import { U } from "./shared.js";
import { requestDraw } from "./draw.js";

export function cancelConfirm(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try {
    if (u && typeof u.isConfirmOpen === "function") wasOpen = !!u.isConfirmOpen();
  } catch (_) {}
  if (u && typeof u.cancelConfirm === "function") {
    u.cancelConfirm(ctx);
    if (wasOpen) requestDraw(ctx);
  }
}

export function isConfirmOpen(ctx) {
  const u = U(ctx);
  try {
    if (u && typeof u.isConfirmOpen === "function") return !!u.isConfirmOpen();
  } catch (_) {}
  return false;
}

export function showConfirm(ctx, text, pos, onOk, onCancel) {
  const u = U(ctx);
  // Best-effort: delegate to UIBridge/UI; no browser confirm fallback here
  if (u && typeof u.showConfirm === "function") {
    u.showConfirm(ctx, String(text || ""), pos || null, onOk, onCancel);
    requestDraw(ctx);
  }
}

export function isAnyModalOpen(ctx) {
  const u = U(ctx);
  try {
    if (u && typeof u.isAnyModalOpen === "function") return !!u.isAnyModalOpen();
  } catch (_) {}
  // Conservative default
  return false;
}
