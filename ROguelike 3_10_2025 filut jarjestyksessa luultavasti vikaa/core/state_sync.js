/**
 * StateSync: helpers to synchronize ctx mutations back to a local orchestrator sink
 *            and refresh visuals afterwards.
 *
 * Exports (ESM + window.StateSync):
 * - applyLocal(ctx, sink)
 * - applyAndRefresh(ctx, sink)
 *
 * The sink is an object of setter functions:
 * {
 *   setMode(v), setMap(v), setSeen(v), setVisible(v), setWorld(v),
 *   setEnemies(v), setCorpses(v), setDecals(v), setNpcs(v),
 *   setEncounterProps(v), setDungeonProps(v),
 *   setEncounterBiome(v), setEncounterObjective(v),
 *   setShops(v), setTownProps(v), setTownBuildings(v),
 *   setTownPlaza(v), setTavern(v),
 *   setWorldReturnPos(v), setRegion(v), setTownExitAt(v), setDungeonExitAt(v),
 *   setDungeonInfo(v), setFloor(v)
 * }
 */

export function applyLocal(ctx, sink) {
  if (!ctx || !sink) return;
  try { if (typeof sink.setMode === "function") sink.setMode(ctx.mode); } catch (_) {}
  try { if (typeof sink.setMap === "function") sink.setMap(ctx.map); } catch (_) {}
  try { if (typeof sink.setSeen === "function") sink.setSeen(ctx.seen); } catch (_) {}
  try { if (typeof sink.setVisible === "function") sink.setVisible(ctx.visible); } catch (_) {}
  try { if (typeof sink.setWorld === "function") sink.setWorld(ctx.world); } catch (_) {}
  try { if (typeof sink.setEnemies === "function") sink.setEnemies(ctx.enemies); } catch (_) {}
  try { if (typeof sink.setCorpses === "function") sink.setCorpses(ctx.corpses); } catch (_) {}
  try { if (typeof sink.setDecals === "function") sink.setDecals(ctx.decals); } catch (_) {}
  try { if (typeof sink.setNpcs === "function") sink.setNpcs(ctx.npcs); } catch (_) {}
  try { if (typeof sink.setEncounterProps === "function") sink.setEncounterProps(ctx.encounterProps); } catch (_) {}
  try { if (typeof sink.setDungeonProps === "function") sink.setDungeonProps(ctx.dungeonProps); } catch (_) {}
  try { if (typeof sink.setEncounterBiome === "function") {
    if (Object.prototype.hasOwnProperty.call(ctx, "encounterBiome")) sink.setEncounterBiome(ctx.encounterBiome);
  } } catch (_) {}
  try { if (typeof sink.setEncounterObjective === "function") {
    if (Object.prototype.hasOwnProperty.call(ctx, "encounterObjective")) sink.setEncounterObjective(ctx.encounterObjective);
  } } catch (_) {}
  try { if (typeof sink.setShops === "function") sink.setShops(ctx.shops); } catch (_) {}
  try { if (typeof sink.setTownProps === "function") sink.setTownProps(ctx.townProps); } catch (_) {}
  try { if (typeof sink.setTownBuildings === "function") sink.setTownBuildings(ctx.townBuildings); } catch (_) {}
  try { if (typeof sink.setTownPlaza === "function") sink.setTownPlaza(ctx.townPlaza); } catch (_) {}
  try { if (typeof sink.setTavern === "function") sink.setTavern(ctx.tavern); } catch (_) {}
  // Inn upstairs overlay (optional fields)
  try { if (typeof sink.setInnUpstairs === "function") sink.setInnUpstairs(ctx.innUpstairs); } catch (_) {}
  try { if (typeof sink.setInnUpstairsActive === "function") sink.setInnUpstairsActive(!!ctx.innUpstairsActive); } catch (_) {}
  try { if (typeof sink.setInnStairsGround === "function") sink.setInnStairsGround(Array.isArray(ctx.innStairsGround) ? ctx.innStairsGround : []); } catch (_) {}
  try { if (typeof sink.setWorldReturnPos === "function") sink.setWorldReturnPos(ctx.worldReturnPos); } catch (_) {}
  try { if (typeof sink.setRegion === "function") sink.setRegion(ctx.region); } catch (_) {}
  try { if (typeof sink.setTownExitAt === "function") sink.setTownExitAt(ctx.townExitAt); } catch (_) {}
  try { if (typeof sink.setDungeonExitAt === "function") sink.setDungeonExitAt(ctx.dungeonExitAt); } catch (_) {}
  try { if (typeof sink.setDungeonInfo === "function") sink.setDungeonInfo(ctx.dungeon || ctx.dungeonInfo); } catch (_) {}
  try { if (typeof sink.setFloor === "function" && typeof ctx.floor === "number") sink.setFloor(ctx.floor | 0); } catch (_) {}
}

export function applyAndRefresh(ctx, sink) {
  applyLocal(ctx, sink);
  // Prefer GameState refresh helper if available
  try {
    if (typeof window !== "undefined" && window.GameState && typeof window.GameState.applySyncAndRefresh === "function") {
      window.GameState.applySyncAndRefresh(ctx);
      return;
    }
  } catch (_) {}
  try { if (typeof ctx.updateCamera === "function") ctx.updateCamera(); } catch (_) {}
  try { if (typeof ctx.recomputeFOV === "function") ctx.recomputeFOV(); } catch (_) {}
  try { if (typeof ctx.updateUI === "function") ctx.updateUI(); } catch (_) {}
  try { if (typeof ctx.requestDraw === "function") ctx.requestDraw(); } catch (_) {}
}

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("StateSync", { applyLocal, applyAndRefresh });