/**
 * ModesTransitions: thin ctx-first wrappers around core/modes.js transitions.
 *
 * Exports (ESM + window.ModesTransitions):
 * - enterTownIfOnTile(ctx) -> boolean
 * - enterDungeonIfOnEntrance(ctx) -> boolean
 * - enterRuinsIfOnTile(ctx) -> boolean
 * - enterEncounter(ctx, template, biome, difficulty, applyCtxSyncAndRefresh?) -> boolean
 * - openRegionMap(ctx, applyCtxSyncAndRefresh?) -> boolean
 * - startRegionEncounter(ctx, template, biome, applyCtxSyncAndRefresh?) -> boolean
 * - completeEncounter(ctx, outcome, applyCtxSyncAndRefresh?, helpers?) -> boolean
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

export function enterEncounter(ctx, template, biome, difficulty, applyCtxSyncAndRefresh) {
  const fn = handle("enterEncounter");
  return fn ? !!fn(ctx, template, biome, difficulty, applyCtxSyncAndRefresh) : false;
}

export function openRegionMap(ctx, applyCtxSyncAndRefresh) {
  const fn = handle("openRegionMap");
  return fn ? !!fn(ctx, applyCtxSyncAndRefresh) : false;
}

export function startRegionEncounter(ctx, template, biome, applyCtxSyncAndRefresh) {
  const fn = handle("startRegionEncounter");
  return fn ? !!fn(ctx, template, biome, applyCtxSyncAndRefresh) : false;
}

export function completeEncounter(ctx, outcome, applyCtxSyncAndRefresh, helpers) {
  const fn = handle("completeEncounter");
  return fn ? !!fn(ctx, outcome, applyCtxSyncAndRefresh, helpers) : false;
}

export function requestLeaveTown(ctx) {
  const fn = handle("requestLeaveTown");
  if (fn) fn(ctx);
}

export function leaveTownNow(ctx) {
  const fn = handle("leaveTownNow");
  if (fn) fn(ctx);
}

export function returnToWorldFromTown(ctx, applyCtxSyncAndRefresh, logExitHint) {
  const fn = handle("returnToWorldFromTown");
  return fn ? !!fn(ctx, applyCtxSyncAndRefresh, logExitHint) : false;
}

export function returnToWorldIfAtExit(ctx) {
  const fn = handle("returnToWorldIfAtExit");
  return fn ? !!fn(ctx) : false;
}

import { attachGlobal } from "../../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("ModesTransitions", {
  enterTownIfOnTile,
  enterDungeonIfOnEntrance,
  enterRuinsIfOnTile,
  enterEncounter,
  openRegionMap,
  startRegionEncounter,
  completeEncounter,
  requestLeaveTown,
  leaveTownNow,
  returnToWorldFromTown,
  returnToWorldIfAtExit
});