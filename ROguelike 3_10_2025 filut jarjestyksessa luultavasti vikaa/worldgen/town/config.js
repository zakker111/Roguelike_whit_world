/**
 * Town config helpers
 * --------------------
 * Pure helpers for reading town layout/population configuration from
 * GameData.town. These functions are side‑effect free and are consumed
 * by worldgen/town_gen.js and related modules.
 */

/**
 * Read town-building configuration from GameData.town and town size/kind.
 * Provides maxBuildings, block dimensions, residential fill target and minimum
 * buildings near plaza, with safe defaults matching previous behavior when
 * JSON fields are missing.
 */
export function getTownBuildingConfig(TOWNCFG, townSize, townKind) {
  const bCfg = (TOWNCFG && TOWNCFG.buildings) || {};
  const maxBySize = bCfg.maxBySize || null;
  const blockBySize = bCfg.block || null;
  const fillTargets = bCfg.residentialFillTargets || null;
  const minNearPlaza = bCfg.minNearPlaza || null;

  const sizeKey = townSize;
  const kindCfg = (TOWNCFG && TOWNCFG.kinds && TOWNCFG.kinds[townKind]) || {};
  const kindBuild = kindCfg.buildings || {};
  const densityMul = typeof kindBuild.densityMultiplier === "number" ? kindBuild.densityMultiplier : 1.0;
  const minNearBonus = kindBuild.minNearPlazaBonus | 0;

  function fromSize(map, fallback) {
    if (map && Object.prototype.hasOwnProperty.call(map, sizeKey)) {
      return map[sizeKey];
    }
    return fallback;
  }

  const baseMax = (maxBySize && fromSize(maxBySize, null)) || (bCfg.max | 0) || 18;
  const maxBuildings = Math.max(1, Math.round(baseMax * densityMul));

  const blockBase = fromSize(blockBySize, null);
  const blockW = Math.max(4, blockBase ? (blockBase.blockW | 0) : ((bCfg.blockW | 0) || 8));
  const blockH = Math.max(3, blockBase ? (blockBase.blockH | 0) : ((bCfg.blockH | 0) || 6));

  const baseFill = (fillTargets && fromSize(fillTargets, null)) || null;
  const residentialFillTarget = baseFill != null
    ? Math.max(1, Math.round(baseFill * densityMul))
    : (townSize === "small" ? 12 : (townSize === "city" ? 34 : 22));

  const baseMin = (minNearPlaza && fromSize(minNearPlaza, null)) || null;
  const minBuildingsNearPlaza = (baseMin != null
    ? baseMin
    : (townSize === "small" ? 10 : (townSize === "city" ? 24 : 16))) + minNearBonus;

  return {
    maxBuildings,
    blockW,
    blockH,
    residentialFillTarget,
    minBuildingsNearPlaza
  };
}

/**
 * Read inn size configuration from GameData.town (inn.size[size]) with
 * safe fallbacks to previous hardcoded behavior when JSON fields are missing.
 */
export function getInnSizeConfig(TOWNCFG, townSize) {
  const sizeKey = townSize;
  const innRoot = (TOWNCFG && TOWNCFG.inn && TOWNCFG.inn.size) || null;
  const cfg = (innRoot && innRoot[sizeKey]) || null;
  if (cfg && typeof cfg.minW === "number" && typeof cfg.minH === "number" &&
      typeof cfg.scaleW === "number" && typeof cfg.scaleH === "number") {
    return {
      minW: cfg.minW | 0,
      minH: cfg.minH | 0,
      scaleW: cfg.scaleW,
      scaleH: cfg.scaleH
    };
  }
  // Fallback to previous constants
  let minW = 18, minH = 12, scaleW = 1.20, scaleH = 1.10; // defaults for "big"
  if (sizeKey === "small") { minW = 14; minH = 10; scaleW = 1.15; scaleH = 1.08; }
  else if (sizeKey === "city") { minW = 24; minH = 16; scaleW = 1.35; scaleH = 1.25; }
  return { minW, minH, scaleW, scaleH };
}

/**
 * Read castle keep size configuration from GameData.town (castle.keep.size[size])
 * and compute keepW/keepH from plaza dimensions with clamping, matching previous
 * behavior when JSON fields are missing.
 */
export function getCastleKeepSizeConfig(TOWNCFG, townSize, plazaW, plazaH, mapW, mapH) {
  const sizeKey = townSize;
  const keepRoot = (TOWNCFG && TOWNCFG.castle && TOWNCFG.castle.keep && TOWNCFG.castle.keep.size) || null;
  const cfg = (keepRoot && keepRoot[sizeKey]) || null;
  let minW, minH, scaleW, scaleH;
  if (cfg && typeof cfg.scaleW === "number" && typeof cfg.scaleH === "number") {
    minW = (cfg.minW | 0) || 0;
    minH = (cfg.minH | 0) || 0;
    scaleW = cfg.scaleW;
    scaleH = cfg.scaleH;
  } else {
    // Fallback to previous constants
    minW = 14; minH = 12; scaleW = 0.9; scaleH = 0.9;
    if (sizeKey === "small") { minW = 12; minH = 10; scaleW = 0.8; scaleH = 0.8; }
    else if (sizeKey === "city") { minW = 18; minH = 14; scaleW = 1.1; scaleH = 1.1; }
  }
  let keepW = Math.max(minW, Math.floor(plazaW * scaleW));
  let keepH = Math.max(minH, Math.floor(plazaH * scaleH));
  // Clamp to map with a safety margin from outer walls, as before
  keepW = Math.min(keepW, mapW - 6);
  keepH = Math.min(keepH, mapH - 6);
  return { keepW, keepH };
}

/**
 * Read population configuration (roamers/guards) from GameData.town and compute
 * roamTarget and guardTarget based on building count, town size, and kind.
 * Falls back to previous hardcoded behavior when JSON fields are missing.
 */
export function getTownPopulationTargets(TOWNCFG, townSize, townKind, buildingCount) {
  const pop = (TOWNCFG && TOWNCFG.population) || {};
  const sizeKey = townSize;

  // Roamers: derive from per-building factor with clamping, defaulting to previous formula.
  const roamPerBySize = (pop && pop.roamersPerBuilding) || null;
  const roamPer = (roamPerBySize && typeof roamPerBySize[sizeKey] === "number")
    ? roamPerBySize[sizeKey]
    : 0.5; // previous behavior: tbCount / 2
  const roamMin = (typeof pop.roamersMin === "number") ? pop.roamersMin : 6;
  const roamMax = (typeof pop.roamersMax === "number") ? pop.roamersMax : 14;

  const rawRoam = buildingCount * roamPer;
  let roamTargetBase = Math.floor(rawRoam);
  if (!Number.isFinite(roamTargetBase)) roamTargetBase = Math.floor(buildingCount / 2) || 0;
  let roamTarget = roamTargetBase;
  if (roamTarget < roamMin) roamTarget = roamMin;
  if (roamTarget > roamMax) roamTarget = roamMax;

  // Guards: base per size with castle bonus, then clamp to roamTarget.
  const baseBySize = (pop && pop.guardsBaseBySize) || null;
  let guardBase = 0;
  if (baseBySize && typeof baseBySize[sizeKey] === "number") {
    guardBase = baseBySize[sizeKey] | 0;
  } else {
    // previous behavior
    if (sizeKey === "small") guardBase = 2;
    else if (sizeKey === "city") guardBase = 4;
    else guardBase = 3;
  }
  const castleBonus = (typeof pop.guardsCastleBonus === "number") ? pop.guardsCastleBonus | 0 : 2;
  if (townKind === "castle") guardBase += castleBonus;
  let guardTarget = guardBase;
  if (guardTarget > roamTarget) guardTarget = roamTarget;
  if (guardTarget < 0) guardTarget = 0;

  return { roamTarget, guardTarget };
}