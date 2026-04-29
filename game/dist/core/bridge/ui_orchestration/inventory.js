import { U, IC } from "./shared.js";
import { requestDraw } from "./draw.js";

export function renderInventory(ctx) {
  const ic = IC(ctx);
  if (ic && typeof ic.render === "function") {
    ic.render(ctx);
    return;
  }
  const u = U(ctx);
  if (u && typeof u.renderInventory === "function") {
    u.renderInventory(ctx);
  }
}

export function showInventory(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try {
    if (u && typeof u.isInventoryOpen === "function") wasOpen = !!u.isInventoryOpen();
  } catch (_) {}

  const ic = IC(ctx);
  if (ic && typeof ic.show === "function") {
    ic.show(ctx);
  } else if (typeof renderInventory === "function") {
    renderInventory(ctx);
    if (u && typeof u.showInventory === "function") {
      u.showInventory(ctx);
    }
  }

  if (!wasOpen) requestDraw(ctx);
}

export function hideInventory(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try {
    if (u && typeof u.isInventoryOpen === "function") wasOpen = !!u.isInventoryOpen();
  } catch (_) {}

  const ic = IC(ctx);
  if (ic && typeof ic.hide === "function") {
    ic.hide(ctx);
  } else if (u && typeof u.hideInventory === "function") {
    u.hideInventory(ctx);
  }

  if (wasOpen) requestDraw(ctx);
}

export function isInventoryOpen(ctx) {
  const u = U(ctx);
  try {
    if (u && typeof u.isInventoryOpen === "function") return !!u.isInventoryOpen();
  } catch (_) {}
  return false;
}
