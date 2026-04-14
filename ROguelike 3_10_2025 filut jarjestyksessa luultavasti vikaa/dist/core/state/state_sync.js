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
 *   setEncounterBiome(v), setEncounterObjective(v), setEncounterInfo(v),
 *   setShops(v), setTownProps(v), setTownBuildings(v),
 *   setTownPlaza(v), setTavern(v),
 *   setWorldReturnPos(v), setRegion(v), setTownExitAt(v), setDungeonExitAt(v),
 *   setDungeonInfo(v), setFloor(v)
 * }
 */

function nowMs() {
  try {
    if (typeof performance !== "undefined" && performance && typeof performance.now === "function") {
      return performance.now();
    }
  } catch (_) {
    return Date.now();
  }
  return Date.now();
}

function shouldLogStateSyncPerf(dtMs) {
  if (dtMs >= 6) return true;
  try {
    if (typeof window !== "undefined" && window.DEV) return true;
    if (typeof localStorage !== "undefined" && localStorage.getItem("DEV") === "1") return true;
  } catch (_) {
    return false;
  }
  return false;
}

function logStateSyncPerf(details) {
  try {
    if (!shouldLogStateSyncPerf(details.dtMs)) return;
    const LG = (typeof window !== "undefined") ? window.Logger : null;
    const message = `[StateSync] total=${details.dtMs.toFixed(1)}ms local=${details.localMs.toFixed(1)}ms refresh=${details.refreshMs.toFixed(1)}ms mode=${details.mode}`;
    if (LG && typeof LG.log === "function") {
      LG.log(message, "notice", Object.assign({ category: "StateSync", perf: "applyAndRefresh" }, details));
    } else if (typeof console !== "undefined" && typeof console.debug === "function") {
      console.debug(message, details);
    }
  } catch (_) {}
}

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
  try { if (typeof sink.setEncounterInfo === "function") {
    if (Object.prototype.hasOwnProperty.call(ctx, "encounterInfo")) sink.setEncounterInfo(ctx.encounterInfo);
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
  try { if (typeof sink.setTowerRun === "function") sink.setTowerRun(ctx.towerRun); } catch (_) {}
}

export function applyAndRefresh(ctx, sink) {
  const t0 = nowMs();
  let localMs = 0;
  let refreshMs = 0;
  try {
    const t = nowMs();
    applyLocal(ctx, sink);
    localMs = nowMs() - t;
  } catch (_) {}
  // Prefer GameState refresh helper if available
  try {
    if (typeof window !== "undefined" && window.GameState && typeof window.GameState.applySyncAndRefresh === "function") {
      const t = nowMs();
      window.GameState.applySyncAndRefresh(ctx);
      refreshMs = nowMs() - t;
      logStateSyncPerf({
        dtMs: nowMs() - t0,
        localMs,
        refreshMs,
        mode: String((ctx && ctx.mode) || "")
      });
      return;
    }
  } catch (_) {}
  try {
    const t = nowMs();
    if (typeof ctx.updateCamera === "function") ctx.updateCamera();
    if (typeof ctx.recomputeFOV === "function") ctx.recomputeFOV();
    if (typeof ctx.updateUI === "function") ctx.updateUI();
    if (typeof ctx.requestDraw === "function") ctx.requestDraw();
    refreshMs = nowMs() - t;
  } catch (_) {}
  logStateSyncPerf({
    dtMs: nowMs() - t0,
    localMs,
    refreshMs,
    mode: String((ctx && ctx.mode) || "")
  });
}

import { attachGlobal } from "../../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("StateSync", { applyLocal, applyAndRefresh });
