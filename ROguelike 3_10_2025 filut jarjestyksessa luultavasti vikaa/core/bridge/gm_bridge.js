/**
 * GMBridge: central wrapper for GMRuntime-driven side effects.
 *
 * Exports (ESM + window.GMBridge):
 * - maybeHandleWorldStep(ctx): boolean
 * - handleMarkerAction(ctx): boolean
 * - useInventoryItem(ctx, item, idx): boolean
 * - onEncounterComplete(ctx, { encounterId, outcome }): void
 * - onWorldScanRect(ctx, { x0, y0, w, h }): void   // procedural gm.* marker spawns (scan-time)
 * - onWorldScanTile(ctx, { wx, wy, tile }): void   // backwards-compatible 1-tile scan hook
 * - ensureGuaranteedSurveyCache(ctx): void          // hybrid guarantee spawn
 */

import { getGameData, getMod } from "../../utils/access.js";
import { attachGlobal } from "../../utils/global.js";
import { gmRngFloat, hash32 } from "../gm/runtime/rng.js";

// ------------------------
// Survey Cache (gm.surveyCache): hybrid gm.* marker thread
// ------------------------

const SURVEY_GRID = 44;
const SURVEY_CHANCE = 0.18; // per-cell, not per-tile
const SURVEY_MARGIN = 3;

// Salts used for deterministic coordinate hashing (does NOT consume the GM RNG stream).
const SURVEY_SALT_ANCHOR_X = 0x53_58_01;
const SURVEY_SALT_ANCHOR_Y = 0x53_59_02;
const SURVEY_SALT_ROLL = 0x53_52_03;
const SURVEY_SALT_REWARD = 0x53_52_04;
const SURVEY_SALT_GUARANTEE = 0x53_47_05;

// Minimal fallback encounter templates used when JSON registries haven't loaded.
// These should match data/encounters/encounters.json so gameplay stays consistent.
const FALLBACK_GM_ENCOUNTER_TEMPLATES = {
  gm_bottle_map_scene: {
    id: "gm_bottle_map_scene",
    name: "GM: Bottle Map Cache",
    baseWeight: 0.0,
    allowedBiomes: ["FOREST", "GRASS", "DESERT", "SNOW", "BEACH", "MOUNTAIN", "SWAMP"],
    map: { generator: "ruins", w: 26, h: 18 },
    objective: { type: "clearAll" },
    groups: [
      { type: "bandit", count: { min: 3, max: 5 }, faction: "bandit" }
    ]
  },
  gm_survey_cache_scene: {
    id: "gm_survey_cache_scene",
    name: "GM: Surveyor's Cache",
    baseWeight: 0.0,
    allowedBiomes: ["FOREST", "GRASS", "DESERT", "SNOW", "BEACH", "MOUNTAIN", "SWAMP"],
    map: { generator: "ruins", w: 26, h: 18 },
    objective: { type: "clearAll" },
    groups: [
      { type: "bandit", count: { min: 3, max: 6 }, faction: "bandit" }
    ]
  },
};

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

function isGmEnabled(ctx) {
  try {
    const gm = (ctx && ctx.gm && typeof ctx.gm === "object") ? ctx.gm : null;
    if (gm) return !(gm.enabled === false);
  } catch (_) {}

  try {
    const GM = getMod(ctx, "GMRuntime");
    if (!GM || typeof GM.getState !== "function") return false;
    const gm = GM.getState(ctx);
    return !(gm && gm.enabled === false);
  } catch (_) {
    return false;
  }
}

function ensureSurveyCacheThread(gm) {
  if (!gm || typeof gm !== "object") return null;
  if (!gm.threads || typeof gm.threads !== "object") gm.threads = {};
  if (!gm.threads.surveyCache || typeof gm.threads.surveyCache !== "object") {
    gm.threads.surveyCache = { claimed: {}, claimedOrder: [], attempts: {}, active: null };
  }
  return gm.threads.surveyCache;
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

function maybeSpawnSurveyCacheMarker(ctx, gm, sc, absX, absY, tile) {
  const MS = getMod(ctx, "MarkerService");
  if (!MS || typeof MS.add !== "function") return;

  // Skip obvious non-walkable / POI tiles.
  const T = (ctx.World && ctx.World.TILES)
    || (typeof window !== "undefined" && window.World && window.World.TILES)
    || null;
  if (T && isDisallowedSurveyTile(tile, T)) return;

  // Deterministic anchor-per-cell spawning.
  const cellX = Math.floor((absX | 0) / SURVEY_GRID);
  const cellY = Math.floor((absY | 0) / SURVEY_GRID);
  const baseX = cellX * SURVEY_GRID;
  const baseY = cellY * SURVEY_GRID;

  const seed = (typeof gm.runSeed === "number" && Number.isFinite(gm.runSeed)) ? (gm.runSeed >>> 0) : 0;
  const inner = Math.max(1, SURVEY_GRID - SURVEY_MARGIN * 2);
  const offX = SURVEY_MARGIN + Math.floor(hash2Float((seed ^ SURVEY_SALT_ANCHOR_X) >>> 0, cellX, cellY) * inner);
  const offY = SURVEY_MARGIN + Math.floor(hash2Float((seed ^ SURVEY_SALT_ANCHOR_Y) >>> 0, cellX, cellY) * inner);
  const anchorX = baseX + offX;
  const anchorY = baseY + offY;

  if ((absX | 0) !== (anchorX | 0) || (absY | 0) !== (anchorY | 0)) return;

  const roll = hash2Float((seed ^ SURVEY_SALT_ROLL) >>> 0, cellX, cellY);
  if (roll >= SURVEY_CHANCE) return;

  // Walkability check: prefer generator if available.
  try {
    const gen = ctx.world && ctx.world.gen;
    if (gen && typeof gen.isWalkable === "function") {
      if (!gen.isWalkable(tile)) return;
    } else if (typeof window !== "undefined" && window.World && typeof window.World.isWalkable === "function") {
      if (!window.World.isWalkable(tile)) return;
    }
  } catch (_) {}

  const instanceId = `surveyCache:${absX | 0},${absY | 0}`;
  if (sc.claimed && sc.claimed[instanceId]) return;

  try {
    MS.add(ctx, {
      x: (absX | 0),
      y: (absY | 0),
      kind: "gm.surveyCache",
      glyph: "?",
      paletteKey: "gmMarker",
      instanceId,
    });
  } catch (_) {}
}

export function onWorldScanRect(ctx, { x0, y0, w, h } = {}) {
  if (!ctx) return;
  if (!isGmEnabled(ctx)) return;

  const GM = getMod(ctx, "GMRuntime");
  if (!GM || typeof GM.getState !== "function") return;

  const gm = GM.getState(ctx);
  if (!gm || gm.enabled === false) return;

  const sc = ensureSurveyCacheThread(gm);
  if (!sc) return;

  const world = ctx.world || null;
  const map = Array.isArray(ctx.map) ? ctx.map : (world && Array.isArray(world.map) ? world.map : null);
  if (!world || !map || !map.length || !map[0]) return;

  const ox = (typeof world.originX === "number") ? (world.originX | 0) : 0;
  const oy = (typeof world.originY === "number") ? (world.originY | 0) : 0;

  const lx0 = (typeof x0 === "number" && Number.isFinite(x0)) ? (x0 | 0) : 0;
  const ly0 = (typeof y0 === "number" && Number.isFinite(y0)) ? (y0 | 0) : 0;
  const lw = (typeof w === "number" && Number.isFinite(w)) ? (w | 0) : 0;
  const lh = (typeof h === "number" && Number.isFinite(h)) ? (h | 0) : 0;
  if (lw <= 0 || lh <= 0) return;

  const absX0 = (ox + lx0) | 0;
  const absY0 = (oy + ly0) | 0;
  const absX1 = (absX0 + lw - 1) | 0;
  const absY1 = (absY0 + lh - 1) | 0;

  const cellX0 = Math.floor(absX0 / SURVEY_GRID);
  const cellY0 = Math.floor(absY0 / SURVEY_GRID);
  const cellX1 = Math.floor(absX1 / SURVEY_GRID);
  const cellY1 = Math.floor(absY1 / SURVEY_GRID);

  for (let cy = cellY0; cy <= cellY1; cy++) {
    for (let cx = cellX0; cx <= cellX1; cx++) {
      const baseX = cx * SURVEY_GRID;
      const baseY = cy * SURVEY_GRID;
      const seed = (typeof gm.runSeed === "number" && Number.isFinite(gm.runSeed)) ? (gm.runSeed >>> 0) : 0;
      const inner = Math.max(1, SURVEY_GRID - SURVEY_MARGIN * 2);
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

      maybeSpawnSurveyCacheMarker(ctx, gm, sc, anchorX, anchorY, tile);
    }
  }
}

// Backwards-compatible 1-tile hook.
export function onWorldScanTile(ctx, { wx, wy } = {}) {
  return onWorldScanRect(ctx, {
    x0: (wx | 0) - ((ctx.world && ctx.world.originX) | 0),
    y0: (wy | 0) - ((ctx.world && ctx.world.originY) | 0),
    w: 1,
    h: 1
  });
}

export function ensureGuaranteedSurveyCache(ctx) {
  if (!ctx) return;
  if (!isGmEnabled(ctx)) return;

  const GM = getMod(ctx, "GMRuntime");
  const MS = getMod(ctx, "MarkerService");
  if (!GM || !MS || typeof MS.add !== "function") return;

  const gm = GM.getState(ctx);
  if (!gm || gm.enabled === false) return;

  // If we already have a Survey Cache marker in this run/window, do nothing.
  try {
    const markers = (ctx.world && Array.isArray(ctx.world.questMarkers)) ? ctx.world.questMarkers : [];
    if (markers.some(m => m && String(m.kind || "") === "gm.surveyCache")) return;
  } catch (_) {}

  const sc = ensureSurveyCacheThread(gm);
  if (!sc) return;

  const w = ctx.world || null;
  const map = Array.isArray(ctx.map) ? ctx.map : (w && Array.isArray(w.map) ? w.map : null);
  if (!w || !map || !map.length || !map[0]) return;

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

  const T = (ctx.World && ctx.World.TILES)
    || (typeof window !== "undefined" && window.World && window.World.TILES)
    || null;

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

    try {
      const gen = w.gen;
      if (gen && typeof gen.isWalkable === "function") {
        if (!gen.isWalkable(tile)) continue;
      } else if (typeof window !== "undefined" && window.World && typeof window.World.isWalkable === "function") {
        if (!window.World.isWalkable(tile)) continue;
      }
    } catch (_) {}

    const instanceId = `surveyCache:${absX},${absY}`;
    if (sc.claimed && sc.claimed[instanceId]) continue;

    picked = { absX, absY, instanceId };
    break;
  }

  if (!picked) {
    picked = { absX: pAbsX, absY: pAbsY, instanceId: `surveyCache:${pAbsX},${pAbsY}` };
  }

  try {
    MS.add(ctx, {
      x: picked.absX,
      y: picked.absY,
      kind: "gm.surveyCache",
      glyph: "?",
      paletteKey: "gmMarker",
      instanceId: picked.instanceId,
    });
  } catch (_) {}
}

// ------------------------
// Existing GMBridge functionality
// ------------------------

export function maybeHandleWorldStep(ctx) {
  if (!ctx) return false;

  // Respect gm.enabled: if GM is disabled, do not run any GM-driven world-step intents.
  if (!isGmEnabled(ctx)) return false;

  try {
    const GM = getMod(ctx, "GMRuntime");
    if (!GM || typeof GM.getFactionTravelEvent !== "function") return false;

    const intent = GM.getFactionTravelEvent(ctx) || { kind: "none" };
    if (!intent || intent.kind === "none") return false;

    if (intent.kind === "guard_fine") {
      return handleGuardFineTravelEvent(ctx, GM);
    }

    if (intent.kind === "encounter") {
      const encId = intent.encounterId || intent.id || null;
      if (!encId) return false;
      return startGmFactionEncounter(ctx, encId);
    }

    // Unknown intent kinds are ignored for forward compatibility.
    return false;
  } catch (_) {
    try {
      if (ctx && typeof ctx.log === "function") {
        ctx.log("[GM] Failed to process faction travel event intent.", "warn");
      }
    } catch (_) {}
    return false;
  }
}

function findGmMarkerAtPlayer(ctx) {
  if (!ctx || !ctx.world || !ctx.player) return null;

  const ox = (ctx.world && typeof ctx.world.originX === "number") ? (ctx.world.originX | 0) : 0;
  const oy = (ctx.world && typeof ctx.world.originY === "number") ? (ctx.world.originY | 0) : 0;
  const absX = (ox + (ctx.player.x | 0)) | 0;
  const absY = (oy + (ctx.player.y | 0)) | 0;

  let markers = [];

  // Prefer MarkerService (dedup + canonical behavior), but tolerate missing/late modules.
  try {
    const MS = getMod(ctx, "MarkerService");
    if (MS && typeof MS.findAt === "function") {
      const at = MS.findAt(ctx, absX, absY);
      markers = Array.isArray(at) ? at : (at ? [at] : []);
    }
  } catch (_) {}

  if (!markers.length) {
    try {
      const arr = Array.isArray(ctx.world.questMarkers) ? ctx.world.questMarkers : [];
      markers = arr.filter(m => m && (m.x | 0) === absX && (m.y | 0) === absY);
    } catch (_) {
      markers = [];
    }
  }

  return markers.find((m) => m && typeof m.kind === "string" && m.kind.startsWith("gm.")) || null;
}

export function handleMarkerAction(ctx) {
  if (!ctx) return false;

  const gmMarker = findGmMarkerAtPlayer(ctx);
  if (!gmMarker) return false;

  // Even when GM is disabled, consume input on gm.* markers so we don't fall
  // through to other world actions like opening the Region Map.
  if (!isGmEnabled(ctx)) {
    try {
      if (typeof ctx.log === "function") {
        ctx.log("[GM] GM is disabled; this marker cannot be used.", "warn");
      }
    } catch (_) {}
    return true;
  }

  try {
    const kind = String(gmMarker.kind || "");

    let ok = true;

    if (kind === "gm.bottleMap") {
      ok = !!handleBottleMapMarker(ctx, gmMarker);
    } else if (kind === "gm.surveyCache") {
      ok = !!handleSurveyCacheMarker(ctx, gmMarker);
    } else {
      // Unknown gm.* markers are consumed for forward compatibility.
      try {
        if (typeof ctx.log === "function") {
          const k = String(gmMarker.kind || "gm.?");
          ctx.log(`[GM] Marker '${k}' action not implemented yet.`, "notice");
        }
      } catch (_) {}
      ok = true;
    }

    if (!ok) {
      try {
        if (typeof ctx.log === "function") {
          ctx.log(`[GM] Failed to start marker action for '${kind}'.`, "warn");
        }
      } catch (_) {}
    }

    return true;
  } catch (_) {
    // Even if the handler crashes, consume the input so we don't open Region Map.
    return true;
  }
}

function handleSurveyCacheMarker(ctx, marker) {
  try {
    const GM = getMod(ctx, "GMRuntime");
    const MS = getMod(ctx, "MarkerService");
    if (!GM || !MS) return true;

    const gm = GM.getState(ctx);
    if (gm && gm.enabled === false) return false;

    const sc = ensureSurveyCacheThread(gm);
    if (!sc) return true;

    const absX = marker && typeof marker.x === "number" ? (marker.x | 0) : 0;
    const absY = marker && typeof marker.y === "number" ? (marker.y | 0) : 0;
    const instanceId = (marker && marker.instanceId != null)
      ? String(marker.instanceId)
      : `surveyCache:${absX},${absY}`;

    if (sc.claimed && sc.claimed[instanceId]) {
      try { if (typeof ctx.log === "function") ctx.log("This cache has already been picked clean.", "info"); } catch (_) {}
      try { MS.remove(ctx, { instanceId }); } catch (_) {}
      return true;
    }

    sc.active = { instanceId, absX, absY };
    if (!sc.attempts || typeof sc.attempts !== "object") sc.attempts = {};
    sc.attempts[instanceId] = ((sc.attempts[instanceId] | 0) + 1);

    // IMPORTANT (Phase 1 fix): marker actions must be ctx-first for mode transitions.
    // Do not use GameAPI here (it reacquires ctx and can desync mode/player coords).
    const started = !!startGmFactionEncounter(ctx, "gm_survey_cache_scene", { ctxFirst: true });
    if (!started) {
      sc.active = null;
      return false;
    }

    try {
      GM.onEvent(ctx, { type: "gm.surveyCache.encounterStart", interesting: false, payload: { instanceId } });
    } catch (_) {}

    return true;
  } catch (_) {
    return true;
  }
}

function handleBottleMapMarker(ctx, marker) {
  try {
    const GM = getMod(ctx, "GMRuntime");
    const MS = getMod(ctx, "MarkerService");
    if (!GM || !MS) return true;

    const gm = GM.getState(ctx);
    if (gm && gm.enabled === false) return false;

    const thread = ensureBottleMapThread(gm);
    if (!thread || thread.active !== true) {
      try { if (typeof ctx.log === "function") ctx.log("The map's ink has faded.", "warn"); } catch (_) {}
      // Clean up orphaned marker.
      try {
        const inst = marker && marker.instanceId != null ? String(marker.instanceId) : "";
        if (inst) MS.remove(ctx, { instanceId: inst });
      } catch (_) {}
      return true;
    }

    // Only start encounter if this marker matches the active thread target.
    const inst = marker && marker.instanceId != null ? String(marker.instanceId) : "";
    if (thread.instanceId && inst && String(thread.instanceId) !== inst) {
      return true;
    }

    if (thread.status === "claimed") {
      try { if (typeof ctx.log === "function") ctx.log("You've already claimed what's buried here.", "info"); } catch (_) {}
      return true;
    }

    if (thread.status !== "inEncounter") {
      thread.status = "inEncounter";
      thread.attempts = (thread.attempts | 0) + 1;
      try {
        GM.onEvent(ctx, { type: "gm.bottleMap.encounterStart", interesting: false, payload: { instanceId: thread.instanceId } });
      } catch (_) {}
    }

    // Start the dedicated Bottle Map encounter.
    const started = !!startGmBottleMapEncounter(ctx);
    if (!started) {
      // If we couldn't enter the encounter (e.g., template missing/late load), revert so the player can retry.
      if (thread.status === "inEncounter") thread.status = "active";
      return false;
    }
    return true;
  } catch (_) {
    return true;
  }
}

function startGmBottleMapEncounter(ctx) {
  // IMPORTANT (Phase 1 fix): marker actions must be ctx-first for mode transitions.
  // Do not use GameAPI here (it reacquires ctx and can desync mode/player coords).
  return startGmFactionEncounter(ctx, "gm_bottle_map_scene", { ctxFirst: true });
}

function ensureBottleMapThread(gm) {
  if (!gm || typeof gm !== "object") return null;
  if (!gm.threads || typeof gm.threads !== "object") gm.threads = {};
  if (!gm.threads.bottleMap || typeof gm.threads.bottleMap !== "object") gm.threads.bottleMap = { active: false };
  return gm.threads.bottleMap;
}

function isBottleMapItem(it) {
  try {
    if (!it) return false;
    if (it.usable !== true) return false;
    const k = String(it.kind || "").toLowerCase();
    if (k !== "tool" && k !== "item" && k !== "use") {
      // Allow custom kinds, but keep it narrow.
    }
    const id = String(it.type || it.id || it.key || it.name || "").toLowerCase();
    return id === "bottle_map" || id === "bottle map" || id.includes("bottle map") || id.includes("bottle_map");
  } catch (_) {
    return false;
  }
}

function pickBottleMapTarget(ctx, gm) {
  const w = (ctx && ctx.world) ? ctx.world : null;
  const map = w && Array.isArray(w.map) ? w.map : null;
  if (!map || !map.length || !map[0]) return null;

  const H = map.length | 0;
  const W = map[0].length | 0;

  const ox = (w && typeof w.originX === "number") ? (w.originX | 0) : 0;
  const oy = (w && typeof w.originY === "number") ? (w.originY | 0) : 0;

  const px = (ctx.player && typeof ctx.player.x === "number") ? (ctx.player.x | 0) : 0;
  const py = (ctx.player && typeof ctx.player.y === "number") ? (ctx.player.y | 0) : 0;
  const pAbsX = ox + px;
  const pAbsY = oy + py;

  const WorldMod = (typeof window !== "undefined" ? window.World : null) || (ctx && ctx.World ? ctx.World : null);
  const T = WorldMod && WorldMod.TILES ? WorldMod.TILES : null;

  // IMPORTANT:
  // Bottle Map targets must be walkable in the overworld.
  // Do NOT use ctx.isWalkable here: that is defined in core/game.js and is primarily for
  // town/dungeon tile ids (via Utils.isWalkableTile). Instead, validate using overworld tile rules.
  const isWalkableOverworldTile = (tile) => {
    try {
      const gen = w && w.gen;
      if (gen && typeof gen.isWalkable === "function") return !!gen.isWalkable(tile);
    } catch (_) {}
    try {
      if (WorldMod && typeof WorldMod.isWalkable === "function") return !!WorldMod.isWalkable(tile);
    } catch (_) {}
    // Conservative fallback: treat unknown as not walkable.
    return false;
  };

  const isDisallowed = (tile) => {
    if (!T) return false;
    return tile === T.WATER
      || tile === T.RIVER
      || tile === T.MOUNTAIN
      || tile === T.RUINS
      || tile === T.TOWN
      || tile === T.DUNGEON
      || (T.CASTLE != null && tile === T.CASTLE)
      || (T.TOWER != null && tile === T.TOWER);
  };

  const tries = 80;
  for (let n = 0; n < tries; n++) {
    // Distance 12..32, biased a bit farther.
    const r = 12 + Math.floor(Math.pow(gmRngFloat(gm), 0.65) * 20);
    const ang = gmRngFloat(gm) * Math.PI * 2;
    const dx = Math.round(Math.cos(ang) * r);
    const dy = Math.round(Math.sin(ang) * r);

    const absX = (pAbsX + dx) | 0;
    const absY = (pAbsY + dy) | 0;

    const lx = absX - ox;
    const ly = absY - oy;
    if (lx < 0 || ly < 0 || lx >= W || ly >= H) continue;

    const tile = map[ly] ? map[ly][lx] : null;
    if (tile == null) continue;

    if (T && isDisallowed(tile)) continue;
    if (!isWalkableOverworldTile(tile)) continue;

    return { absX, absY };
  }

  // Fallback: current player tile (as absolute coords)
  return { absX: pAbsX, absY: pAbsY };
}

function ensureUniqueGranted(gm) {
  if (!gm || typeof gm !== "object") return null;

  const runSeed = (typeof gm.runSeed === "number" && Number.isFinite(gm.runSeed)) ? (gm.runSeed >>> 0) : 0;

  if (!gm.uniqueGranted || typeof gm.uniqueGranted !== "object" || gm.uniqueGrantedRunSeed !== runSeed) {
    gm.uniqueGranted = {};
    gm.uniqueGrantedRunSeed = runSeed;
  }

  return gm.uniqueGranted;
}

function rollBottleMapReward(ctx, gm) {
  // NOTE: This roll should be deterministic and stable across retries.
  // It is computed once at Bottle Map activation and stored on the thread.

  // Gold: uniform 60..80 inclusive.
  const gold = 60 + Math.floor(gmRngFloat(gm) * 21);
  const grants = [{ kind: "gold", amount: gold }];

  // Always grant exactly 1 tier-2 equipment item.
  try {
    const Items = (typeof window !== "undefined" ? window.Items : null) || (ctx && ctx.Items ? ctx.Items : null);
    if (Items && typeof Items.createEquipment === "function") {
      const it = Items.createEquipment(2, () => gmRngFloat(gm));
      if (it) grants.push({ kind: "item", item: it });
    } else {
      // Fallback: create a minimal equip-shaped item so inventory/equip code can handle it.
      grants.push({ kind: "item", item: { kind: "equip", slot: "hand", name: "iron gear", tier: 2, atk: 0, def: 0, decay: 0 } });
    }
  } catch (_) {
    grants.push({ kind: "item", item: { kind: "equip", slot: "hand", name: "iron gear", tier: 2, atk: 0, def: 0, decay: 0 } });
  }

  // Unique drop: 2–3% per Bottle Map resolution. Enforced unique per-run via gm.uniqueGranted.
  try {
    const uniqueChance = 0.02 + (gmRngFloat(gm) * 0.01);
    const roll = gmRngFloat(gm);
    if (roll < uniqueChance) {
      const granted = ensureUniqueGranted(gm) || {};
      const pool = ["skeleton_key"]; // Expandable.
      const available = pool.filter((id) => !granted[String(id)]);

      if (available.length) {
        const pick = available[Math.floor(gmRngFloat(gm) * available.length)] || available[0];
        granted[String(pick)] = true;

        if (pick === "skeleton_key") {
          grants.push({
            kind: "tool",
            tool: {
              kind: "tool",
              type: "skeleton_key",
              id: "skeleton_key",
              name: "skeleton key",
              uses: 1,
              unique: true,
              decay: 0,
              usable: false,
            },
          });
        }
      }
    }
  } catch (_) {}

  return { grants };
}

function grantBottleMapRewards(ctx, reward) {
  if (!ctx || !ctx.player || !reward) return;
  const inv = Array.isArray(ctx.player.inventory) ? ctx.player.inventory : (ctx.player.inventory = []);

  for (const g of (reward.grants || [])) {
    if (!g) continue;
    if (g.kind === "gold") {
      const amount = (typeof g.amount === "number" ? (g.amount | 0) : 0);
      if (amount <= 0) continue;
      let goldObj = inv.find(it => it && String(it.kind || it.type || "").toLowerCase() === "gold");
      if (!goldObj) {
        goldObj = { kind: "gold", amount: 0, name: "gold" };
        inv.push(goldObj);
      }
      goldObj.amount = (typeof goldObj.amount === "number" ? goldObj.amount : 0) + amount;
      continue;
    }
    if (g.kind === "item" && g.item) {
      inv.push(g.item);
      continue;
    }
    if (g.kind === "tool" && g.tool) {
      inv.push(g.tool);
      continue;
    }
  }

  try { if (typeof ctx.updateUI === "function") ctx.updateUI(); } catch (_) {}
}

/**
 * GMBridge hook: called by encounter completion flow.
 */
export function onEncounterComplete(ctx, info) {
  try {
    const id = info && info.encounterId != null ? String(info.encounterId) : "";
    if (!id) return;

    // If GM is disabled, don't apply any GM side effects.
    if (!isGmEnabled(ctx)) return;

    if (id === "gm_bottle_map_scene") {
      const GM = getMod(ctx, "GMRuntime");
      const MS = getMod(ctx, "MarkerService");
      if (!GM || !MS) return;

      const gm = GM.getState(ctx);
      const thread = ensureBottleMapThread(gm);
      if (!thread || thread.active !== true) return;

      const outcome = info && info.outcome ? String(info.outcome) : "";
      if (outcome !== "victory") {
        thread.status = "active";
        try { GM.onEvent(ctx, { type: "gm.bottleMap.encounterExit", interesting: false, payload: { outcome } }); } catch (_) {}
        return;
      }

      // Victory: pay out and clear marker.
      const reward = thread.reward || null;
      try { grantBottleMapRewards(ctx, reward); } catch (_) {}

      try {
        if (thread.instanceId != null) {
          MS.remove(ctx, { instanceId: String(thread.instanceId) });
        }
      } catch (_) {}

      thread.status = "claimed";
      thread.active = false;
      thread.claimedTurn = (ctx && ctx.time && typeof ctx.time.turnCounter === "number") ? (ctx.time.turnCounter | 0) : 0;

      try { if (typeof ctx.log === "function") ctx.log("You unearth a hidden cache from the Bottle Map.", "good"); } catch (_) {}
      try { GM.onEvent(ctx, { type: "gm.bottleMap.claimed", interesting: true, payload: { instanceId: thread.instanceId } }); } catch (_) {}

      // Ensure UI refresh after granting rewards.
      try {
        const UIO = getMod(ctx, "UIOrchestration");
        if (UIO && typeof UIO.renderInventory === "function") UIO.renderInventory(ctx);
      } catch (_) {}

      return;
    }

    if (id === "gm_survey_cache_scene") {
      const GM = getMod(ctx, "GMRuntime");
      const MS = getMod(ctx, "MarkerService");
      if (!GM || !MS) return;

      const gm = GM.getState(ctx);
      const sc = ensureSurveyCacheThread(gm);
      if (!sc || !sc.active) return;

      const outcome = info && info.outcome ? String(info.outcome) : "";
      if (outcome !== "victory") {
        sc.active = null;
        try { GM.onEvent(ctx, { type: "gm.surveyCache.encounterExit", interesting: false, payload: { outcome } }); } catch (_) {}
        return;
      }

      const turn = (ctx && ctx.time && typeof ctx.time.turnCounter === "number") ? (ctx.time.turnCounter | 0) : 0;
      const { instanceId, absX, absY } = sc.active;

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

      try { grantBottleMapRewards(ctx, reward); } catch (_) {}

      try { MS.remove(ctx, { instanceId: String(instanceId) }); } catch (_) {}

      // Record claim.
      if (!sc.claimed || typeof sc.claimed !== "object") sc.claimed = {};
      if (!Array.isArray(sc.claimedOrder)) sc.claimedOrder = [];
      sc.claimed[String(instanceId)] = turn;
      sc.claimedOrder.unshift(String(instanceId));
      if (sc.claimedOrder.length > 256) {
        const old = sc.claimedOrder.pop();
        if (old) delete sc.claimed[String(old)];
      }

      sc.active = null;

      try { if (typeof ctx.log === "function") ctx.log("You pry open a forgotten surveyor's cache.", "good"); } catch (_) {}
      try { GM.onEvent(ctx, { type: "gm.surveyCache.claimed", interesting: true, payload: { instanceId } }); } catch (_) {}
      return;
    }
  } catch (_) {}
}

/**
 * Inventory "use" hook: called from InventoryFlow.useItemByIndex.
 */
export function useInventoryItem(ctx, item, idx) {
  if (!ctx || !item) return false;
  if (!isBottleMapItem(item)) return false;

  if (!isGmEnabled(ctx)) return false;

  if (ctx.mode !== "world") {
    try { if (typeof ctx.log === "function") ctx.log("The map can only be used in the overworld.", "warn"); } catch (_) {}
    return true;
  }

  const GM = getMod(ctx, "GMRuntime");
  const MS = getMod(ctx, "MarkerService");
  if (!GM || !MS) {
    try { if (typeof ctx.log === "function") ctx.log("Nothing happens.", "warn"); } catch (_) {}
    return true;
  }

  const gm = GM.getState(ctx);
  const thread = ensureBottleMapThread(gm);

  // Disallow stacking multiple active Bottle Maps.
  if (thread.active === true && thread.status !== "claimed") {
    try { if (typeof ctx.log === "function") ctx.log("The Bottle Map already points to a location.", "info"); } catch (_) {}
    return true;
  }

  // Consume the item.
  try {
    const inv = Array.isArray(ctx.player.inventory) ? ctx.player.inventory : (ctx.player.inventory = []);
    const i = (idx | 0);
    if (i >= 0 && i < inv.length) inv.splice(i, 1);
  } catch (_) {}

  // Roll deterministic target + reward using GM RNG.
  const target = pickBottleMapTarget(ctx, gm);
  const reward = rollBottleMapReward(ctx, gm);

  const turn = (ctx && ctx.time && typeof ctx.time.turnCounter === "number") ? (ctx.time.turnCounter | 0) : 0;
  const id = `bottleMap:${turn}:${(gm && gm.rng ? (gm.rng.calls | 0) : 0)}`;

  thread.active = true;
  thread.instanceId = id;
  thread.createdTurn = turn;
  thread.status = "active";
  thread.attempts = 0;
  thread.target = target;
  thread.reward = reward;

  if (target && typeof target.absX === "number" && typeof target.absY === "number") {
    try {
      MS.add(ctx, {
        x: target.absX,
        y: target.absY,
        kind: "gm.bottleMap",
        glyph: "X",
        paletteKey: "gmMarker",
        instanceId: id,
        createdTurn: turn,
      });
    } catch (_) {}
  }

  try { GM.onEvent(ctx, { type: "gm.bottleMap.activated", interesting: true, payload: { instanceId: id } }); } catch (_) {}
  try { if (typeof ctx.log === "function") ctx.log("You study the Bottle Map. An X appears on your world map.", "notice"); } catch (_) {}
  try { if (typeof ctx.updateUI === "function") ctx.updateUI(); } catch (_) {}

  return true;
}

function handleGuardFineTravelEvent(ctx, GM) {
  if (!ctx || !ctx.player) return false;

  try {
    const MZ = getMod(ctx, "Messages");
    const UIO = getMod(ctx, "UIOrchestration");

    if (!GM || typeof GM.onEvent !== "function") return false;

    const inv = Array.isArray(ctx.player.inventory) ? ctx.player.inventory : (ctx.player.inventory = []);
    let goldObj = inv.find(it => it && String(it.kind || it.type || "").toLowerCase() === "gold");
    if (!goldObj) {
      goldObj = { kind: "gold", amount: 0, name: "gold" };
      inv.push(goldObj);
    }

    const currentGold = (typeof goldObj.amount === "number" ? goldObj.amount : 0) | 0;

    const level = (typeof ctx.player.level === "number" ? (ctx.player.level | 0) : 1);
    let fine = level * 10;
    if (fine < 30) fine = 30;
    if (fine > 300) fine = 300;

    if (currentGold < fine) {
      try {
        if (MZ && typeof MZ.log === "function") {
          MZ.log(ctx, "gm.guardFine.noMoney", null, "warn");
        } else if (typeof ctx.log === "function") {
          ctx.log("A patrol of guards demands a fine you cannot afford. They let you go with a warning this time.", "warn");
        }
      } catch (_) {}

      try { GM.onEvent(ctx, { type: "gm.guardFine.refuse" }); } catch (_) {}
      return true;
    }

    const vars = { amount: fine };
    let prompt = "";
    try {
      if (MZ && typeof MZ.get === "function") {
        prompt = MZ.get("gm.guardFine.prompt", vars) || "";
      }
    } catch (_) {}
    if (!prompt) prompt = `A patrol of guards demands a fine of ${fine} gold for your crimes.\nPay?`;

    const onPay = () => {
      try { goldObj.amount = Math.max(0, currentGold - fine); } catch (_) {}
      try { GM.onEvent(ctx, { type: "gm.guardFine.pay" }); } catch (_) {}
      try {
        if (MZ && typeof MZ.log === "function") MZ.log(ctx, "gm.guardFine.paid", { amount: fine }, "good");
        else if (typeof ctx.log === "function") ctx.log(`You pay ${fine} gold to settle your fines with the guards.`, "info");
      } catch (_) {}
      try { if (typeof ctx.updateUI === "function") ctx.updateUI(); } catch (_) {}
    };

    const onRefuse = () => {
      try { GM.onEvent(ctx, { type: "gm.guardFine.refuse" }); } catch (_) {}
      try {
        if (MZ && typeof MZ.log === "function") MZ.log(ctx, "gm.guardFine.refused", null, "warn");
        else if (typeof ctx.log === "function") ctx.log("You refuse to pay the fine. The guards will remember this.", "warn");
      } catch (_) {}
    };

    if (UIO && typeof UIO.showConfirm === "function") UIO.showConfirm(ctx, prompt, null, onPay, onRefuse);
    else onPay();

    return true;
  } catch (_) {
    try { if (ctx && typeof ctx.log === "function") ctx.log("[GM] Error handling guard fine travel event.", "warn"); } catch (_) {}
    return false;
  }
}



function startGmFactionEncounter(ctx, encounterId, opts) {
  if (!ctx) return false;

  const idRaw = encounterId != null ? String(encounterId) : "";
  const id = idRaw.trim();
  if (!id) return false;

  const key = id.toLowerCase();

  const GD = getGameData(ctx);
  const reg = GD && GD.encounters && Array.isArray(GD.encounters.templates) ? GD.encounters.templates : null;

  let tmpl = null;
  try {
    if (reg && reg.length) {
      tmpl = reg.find(t => t && String(t.id || "").toLowerCase() === key) || null;
    }
  } catch (_) {
    tmpl = null;
  }

  // If encounter registries haven't loaded yet (or failed to load), use a minimal fallback
  // for known GM encounters so marker interactions remain functional.
  if (!tmpl && (!reg || !reg.length)) {
    tmpl = FALLBACK_GM_ENCOUNTER_TEMPLATES[key] || null;
    if (tmpl) {
      try {
        if (ctx && typeof ctx.log === "function") {
          ctx.log(`[GM] Encounter templates not available yet; using fallback for '${id}'.`, "notice");
        }
      } catch (_) {}
    }
  }

  if (!tmpl) {
    try {
      if (ctx && typeof ctx.log === "function") {
        const loaded = !!(reg && reg.length);
        const count = loaded ? reg.length : 0;
        ctx.log(`[GM] Faction encounter template '${id}' not found (templatesLoaded=${loaded}, count=${count}).`, "warn");
      }
    } catch (_) {}
    return false;
  }

  let biome = "GRASS";
  try {
    const W = getMod(ctx, "World");
    const wmap = ctx.world && ctx.world.map ? ctx.world.map : null;
    const y = (ctx.player && typeof ctx.player.y === "number") ? (ctx.player.y | 0) : 0;
    const x = (ctx.player && typeof ctx.player.x === "number") ? (ctx.player.x | 0) : 0;
    const tile = wmap && wmap[y] ? wmap[y][x] : null;
    if (W && typeof W.biomeName === "function") {
      const name = W.biomeName(tile) || "";
      if (name) biome = String(name).toUpperCase();
    }
  } catch (_) {}

  let difficulty = 1;
  try {
    const ES = getMod(ctx, "EncounterService");
    if (ES && typeof ES.computeDifficulty === "function") {
      difficulty = ES.computeDifficulty(ctx, biome);
    }
  } catch (_) {}
  if (typeof difficulty !== "number" || !Number.isFinite(difficulty)) difficulty = 1;
  if (difficulty < 1) difficulty = 1;
  if (difficulty > 5) difficulty = 5;

  const ctxFirst = !!(opts && opts.ctxFirst);

  let ok = false;

  // IMPORTANT (Phase 1 fix): marker actions run inside Actions.doAction(ctx), which
  // later commits changes via applyCtxSyncAndRefresh(ctx). If we call GameAPI here,
  // it may reacquire a different ctx instance and cause world/encounter desync.
  if (!ctxFirst) {
    try {
      const GA = getMod(ctx, "GameAPI");
      if (GA && typeof GA.enterEncounter === "function") {
        ok = !!GA.enterEncounter(tmpl, biome, difficulty);
      }
    } catch (_) {}
  }

  // ctx-first entry for marker-triggered encounters
  if (!ok && ctxFirst) {
    try {
      const M = (ctx && ctx.Modes) ? ctx.Modes : getMod(ctx, "Modes");
      if (M && typeof M.enterEncounter === "function") {
        ok = !!M.enterEncounter(ctx, tmpl, biome, difficulty);
      }
    } catch (_) {}
  }

  // Fallback: direct EncounterRuntime entry (still ctx-first)
  if (!ok) {
    try {
      const ER = getMod(ctx, "EncounterRuntime");
      if (ER && typeof ER.enter === "function") {
        ok = !!ER.enter(ctx, { template: tmpl, biome, difficulty });
      }
    } catch (_) {}
  }

  if (!ok) {
    try { if (ctx && typeof ctx.log === "function") ctx.log("[GM] Failed to start faction encounter.", "warn"); } catch (_) {}
    return false;
  }

  try {
    if (ctx && typeof ctx.log === "function") {
      const name = tmpl && tmpl.name ? tmpl.name : id;
      ctx.log(`[GM] A special encounter begins: ${name}.`, "notice");
    }
  } catch (_) {}

  return true;
}

attachGlobal("GMBridge", {
  maybeHandleWorldStep,
  handleMarkerAction,
  onEncounterComplete,
  useInventoryItem,
  onWorldScanRect,
  onWorldScanTile,
  ensureGuaranteedSurveyCache,
});
