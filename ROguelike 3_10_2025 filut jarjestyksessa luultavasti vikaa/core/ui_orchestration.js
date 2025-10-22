/**
 * UIOrchestration: ctx-first wrappers around UIBridge and related UI modules.
 *
 * Exports (ESM + window.UIOrchestration):
 * - requestDraw(ctx)
 * - renderInventory(ctx)
 * - showInventory(ctx)
 * - hideInventory(ctx)
 * - showLoot(ctx, list)
 * - hideLoot(ctx)
 * - showGameOver(ctx)
 * - hideGameOver(ctx)
 * - showGod(ctx), hideGod(ctx)
 * - showHelp(ctx), hideHelp(ctx)
 * - showRegionMap(ctx), hideRegionMap(ctx)
 * - isAnyModalOpen(ctx): boolean
 */

function U(ctx) {
  try {
    return ctx?.UIBridge || (typeof window !== "undefined" ? window.UIBridge : null);
  } catch (_) { return null; }
}

function IC(ctx) {
  try {
    return ctx?.InventoryController || (typeof window !== "undefined" ? window.InventoryController : null);
  } catch (_) { return null; }
}

function GL() {
  try {
    return (typeof window !== "undefined" ? window.GameLoop : null);
  } catch (_) { return null; }
}

function R() {
  try {
    return (typeof window !== "undefined" ? window.Render : null);
  } catch (_) { return null; }
}

export function requestDraw(ctx) {
  // Prefer ctx.requestDraw if provided by orchestrator
  try {
    if (ctx && typeof ctx.requestDraw === "function") {
      ctx.requestDraw();
      return;
    }
  } catch (_) {}
  // Next, GameLoop.requestDraw
  try {
    const gl = GL();
    if (gl && typeof gl.requestDraw === "function") {
      gl.requestDraw();
      return;
    }
  } catch (_) {}
  // Fallback: ask Render to draw if we have a render context provider
  try {
    const r = R();
    if (r && typeof r.draw === "function" && typeof ctx?.getRenderCtx === "function") {
      r.draw(ctx.getRenderCtx());
    }
  } catch (_) {}
}

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
  try { if (u && typeof u.isInventoryOpen === "function") wasOpen = !!u.isInventoryOpen(); } catch (_) {}
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
  try { if (u && typeof u.isInventoryOpen === "function") wasOpen = !!u.isInventoryOpen(); } catch (_) {}
  const ic = IC(ctx);
  if (ic && typeof ic.hide === "function") {
    ic.hide(ctx);
  } else if (u && typeof u.hideInventory === "function") {
    u.hideInventory(ctx);
  }
  if (wasOpen) requestDraw(ctx);
}

export function showLoot(ctx, list) {
  const u = U(ctx);
  let wasOpen = false;
  try { if (u && typeof u.isLootOpen === "function") wasOpen = !!u.isLootOpen(); } catch (_) {}
  if (u && typeof u.showLoot === "function") {
    u.showLoot(ctx, list);
    if (!wasOpen) requestDraw(ctx);
  }
}

export function hideLoot(ctx) {
  const u = U(ctx);
  let wasOpen = true;
  try { if (u && typeof u.isLootOpen === "function") wasOpen = !!u.isLootOpen(); } catch (_) {}
  if (u && typeof u.hideLoot === "function") {
    u.hideLoot(ctx);
    if (wasOpen) requestDraw(ctx);
  }
}

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
  try { if (u && typeof u.isGodOpen === "function") wasOpen = !!u.isGodOpen(); } catch (_) {}
  if (u && typeof u.showGod === "function") {
    u.showGod(ctx);
    if (!wasOpen) requestDraw(ctx);
  }
}

export function hideGod(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try { if (u && typeof u.isGodOpen === "function") wasOpen = !!u.isGodOpen(); } catch (_) {}
  if (u && typeof u.hideGod === "function") {
    u.hideGod(ctx);
    if (wasOpen) requestDraw(ctx);
  }
}

export function showHelp(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try { if (u && typeof u.isHelpOpen === "function") wasOpen = !!u.isHelpOpen(); } catch (_) {}
  if (u && typeof u.showHelp === "function") {
    u.showHelp(ctx);
    if (!wasOpen) requestDraw(ctx);
  }
}

export function hideHelp(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try { if (u && typeof u.isHelpOpen === "function") wasOpen = !!u.isHelpOpen(); } catch (_) {}
  if (u && typeof u.hideHelp === "function") {
    u.hideHelp(ctx);
    if (wasOpen) requestDraw(ctx);
  }
}

export function showRegionMap(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try { if (u && typeof u.isRegionMapOpen === "function") wasOpen = !!u.isRegionMapOpen(); } catch (_) {}
  if (u && typeof u.showRegionMap === "function") {
    u.showRegionMap(ctx);
    if (!wasOpen) requestDraw(ctx);
  }
}

export function hideRegionMap(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try { if (u && typeof u.isRegionMapOpen === "function") wasOpen = !!u.isRegionMapOpen(); } catch (_) {}
  if (u && typeof u.hideRegionMap === "function") {
    u.hideRegionMap(ctx);
    if (wasOpen) requestDraw(ctx);
  }
}

export function isAnyModalOpen(ctx) {
  const u = U(ctx);
  try { if (u && typeof u.isAnyModalOpen === "function") return !!u.isAnyModalOpen(); } catch (_) {}
  // Conservative default
  return false;
}

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("UIOrchestration", {
  requestDraw,
  renderInventory,
  showInventory,
  hideInventory,
  showLoot,
  hideLoot,
  showGameOver,
  hideGameOver,
  showGod,
  hideGod,
  showHelp,
  hideHelp,
  showRegionMap,
  hideRegionMap,
  isAnyModalOpen
});