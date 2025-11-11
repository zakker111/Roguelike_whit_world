/**
 * GameOrchestrator
 * Stable entrypoint that boots the game by calling explicit helpers from core/game.js.
 * Keeps behavior identical but moves side-effects out of game.js.
 */

import { initWorld, setupInput, initMouseSupport, startLoop, scheduleAssetsReadyDraw, buildGameAPI } from "./game.js";

export function start() {
  try { buildGameAPI(); } catch (_) {}
  // Defer world init and first draw until assets (tiles/palette) are ready to avoid strict renderer errors
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const readyP = (GD && GD.ready && typeof GD.ready.then === "function") ? GD.ready : Promise.resolve();
    readyP.then(() => {
      try { initWorld(); } catch (_) {}
      try { setupInput(); } catch (_) {}
      try { initMouseSupport(); } catch (_) {}
      try { startLoop(); } catch (_) {}
      // Assets are loaded; offscreen caches will be built on the first draw
    }).catch(() => {
      // Fallback: proceed even if ready failed; modules will surface errors
      try { initWorld(); } catch (_) {}
      try { setupInput(); } catch (_) {}
      try { initMouseSupport(); } catch (_) {}
      try { startLoop(); } catch (_) {}
    });
  } catch (_) {
    // Ultimate fallback: start immediately
    try { initWorld(); } catch (_) {}
    try { setupInput(); } catch (_) {}
    try { initMouseSupport(); } catch (_) {}
    try { startLoop(); } catch (_) {}
  }
  return true;
}

// Auto-start to match previous behavior (game booted on import before this refactor)
try { start(); } catch (_) {}

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach orchestrator handle to window
attachGlobal("GameOrchestrator", { start });