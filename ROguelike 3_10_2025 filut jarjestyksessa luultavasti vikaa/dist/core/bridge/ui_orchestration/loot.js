import { U } from "./shared.js";
import { requestDraw } from "./draw.js";

export function showLoot(ctx, list) {
  const u = U(ctx);
  let wasOpen = false;
  try {
    if (u && typeof u.isLootOpen === "function") wasOpen = !!u.isLootOpen();
  } catch (_) {}

  if (u && typeof u.showLoot === "function") {
    u.showLoot(ctx, list);
    if (!wasOpen) requestDraw(ctx);
  }
}

export function hideLoot(ctx) {
  const u = U(ctx);
  let wasOpen = true;
  try {
    if (u && typeof u.isLootOpen === "function") wasOpen = !!u.isLootOpen();
  } catch (_) {}

  if (u && typeof u.hideLoot === "function") {
    u.hideLoot(ctx);
    if (wasOpen) requestDraw(ctx);
  }
}

export function isLootOpen(ctx) {
  const u = U(ctx);
  try {
    if (u && typeof u.isLootOpen === "function") return !!u.isLootOpen();
  } catch (_) {}
  return false;
}
