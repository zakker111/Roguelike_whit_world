/**
 * DeathFlow: ctx-first wrappers for game over show/hide and restart.
 *
 * Exports (ESM + window.DeathFlow):
 * - show(ctx)
 * - hide(ctx)
 * - restart(ctx)
 * - onPlayerDied(ctx) [optional usage]
 */

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
  const UB = mod("UIBridge");
  if (UB && typeof UB.showGameOver === "function") {
    UB.showGameOver(ctx);
    requestDraw(ctx);
  }
}

export function hide(ctx) {
  try {
    const UIO = mod("UIOrchestration");
    if (UIO && typeof UIO.hideGameOver === "function") {
      UIO.hideGameOver(ctx);
      return;
    }
  } catch (_) {}
  const UB = mod("UIBridge");
  if (UB && typeof UB.hideGameOver === "function") {
    UB.hideGameOver(ctx);
  }
}

export function restart(ctx) {
  hide(ctx);
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
  requestDraw(ctx);
}

export function onPlayerDied(ctx) {
  try { ctx.isDead = true; } catch (_) {}
  try { ctx.updateUI && ctx.updateUI(); } catch (_) {}
  try { ctx.log && ctx.log("You die. Press R or Enter to restart.", "bad"); } catch (_) {}
  show(ctx);
}

import { attachGlobal } from "../utils/global.js";
attachGlobal("DeathFlow", { show, hide, restart, onPlayerDied });