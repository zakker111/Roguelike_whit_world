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

import {
  returnToWorldFromTown as modesReturnToWorldFromTown,
  returnToWorldIfAtExit as modesReturnToWorldIfAtExit,
  completeEncounter as modesCompleteEncounter,
} from "./modes.js";

/**
 * @typedef {Object} ExitOptions
 * @property {string}   [reason]                 - optional reason tag ("gate","stairs","regionEdge","encounterWithdraw","api","other")
 * @property {Function} [applyCtxSyncAndRefresh] - optional sync helper from orchestrator
 * @property {Function} [logExitHint]            - optional hint logger for failed exits (mainly town/dungeon)
 * @property {Object}   [helpers]                - optional helpers bag forwarded to Modes.completeEncounter (e.g., escort auto-travel)
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

/**
 * Detection helpers
 * These functions centralize exit detection rules for orchestrated flows.
 * Mode runtimes remain responsible for applying the transition once exit
 * has been decided.
 */

// Town: inner-perimeter tile adjacent to a boundary DOOR
export function isAtTownGate(ctx) {
  try {
    if (!ctx || ctx.mode !== "town") return false;
    const map = ctx.map;
    const rows = Array.isArray(map) ? map.length : 0;
    const cols = rows && Array.isArray(map[0]) ? map[0].length : 0;
    if (!rows || !cols || !ctx.player || !ctx.TILES) return false;
    const px = ctx.player.x | 0;
    const py = ctx.player.y | 0;
    const T = ctx.TILES;

    const onInnerPerimeter =
      px === 1 || py === 1 || px === cols - 2 || py === rows - 2;
    if (!onInnerPerimeter) return false;

    const dirs = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];
    for (let i = 0; i < dirs.length; i++) {
      const nx = px + dirs[i].dx;
      const ny = py + dirs[i].dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const isBoundary =
        nx === 0 || ny === 0 || nx === cols - 1 || ny === rows - 1;
      if (!isBoundary) continue;
      if (map[ny][nx] === T.DOOR) return true;
    }
  } catch (_) {}
  return false;
}

// Dungeon: standing on a STAIRS tile in dungeon mode
export function isAtDungeonExit(ctx) {
  try {
    if (!ctx || ctx.mode !== "dungeon" || !ctx.map || !ctx.TILES || !ctx.player) return false;
    const px = ctx.player.x | 0;
    const py = ctx.player.y | 0;

    try {
      if (typeof ctx.inBounds === "function" && !ctx.inBounds(px, py)) return false;
    } catch (_) {}

    const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
    const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
    if (px < 0 || py < 0 || px >= cols || py >= rows) return false;
    return ctx.map[py][px] === ctx.TILES.STAIRS;
  } catch (_) {}
  return false;
}

// Region: cursor on one of region.exitTiles
export function isAtRegionEdgeExit(ctx) {
  try {
    if (!ctx || ctx.mode !== "region") return false;
    const region = ctx.region;
    if (!region || !region.cursor || !Array.isArray(region.exitTiles)) return false;
    const cur = region.cursor;
    return region.exitTiles.some((e) => e && e.x === cur.x && e.y === cur.y);
  } catch (_) {}
  return false;
}

// Encounter: standing on STAIRS in encounter map
export function isAtEncounterExit(ctx) {
  try {
    if (!ctx || ctx.mode !== "encounter" || !ctx.map || !ctx.TILES || !ctx.player) return false;
    const px = ctx.player.x | 0;
    const py = ctx.player.y | 0;
    const row = ctx.map[py];
    if (!row) return false;
    return row[px] === ctx.TILES.STAIRS;
  } catch (_) {}
  return false;
}

// --- Town -------------------------------------------------------------------

function exitTownToWorld(ctx, opts) {
  const atGate = isAtTownGate(ctx);
  const apply = typeof opts.applyCtxSyncAndRefresh === "function" ? opts.applyCtxSyncAndRefresh : undefined;

  if (!atGate) {
    if (typeof opts.logExitHint === "function") {
      try { opts.logExitHint(ctx); } catch (_) {}
    }
    return false;
  }

  // We already validated gate position; call Modes.returnToWorldFromTown without a hint
  // callback so logging remains in this orchestrator.
  return !!modesReturnToWorldFromTown(ctx, apply, undefined);
}

// --- Dungeon ----------------------------------------------------------------

function exitDungeonToWorld(ctx, opts) {
  const atExit = isAtDungeonExit(ctx);
  if (!atExit) {
    if (typeof opts.logExitHint === "function") {
      try { opts.logExitHint(ctx); } catch (_) {}
    }
    return false;
  }

  const ok = !!modesReturnToWorldIfAtExit(ctx);
  if (!ok && typeof opts.logExitHint === "function") {
    try { opts.logExitHint(ctx); } catch (_) {}
  }
  return ok;
}

// --- Region Map -------------------------------------------------------------

function exitRegionToWorld(ctx, opts) {
  if (!isAtRegionEdgeExit(ctx)) return false;
  const RM = ctx.RegionMapRuntime || (typeof window !== "undefined" ? window.RegionMapRuntime : null);
  if (!RM || typeof RM.close !== "function") return false;

  const ok = !!RM.close(ctx);
  // RM.close already restores world map, visibility, and calls StateSync.applyAndRefresh when available.
  return ok && ctx.mode === "world";
}

// --- Encounter --------------------------------------------------------------

function exitEncounterToWorld(ctx, opts) {
  if (!isAtEncounterExit(ctx)) {
    if (typeof opts.logExitHint === "function") {
      try { opts.logExitHint(ctx); } catch (_) {}
    }
    return false;
  }

  // Use Modes.completeEncounter with outcome "withdraw" so we respect centralized encounter flows.
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