/**
 * ModeController: app-level facade around mode transitions.
 * Wraps core/modes_transitions.js (preferred) and core/modes.js (fallback).
 *
 * Exports (ESM + window.ModeController):
 * - enterTownIfOnTile(ctx) -> boolean
 * - enterDungeonIfOnEntrance(ctx) -> boolean
 * - enterRuinsIfOnTile(ctx) -> boolean
 * - leaveTownNow(ctx) -> void
 * - requestLeaveTown(ctx) -> void
 * - returnToWorldFromTown(ctx) -> boolean
 * - returnToWorldIfAtExit(ctx) -> boolean
 */

function mod(name) {
  try {
    const w = (typeof window !== "undefined") ? window : {};
    return w[name] || null;
  } catch (_) { return null; }
}

export function enterTownIfOnTile(ctx) {
  const MT = mod("ModesTransitions");
  if (MT && typeof MT.enterTownIfOnTile === "function") {
    return !!MT.enterTownIfOnTile(ctx);
  }
  const M = mod("Modes");
  if (M && typeof M.enterTownIfOnTile === "function") {
    return !!M.enterTownIfOnTile(ctx);
  }
  return false;
}

export function enterDungeonIfOnEntrance(ctx) {
  const MT = mod("ModesTransitions");
  if (MT && typeof MT.enterDungeonIfOnEntrance === "function") {
    return !!MT.enterDungeonIfOnEntrance(ctx);
  }
  const M = mod("Modes");
  if (M && typeof M.enterDungeonIfOnEntrance === "function") {
    return !!M.enterDungeonIfOnEntrance(ctx);
  }
  return false;
}

export function enterRuinsIfOnTile(ctx) {
  const MT = mod("ModesTransitions");
  if (MT && typeof MT.enterRuinsIfOnTile === "function") {
    return !!MT.enterRuinsIfOnTile(ctx);
  }
  const M = mod("Modes");
  if (M && typeof M.enterRuinsIfOnTile === "function") {
    return !!M.enterRuinsIfOnTile(ctx);
  }
  return false;
}

export function leaveTownNow(ctx) {
  const MT = mod("ModesTransitions");
  if (MT && typeof MT.leaveTownNow === "function") {
    MT.leaveTownNow(ctx);
    return;
  }
  const M = mod("Modes");
  if (M && typeof M.leaveTownNow === "function") {
    M.leaveTownNow(ctx);
    return;
  }
}

export function requestLeaveTown(ctx) {
  const MT = mod("ModesTransitions");
  if (MT && typeof MT.requestLeaveTown === "function") {
    MT.requestLeaveTown(ctx);
    return;
  }
  const M = mod("Modes");
  if (M && typeof M.requestLeaveTown === "function") {
    M.requestLeaveTown(ctx);
    return;
  }
}

export function returnToWorldFromTown(ctx) {
  const MT = mod("ModesTransitions");
  if (MT && typeof MT.returnToWorldFromTown === "function") {
    return !!MT.returnToWorldFromTown(ctx);
  }
  const TR = mod("TownRuntime");
  if (TR && typeof TR.returnToWorldIfAtGate === "function") {
    return !!TR.returnToWorldIfAtGate(ctx);
  }
  // Fallback: gate check + applyLeaveSync if available
  try {
    const gate = ctx && ctx.townExitAt;
    if (gate && ctx.player.x === gate.x && ctx.player.y === gate.y && TR && typeof TR.applyLeaveSync === "function") {
      TR.applyLeaveSync(ctx);
      return true;
    }
  } catch (_) {}
  return false;
}

export function returnToWorldIfAtExit(ctx) {
  const MT = mod("ModesTransitions");
  if (MT && typeof MT.returnToWorldIfAtExit === "function") {
    return !!MT.returnToWorldIfAtExit(ctx);
  }
  const M = mod("Modes");
  if (M && typeof M.returnToWorldIfAtExit === "function") {
    return !!M.returnToWorldIfAtExit(ctx);
  }
  return false;
}

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("ModeController", {
  enterTownIfOnTile,
  enterDungeonIfOnEntrance,
  enterRuinsIfOnTile,
  leaveTownNow,
  requestLeaveTown,
  returnToWorldFromTown,
  returnToWorldIfAtExit,
});