/**
 * Exit: centralized high-level exit-to-overworld orchestration.
 *
 * API (ESM + window.GameExit):
 *   - exitToWorld(ctx, opts?) -> boolean
 *
 * Notes:
 * - This module is ctx-first and does not depend on core/game.js internals.
 * - It delegates mode-specific transitions to core/modes.js helpers and runtime modules.
 */

import { getMod } from "../../utils/access.js";
import {
  returnToWorldFromTown as modesReturnToWorldFromTown,
  returnToWorldIfAtExit as modesReturnToWorldIfAtExit,
  completeEncounter as modesCompleteEncounter,
} from "./modes.js";

/**
 * @typedef {Object} ExitOptions
 * @property {string} [reason]  - optional reason tag ("gate","stairs","regionEdge","encounterWithdraw","api","other")
 * @property {Function} [applyCtxSyncAndRefresh] - optional sync helper from orchestrator
 * @property {Function} [logExitHint] - optional hint logger for failed exits (mainly town/dungeon)
 */

/**
 * Try to exit from the current mode back to the overworld.
 *
 * Returns true if an exit actually happened (mode becomes "world"),
 * false otherwise.
 *
 * @param {any} ctx
 * @param {ExitOptions} [opts]
 */
export function exitToWorld(ctx, opts = {}) {
  if (!ctx || !ctx.world) return false;

  switch (ctx.mode) {
    case "town":
      return exitTownToWorld(ctx, opts);

    case "dungeon":
      return exitDungeonToWorld(ctx, opts);

    case "region":
      return exitRegionToWorld(ctx, opts);

    case "encounter":
      return exitEncounterToWorld(ctx, opts);

    default:
      return false;
  }
}

// --- Town -------------------------------------------------------------------

function exitTownToWorld(ctx, opts) {
  // Reuse Modes.returnToWorldFromTown as the canonical town exit rule.
  // It already implements the inner-perimeter + DOOR heuristic and delegates to TownRuntime.applyLeaveSync.
  const apply = typeof opts.applyCtxSyncAndRefresh === "function" ? opts.applyCtxSyncAndRefresh : undefined;
  const logExitHint = typeof opts.logExitHint === "function" ? opts.logExitHint : undefined;
  return !!modesReturnToWorldFromTown(ctx, apply, logExitHint);
}

// --- Dungeon ----------------------------------------------------------------

function exitDungeonToWorld(ctx, opts) {
  // Delegate to Modes.returnToWorldIfAtExit which in turn prefers DungeonRuntime.returnToWorldIfAtExit.
  // That helper already performs detection (STAIRS tile) and refresh via syncAfterMutation.
  const ok = !!modesReturnToWorldIfAtExit(ctx);
  if (!ok && typeof opts.logExitHint === "function") {
    try { opts.logExitHint(ctx); } catch (_) {}
  }
  return ok;
}

// --- Region Map -------------------------------------------------------------

function exitRegionToWorld(ctx, opts) {
  if (ctx.mode !== "region") return false;
  const RM = ctx.RegionMapRuntime || (typeof window !== "undefined" ? window.RegionMapRuntime : null);
  if (!RM || typeof RM.close !== "function") return false;

  // Only exit when the region cursor is on a designated exit tile (orange edge).
  try {
    const region = ctx.region;
    if (!region || !region.cursor || !Array.isArray(region.exitTiles)) return false;
    const cur = region.cursor;
    const onExit = region.exitTiles.some((e) => e && e.x === cur.x && e.y === cur.y);
    if (!onExit) return false;
  } catch (_) {
    return false;
  }

  const ok = !!RM.close(ctx);
  // RM.close already restores world map, visibility, and calls StateSync.applyAndRefresh when available.
  return ok && ctx.mode === "world";
}

// --- Encounter --------------------------------------------------------------

function exitEncounterToWorld(ctx, opts) {
  if (ctx.mode !== "encounter") return false;

  // Use Modes.completeEncounter with outcome \"withdraw\" so we respect centralized encounter flows.
  const apply = typeof opts.applyCtxSyncAndRefresh === "function" ? opts.applyCtxSyncAndRefresh : undefined;

  const ok = !!modesCompleteEncounter(ctx, "withdraw", apply, opts.helpers || {});
  if (!ok && typeof opts.logExitHint === "function") {
    try { opts.logExitHint(ctx); } catch (_) {}
  }

  // completeEncounter will refresh via syncAfterMutation / applyCtxSyncAndRefresh.
  return ok;
}

import { attachGlobal } from "../../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("GameExit", { exitToWorld });