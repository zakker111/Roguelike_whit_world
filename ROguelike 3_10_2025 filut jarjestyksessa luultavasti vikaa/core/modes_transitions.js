/**
 * ModesTransitions: thin ctx-first wrappers around core/modes.js transitions.
 *
 * Exports (ESM + window.ModesTransitions):
 * - enterTownIfOnTile(ctx) -> boolean
 * - enterDungeonIfOnEntrance(ctx) -> boolean
 * - enterRuinsIfOnTile(ctx) -> boolean
 * - requestLeaveTown(ctx) -> void
 * - leaveTownNow(ctx) -> void
 * - returnToWorldFromTown(ctx) -> boolean
 * - returnToWorldIfAtExit(ctx) -> boolean
 *
 * Notes:
 * - This module provides a stable facade so orchestrators can depend on it,
 *   while leaving the heavy logic in core/modes.js.
 */

function handle(name) {
  try {
    if (typeof window !== "undefined" && window.Modes && typeof window.Modes[name] === "function") {
      return window.Modes[name];
    }
  } catch (_) {}
  return null;
}

export function enterTownIfOnTile(ctx) {
  const fn = handle("enterTownIfOnTile");
  return fn ? !!fn(ctx) : false;
}

export function enterDungeonIfOnEntrance(ctx) {
  const fn = handle("enterDungeonIfOnEntrance");
  return fn ? !!fn(ctx) : false;
}

export function enterRuinsIfOnTile(ctx) {
  const fn = handle("enterRuinsIfOnTile");
  return fn ? !!fn(ctx) : false;
}

export function requestLeaveTown(ctx) {
  const fn = handle("requestLeaveTown");
  if (fn) fn(ctx);
}

export function leaveTownNow(ctx) {
  const fn = handle("leaveTownNow");
  if (fn) fn(ctx);
}

export function returnToWorldFromTown(ctx) {
  const fn = handle("returnToWorldFromTown");
  return fn ? !!fn(ctx) : false;
}

export function returnToWorldIfAtExit(ctx) {
  const fn = handle("returnToWorldIfAtExit");
  return fn ? !!fn(ctx) : false;
}

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("ModesTransitions", {
  enterTownIfOnTile,
  enterDungeonIfOnEntrance,
  enterRuinsIfOnTile,
  requestLeaveTown,
  leaveTownNow,
  returnToWorldFromTown,
  returnToWorldIfAtExit
});