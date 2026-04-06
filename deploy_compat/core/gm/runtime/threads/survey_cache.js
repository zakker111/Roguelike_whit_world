/* eslint-disable max-lines */
/**
 * Survey Cache thread helpers (gm.threads.surveyCache)
 *
 * GMRuntime-owned logic for:
 * - scan-time/guaranteed marker decisions (no MarkerService dependency)
 * - persistent claim bookkeeping + deterministic rewards
 */

import { hash32 } from "../rng.js";

// ------------------------
// Constants (mirrored from previous GMBridge implementation)
// ------------------------

export const SURVEY_GRID = 44;
export const SURVEY_CHANCE = 0.18; // per-cell, not per-tile
export const SURVEY_MARGIN = 3;

// Salts used for deterministic coordinate hashing (does NOT consume the GM RNG stream).
export const SURVEY_SALT_ANCHOR_X = 0x535801;
export const SURVEY_SALT_ANCHOR_Y = 0x535902;
export const SURVEY_SALT_ROLL = 0x535203;
export const SURVEY_SALT_REWARD = 0x535204;
export const SURVEY_SALT_GUARANTEE = 0x534705;
export const SURVEY_SALT_COOLDOWN = 0x534306;

// ------------------------
// Small deterministic helpers (copied semantics from gm_bridge.js)
// ------------------------

function mulberry32(seed) {
  let a = (seed >>> 0);
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2Float(seed, x, y) {
  // Deterministic 2D hash -> [0,1)
  let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + (seed | 0)) | 0;
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177) | 0;
  n = (n ^ (n >>> 16)) >>> 0;
  return n / 4294967296;
}

function nowTurn(ctx) {
  try {
    if (ctx && ctx.time && typeof ctx.time.turnCounter === "number" && Number.isFinite(ctx.time.turnCounter)) {
      return (ctx.time.turnCounter | 0);
    }
  } catch (_) {}
  return 0;
}

function getWorldAndMap(ctx) {
  const world = ctx && ctx.world ? ctx.world : null;
  const map = Array.isArray(ctx && ctx.map)
    ? ctx.map
    : (world && Array.isArray(world.map) ? world.map : null);
  if (!world || !map || !map.length || !map[0]) return { world: null, map: null };
  return { world, map };
}

function getTilesConst(ctx) {
  try {
    return (ctx && ctx.World && ctx.World.TILES)
      || (typeof window !== "undefined" && window.World && window.World.TILES)
      || null;
  } catch (_) {
    return null;
  }
}

function isDisallowedSurveyTile(tile, T) {
  if (!T) return false;
  return tile === T.WATER
    || tile === T.RIVER
    || tile === T.MOUNTAIN
    || tile === T.TOWN
    || tile === T.DUNGEON
    || (T.CASTLE != null && tile === T.CASTLE)
    || (T.TOWER != null && tile === T.TOWER)
    || tile === T.RUINS;
}

function isWalkable(ctx, world, tile) {
  try {
    const gen = world && world.gen;
    if (gen && typeof gen.isWalkable === "function") {
      return !!gen.isWalkable(tile);
    }
  } catch (_) {}

  try {
    if (typeof window !== "undefined" && window.World && typeof window.World.isWalkable === "function") {
      return !!window.World.isWalkable(tile);
    }
  } catch (_) {}

  // If we can't check, assume walkable (preserves previous behavior in environments
  // where the generator isn't present).
  return true;
}

function getSurveyCacheSpawnConfig(ctx) {
  const DEFAULTS = { boredomMin: 0.6, cooldownMinTurns: 600, cooldownMaxTurns: 900 };
  try {
    const cfg = (typeof window !== "undefined" && window.GameData && window.GameData.config)
      ? window.GameData.config
      : null;

    const s = cfg && cfg.gm && cfg.gm.surveyCache && typeof cfg.gm.surveyCache === "object"
      ? cfg.gm.surveyCache
      : null;

    let boredomMin = s && typeof s.boredomMin === "number" && Number.isFinite(s.boredomMin)
      ? s.boredomMin
      : DEFAULTS.boredomMin;

    let cooldownMinTurns = s && typeof s.cooldownMinTurns === "number" && Number.isFinite(s.cooldownMinTurns)
      ? (s.cooldownMinTurns | 0)
      : DEFAULTS.cooldownMinTurns;

    let cooldownMaxTurns = s && typeof s.cooldownMaxTurns === "number" && Number.isFinite(s.cooldownMaxTurns)
      ? (s.cooldownMaxTurns | 0)
      : DEFAULTS.cooldownMaxTurns;

    if (boredomMin < 0) boredomMin = 0;
    if (boredomMin > 1) boredomMin = 1;

    if (cooldownMinTurns < 0) cooldownMinTurns = 0;
    if (cooldownMaxTurns < cooldownMinTurns) cooldownMaxTurns = cooldownMinTurns;

    return { boredomMin, cooldownMinTurns, cooldownMaxTurns };
  } catch (_) {
    return Object.assign({}, DEFAULTS);
  }
}

function boredomLevel(gm) {
  let b = 0;
  try {
    b = (gm && gm.boredom && typeof gm.boredom.level === "number" && Number.isFinite(gm.boredom.level))
      ? gm.boredom.level
      : 0;
  } catch (_) {}
  if (b < 0) b = 0;
  if (b > 1) b = 1;
  return b;
}

export function surveyCacheCooldownReady(ctx, sc) {
  const turn = nowTurn(ctx);
  const next = (sc && typeof sc.nextSpawnTurn === "number" && Number.isFinite(sc.nextSpawnTurn))
    ? (sc.nextSpawnTurn | 0)
    : 0;
  return turn >= next;
}

export function surveyCacheCanSpawnNow(ctx, gm, sc) {
  const cfg = getSurveyCacheSpawnConfig(ctx);
  if (boredomLevel(gm) < cfg.boredomMin) return false;
  if (!surveyCacheCooldownReady(ctx, sc)) return false;
  return true;
}

export function surveyCacheSetNextSpawnTurn(ctx, gm, sc) {
  const cfg = getSurveyCacheSpawnConfig(ctx);
  const turn = nowTurn(ctx);

  let min = cfg.cooldownMinTurns | 0;
  let max = cfg.cooldownMaxTurns | 0;
  if (min < 0) min = 0;
  if (max < min) max = min;

  const span = Math.max(0, (max - min) | 0);

  let runSeed = 0;
  try {
    runSeed = (gm && typeof gm.runSeed === "number" && Number.isFinite(gm.runSeed))
      ? (gm.runSeed >>> 0)
      : 0;
  } catch (_) {
    runSeed = 0;
  }

  const prev = (sc && typeof sc.nextSpawnTurn === "number" && Number.isFinite(sc.nextSpawnTurn))
    ? (sc.nextSpawnTurn | 0)
    : 0;

  const u = hash32((runSeed ^ SURVEY_SALT_COOLDOWN ^ Math.imul(turn | 0, 0x9e3779b9) ^ (prev | 0)) >>> 0) >>> 0;
  const dt = min + (span ? (u % (span + 1)) : 0);
  sc.nextSpawnTurn = (turn + dt) | 0;
}

export function surveyCacheIsClaimed(sc, instanceId) {
  const claimed = (sc && sc.claimed && typeof sc.claimed === "object") ? sc.claimed : null;
  if (!claimed) return false;
  return Object.prototype.hasOwnProperty.call(claimed, String(instanceId));
}

export function surveyCacheRecordClaim(sc, instanceId, turn) {
  if (!sc || typeof sc !== "object") return;

  if (!sc.claimed || typeof sc.claimed !== "object") sc.claimed = {};
  if (!Array.isArray(sc.claimedOrder)) sc.claimedOrder = [];

  const iid = String(instanceId);
  sc.claimed[iid] = (turn | 0);

  // Dedupe claimedOrder and move newest to front.
  for (let i = sc.claimedOrder.length - 1; i >= 0; i--) {
    if (String(sc.claimedOrder[i] || "") === iid) sc.claimedOrder.splice(i, 1);
  }
  sc.claimedOrder.unshift(iid);

  // Keep bounded; only delete the pruned claimed entry if it no longer exists
  // anywhere else in claimedOrder (defensive against legacy duplicate lists).
  if (sc.claimedOrder.length > 256) {
    const old = String(sc.claimedOrder.pop() || "");
    if (old && !sc.claimedOrder.includes(old)) delete sc.claimed[old];
  }
}

function hasAnySurveyCacheMarker(ctx) {
  try {
    const markers = (ctx && ctx.world && Array.isArray(ctx.world.questMarkers)) ? ctx.world.questMarkers : [];
    return markers.some(m => m && String(m.kind || "") === "gm.surveyCache");
  } catch (_) {
    return false;
  }
}

function hasSurveyCacheMarkerInstance(ctx, instanceId) {
  const iid = String(instanceId);
  try {
    const markers = (ctx && ctx.world && Array.isArray(ctx.world.questMarkers)) ? ctx.world.questMarkers : [];
    return markers.some(m => m && String(m.kind || "") === "gm.surveyCache" && String(m.instanceId || "") === iid);
  } catch (_) {
    return false;
  }
}

function findSurveyCacheMarkerAt(ctx, absX, absY) {
  const x = absX | 0;
  const y = absY | 0;
  try {
    const markers = (ctx && ctx.world && Array.isArray(ctx.world.questMarkers)) ? ctx.world.questMarkers : [];
    return markers.find(m => m && String(m.kind || "") === "gm.surveyCache" && (m.x | 0) === x && (m.y | 0) === y) || null;
  } catch (_) {
    return null;
  }
}

// ------------------------
// World scan spawn
// ------------------------

export function surveyCacheComputeScanSpawn(ctx, gm, sc, { x0, y0, w, h } = {}) {
  if (!ctx || !gm || !sc) return [];
  if (!surveyCacheCanSpawnNow(ctx, gm, sc)) return [];

  const { world, map } = getWorldAndMap(ctx);
  if (!world || !map) return [];

  const ox = (typeof world.originX === "number") ? (world.originX | 0) : 0;
  const oy = (typeof world.originY === "number") ? (world.originY | 0) : 0;

  const lx0 = (typeof x0 === "number" && Number.isFinite(x0)) ? (x0 | 0) : 0;
  const ly0 = (typeof y0 === "number" && Number.isFinite(y0)) ? (y0 | 0) : 0;
  const lw = (typeof w === "number" && Number.isFinite(w)) ? (w | 0) : 0;
  const lh = (typeof h === "number" && Number.isFinite(h)) ? (h | 0) : 0;
  if (lw <= 0 || lh <= 0) return [];

  const absX0 = (ox + lx0) | 0;
  const absY0 = (oy + ly0) | 0;
  const absX1 = (absX0 + lw - 1) | 0;
  const absY1 = (absY0 + lh - 1) | 0;

  const cellX0 = Math.floor(absX0 / SURVEY_GRID);
  const cellY0 = Math.floor(absY0 / SURVEY_GRID);
  const cellX1 = Math.floor(absX1 / SURVEY_GRID);
  const cellY1 = Math.floor(absY1 / SURVEY_GRID);

  const seed = (typeof gm.runSeed === "number" && Number.isFinite(gm.runSeed)) ? (gm.runSeed >>> 0) : 0;
  const inner = Math.max(1, SURVEY_GRID - SURVEY_MARGIN * 2);

  const T = getTilesConst(ctx);

  for (let cy = cellY0; cy <= cellY1; cy++) {
    for (let cx = cellX0; cx <= cellX1; cx++) {
      const baseX = cx * SURVEY_GRID;
      const baseY = cy * SURVEY_GRID;
      const offX = SURVEY_MARGIN + Math.floor(hash2Float((seed ^ SURVEY_SALT_ANCHOR_X) >>> 0, cx, cy) * inner);
      const offY = SURVEY_MARGIN + Math.floor(hash2Float((seed ^ SURVEY_SALT_ANCHOR_Y) >>> 0, cx, cy) * inner);
      const anchorX = (baseX + offX) | 0;
      const anchorY = (baseY + offY) | 0;

      if (anchorX < absX0 || anchorY < absY0 || anchorX > absX1 || anchorY > absY1) continue;

      const lx = (anchorX - ox) | 0;
      const ly = (anchorY - oy) | 0;
      if (ly < 0 || lx < 0 || ly >= map.length || lx >= (map[0] ? map[0].length : 0)) continue;

      const tile = map[ly] ? map[ly][lx] : null;
      if (tile == null) continue;
      if (T && isDisallowedSurveyTile(tile, T)) continue;

      const roll = hash2Float((seed ^ SURVEY_SALT_ROLL) >>> 0, cx, cy);
      if (roll >= SURVEY_CHANCE) continue;

      if (!isWalkable(ctx, world, tile)) continue;

      const instanceId = `surveyCache:${anchorX | 0},${anchorY | 0}`;
      if (surveyCacheIsClaimed(sc, instanceId)) continue;
      if (hasSurveyCacheMarkerInstance(ctx, instanceId)) continue;

      return [{
        x: (anchorX | 0),
        y: (anchorY | 0),
        kind: "gm.surveyCache",
        glyph: "?",
        paletteKey: "gmMarker",
        instanceId,
      }];
    }
  }

  return [];
}

// ------------------------
// Guarantee spawn
// ------------------------

export function surveyCacheComputeGuaranteedSpawn(ctx, gm, sc) {
  if (!ctx || !gm || !sc) return null;

  if (!surveyCacheCanSpawnNow(ctx, gm, sc)) return null;

  // If we already have a Survey Cache marker in this run/window, do nothing.
  if (hasAnySurveyCacheMarker(ctx)) return null;

  const { world: w, map } = getWorldAndMap(ctx);
  if (!w || !map) return null;

  const ox = (typeof w.originX === "number") ? (w.originX | 0) : 0;
  const oy = (typeof w.originY === "number") ? (w.originY | 0) : 0;
  const H = map.length | 0;
  const W = map[0].length | 0;

  const px = (ctx.player && typeof ctx.player.x === "number") ? (ctx.player.x | 0) : 0;
  const py = (ctx.player && typeof ctx.player.y === "number") ? (ctx.player.y | 0) : 0;
  const pAbsX = ox + px;
  const pAbsY = oy + py;

  const seed = (typeof gm.runSeed === "number" && Number.isFinite(gm.runSeed)) ? (gm.runSeed >>> 0) : 0;
  const rng = mulberry32(hash32((seed ^ SURVEY_SALT_GUARANTEE ^ 0x9e3779b9) >>> 0));

  const T = getTilesConst(ctx);

  let picked = null;
  for (let n = 0; n < 80; n++) {
    const r = 14 + Math.floor(rng() * 22); // 14..35
    const ang = rng() * Math.PI * 2;
    const dx = Math.round(Math.cos(ang) * r);
    const dy = Math.round(Math.sin(ang) * r);
    const absX = (pAbsX + dx) | 0;
    const absY = (pAbsY + dy) | 0;
    const lx = absX - ox;
    const ly = absY - oy;
    if (lx < 0 || ly < 0 || lx >= W || ly >= H) continue;

    const tile = map[ly] ? map[ly][lx] : null;
    if (tile == null) continue;
    if (T && isDisallowedSurveyTile(tile, T)) continue;
    if (!isWalkable(ctx, w, tile)) continue;

    const instanceId = `surveyCache:${absX},${absY}`;
    if (surveyCacheIsClaimed(sc, instanceId)) continue;
    if (hasSurveyCacheMarkerInstance(ctx, instanceId)) continue;

    picked = { absX, absY, instanceId };
    break;
  }

  if (!picked) {
    picked = { absX: pAbsX, absY: pAbsY, instanceId: `surveyCache:${pAbsX},${pAbsY}` };
  }

  return {
    x: picked.absX,
    y: picked.absY,
    kind: "gm.surveyCache",
    glyph: "?",
    paletteKey: "gmMarker",
    instanceId: picked.instanceId,
  };
}

// ------------------------
// Encounter lifecycle + reward
// ------------------------

export function surveyCacheDeriveInstanceFromWorldReturn(ctx, worldReturnPos) {
  try {
    const pos = worldReturnPos || (ctx ? ctx.worldReturnPos : null) || null;
    if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
      const absX = pos.x | 0;
      const absY = pos.y | 0;
      let instanceId = `surveyCache:${absX},${absY}`;

      const m = findSurveyCacheMarkerAt(ctx, absX, absY);
      if (m && m.instanceId != null) instanceId = String(m.instanceId);

      return { instanceId, absX, absY };
    }
  } catch (_) {}
  return { instanceId: null, absX: null, absY: null };
}

export function surveyCacheMakeReward(ctx, gm, absX, absY) {
  const runSeed = (typeof gm.runSeed === "number" && Number.isFinite(gm.runSeed)) ? (gm.runSeed >>> 0) : 0;
  const seed = hash32((runSeed ^ SURVEY_SALT_REWARD ^ Math.imul(absX | 0, 374761393) ^ Math.imul(absY | 0, 668265263)) >>> 0);
  const rng = mulberry32(seed);

  // Rewards: gold 40..70 + tier-2 equipment + 8% fine lockpick.
  const gold = 40 + Math.floor(rng() * 31);
  const reward = { grants: [{ kind: "gold", amount: gold }] };

  try {
    const Items = (typeof window !== "undefined" ? window.Items : null) || (ctx && ctx.Items ? ctx.Items : null);
    if (Items && typeof Items.createEquipment === "function") {
      const it = Items.createEquipment(2, () => rng());
      if (it) reward.grants.push({ kind: "item", item: it });
    } else {
      reward.grants.push({ kind: "item", item: { kind: "equip", slot: "hand", name: "iron gear", tier: 2, atk: 0, def: 0, decay: 0 } });
    }
  } catch (_) {
    reward.grants.push({ kind: "item", item: { kind: "equip", slot: "hand", name: "iron gear", tier: 2, atk: 0, def: 0, decay: 0 } });
  }

  if (rng() < 0.08) {
    reward.grants.push({ kind: "tool", tool: { kind: "tool", type: "lockpick_fine", name: "fine lockpick", decay: 0 } });
  }

  return reward;
}

export function surveyCacheOnEncounterStart(gm, sc, { instanceId, absX, absY } = {}, ctx) {
  const iid = instanceId != null ? String(instanceId) : "";
  const x = (typeof absX === "number" && Number.isFinite(absX)) ? (absX | 0) : null;
  const y = (typeof absY === "number" && Number.isFinite(absY)) ? (absY | 0) : null;
  if (!iid || x == null || y == null) return null;

  try {
    sc.active = { instanceId: iid, absX: x, absY: y };
    if (!sc.attempts || typeof sc.attempts !== "object") sc.attempts = {};
    sc.attempts[iid] = ((sc.attempts[iid] | 0) + 1);

    // Consume immediately so fleeing/withdrawing cannot re-enter the same cache.
    surveyCacheRecordClaim(sc, iid, nowTurn(ctx));
  } catch (_) {}

  return { instanceId: iid, absX: x, absY: y };
}

export function surveyCacheOnEncounterComplete(gm, sc, { outcome, worldReturnPos } = {}, ctx) {
  const out = outcome ? String(outcome).trim().toLowerCase() : "";

  // Prefer active marker reference, fallback to worldReturnPos.
  let instanceId = null;
  let absX = null;
  let absY = null;

  try {
    if (sc.active && typeof sc.active === "object") {
      instanceId = sc.active.instanceId != null ? String(sc.active.instanceId) : null;
      absX = (typeof sc.active.absX === "number" && Number.isFinite(sc.active.absX)) ? (sc.active.absX | 0) : null;
      absY = (typeof sc.active.absY === "number" && Number.isFinite(sc.active.absY)) ? (sc.active.absY | 0) : null;
    }
  } catch (_) {}

  if (!instanceId || absX == null || absY == null) {
    const d = surveyCacheDeriveInstanceFromWorldReturn(ctx, worldReturnPos);
    instanceId = d.instanceId;
    absX = d.absX;
    absY = d.absY;
  }

  if (!instanceId || absX == null || absY == null) return null;

  // Record the cache as exhausted/claimed so deterministic scan-time spawns do not respawn it.
  try {
    surveyCacheRecordClaim(sc, instanceId, nowTurn(ctx));
  } catch (_) {}

  // Clear active regardless.
  try {
    sc.active = null;
  } catch (_) {}

  if (out !== "victory") {
    return { outcome: out, instanceId, absX, absY, reward: null };
  }

  const reward = surveyCacheMakeReward(ctx, gm, absX, absY);
  return { outcome: out, instanceId, absX, absY, reward };
}

