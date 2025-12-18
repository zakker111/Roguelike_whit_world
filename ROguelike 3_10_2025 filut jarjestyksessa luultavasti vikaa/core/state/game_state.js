/**
 * GameState: small helpers for ctx state shape and refresh.
 *
 * Exports (ESM + window.GameState):
 * - ensureVisibilityShape(ctx)
 * - applySyncAndRefresh(ctx)
 * - syncFromCtxWithSink(ctx, sink)
 */
export function ensureVisibilityShape(ctx) {
  if (!ctx || !Array.isArray(ctx.map)) return;
  const rows = ctx.map.length;
  const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;

  function okGrid(grid) {
    try {
      return Array.isArray(grid) && grid.length === rows && (rows === 0 || (Array.isArray(grid[0]) && grid[0].length === cols));
    } catch (_) { return false; }
  }

  if (!okGrid(ctx.visible)) {
    ctx.visible = Array.from({ length: rows }, () => Array(cols).fill(false));
  }
  if (!okGrid(ctx.seen)) {
    ctx.seen = Array.from({ length: rows }, () => Array(cols).fill(false));
  }
}

export function applySyncAndRefresh(ctx) {
  try { if (typeof ctx.updateCamera === "function") ctx.updateCamera(); } catch (_) {}
  try { if (typeof ctx.recomputeFOV === "function") ctx.recomputeFOV(); } catch (_) {}
  try { if (typeof ctx.updateUI === "function") ctx.updateUI(); } catch (_) {}
  try { if (typeof ctx.requestDraw === "function") ctx.requestDraw(); } catch (_) {}
}

/**
 * Synchronize mutated ctx back into a local sink of setter functions.
 * Prefers StateSync.applyLocal(ctx, sink) when available; falls back to
 * direct assignments from ctx into sink.
 */
export function syncFromCtxWithSink(ctx, sink) {
  if (!ctx || !sink) return;

  // Preferred path: delegate to StateSync.applyLocal when available
  try {
    if (typeof window !== "undefined" && window.StateSync && typeof window.StateSync.applyLocal === "function") {
      window.StateSync.applyLocal(ctx, sink);
      return;
    }
  } catch (_) {}

  // Fallback: direct assignments into sink
  try { if (typeof sink.setMode === "function" && typeof ctx.mode !== "undefined") sink.setMode(ctx.mode); } catch (_) {}
  try { if (typeof sink.setMap === "function" && ctx.map) sink.setMap(ctx.map); } catch (_) {}
  try { if (typeof sink.setSeen === "function" && ctx.seen) sink.setSeen(ctx.seen); } catch (_) {}
  try { if (typeof sink.setVisible === "function" && ctx.visible) sink.setVisible(ctx.visible); } catch (_) {}
  try { if (typeof sink.setWorld === "function" && typeof ctx.world !== "undefined") sink.setWorld(ctx.world); } catch (_) {}
  try { if (typeof sink.setEnemies === "function" && Array.isArray(ctx.enemies)) sink.setEnemies(ctx.enemies); } catch (_) {}
  try { if (typeof sink.setCorpses === "function" && Array.isArray(ctx.corpses)) sink.setCorpses(ctx.corpses); } catch (_) {}
  try { if (typeof sink.setDecals === "function" && Array.isArray(ctx.decals)) sink.setDecals(ctx.decals); } catch (_) {}
  try { if (typeof sink.setNpcs === "function" && Array.isArray(ctx.npcs)) sink.setNpcs(ctx.npcs); } catch (_) {}

  try { if (typeof sink.setEncounterProps === "function" && Array.isArray(ctx.encounterProps)) sink.setEncounterProps(ctx.encounterProps); } catch (_) {}
  try { if (typeof sink.setDungeonProps === "function" && Array.isArray(ctx.dungeonProps)) sink.setDungeonProps(ctx.dungeonProps); } catch (_) {}

  try {
    if (typeof sink.setEncounterBiome === "function" && Object.prototype.hasOwnProperty.call(ctx, "encounterBiome")) {
      sink.setEncounterBiome(ctx.encounterBiome);
    }
  } catch (_) {}
  try {
    if (typeof sink.setEncounterObjective === "function" && Object.prototype.hasOwnProperty.call(ctx, "encounterObjective")) {
      sink.setEncounterObjective(ctx.encounterObjective);
    }
  } catch (_) {}

  try { if (typeof sink.setShops === "function" && Array.isArray(ctx.shops)) sink.setShops(ctx.shops); } catch (_) {}
  try { if (typeof sink.setTownProps === "function" && Array.isArray(ctx.townProps)) sink.setTownProps(ctx.townProps); } catch (_) {}
  try { if (typeof sink.setTownBuildings === "function" && Array.isArray(ctx.townBuildings)) sink.setTownBuildings(ctx.townBuildings); } catch (_) {}
  try { if (typeof sink.setTownPlaza === "function" && typeof ctx.townPlaza !== "undefined") sink.setTownPlaza(ctx.townPlaza); } catch (_) {}
  try { if (typeof sink.setTavern === "function" && typeof ctx.tavern !== "undefined") sink.setTavern(ctx.tavern); } catch (_) {}

  // Inn upstairs overlay (optional)
  try {
    if (typeof sink.setInnUpstairs === "function" && Object.prototype.hasOwnProperty.call(ctx, "innUpstairs")) {
      sink.setInnUpstairs(ctx.innUpstairs);
    }
  } catch (_) {}
  try {
    if (typeof sink.setInnUpstairsActive === "function" && Object.prototype.hasOwnProperty.call(ctx, "innUpstairsActive")) {
      sink.setInnUpstairsActive(!!ctx.innUpstairsActive);
    }
  } catch (_) {}
  try {
    if (typeof sink.setInnStairsGround === "function" && Object.prototype.hasOwnProperty.call(ctx, "innStairsGround") && Array.isArray(ctx.innStairsGround)) {
      sink.setInnStairsGround(ctx.innStairsGround);
    }
  } catch (_) {}

  try { if (typeof sink.setWorldReturnPos === "function" && typeof ctx.worldReturnPos !== "undefined") sink.setWorldReturnPos(ctx.worldReturnPos); } catch (_) {}
  try { if (typeof sink.setRegion === "function" && typeof ctx.region !== "undefined") sink.setRegion(ctx.region); } catch (_) {}
  try { if (typeof sink.setTownExitAt === "function" && typeof ctx.townExitAt !== "undefined") sink.setTownExitAt(ctx.townExitAt); } catch (_) {}
  try { if (typeof sink.setDungeonExitAt === "function" && typeof ctx.dungeonExitAt !== "undefined") sink.setDungeonExitAt(ctx.dungeonExitAt); } catch (_) {}
  try { if (typeof sink.setDungeonInfo === "function" && (typeof ctx.dungeon !== "undefined" || typeof ctx.dungeonInfo !== "undefined")) sink.setDungeonInfo(ctx.dungeon || ctx.dungeonInfo); } catch (_) {}
  try { if (typeof sink.setFloor === "function" && typeof ctx.floor === "number") sink.setFloor(ctx.floor | 0); } catch (_) {}
}

import { attachGlobal } from "../../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("GameState", { ensureVisibilityShape, applySyncAndRefresh, syncFromCtxWithSink });