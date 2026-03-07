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

import { getMod } from "../../utils/access.js";
import { attachGlobal } from "../../utils/global.js";
import { gmRngFloat, hash32 } from "../gm/runtime/rng.js";
import { grantBottleMapRewards, startGmFactionEncounter } from "./gm_bridge_effects.js";

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
const SURVEY_SALT_COOLDOWN = 0x53_43_06;



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
    gm.threads.surveyCache = { claimed: {}, claimedOrder: [], attempts: {}, active: null, nextSpawnTurn: 0 };
  }
  const sc = gm.threads.surveyCache;
  if (!sc.claimed || typeof sc.claimed !== "object" || Array.isArray(sc.claimed)) sc.claimed = {};
  if (!Array.isArray(sc.claimedOrder)) sc.claimedOrder = [];
  if (!sc.attempts || typeof sc.attempts !== "object" || Array.isArray(sc.attempts)) sc.attempts = {};
  if (sc.active != null && typeof sc.active !== "object") sc.active = null;

  sc.nextSpawnTurn = (typeof sc.nextSpawnTurn === "number" && Number.isFinite(sc.nextSpawnTurn)) ? (sc.nextSpawnTurn | 0) : 0;
  if (sc.nextSpawnTurn < 0) sc.nextSpawnTurn = 0;

  return sc;
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

    let boredomMin = s && typeof s.boredomMin === "number" && Number.isFinite(s.boredomMin) ? s.boredomMin : DEFAULTS.boredomMin;
    let cooldownMinTurns = s && typeof s.cooldownMinTurns === "number" && Number.isFinite(s.cooldownMinTurns) ? (s.cooldownMinTurns | 0) : DEFAULTS.cooldownMinTurns;
    let cooldownMaxTurns = s && typeof s.cooldownMaxTurns === "number" && Number.isFinite(s.cooldownMaxTurns) ? (s.cooldownMaxTurns | 0) : DEFAULTS.cooldownMaxTurns;

    if (boredomMin < 0) boredomMin = 0;
    if (boredomMin > 1) boredomMin = 1;

    if (cooldownMinTurns < 0) cooldownMinTurns = 0;
    if (cooldownMaxTurns < cooldownMinTurns) cooldownMaxTurns = cooldownMinTurns;

    return { boredomMin, cooldownMinTurns, cooldownMaxTurns };
  } catch (_) {
    return Object.assign({}, DEFAULTS);
  }
}

function isGmBoredEnoughForSurveyCache(ctx, gm) {
  const cfg = getSurveyCacheSpawnConfig(ctx);
  let boredom = 0;
  try {
    boredom = (gm && gm.boredom && typeof gm.boredom.level === "number" && Number.isFinite(gm.boredom.level)) ? gm.boredom.level : 0;
  } catch (_) { boredom = 0; }
  if (boredom < 0) boredom = 0;
  if (boredom > 1) boredom = 1;

  return boredom >= cfg.boredomMin;
}

function surveyCacheCooldownReady(ctx, sc) {
  const turn = (ctx && ctx.time && typeof ctx.time.turnCounter === "number" && Number.isFinite(ctx.time.turnCounter)) ? (ctx.time.turnCounter | 0) : 0;
  const next = (sc && typeof sc.nextSpawnTurn === "number" && Number.isFinite(sc.nextSpawnTurn)) ? (sc.nextSpawnTurn | 0) : 0;
  return turn >= next;
}

function setSurveyCacheNextSpawnTurn(ctx, gm, sc) {
  const cfg = getSurveyCacheSpawnConfig(ctx);
  const turn = (ctx && ctx.time && typeof ctx.time.turnCounter === "number" && Number.isFinite(ctx.time.turnCounter)) ? (ctx.time.turnCounter | 0) : 0;

  let min = cfg.cooldownMinTurns | 0;
  let max = cfg.cooldownMaxTurns | 0;
  if (min < 0) min = 0;
  if (max < min) max = min;

  // IMPORTANT: do not consume ctx.rng here.
  // This cooldown is deterministic, but should not advance the run RNG stream.
  const span = Math.max(0, (max - min) | 0);

  let runSeed = 0;
  try { runSeed = (gm && typeof gm.runSeed === "number" && Number.isFinite(gm.runSeed)) ? (gm.runSeed >>> 0) : 0; } catch (_) { runSeed = 0; }

  const prev = (sc && typeof sc.nextSpawnTurn === "number" && Number.isFinite(sc.nextSpawnTurn)) ? (sc.nextSpawnTurn | 0) : 0;
  const u = hash32((runSeed ^ SURVEY_SALT_COOLDOWN ^ Math.imul(turn | 0, 0x9e3779b9) ^ (prev | 0)) >>> 0) >>> 0;
  const dt = min + (span ? (u % (span + 1)) : 0);

  sc.nextSpawnTurn = (turn + dt) | 0;
}

function canSpawnSurveyCacheNow(ctx, gm, sc) {
  if (!isGmBoredEnoughForSurveyCache(ctx, gm)) return false;
  if (!surveyCacheCooldownReady(ctx, sc)) return false;
  return true;
}

function isSurveyCacheClaimed(sc, instanceId) {
  const claimed = (sc && sc.claimed && typeof sc.claimed === "object") ? sc.claimed : null;
  if (!claimed) return false;
  return Object.prototype.hasOwnProperty.call(claimed, String(instanceId));
}

function removeSurveyCacheMarker(ctx, MS, { instanceId, absX, absY } = {}) {
  if (!MS || typeof MS.remove !== "function") return 0;

  const iid = (instanceId != null) ? String(instanceId) : "";
  const x = (typeof absX === "number" && Number.isFinite(absX)) ? (absX | 0) : null;
  const y = (typeof absY === "number" && Number.isFinite(absY)) ? (absY | 0) : null;

  let removed = 0;

  if (iid) {
    // Prefer criteria object with kind+instanceId to avoid accidental collisions.
    try { removed = (MS.remove(ctx, { kind: "gm.surveyCache", instanceId: iid }) | 0); } catch (_) {}
    if (!removed) {
      try {
        removed = (MS.remove(ctx, (m) => m && String(m.kind || "") === "gm.surveyCache" && String(m.instanceId || "") === iid) | 0);
      } catch (_) {}
    }
  }

  if (!removed && x != null && y != null) {
    try {
      removed = (MS.remove(ctx, (m) => m && String(m.kind || "") === "gm.surveyCache" && (m.x | 0) === x && (m.y | 0) === y) | 0);
    } catch (_) {}
  }

  return removed;
}

function recordSurveyCacheClaim(sc, instanceId, turn) {
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

  // Spawn gate: only place new markers when GM boredom is high enough and the thread cooldown has elapsed.
  if (!canSpawnSurveyCacheNow(ctx, gm, sc)) return;

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
  if (isSurveyCacheClaimed(sc, instanceId)) return;

  let placed = null;
  try {
    placed = MS.add(ctx, {
      x: (absX | 0),
      y: (absY | 0),
      kind: "gm.surveyCache",
      glyph: "?",
      paletteKey: "gmMarker",
      instanceId,
    });
  } catch (_) {}

  if (placed) {
    try { setSurveyCacheNextSpawnTurn(ctx, gm, sc); } catch (_) {}
  }
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

  // Hybrid thread: the guarantee spawn should be safe to call repeatedly. This allows the
  // "guarantee at least one per run" behavior to occur later in the run once boredom rises.
  try { ensureGuaranteedSurveyCache(ctx); } catch (_) {}
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

  const sc = ensureSurveyCacheThread(gm);
  if (!sc) return;

  // Spawn gate: do not guarantee a cache unless boredom and cooldown allow it.
  if (!canSpawnSurveyCacheNow(ctx, gm, sc)) return;

  // If we already have a Survey Cache marker in this run/window, do nothing.
  try {
    const markers = (ctx.world && Array.isArray(ctx.world.questMarkers)) ? ctx.world.questMarkers : [];
    if (markers.some(m => m && String(m.kind || "") === "gm.surveyCache")) return;
  } catch (_) {}

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
    if (isSurveyCacheClaimed(sc, instanceId)) continue;

    picked = { absX, absY, instanceId };
    break;
  }

  if (!picked) {
    picked = { absX: pAbsX, absY: pAbsY, instanceId: `surveyCache:${pAbsX},${pAbsY}` };
  }

  let placed = null;
  try {
    placed = MS.add(ctx, {
      x: picked.absX,
      y: picked.absY,
      kind: "gm.surveyCache",
      glyph: "?",
      paletteKey: "gmMarker",
      instanceId: picked.instanceId,
    });
  } catch (_) {}

  if (placed) {
    try { setSurveyCacheNextSpawnTurn(ctx, gm, sc); } catch (_) {}
  }
}

// ------------------------
// Existing GMBridge functionality
// ------------------------

export function maybeHandleWorldStep(ctx) {
  if (!ctx) return false;

  // Travel events are overworld-only. Guard against accidental calls from other modes.
  if (typeof ctx.mode === "string" && ctx.mode !== "world") return false;

  // Respect gm.enabled: if GM is disabled, do not run any GM-driven world-step intents.
  if (!isGmEnabled(ctx)) return false;

  // Phase 7: keep Bottle Map marker/thread state consistent as you move.
  // This is a cheap integrity pass (no RNG consumption).
  try { ensureBottleMapMarkerIntegrity(ctx); } catch (_) {}

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

      const UIO = getMod(ctx, "UIOrchestration");
      if (!UIO || typeof UIO.showConfirm !== "function") {
        // Phase 5 direction: choices only. If we can't present a confirm UI, do not force-start.
        try { if (typeof ctx.log === "function") ctx.log("[GM] Travel encounter requires confirm UI; skipping.", "warn"); } catch (_) {}
        return false;
      }

      const MZ = ctx.Messages || getMod(ctx, "Messages");
      let prompt = "";
      try {
        if (MZ && typeof MZ.get === "function") {
          const k = encId === "gm_bandit_bounty" ? "gm.travel.banditBounty.prompt" : encId === "gm_troll_hunt" ? "gm.travel.trollHunt.prompt" : "";
          if (k) prompt = MZ.get(k, null) || "";
        }
      } catch (_) {}
      if (!prompt) {
        if (encId === "gm_bandit_bounty") prompt = "You spot signs of bandits nearby. Investigate?";
        else if (encId === "gm_troll_hunt") prompt = "You hear heavy tracks and guttural noises ahead. Hunt the troll?";
        else prompt = `A strange opportunity presents itself (${String(encId)}). Investigate?`;
      }

      // Phase 4 pacing: showing a choice prompt counts as an intervention.
      try {
        if (GM && typeof GM.recordIntervention === "function") {
          GM.recordIntervention(ctx, { kind: "confirm", channel: "factionTravel", id: String(encId) });
        }
      } catch (_) {}

      const onOk = () => {
        try { startGmFactionEncounter(ctx, encId); } catch (_) {}
      };
      const onCancel = () => {
        try { if (typeof ctx.log === "function") ctx.log("You decide not to get involved.", "info"); } catch (_) {}
      };

      UIO.showConfirm(ctx, prompt, null, onOk, onCancel);
      return true;
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

    if (isSurveyCacheClaimed(sc, instanceId)) {
      try { if (typeof ctx.log === "function") ctx.log("This cache has already been picked clean.", "info"); } catch (_) {}
      try {
        const iid = String(instanceId);
        const removed = (typeof MS.remove === "function")
          ? (MS.remove(ctx, { kind: "gm.surveyCache", instanceId: iid }) | 0)
          : 0;

        if (!removed && typeof MS.remove === "function") {
          MS.remove(ctx, (m) => {
            if (!m) return false;
            if (String(m.kind || "") !== "gm.surveyCache") return false;
            if (String(m.instanceId || "") === iid) return true;
            return (m.x | 0) === (absX | 0) && (m.y | 0) === (absY | 0);
          });
        }
      } catch (_) {}
      return true;
    }

    const UIO = getMod(ctx, "UIOrchestration");
    if (!UIO || typeof UIO.showConfirm !== "function") {
      try { if (typeof ctx.log === "function") ctx.log("[GM] Survey Cache requires confirm UI; skipping.", "warn"); } catch (_) {}
      return true;
    }

    // Phase 4 pacing: showing a choice prompt counts as an intervention.
    try {
      if (GM && typeof GM.recordIntervention === "function") {
        GM.recordIntervention(ctx, { kind: "confirm", channel: "marker", id: "gm.surveyCache" });
      }
    } catch (_) {}

    const onOk = () => {
      try {
        sc.active = { instanceId, absX, absY };
        if (!sc.attempts || typeof sc.attempts !== "object") sc.attempts = {};
        sc.attempts[instanceId] = ((sc.attempts[instanceId] | 0) + 1);

        const started = !!startGmFactionEncounter(ctx, "gm_survey_cache_scene", { ctxFirst: true });
        if (!started) {
          sc.active = null;
          try { if (typeof ctx.log === "function") ctx.log("Nothing happens.", "warn"); } catch (_) {}
          try { if (typeof ctx.log === "function") ctx.log("[GM] Failed to start Survey Cache encounter.", "warn"); } catch (_) {}
          return;
        }

        // Consume immediately so fleeing/withdrawing cannot re-enter the same cache.
        // Keep sc.active intact so victory payout can still resolve the reward.
        const turn = (ctx && ctx.time && typeof ctx.time.turnCounter === "number") ? (ctx.time.turnCounter | 0) : 0;
        try { removeSurveyCacheMarker(ctx, MS, { instanceId, absX, absY }); } catch (_) {}
        try { recordSurveyCacheClaim(sc, instanceId, turn); } catch (_) {}

        try {
          GM.onEvent(ctx, { type: "gm.surveyCache.encounterStart", interesting: false, payload: { instanceId } });
        } catch (_) {}
      } catch (err) {
        sc.active = null;
        try { if (typeof ctx.log === "function") ctx.log("[GM] Error while starting Survey Cache encounter.", "warn"); } catch (_) {}
        try { if (typeof console !== "undefined" && console && typeof console.error === "function") console.error(err); } catch (_) {}
      }
    };

    const onCancel = () => {
      try { if (typeof ctx.log === "function") ctx.log("You leave the cache alone.", "info"); } catch (_) {}
    };

    UIO.showConfirm(ctx, "Investigate the Surveyor's Cache?", null, onOk, onCancel);
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
    if (thread.instanceId && String(thread.instanceId) !== inst) {
      return true;
    }

    if (thread.status === "claimed") {
      try { if (typeof ctx.log === "function") ctx.log("You've already claimed what's buried here.", "info"); } catch (_) {}
      return true;
    }

    const UIO = getMod(ctx, "UIOrchestration");
    if (!UIO || typeof UIO.showConfirm !== "function") {
      try { if (typeof ctx.log === "function") ctx.log("[GM] Bottle Map requires confirm UI; skipping.", "warn"); } catch (_) {}
      return true;
    }

    // Phase 4 pacing: showing a choice prompt counts as an intervention.
    try {
      if (GM && typeof GM.recordIntervention === "function") {
        GM.recordIntervention(ctx, { kind: "confirm", channel: "marker", id: "gm.bottleMap" });
      }
    } catch (_) {}

    const onOk = () => {
      if (thread.status !== "inEncounter") {
        thread.status = "inEncounter";
        thread.attempts = (thread.attempts | 0) + 1;
        try {
          GM.onEvent(ctx, { type: "gm.bottleMap.encounterStart", interesting: false, payload: { instanceId: thread.instanceId } });
        } catch (_) {}
      }

      const started = !!startGmBottleMapEncounter(ctx);
      if (!started) {
        if (thread.status === "inEncounter") thread.status = "active";
      }
    };

    const onCancel = () => {
      try { if (typeof ctx.log === "function") ctx.log("You decide not to follow the Bottle Map right now.", "info"); } catch (_) {}
    };

    UIO.showConfirm(ctx, "Follow the Bottle Map?", null, onOk, onCancel);
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

function getBottleMapFishingConfig(ctx) {
  const DEFAULTS = { S0: 60, Smax: 180, boredomMin: 0.2, boredomMultMax: 3.0, cooldownTurns: 400 };
  try {
    const cfg = (typeof window !== "undefined" && window.GameData && window.GameData.config)
      ? window.GameData.config
      : null;

    const f = cfg && cfg.gm && cfg.gm.bottleMap && cfg.gm.bottleMap.fishing && typeof cfg.gm.bottleMap.fishing === "object"
      ? cfg.gm.bottleMap.fishing
      : null;

    let S0 = f && typeof f.S0 === "number" && Number.isFinite(f.S0) ? (f.S0 | 0) : DEFAULTS.S0;
    let Smax = f && typeof f.Smax === "number" && Number.isFinite(f.Smax) ? (f.Smax | 0) : DEFAULTS.Smax;
    let boredomMin = f && typeof f.boredomMin === "number" && Number.isFinite(f.boredomMin) ? f.boredomMin : DEFAULTS.boredomMin;
    let boredomMultMax = f && typeof f.boredomMultMax === "number" && Number.isFinite(f.boredomMultMax) ? f.boredomMultMax : DEFAULTS.boredomMultMax;
    let cooldownTurns = f && typeof f.cooldownTurns === "number" && Number.isFinite(f.cooldownTurns) ? (f.cooldownTurns | 0) : DEFAULTS.cooldownTurns;

    if (S0 < 0) S0 = 0;
    if (Smax < S0) Smax = S0;
    if (boredomMin < 0) boredomMin = 0;
    if (boredomMin > 1) boredomMin = 1;
    if (boredomMultMax < 1) boredomMultMax = 1;
    if (cooldownTurns < 0) cooldownTurns = 0;

    return { S0, Smax, boredomMin, boredomMultMax, cooldownTurns };
  } catch (_) {
    return Object.assign({}, DEFAULTS);
  }
}

function hasBottleMapInInventory(ctx) {
  try {
    const inv = (ctx && ctx.player && Array.isArray(ctx.player.inventory)) ? ctx.player.inventory : [];
    return inv.some((it) => {
      if (!it) return false;
      const k = String(it.kind || "").toLowerCase();
      if (k !== "tool") return false;
      const id = String(it.type || it.id || it.key || it.name || "").toLowerCase();
      return id === "bottle_map" || id === "bottle map" || id.includes("bottle map") || id.includes("bottle_map");
    });
  } catch (_) {
    return false;
  }
}

export function maybeAwardBottleMapFromFishing(ctx) {
  if (!ctx || !isGmEnabled(ctx)) return false;

  const GM = getMod(ctx, "GMRuntime");
  if (!GM || typeof GM.getState !== "function") return false;

  const gm = GM.getState(ctx);
  if (!gm || gm.enabled === false) return false;

  // Only one active Bottle Map thread at a time, and don't award if the player already has one.
  try {
    const thread = gm.threads && gm.threads.bottleMap && typeof gm.threads.bottleMap === "object" ? gm.threads.bottleMap : null;
    if (!thread) return false;
    if (thread.active === true) return false;
    if (hasBottleMapInInventory(ctx)) return false;

    const cfg = getBottleMapFishingConfig(ctx);

    const turn = (ctx && ctx.time && typeof ctx.time.turnCounter === "number") ? (ctx.time.turnCounter | 0) : 0;

    // Cooldown after a map award.
    const lastAwardTurn = thread.fishing && typeof thread.fishing.lastAwardTurn === "number" ? (thread.fishing.lastAwardTurn | 0) : -9999;
    if ((turn - lastAwardTurn) < (cfg.cooldownTurns | 0)) {
      if (thread.fishing) thread.fishing.totalSuccesses = (thread.fishing.totalSuccesses | 0) + 1;
      try { if (typeof GM.onEvent === "function") GM.onEvent(ctx, { type: "gm.bottleMap.fishing.success", interesting: false, payload: { awarded: false, reason: "cooldown" } }); } catch (_) {}
      return false;
    }

    // Update counters
    if (!thread.fishing || typeof thread.fishing !== "object") {
      thread.fishing = { eligibleSuccesses: 0, totalSuccesses: 0, lastAwardTurn: -9999, awardCount: 0 };
    }

    thread.fishing.totalSuccesses = (thread.fishing.totalSuccesses | 0) + 1;

    let boredom = 0;
    try {
      boredom = (gm && gm.boredom && typeof gm.boredom.level === "number" && Number.isFinite(gm.boredom.level)) ? gm.boredom.level : 0;
    } catch (_) { boredom = 0; }
    if (boredom < 0) boredom = 0;
    if (boredom > 1) boredom = 1;

    const eligible = boredom >= cfg.boredomMin;
    if (eligible) thread.fishing.eligibleSuccesses = (thread.fishing.eligibleSuccesses | 0) + 1;

    const s = thread.fishing.eligibleSuccesses | 0;
    if (!eligible || s < (cfg.S0 | 0)) {
      try { if (typeof GM.onEvent === "function") GM.onEvent(ctx, { type: "gm.bottleMap.fishing.success", interesting: false, payload: { awarded: false, eligible, s } }); } catch (_) {}
      return false;
    }

    // Probability ramp: start very low at S0 and reach near-guaranteed by Smax.
    // Multiply by boredom factor (up to boredomMultMax at boredom=1).
    const denom = Math.max(1, (cfg.Smax | 0) - (cfg.S0 | 0));
    const t = Math.max(0, Math.min(1, (s - (cfg.S0 | 0)) / denom));

    const baseChance = 0.002; // 0.2% at ramp start
    const maxChance = 0.10;   // up to 10%
    let chance = baseChance + t * (maxChance - baseChance);

    const boredomMult = 1 + boredom * (cfg.boredomMultMax - 1);
    chance *= boredomMult;

    // Hard guarantee at Smax.
    const force = s >= (cfg.Smax | 0);
    const roll = gmRngFloat(gm, null);
    const win = force || roll < chance;

    if (!win) {
      try { if (typeof GM.onEvent === "function") GM.onEvent(ctx, { type: "gm.bottleMap.fishing.success", interesting: false, payload: { awarded: false, eligible, s, chance, roll } }); } catch (_) {}
      return false;
    }

    // Award the bottle map item.
    try {
      const inv = (ctx.player && Array.isArray(ctx.player.inventory)) ? ctx.player.inventory : (ctx.player.inventory = []);
      inv.push({ kind: "tool", type: "bottle_map", id: "bottle_map", name: "bottle map", decay: 0, usable: true });
    } catch (_) {
      return false;
    }

    thread.fishing.lastAwardTurn = turn;
    thread.fishing.awardCount = (thread.fishing.awardCount | 0) + 1;
    thread.fishing.eligibleSuccesses = 0;

    try { if (typeof ctx.updateUI === "function") ctx.updateUI(); } catch (_) {}
    try { if (typeof ctx.rerenderInventoryIfOpen === "function") ctx.rerenderInventoryIfOpen(); } catch (_) {}
    try { if (typeof ctx.log === "function") ctx.log("You fished up a bottle map in a sealed bottle!", "good"); } catch (_) {}

    try { if (typeof GM.onEvent === "function") GM.onEvent(ctx, { type: "gm.bottleMap.fishing.awarded", interesting: true, payload: { turn, awardCount: thread.fishing.awardCount } }); } catch (_) {}

    return true;
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

    return { absX, absY, tries: n + 1 };
  }

  return null;
}

function ensureBottleMapMarkerIntegrity(ctx) {
  if (!ctx || !isGmEnabled(ctx)) return false;

  const GM = getMod(ctx, "GMRuntime");
  const MS = getMod(ctx, "MarkerService");
  if (!GM || !MS || typeof MS.add !== "function" || typeof MS.remove !== "function") return false;

  const gm = GM.getState(ctx);
  if (!gm || gm.enabled === false) return false;

  const thread = ensureBottleMapThread(gm);
  if (!thread) return false;

  const active = thread.active === true && thread.status !== "claimed";
  const iid = thread.instanceId != null ? String(thread.instanceId) : "";

  // If no active thread, remove orphan bottle map markers.
  if (!active || !iid) {
    try { MS.remove(ctx, (m) => m && String(m.kind || "") === "gm.bottleMap"); } catch (_) {}
    return true;
  }

  // Remove any mismatched bottle map markers (stale instanceId, including legacy markers
  // missing an instanceId). This prevents claiming the active thread reward from the wrong marker.
  try {
    MS.remove(ctx, (m) => {
      if (!m) return false;
      if (String(m.kind || "") !== "gm.bottleMap") return false;
      return String(m.instanceId || "") !== iid;
    });
  } catch (_) {}

  const target = thread.target && typeof thread.target === "object" ? thread.target : null;
  const tx = target && typeof target.absX === "number" ? (target.absX | 0) : null;
  const ty = target && typeof target.absY === "number" ? (target.absY | 0) : null;

  if (tx == null || ty == null) {
    // Thread is broken; expire it and remove marker(s).
    thread.active = false;
    thread.status = "expired";
    thread.failureReason = thread.failureReason || "missingTarget";
    try { MS.remove(ctx, (m) => m && String(m.kind || "") === "gm.bottleMap"); } catch (_) {}
    return true;
  }

  // Ensure marker exists.
  let found = false;
  try {
    const list = (ctx.world && Array.isArray(ctx.world.questMarkers)) ? ctx.world.questMarkers : [];
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m) continue;
      if (String(m.kind || "") !== "gm.bottleMap") continue;
      if (String(m.instanceId || "") !== iid) continue;
      found = true;
      break;
    }
  } catch (_) { found = false; }

  if (!found) {
    try {
      MS.add(ctx, { x: tx, y: ty, kind: "gm.bottleMap", glyph: "X", paletteKey: "gmMarker", instanceId: iid });
    } catch (_) {}
  }

  return true;
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



/**
 * GMBridge hook: called by encounter completion flow.
 */
export function onEncounterComplete(ctx, info) {
  try {
    const id = info && info.encounterId != null ? String(info.encounterId).trim().toLowerCase() : "";
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

      const outcome = info && info.outcome ? String(info.outcome).trim().toLowerCase() : "";
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
          const iid = String(thread.instanceId);
          const removed = (typeof MS.remove === "function") ? (MS.remove(ctx, { instanceId: iid }) | 0) : 0;
          // Fallback: some legacy markers may not carry instanceId as expected; do a best-effort remove.
          if (!removed && typeof MS.remove === "function") {
            MS.remove(ctx, (m) => m && String(m.kind || "") === "gm.bottleMap" && String(m.instanceId || "") === iid);
          }
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
      if (!sc) return;

      const outcome = info && info.outcome ? String(info.outcome).trim().toLowerCase() : "";
      const turn = (ctx && ctx.time && typeof ctx.time.turnCounter === "number") ? (ctx.time.turnCounter | 0) : 0;

      // Prefer the explicit active marker reference set when the player accepted the confirm.
      // Fallback: derive from worldReturnPos so we still consume the marker even if GM state
      // lost sc.active (e.g. page reload or other non-standard exit paths).
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
        try {
          const pos = ctx.worldReturnPos || null;
          if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
            absX = pos.x | 0;
            absY = pos.y | 0;
            instanceId = `surveyCache:${absX},${absY}`;

            // Prefer the actual marker's instanceId if present.
            try {
              if (typeof MS.findAt === "function") {
                const at = MS.findAt(ctx, absX, absY);
                const list = Array.isArray(at) ? at : (at ? [at] : []);
                const m = list.find(mm => mm && String(mm.kind || "") === "gm.surveyCache") || null;
                if (m && m.instanceId != null) instanceId = String(m.instanceId);
              }
            } catch (_) {}
          }
        } catch (_) {}
      }

      if (!instanceId || absX == null || absY == null) return;

      // Consume the marker on encounter completion for any outcome.
      // This prevents re-running the same cache by re-entering the encounter.
      try { removeSurveyCacheMarker(ctx, MS, { instanceId, absX, absY }); } catch (_) {}

      // Record the cache as exhausted/claimed so deterministic scan-time spawns do not respawn it.
      try { recordSurveyCacheClaim(sc, instanceId, turn); } catch (_) {}

      // Clear active regardless of whether we came from the explicit marker flow.
      sc.active = null;

      try { GM.onEvent(ctx, { type: "gm.surveyCache.encounterExit", interesting: false, payload: { outcome, instanceId } }); } catch (_) {}

      if (outcome !== "victory") {
        return;
      }

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
  // Defensive: InventoryFlow should pass a valid idx, but avoid (idx|0) pitfalls
  // (e.g. undefined|0 === 0) which could delete the wrong inventory slot.
  let consumed = false;
  try {
    const inv = Array.isArray(ctx.player.inventory) ? ctx.player.inventory : (ctx.player.inventory = []);

    let i = -1;
    if (typeof idx === "number" && Number.isFinite(idx)) i = (idx | 0);

    // Prefer strict identity match to avoid consuming the wrong item.
    if (i < 0 || i >= inv.length || inv[i] !== item) {
      const byRef = inv.indexOf(item);
      if (byRef >= 0) i = byRef;
    }

    // If the resolved index isn't a bottle map, abort.
    if (i >= 0 && i < inv.length && inv[i] && !isBottleMapItem(inv[i])) i = -1;

    if (i < 0 || i >= inv.length) {
      try { if (typeof ctx.log === "function") ctx.log("The Bottle Map slips from your fingers. Nothing happens.", "warn"); } catch (_) {}
      return true;
    }

    inv.splice(i, 1);
    consumed = true;
  } catch (_) {
    return true;
  }

  // Safety: never start a Bottle Map thread if we failed to consume the map.
  if (!consumed) return true;

  // Roll deterministic target + reward using GM RNG.
  const target = pickBottleMapTarget(ctx, gm);
  if (!target) {
    // Graceful expiry: if we can't find a valid target, do not start the thread.
    // Refund the item if we consumed it.
    try {
      if (consumed) {
        const inv = Array.isArray(ctx.player.inventory) ? ctx.player.inventory : (ctx.player.inventory = []);
        inv.push({ kind: "tool", type: "bottle_map", id: "bottle_map", name: "bottle map", decay: 0, usable: true });
      }
    } catch (_) {}

    thread.active = false;
    thread.status = "expired";
    thread.failureReason = "targetPlacementFailed";

    try { if (typeof ctx.log === "function") ctx.log("The Bottle Map's ink runs and becomes unreadable.", "warn"); } catch (_) {}
    try { GM.onEvent(ctx, { type: "gm.bottleMap.expired", interesting: false, payload: { reason: "targetPlacementFailed" } }); } catch (_) {}
    return true;
  }

  const reward = rollBottleMapReward(ctx, gm);

  const turn = (ctx && ctx.time && typeof ctx.time.turnCounter === "number") ? (ctx.time.turnCounter | 0) : 0;
  const id = `bottleMap:${turn}:${(gm && gm.rng ? (gm.rng.calls | 0) : 0)}`;

  thread.active = true;
  thread.instanceId = id;
  thread.createdTurn = turn;
  thread.status = "active";
  thread.attempts = 0;
  thread.target = { absX: target.absX, absY: target.absY };
  thread.reward = reward;
  thread.failureReason = null;
  thread.placementTries = target.tries | 0;

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

  // Ensure marker is present and stale markers are cleaned.
  try { ensureBottleMapMarkerIntegrity(ctx); } catch (_) {}

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

    if (UIO && typeof UIO.showConfirm === "function") {
      // Phase 4 (v0.3 pacing): showing a choice prompt counts as an intervention.
      try {
        if (GM && typeof GM.recordIntervention === "function") {
          GM.recordIntervention(ctx, { kind: "confirm", channel: "factionTravel", id: "guardFine" });
        }
      } catch (_) {}

      UIO.showConfirm(ctx, prompt, null, onPay, onRefuse);
      return true;
    }

    // v0.3 direction: choices only (no forced outcomes).
    // If we cannot present a confirm UI, do not auto-pay or auto-refuse.
    try {
      if (typeof ctx.log === "function") {
        ctx.log("[GM] Guard fine requires confirm UI; skipping (no forced outcome).", "warn");
      }
    } catch (_) {}

    return false;
  } catch (_) {
    try { if (ctx && typeof ctx.log === "function") ctx.log("[GM] Error handling guard fine travel event.", "warn"); } catch (_) {}
    return false;
  }
}





export function reconcileMarkers(ctx) {
  try { return !!ensureBottleMapMarkerIntegrity(ctx); } catch (_) { return false; }
}

attachGlobal("GMBridge", {
  maybeHandleWorldStep,
  handleMarkerAction,
  onEncounterComplete,
  useInventoryItem,
  maybeAwardBottleMapFromFishing,
  onWorldScanRect,
  onWorldScanTile,
  ensureGuaranteedSurveyCache,
  reconcileMarkers,
});
