/**
 * GameOrchestrator
 * Stable entrypoint that boots the game by calling explicit helpers from core/game.js.
 * Keeps behavior identical but moves side-effects out of game.js.
 */

import { initWorld, setupInput, initMouseSupport, startLoop, scheduleAssetsReadyDraw, buildGameAPI } from "/core/game.js?v=1.45.2";

export function start() {
  try { buildGameAPI(); } catch (_) {}
  try { initWorld(); } catch (_) {}
  try { setupInput(); } catch (_) {}
  try { initMouseSupport(); } catch (_) {}
  try { startLoop(); } catch (_) {}
  try { scheduleAssetsReadyDraw(); } catch (_) {}
  return true;
}

// Auto-start to match previous behavior (game booted on import before this refactor)
try { start(); } catch (_) {}

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach orchestrator handle to window
attachGlobal("GameOrchestrator", { start });