import { U } from "./shared.js";
import { requestDraw } from "./draw.js";

export function showGameOver(ctx) {
  const u = U(ctx);
  if (u && typeof u.showGameOver === "function") {
    u.showGameOver(ctx);
    requestDraw(ctx);
  }
}

export function hideGameOver(ctx) {
  const u = U(ctx);
  if (u && typeof u.hideGameOver === "function") {
    u.hideGameOver(ctx);
  }
}

export function showGod(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try {
    if (u && typeof u.isGodOpen === "function") wasOpen = !!u.isGodOpen();
  } catch (_) {}
  if (u && typeof u.showGod === "function") {
    u.showGod(ctx);
    if (!wasOpen) requestDraw(ctx);
  }
}

export function hideGod(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try {
    if (u && typeof u.isGodOpen === "function") wasOpen = !!u.isGodOpen();
  } catch (_) {}
  if (u && typeof u.hideGod === "function") {
    u.hideGod(ctx);
    if (wasOpen) requestDraw(ctx);
  }
}

export function isGodOpen(ctx) {
  const u = U(ctx);
  try {
    if (u && typeof u.isGodOpen === "function") return !!u.isGodOpen();
  } catch (_) {}
  return false;
}

export function showHelp(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try {
    if (u && typeof u.isHelpOpen === "function") wasOpen = !!u.isHelpOpen();
  } catch (_) {}
  if (u && typeof u.showHelp === "function") {
    u.showHelp(ctx);
    if (!wasOpen) requestDraw(ctx);
  }
}

export function hideHelp(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try {
    if (u && typeof u.isHelpOpen === "function") wasOpen = !!u.isHelpOpen();
  } catch (_) {}
  if (u && typeof u.hideHelp === "function") {
    u.hideHelp(ctx);
    if (wasOpen) requestDraw(ctx);
  }
}

export function isHelpOpen(ctx) {
  const u = U(ctx);
  try {
    if (u && typeof u.isHelpOpen === "function") return !!u.isHelpOpen();
  } catch (_) {}
  return false;
}

// --- Character Sheet wrappers ---
export function showCharacter(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try {
    if (u && typeof u.isCharacterOpen === "function") wasOpen = !!u.isCharacterOpen();
  } catch (_) {}
  if (u && typeof u.showCharacter === "function") {
    u.showCharacter(ctx);
    if (!wasOpen) requestDraw(ctx);
  }
}

export function hideCharacter(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try {
    if (u && typeof u.isCharacterOpen === "function") wasOpen = !!u.isCharacterOpen();
  } catch (_) {}
  if (u && typeof u.hideCharacter === "function") {
    u.hideCharacter(ctx);
    if (wasOpen) requestDraw(ctx);
  }
}

export function isCharacterOpen(ctx) {
  const u = U(ctx);
  try {
    if (u && typeof u.isCharacterOpen === "function") return !!u.isCharacterOpen();
  } catch (_) {}
  return false;
}

export function showShop(ctx, npc) {
  const u = U(ctx);
  let wasOpen = false;
  try {
    if (u && typeof u.isShopOpen === "function") wasOpen = !!u.isShopOpen();
  } catch (_) {}
  if (u && typeof u.showShop === "function") {
    u.showShop(ctx, npc);
    if (!wasOpen) requestDraw(ctx);
  }
}

export function hideShop(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try {
    if (u && typeof u.isShopOpen === "function") wasOpen = !!u.isShopOpen();
  } catch (_) {}
  if (u && typeof u.hideShop === "function") {
    u.hideShop(ctx);
    if (wasOpen) requestDraw(ctx);
  }
}

export function isShopOpen(ctx) {
  const u = U(ctx);
  try {
    if (u && typeof u.isShopOpen === "function") return !!u.isShopOpen();
  } catch (_) {}
  return false;
}

export function buyShopIndex(ctx, idx) {
  const u = U(ctx);
  if (u && typeof u.buyShopIndex === "function") {
    u.buyShopIndex(ctx, idx | 0);
  }
}

export function showSmoke(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try {
    if (u && typeof u.isSmokeOpen === "function") wasOpen = !!u.isSmokeOpen();
  } catch (_) {}
  if (u && typeof u.showSmoke === "function") {
    u.showSmoke(ctx);
    if (!wasOpen) requestDraw(ctx);
  }
}

export function hideSmoke(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try {
    if (u && typeof u.isSmokeOpen === "function") wasOpen = !!u.isSmokeOpen();
  } catch (_) {}
  if (u && typeof u.hideSmoke === "function") {
    u.hideSmoke(ctx);
    if (wasOpen) requestDraw(ctx);
  }
}

export function isSmokeOpen(ctx) {
  const u = U(ctx);
  try {
    if (u && typeof u.isSmokeOpen === "function") return !!u.isSmokeOpen();
  } catch (_) {}
  return false;
}

export function showSleep(ctx, opts) {
  const u = U(ctx);
  let wasOpen = false;
  try {
    if (u && typeof u.isSleepOpen === "function") wasOpen = !!u.isSleepOpen();
  } catch (_) {}
  if (u && typeof u.showSleep === "function") {
    u.showSleep(ctx, opts || {});
    if (!wasOpen) requestDraw(ctx);
  }
}

export function hideSleep(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try {
    if (u && typeof u.isSleepOpen === "function") wasOpen = !!u.isSleepOpen();
  } catch (_) {}
  if (u && typeof u.hideSleep === "function") {
    u.hideSleep(ctx);
    if (wasOpen) requestDraw(ctx);
  }
}

export function isSleepOpen(ctx) {
  const u = U(ctx);
  try {
    if (u && typeof u.isSleepOpen === "function") return !!u.isSleepOpen();
  } catch (_) {}
  return false;
}

export function animateSleep(ctx, minutes, afterTimeCb) {
  const u = U(ctx);
  if (u && typeof u.animateSleep === "function") {
    u.animateSleep(ctx, minutes, afterTimeCb);
  }
}
