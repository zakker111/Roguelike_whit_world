/**
 * GameOrchestrator (minimal)
 * Provides a stable entrypoint for booting the game.
 * For now, core/game.js still performs world/input/loop boot on import.
 * This module exists so we can later move boot logic here without changing src/main.js.
 */

// Importing game.js triggers its side-effectful boot (init world, input, loop).
import "./game.js";

// Public API (placeholder for future explicit boot control)
export function start() {
  // No-op for now — game.js already booted.
  return true;
}

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach orchestrator handle to window
attachGlobal("GameOrchestrator", { start });