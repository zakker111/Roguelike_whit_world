import { U } from "./shared.js";
import { requestDraw } from "./draw.js";

export function showLockpick(ctx, opts) {
  const u = U(ctx);
  let wasOpen = false;
  try {
    if (u && typeof u.isLockpickOpen === "function") wasOpen = !!u.isLockpickOpen();
  } catch (_) {}
  if (u && typeof u.showLockpick === "function") {
    u.showLockpick(ctx, opts || {});
    if (!wasOpen) requestDraw(ctx);
  }
}

export function hideLockpick(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try {
    if (u && typeof u.isLockpickOpen === "function") wasOpen = !!u.isLockpickOpen();
  } catch (_) {}
  if (u && typeof u.hideLockpick === "function") {
    u.hideLockpick(ctx);
    if (wasOpen) requestDraw(ctx);
  }
}

export function isLockpickOpen(ctx) {
  const u = U(ctx);
  try {
    if (u && typeof u.isLockpickOpen === "function") return !!u.isLockpickOpen();
  } catch (_) {}
  return false;
}
