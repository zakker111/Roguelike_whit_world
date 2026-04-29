/**
 * DeathFlow: ctx-first wrappers for game over show/hide and restart.
 *
 * Exports (ESM + window.DeathFlow):
 * - show(ctx)
 * - hide(ctx)
 * - restart(ctx)
 * - onPlayerDied(ctx) [optional usage]
 */

import { getMod } from "../utils/access.js";
import { log as fallbackLog } from "../utils/fallback.js";

function mod(name) {
  try {
    const w = (typeof window !== "undefined") ? window : {};
    return w[name] || null;
  } catch (_) { return null; }
}

function requestDraw(ctx) {
  try {
    const UIO = mod("UIOrchestration");
    if (UIO && typeof UIO.requestDraw === "function") {
      UIO.requestDraw(ctx);
      return;
    }
  } catch (_) {}
  try {
    const GL = mod("GameLoop");
    if (GL && typeof GL.requestDraw === "function") {
      GL.requestDraw();
      return;
    }
  } catch (_) {}
}

export function show(ctx) {
  try {
    const UIO = mod("UIOrchestration");
    if (UIO && typeof UIO.showGameOver === "function") {
      UIO.showGameOver(ctx);
      return;
    }
  } catch (_) {}
  // No direct UIBridge fallback — UI must be routed via UIOrchestration
}

export function hide(ctx) {
  try {
    const UIO = mod("UIOrchestration");
    if (UIO && typeof UIO.hideGameOver === "function") {
      UIO.hideGameOver(ctx);
      return;
    }
  } catch (_) {}
  // No direct UIBridge fallback — UI must be routed via UIOrchestration
}

export function restart(ctx) {
  hide(ctx);
  try {
    const GM = mod("GMRuntime");
    if (GM && typeof GM.reset === "function") {
      GM.reset(ctx, { reason: "death_restart" });
    }
  } catch (_) {}
  try {
    // Reset player to defaults when possible
    const P = mod("Player");
    if (P && typeof P.resetFromDefaults === "function") {
      P.resetFromDefaults(ctx.player);
    } else {
      // Minimal reset
      ctx.player.hp = ctx.player.maxHp;
      ctx.player.bleedTurns = 0;
      ctx.player.dazedTurns = 0;
    }
  } catch (_) {}
  try {
    ctx.player.bleedTurns = 0;
    ctx.player.dazedTurns = 0;
  } catch (_) {}
  ctx.mode = "world";
  // Recreate world via orchestrator hook
  try {
    if (typeof ctx.initWorld === "function") {
      ctx.initWorld();
      return;
    }
  } catch (_) {}
  // Fallback: trigger a draw so UI reflects state
  try {
    fallbackLog("deathFlow.restart.noInitWorld", "initWorld missing; triggering draw-only restart fallback.", {
      hasInitWorld: typeof ctx.initWorld === "function"
    });
  } catch (_) {}
  requestDraw(ctx);
}

export function onPlayerDied(ctx) {
  try { ctx.isDead = true; } catch (_) {}
  try {
    const SS = ctx.StateSync || getMod(ctx, "StateSync");
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    }
  } catch (_) {}
  try { ctx.log && ctx.log("You die. Press R or Enter to restart.", "info"); } catch (_) {}
  show(ctx);
}

import { attachGlobal } from "../utils/global.js";
attachGlobal("DeathFlow", { show, hide, restart, onPlayerDied });