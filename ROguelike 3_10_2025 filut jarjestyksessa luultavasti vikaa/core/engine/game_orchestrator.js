/**
 * GameOrchestrator
 * Stable entrypoint that boots the game by calling explicit helpers from core/game.js.
 * Keeps behavior identical but moves side-effects out of game.js.
 */

import { initWorld, setupInput, initMouseSupport, startLoop, scheduleAssetsReadyDraw, buildGameAPI, getCtx } from "/core/game.js?v=1.45.2";
import { scheduleHealthCheck } from "./health_check.js";

export function start() {
  try { buildGameAPI(); } catch (_) {}
  // Schedule a startup health check once GameData is ready so we get a boot report
  // without blocking world generation or the main loop.
  try { scheduleHealthCheck(() => getCtx()); } catch (_) {}
  try { initWorld(); } catch (_) {}
  // Initialize optional GM runtime early so ctx.gm is available for callers.
  try {
    const GM = (typeof window !== "undefined") ? window.GMRuntime : null;
    if (GM && typeof GM.init === "function") {
      GM.init(getCtx());
      if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") {
        window.Logger.log("[BOOT] GMRuntime initialized.", "notice", { category: "gm" });
      } else if (typeof console !== "undefined" && typeof console.log === "function") {
        console.log("[BOOT] GMRuntime initialized.");
      }
    }
  } catch (_) {}
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