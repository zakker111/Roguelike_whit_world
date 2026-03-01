/**
 * GameOrchestrator
 * Stable entrypoint that boots the game by calling explicit helpers from core/game.js.
 * Keeps behavior identical but moves side-effects out of game.js.
 */

import { scheduleHealthCheck } from "./health_check.js";

function getAppVersion() {
  try {
    if (typeof window !== "undefined" && window.APP_VERSION) {
      return String(window.APP_VERSION || "");
    }
  } catch (_) {}
  try {
    const meta = (typeof document !== "undefined") ? document.querySelector('meta[name="app-version"]') : null;
    const ver = meta ? String(meta.getAttribute("content") || "") : "";
    return ver;
  } catch (_) {}
  return "";
}

const APP_VERSION = getAppVersion();
const CORE_GAME_URL = `/core/game.js${APP_VERSION ? `?v=${encodeURIComponent(APP_VERSION)}` : ""}`;

// Ensure core/game.js is imported with a cache-busting version that matches the single app-version.
const {
  initWorld,
  setupInput,
  initMouseSupport,
  startLoop,
  scheduleAssetsReadyDraw,
  buildGameAPI,
  getCtx,
} = await import(CORE_GAME_URL);

export function start() {
  try { buildGameAPI(); } catch (_) {}
  // Schedule a startup health check once GameData is ready so we get a boot report
  // without blocking world generation or the main loop.
  try { scheduleHealthCheck(() => getCtx()); } catch (_) {}

  // Initialize optional GM runtime early so ctx.gm is available for callers.
  // This is optional and must never break boot.
  try {
    const ctx = getCtx();
    const GM = (ctx && ctx.GMRuntime) ? ctx.GMRuntime : ((typeof window !== "undefined") ? window.GMRuntime : null);
    if (GM && typeof GM.init === "function") {
      GM.init(ctx);
    }
  } catch (_) {}

  try { initWorld(); } catch (_) {}
  try { setupInput(); } catch (_) {}
  try { initMouseSupport(); } catch (_) {}
  try { startLoop(); } catch (_) {}
  try { scheduleAssetsReadyDraw(); } catch (_) {}
  return true;
}

// Auto-start to match previous behavior (game booted on import before this refactor)
try { start(); } catch (_) {}

import { attachGlobal } from "../../utils/global.js";
// Back-compat: attach orchestrator handle to window
attachGlobal("GameOrchestrator", { start });