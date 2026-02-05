/**
 * RegionMapRuntime
 * Lightweight, fixed-size overlay map shown from overworld when pressing G on a walkable tile.
 *
 * Quick usage:
 * - Press G on a walkable overworld tile (not town/dungeon) to open.
 * - Move with arrows; orange edge tiles are exits; press G on an edge to close.
 * - Context actions: loot underfoot, pick berries, cut trees, fish near water (requires a fishing pole).
 * - Neutral animals may spawn and wander; presence is persisted per overworld tile.
 *
 * Exports (ESM + window.RegionMapRuntime):
 * - open(ctx, size?): builds a local downscaled view of the world and enters "region" mode.
 * - close(ctx): returns to overworld at the same coordinates where G was pressed.
 * - tryMove(ctx, dx, dy): moves the region cursor within bounds; respects overworld walkability.
 * - onAction(ctx): pressing G inside region map; closes only when on an orange edge tile.
 * - tick(ctx): optional no-op hook.
 */
import * as World from "../world/world.js";
import { getTileDef, getTileDefByKey } from "../data/tile_lookup.js";
import { getMod, getRNGUtils, getUIOrchestration, getGameData } from "../utils/access.js";
import { attachGlobal } from "../utils/global.js";
import { spawnInDungeon, syncFollowersFromDungeon } from "../core/followers_runtime.js";
import {
  clamp,
  buildLocalDownscaled,
  countBiomes,
  addMinorWaterAndBeaches,
  collectNeighborSet,
  choosePrimaryTile,
  filterSampleByNeighborSet,
  computeDirectionalTiles,
  orientSampleByCardinals,
  addSparseTreesInForests,
  addBerryBushesInForests
} from "./region_map_sampling.js";
import {
  applyRegionCuts,
  addRegionCut,
  regionCutKey,
  saveRegionState,
  loadRegionState,
  markAnimalsSeen,
  markAnimalsCleared,
  animalsSeenHere,
  animalsClearedHere
} from "./region_map_persistence.js";

const DEFAULT_WIDTH = 28;
const DEFAULT_HEIGHT = 18;



/**
 * Deterministic RNG for region map based on global seed and world position
 */
function _mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getRegionRng(ctx) {
  let base = 0 >>> 0;
  try {
    if (typeof window !== "undefined" && window.RNG && typeof window.RNG.getSeed === "function") {
      const s = window.RNG.getSeed();
      if (typeof s === "number") base = (s >>> 0);
      else if (typeof s === "string") base = (Number(s) >>> 0) || 0;
    } else if (typeof localStorage !== "undefined") {
      const sRaw = localStorage.getItem("SEED");
      if (sRaw != null) base = (Number(sRaw) >>> 0) || 0;
    }
  } catch (_) {}
  const px = (ctx && ctx.player && typeof ctx.player.x === "number") ? (ctx.player.x | 0) : 0;
  const py = (ctx && ctx.player && typeof ctx.player.y === "number") ? (ctx.player.y | 0) : 0;
  const mix = (((px & 0xffff) | ((py & 0xffff) << 16)) ^ base) >>> 0;
  return _mulberry32(mix);
}

// RNG helper: prefer ctx.RNGUtils via access helper
function getRU(ctx) {
  try {
    return getRNGUtils(ctx);
  } catch (_) {
    return null;
  }
}

function open(ctx, size) {
  if (!ctx || ctx.mode !== "world" || !ctx.world || !ctx.world.map) return false;
  // Capture world position for persistence keying
  const worldX = ctx.player.x | 0;
  const worldY = ctx.player.y | 0;
  // Only allow from walkable, non-town, non-dungeon tiles
  const WT = World.TILES;
  const tileHere = ctx.world.map[worldY][worldX];
  // Disallow from towns/dungeons; allow RUINS explicitly even if not walkable in overworld semantics
  if (tileHere === WT.TOWN || tileHere === WT.DUNGEON) return false;

  // Allow entering RUINS even when standing adjacent: retarget the region anchor to the neighboring RUINS tile
  let anchorX = worldX, anchorY = worldY;
  let anchorTile = tileHere;
  if (anchorTile !== WT.RUINS) {
    const worldW = (ctx.world && (ctx.world.width || (ctx.world.map[0] ? ctx.world.map[0].length : 0))) || 0;
    const worldH = (ctx.world && (ctx.world.height || ctx.world.map.length)) || 0;
    outer: for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = worldX + dx, ny = worldY + dy;
        if (nx < 0 || ny < 0 || nx >= worldW || ny >= worldH) continue;
        const nt = ctx.world.map[ny][nx];
        if (nt === WT.RUINS) {
          anchorX = nx; anchorY = ny; anchorTile = WT.RUINS;
          break outer;
        }
      }
    }
  }

  let isWalkable = true;
  try {
    isWalkable = (typeof World.isWalkable === "function") ? World.isWalkable(tileHere) : true;
  } catch (_) { isWalkable = true; }
  const allowNonWalkableHere = (anchorTile === WT.RUINS);
  if (!isWalkable && !allowNonWalkableHere) return false;
  const RU = getRU(ctx);
  const rng = getRegionRng(ctx);

  const width = clamp((size && size.width) || DEFAULT_WIDTH, 12, 80);
  const height = clamp((size && size.height) || DEFAULT_HEIGHT, 8, 60);

  // If persisted state exists for this tile (anchor), load it; else build a fresh sample.
  const persisted = loadRegionState(anchorX, anchorY);
  let sample = null;
  let restoredCorpses = null;
  let loadedPersisted = false;
  if (persisted && Array.isArray(persisted.map) && (persisted.w | 0) === width && (persisted.h | 0) === height) {
    sample = persisted.map;
    restoredCorpses = Array.isArray(persisted.corpses) ? persisted.corpses : [];
    loadedPersisted = true;
  } else {
    // Build local sample reflecting biomes near the anchor (RUINS if adjacent, otherwise player tile).
    sample = buildLocalDownscaled(ctx.world, anchorX, anchorY, width, height);
  }

  // If animals were previously cleared for this tile (anchor), do not spawn new ones this session.
  const animalsCleared = animalsClearedHere(anchorX, anchorY);

  // Restrict the region map to only the immediate neighbor biomes around the player (+ current tile)
  // and perform decorative transforms ONLY when not loading a previously persisted region state.
  if (!loadedPersisted) {
    const playerTile = anchorTile;
    const { set: neighborSet, counts: neighborCounts } = collectNeighborSet(ctx.world, anchorX, anchorY);
    neighborSet.add(playerTile);
    const primaryTile = choosePrimaryTile(neighborCounts, playerTile);
    filterSampleByNeighborSet(sample, neighborSet, primaryTile);

    // Orient biomes by robust directional sampling (cardinals + diagonals) to line up with overworld (anchored at RUINS when adjacent)
    const dirs = computeDirectionalTiles(ctx.world, anchorX, anchorY, 7);
    orientSampleByCardinals(sample, dirs.cardinals, 0.33, dirs.diagonals, dirs.weights);

    // Enhance per rules: minor water ponds in uniform grass/forest and shoreline beaches near water
    // rng precomputed above for the whole open() scope
    addMinorWaterAndBeaches(sample, rng);
    // Sprinkle sparse trees and scarce berry bushes for region visualization/foraging
    addSparseTreesInForests(sample, 0.10, rng);
    addBerryBushesInForests(sample, 0.025, rng);
    // Apply persisted cuts for this region so trees/bushes don't respawn
    try {
      const cutKey = regionCutKey(anchorX, anchorY, width, height);
      applyRegionCuts(sample, cutKey);
      // Stash key for onAction persistence
      if (!ctx.region) ctx.region = {};
      ctx.region._cutKey = cutKey;
    } catch (_) {}
  } else {
    // Persisted map is authoritative; do not mutate it. Still set cut key so new cuts can be recorded.
    try {
      const cutKey = regionCutKey(anchorX, anchorY, width, height);
      if (!ctx.region) ctx.region = {};
      ctx.region._cutKey = cutKey;
    } catch (_) {}
  }

  // PHASE 2: Ruins decoration and encounter setup on RUINS tiles
  const isRuins = (anchorTile === World.TILES.RUINS);
  if (isRuins) {
    // Only decorate/spawn if there is no persisted map for this tile (respect persistence)
    if (!loadedPersisted) {
      // Resolve RUIN_WALL id from tileset (region scope); fallback to MOUNTAIN if missing
      let ruinWallId = World.TILES.MOUNTAIN;
      try {
        const td = getTileDefByKey("region", "RUIN_WALL");
        if (td && typeof td.id === "number") ruinWallId = td.id | 0;
      } catch (_) {}
      // Draw a broken ring + scattered ruin walls
      (function decorateRuins() {
        const h = sample.length, w = sample[0] ? sample[0].length : 0;
        if (!w || !h) return;
        const cx = (w / 2) | 0, cy = (h / 2) | 0;
        // Footprint rectangle around center
        const rw = Math.max(8, Math.floor(w * 0.5));
        const rh = Math.max(6, Math.floor(h * 0.45));
        const x0 = Math.max(1, cx - (rw >> 1));
        const y0 = Math.max(1, cy - (rh >> 1));
        const x1 = Math.min(w - 2, x0 + rw);
        const y1 = Math.min(h - 2, y0 + rh);

        // Safe setter to guard against out-of-bounds indexing
        const setTileSafe = (yy, xx, val) => {
          if (yy >= 0 && yy < h && xx >= 0 && xx < w && sample[yy]) {
            sample[yy][xx] = val;
          }
        };

        // Perimeter with gaps
        for (let x = x0; x <= x1; x++) {
          if (RU && typeof RU.chance === "function" ? RU.chance(0.87, rng) : (rng() > 0.13)) setTileSafe(y0, x, ruinWallId);
          if (RU && typeof RU.chance === "function" ? RU.chance(0.87, rng) : (rng() > 0.13)) setTileSafe(y1, x, ruinWallId);
        }
        for (let y = y0; y <= y1; y++) {
          if (RU && typeof RU.chance === "function" ? RU.chance(0.87, rng) : (rng() > 0.13)) setTileSafe(y, x0, ruinWallId);
          if (RU && typeof RU.chance === "function" ? RU.chance(0.87, rng) : (rng() > 0.13)) setTileSafe(y, x1, ruinWallId);
        }
        // Open 3–5 random gaps in the ring to create entrances
        const gaps = 3 + ((rng() * 3) | 0);
        for (let i = 0; i < gaps; i++) {
          const side = (rng() * 4) | 0;
          if (side === 0) { // top
            const gx = x0 + 1 + ((rng() * Math.max(1, rw - 2)) | 0);
            setTileSafe(y0, gx, World.TILES.GRASS);
            setTileSafe(y0, Math.max(gx - 1, x0 + 1), World.TILES.GRASS);
            setTileSafe(y0, Math.min(gx + 1, x1 - 1), World.TILES.GRASS);
            setTileSafe(y0 + 1, gx, World.TILES.GRASS);
            setTileSafe(y0 + 1, Math.max(gx - 1, x0 + 1), World.TILES.GRASS);
          } else if (side === 1) { // bottom
            const gx = x0 + 1 + ((rng() * Math.max(1, rw - 2)) | 0);
            setTileSafe(y1, gx, World.TILES.GRASS);
            setTileSafe(y1, Math.max(gx - 1, x0 + 1), World.TILES.GRASS);
            setTileSafe(y1, Math.min(gx + 1, x1 - 1), World.TILES.GRASS);
            setTileSafe(y1 - 1, gx, World.TILES.GRASS);
            setTileSafe(y1 - 1, Math.max(gx - 1, x0 + 1), World.TILES.GRASS);
          } else if (side === 2) { // left
            const gy = y0 + 1 + ((rng() * Math.max(1, rh - 2)) | 0);
            setTileSafe(gy, x0, World.TILES.GRASS);
            setTileSafe(Math.max(gy - 1, y0 + 1), x0, World.TILES.GRASS);
            setTileSafe(Math.min(gy + 1, y1 - 1), x0, World.TILES.GRASS);
            setTileSafe(gy, x0 + 1, World.TILES.GRASS);
            setTileSafe(Math.max(gy - 1, y0 + 1), x0 + 1, World.TILES.GRASS);
          } else { // right
            const gy = y0 + 1 + ((rng() * Math.max(1, rh - 2)) | 0);
            setTileSafe(gy, x1, World.TILES.GRASS);
            setTileSafe(Math.max(gy - 1, y0 + 1), x1, World.TILES.GRASS);
            setTileSafe(Math.min(gy + 1, y1 - 1), x1, World.TILES.GRASS);
            setTileSafe(gy, x1 - 1, World.TILES.GRASS);
            setTileSafe(Math.max(gy - 1, y0 + 1), x1 - 1, World.TILES.GRASS);
          }
        }
        // Scatter interior short ruin segments/pillars
        const segs = 4 + ((rw + rh) / 6) | 0;
        for (let i = 0; i < segs; i++) {
          const horiz = rng() < 0.5;
          const len = 2 + ((rng() * 4) | 0);
          const sx = Math.max(x0 + 2, Math.min(x1 - 2, x0 + 2 + ((rng() * Math.max(1, rw - 4)) | 0)));
          const sy = Math.max(y0 + 2, Math.min(y1 - 2, y0 + 2 + ((rng() * Math.max(1, rh - 4)) | 0)));
          for (let k = 0; k < len; k++) {
            const x = (sx + (horiz ? k : 0)) | 0;
            const y = (sy + (horiz ? 0 : k)) | 0;
            if (x <= x0 || y <= y0 || x >= x1 || y >= y1) continue;
            if (RU && typeof RU.chance === "function" ? RU.chance(0.85, rng) : (rng() < 0.85)) setTileSafe(y, x, ruinWallId);
          }
        }
        // Ensure an inner clearing ring for mobility around center
        for (let y = cy - 2; y <= cy + 2; y++) {
          for (let x = cx - 2; x <= cx + 2; x++) {
            if (x > 0 && y > 0 && x < w - 1 && y < h - 1) {
              if (sample[y] && sample[y][x] === ruinWallId) setTileSafe(y, x, World.TILES.GRASS);
            }
          }
        }
      })();
    }
  }

  const exitNorth = { x: (width / 2) | 0, y: 0 };
  const exitSouth = { x: (width / 2) | 0, y: height - 1 };
  const exitWest = { x: 0, y: (height / 2) | 0 };
  const exitEast = { x: width - 1, y: (height / 2) | 0 };

  // Compute region-map coordinate corresponding to the player's world position within the sampled window
  const worldW = (ctx.world && (ctx.world.width || (ctx.world.map[0] ? ctx.world.map[0].length : 0))) || 0;
  const worldH = (ctx.world && (ctx.world.height || ctx.world.map.length)) || 0;
  const winW = clamp(Math.floor(worldW * 0.35), 12, worldW);
  const winH = clamp(Math.floor(worldH * 0.35), 8, worldH);
  const minX = clamp(anchorX - Math.floor(winW / 2), 0, Math.max(0, worldW - winW));
  const minY = clamp(anchorY - Math.floor(winH / 2), 0, Math.max(0, worldH - winH));
  let spawnX = Math.round(((anchorX - minX) * (width - 1)) / Math.max(1, (winW - 1)));
  let spawnY = Math.round(((anchorY - minY) * (height - 1)) / Math.max(1, (winH - 1)));
  spawnX = clamp(spawnX, 0, width - 1);
  spawnY = clamp(spawnY, 0, height - 1);

  // On enter: choose a walkable edge tile near the mapped point (avoid WATER/RIVER/MOUNTAIN)
  function regionWalkableAt(x, y) {
    const h2 = sample.length, w2 = sample[0] ? sample[0].length : 0;
    if (x < 0 || y < 0 || x >= w2 || y >= h2) return false;
    try {
      const t = sample[y][x];
      // Prefer tiles.json walkability if present
      const def = getTileDef("region", t);
      if (def && def.properties && typeof def.properties.walkable === "boolean") return !!def.properties.walkable;
      // Fallback to overworld semantics
      try { return !!World.isWalkable(t); } catch (_) {}
      const WT = World.TILES;
      return (t !== WT.WATER && t !== WT.RIVER && t !== WT.MOUNTAIN);
    } catch (_) { return true; }
  }
  function nearestWalkableOnEdge(edge) {
    if (edge === "N") {
      const y = 0;
      let x0 = clamp(spawnX, 0, width - 1);
      if (regionWalkableAt(x0, y)) return { x: x0, y };
      for (let r = 1; r < width; r++) {
        const xl = x0 - r, xr = x0 + r;
        if (xl >= 0 && regionWalkableAt(xl, y)) return { x: xl, y };
        if (xr < width && regionWalkableAt(xr, y)) return { x: xr, y };
      }
      return null;
    } else if (edge === "S") {
      const y = height - 1;
      let x0 = clamp(spawnX, 0, width - 1);
      if (regionWalkableAt(x0, y)) return { x: x0, y };
      for (let r = 1; r < width; r++) {
        const xl = x0 - r, xr = x0 + r;
        if (xl >= 0 && regionWalkableAt(xl, y)) return { x: xl, y };
        if (xr < width && regionWalkableAt(xr, y)) return { x: xr, y };
      }
      return null;
    } else if (edge === "W") {
      const x = 0;
      let y0 = clamp(spawnY, 0, height - 1);
      if (regionWalkableAt(x, y0)) return { x, y: y0 };
      for (let r = 1; r < height; r++) {
        const yu = y0 - r, yd = y0 + r;
        if (yu >= 0 && regionWalkableAt(x, yu)) return { x, y: yu };
        if (yd < height && regionWalkableAt(x, yd)) return { x, y: yd };
      }
      return null;
    } else { // "E"
      const x = width - 1;
      let y0 = clamp(spawnY, 0, height - 1);
      if (regionWalkableAt(x, y0)) return { x, y: y0 };
      for (let r = 1; r < height; r++) {
        const yu = y0 - r, yd = y0 + r;
        if (yu >= 0 && regionWalkableAt(x, yu)) return { x, y: yu };
        if (yd < height && regionWalkableAt(x, yd)) return { x, y: yd };
      }
      return null;
    }
  }

  const candidates = [];
  const Np = nearestWalkableOnEdge("N"); if (Np) candidates.push(Np);
  const Sp = nearestWalkableOnEdge("S"); if (Sp) candidates.push(Sp);
  const Wp = nearestWalkableOnEdge("W"); if (Wp) candidates.push(Wp);
  const Ep = nearestWalkableOnEdge("E"); if (Ep) candidates.push(Ep);

  if (!candidates.length) {
    // Fallback: scan entire border for any walkable tile
    for (let x = 0; x < width; x++) {
      if (regionWalkableAt(x, 0)) candidates.push({ x, y: 0 });
      if (regionWalkableAt(x, height - 1)) candidates.push({ x, y: height - 1 });
    }
    for (let y = 0; y < height; y++) {
      if (regionWalkableAt(0, y)) candidates.push({ x: 0, y });
      if (regionWalkableAt(width - 1, y)) candidates.push({ x: width - 1, y });
    }
  }

  if (candidates.length) {
    let best = candidates[0], bestD = Infinity;
    for (const c of candidates) {
      const d = Math.abs(c.x - spawnX) + Math.abs(c.y - spawnY);
      if (d < bestD) { bestD = d; best = c; }
    }
    spawnX = best.x | 0;
    spawnY = best.y | 0;
  } else {
    // Final fallback: keep nearest of four standard exits
    const exits = [exitNorth, exitSouth, exitWest, exitEast];
    let bestExit = exits[0];
    let bestDist = Infinity;
    for (const e of exits) {
      const d = Math.abs((e.x | 0) - spawnX) + Math.abs((e.y | 0) - spawnY);
      if (d < bestDist) { bestDist = d; bestExit = e; }
    }
    spawnX = bestExit.x | 0;
    spawnY = bestExit.y | 0;
  }

  // Build final exit tiles: replace the relevant edge midpoint with the chosen spawn tile to avoid duplicate/extra markers
  let eN = exitNorth, eS = exitSouth, eW = exitWest, eE = exitEast;
  if (spawnY === 0) {
    eN = { x: spawnX | 0, y: 0 };
  } else if (spawnY === height - 1) {
    eS = { x: spawnX | 0, y: (height - 1) | 0 };
  } else if (spawnX === 0) {
    eW = { x: 0, y: spawnY | 0 };
  } else if (spawnX === width - 1) {
    eE = { x: (width - 1) | 0, y: spawnY | 0 };
  }
  const exitTilesFinal = [eN, eS, eW, eE];

  ctx.region = {
    ...(ctx.region || {}),
    width,
    height,
    map: sample,
    cursor: { x: spawnX | 0, y: spawnY | 0 },
    // Exits: four edges; the spawn edge uses the exact chosen tile to avoid duplicates
    exitTiles: exitTilesFinal,
    enterWorldPos: { x: anchorX, y: anchorY },
    _prevLOS: ctx.los || null,
    _hasKnownAnimals: animalsSeenHere(anchorX, anchorY)
  };

  // Region behaves like a normal mode: use region map as active map and player follows cursor
  ctx.map = sample;
  // Initialize FOV memory and visibility (unseen by default; recomputeFOV will fill visible)
  ctx.seen = Array.from({ length: height }, () => Array(width).fill(false));
  ctx.visible = Array.from({ length: height }, () => Array(width).fill(false));
  // Reset transient region entities state; enemies are per-region-session only
  ctx.enemies = [];
  // Clear decals so blood stains from other modes/regions don't leak into this region session
  try { ctx.decals = []; } catch (_) { ctx.decals = []; }
  // Restore corpses saved for this region if present; otherwise clear to avoid bleed from previous region tiles
  try {
    if (restoredCorpses && Array.isArray(restoredCorpses)) {
      ctx.corpses = restoredCorpses;
    } else {
      ctx.corpses = [];
    }
  } catch (_) { ctx.corpses = []; }
  // Move player to region cursor (camera centers on player)
  ctx.player.x = ctx.region.cursor.x | 0;
  ctx.player.y = ctx.region.cursor.y | 0;

  // Override LOS transparency in region mode without mutating the original LOS object:
  // mountains block FOV, other biomes are transparent. Preserve hasLOS if present.
  try {
    const WT2 = World.TILES;
    const prevLOS = ctx.los || null;
    const prevTileTransparent = prevLOS && typeof prevLOS.tileTransparent === "function" ? prevLOS.tileTransparent : null;
    ctx.region._prevLOS = prevLOS;
    ctx.region._prevTileTransparent = prevTileTransparent;

    const regionLOS = {
      tileTransparent: (c, x, y) => {
        const rows = c.map.length;
        const cols = rows ? (c.map[0] ? c.map[0].length : 0) : 0;
        if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
        const t = c.map[y][x];
        // Prefer tiles.json properties if present
        const td = getTileDef("region", t);
        if (td && td.properties && typeof td.properties.blocksFOV === "boolean") {
          return !td.properties.blocksFOV;
        }
        // Fallback: mountains and trees block FOV
        if (WT2 && (t === WT2.MOUNTAIN || t === WT2.TREE)) return false;
        return true;
      },
    };
    // Preserve hasLOS pass-through if the previous LOS provided it
    if (prevLOS && typeof prevLOS.hasLOS === "function") {
      regionLOS.hasLOS = (c, x0, y0, x1, y1) => prevLOS.hasLOS(c, x0, y0, x1, y1);
    }
    ctx.los = regionLOS;
  } catch (_) {}

  ctx.mode = "region";

  // Spawn player follower/ally into the Region map, if configured.
  // This is called once on entering region mode so followers are present
  // for both generic regions and ruins encounters.
  try {
    spawnInDungeon(ctx);
  } catch (_) {}

  // PHASE 2: Ruins encounter (enemies + loot) setup. Skip if cleared or persisted map restored.
  (function spawnRuinsEncounter() {
    try {
      const WT = World.TILES;
      const isRuinsHere = (ctx.world && ctx.world.map && ctx.world.map[anchorY][anchorX] === WT.RUINS);
      if (!isRuinsHere) return;
      // If animalsCleared is set for this tile, treat ruins as cleared as well (shared flag)
      if (animalsCleared) {
        try { ctx.log && ctx.log("These ruins are quiet; no hostiles remain.", "info"); } catch (_) {}
        return;
      }
      // If we restored a persisted map state, assume encounter already handled
      if (loadedPersisted) return;

      const h = ctx.region.map.length;
      const w = ctx.region.map[0] ? ctx.region.map[0].length : 0;
      if (!w || !h) return;

      // Resolve ruin wall id for walkability/FOV checks
      let ruinWallId = WT.MOUNTAIN;
      try {
        const td = getTileDefByKey("region", "RUIN_WALL");
        if (td && typeof td.id === "number") ruinWallId = td.id | 0;
      } catch (_) {}

      function walkableAt(x, y) {
        if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1) return false;
        const t = ctx.region.map[y][x];
        // Prefer tiles.json property
        try {
          const def = getTileDef("region", t);
          if (def && def.properties && typeof def.properties.walkable === "boolean") return !!def.properties.walkable;
        } catch (_) {}
        // Fallback to World.isWalkable on overworld semantics
        try { return !!World.isWalkable(t); } catch (_) {}
        return true;
      }
      function free(x, y) {
        if (!walkableAt(x, y)) return false;
        if (x === (ctx.player.x | 0) && y === (ctx.player.y | 0)) return false;
        if (Array.isArray(ctx.enemies) && ctx.enemies.some(e => e && e.x === x && e.y === y)) return false;
        return true;
      }

      // Prefer interior of the ruin footprint: find bounding box of ruin walls and pick inside
      function pickInteriorSpot(tries = 200) {
        // Compute rough center and inward search
        const cx = (w / 2) | 0, cy = (h / 2) | 0;
        for (let t = 0; t < tries; t++) {
          const rx = cx + (((rng() * 7) | 0) - 3);
          const ry = cy + (((rng() * 5) | 0) - 2);
          const x = clamp(rx, 1, w - 2), y = clamp(ry, 1, h - 2);
          if (free(x, y)) return { x, y };
        }
        // Fallback: any free walkable
        for (let t = 0; t < tries; t++) {
          const x = (rng() * w) | 0;
          const y = (rng() * h) | 0;
          if (free(x, y)) return { x, y };
        }
        return null;
      }

      // Create enemies using Enemies definitions only (JSON-only)
      function createEnemyOfType(x, y, type) {
        try {
          const EM = ctx.Enemies || getMod(ctx, "Enemies");
          if (EM && typeof EM.getTypeDef === "function") {
            const td = EM.getTypeDef(type);
            if (td) {
              const depth = 1;
              const e = {
                x, y,
                type,
                glyph: (td.glyph && td.glyph.length) ? td.glyph : ((type && type.length) ? type.charAt(0) : "?"),
                hp: td.hp(depth),
                atk: td.atk(depth),
                xp: td.xp(depth),
                level: (EM.levelFor && typeof EM.levelFor === "function") ? EM.levelFor(type, depth, ctx.rng) : depth,
                announced: false
              };
              // Faction derived from type label
              const s = String(type || "").toLowerCase();
              e.faction = s.includes("bandit") ? "bandit" : (s.includes("orc") ? "orc" : "monster");
              return e;
            }
          }
        } catch (_) {}
        // Fallback enemy: visible '?' for debugging in Ruins
        try { ctx.log && ctx.log(`Fallback enemy spawned in ruins (type '${type}' not defined).`, "warn"); } catch (_) {}
        return { x, y, type: type || "fallback_enemy", glyph: "?", hp: 3, atk: 1.0, xp: 5, level: 1, faction: "monster", announced: false };
      }

      // Enemy lineup: a mix of skeleton/bandit/mime_ghost (matches data/entities/enemies.json)
      const choices = ["skeleton", "bandit", "mime_ghost"];
      const n = 2 + ((rng() * 3) | 0); // 2–4
      ctx.enemies = Array.isArray(ctx.enemies) ? ctx.enemies : [];
      let placed = 0;
      for (let i = 0; i < n; i++) {
        const spot = pickInteriorSpot(200);
        if (!spot) break;
        const t = choices[(rng() * choices.length) | 0];
        const e = createEnemyOfType(spot.x, spot.y, t);
        if (e) {
          ctx.enemies.push(e);
          placed++;
        }
      }

      // Place 1–2 lootable corpses/chests inside
      try {
        const L = ctx.Loot || getMod(ctx, "Loot");
        const chestCount = 1 + ((rng() * 2) | 0);
        for (let i = 0; i < chestCount; i++) {
          const spot = pickInteriorSpot(180);
          if (!spot) break;
          const loot = (L && typeof L.generate === "function") ? (L.generate(ctx, { type: "bandit", xp: 12 }) || []) : [{ kind: "gold", amount: 6, name: "gold" }];
          ctx.corpses.push({ kind: "chest", x: spot.x, y: spot.y, loot, looted: loot.length === 0 });
        }
      } catch (_) {}

      // Mark encounter-active for AI/tick and guidance
      ctx.region._isEncounter = true;
      try { ctx.log && ctx.log("Hostiles lurk within the ruins!", "info"); } catch (_) {}
    } catch (_) {}
  })();

  // Rare neutral animals in region: deer/boar/fox that wander; become hostile only if attacked.
  if (!(anchorTile === World.TILES.RUINS)) (function spawnNeutralAnimals() {
    try {
      // If animals were cleared previously in this region, skip spawning and inform player
      if (animalsCleared) {
        try { ctx.log && ctx.log("This area has been cleared; creatures won’t respawn here.", "info"); } catch (_) {}
        return;
      }
      const WT = World.TILES;
      // Use the deterministic region RNG defined in open()
      const sample = ctx.region.map;
      const h = sample.length, w = sample[0] ? sample[0].length : 0;
      if (!w || !h) return;

      // If animals were already seen here in a prior visit, reduce the chance to spawn again (60% allowed)
      const seenBefore = animalsSeenHere(anchorX, anchorY);
      if (seenBefore && rng() >= 0.40) {
        try { ctx.log && ctx.log("No creatures spotted in this area.", "info"); } catch (_) {}
        return;
      }

      // Base rarity: prefer zero animals; only 0–1 may spawn in sufficiently wild areas.
      const { counts } = countBiomes(sample);
      const totalCells = w * h;
      const forestBias = (counts[WT.FOREST] || 0) / totalCells;
      const grassBias = (counts[WT.GRASS] || 0) / totalCells;
      const beachBias = (counts[WT.BEACH] || 0) / totalCells;
      const desertBias = (counts[WT.DESERT] || 0) / totalCells;
      const snowBias = (counts[WT.SNOW] || 0) / totalCells;
      const swampBias = (counts[WT.SWAMP] || 0) / totalCells;
      const mountainBias = (counts[WT.MOUNTAIN] || 0) / totalCells;
      // Wildness excludes BEACH to reduce unrealistic shoreline spawns
      const wildFrac = forestBias + grassBias;

      // Gate: skip spawns unless area is fairly wild or the player stands on a wild tile
      const playerTileWild = (function () {
        try {
          const tHere = ctx.world.map[worldY][worldX];
          return (tHere === WT.FOREST || tHere === WT.GRASS);
        } catch (_) { return false; }
      })();
      if (wildFrac < 0.30 && !playerTileWild) {
        try { ctx.log && ctx.log("No creatures spotted in this area.", "info"); } catch (_) {}
        return;
      }
      // Heavily non-wild or rugged biomes suppress spawns
      if (desertBias + snowBias + swampBias > 0.30 || mountainBias > 0.20) {
        try { ctx.log && ctx.log("No creatures spotted in this area.", "info"); } catch (_) {}
        return;
      }

      // Probability for at most a single animal (forest/grass weighted)
      let pOne = Math.max(0, Math.min(0.6, 0.10 + forestBias * 0.40 + grassBias * 0.25));
      // Survivalism slightly increases chance to spot animals (up to +5%)
      try {
        const s = (ctx.player && ctx.player.skills) ? ctx.player.skills : null;
        if (s) {
          const survBuff = Math.max(0, Math.min(0.05, Math.floor((s.survivalism || 0) / 25) * 0.01));
          pOne = Math.min(0.75, pOne * (1 + survBuff));
        }
      } catch (_) {}
      const spawnOne = (typeof RU !== "undefined" && RU && typeof RU.chance === "function") ? RU.chance(pOne, rng) : (rng() < pOne);
      let count = spawnOne ? 1 : 0;

      if (count <= 0) {
        try { ctx.log && ctx.log("No creatures spotted in this area.", "info"); } catch (_) {}
        return;
      }

      ctx.enemies = Array.isArray(ctx.enemies) ? ctx.enemies : [];
      // Map a tile id to a biome key used in spawnWeight (FOREST, GRASS, BEACH, etc.)
      function tileKeyFor(t) {
        try {
          const WT2 = World.TILES;
          for (const k of Object.keys(WT2)) {
            if (WT2[k] === t) return k;
          }
        } catch (_) {}
        return "";
      }
      // Pick animal definition from GameData.animals using biome-weighted selection (with sensible fallbacks)
      function pickAnimalDef() {
        try {
          const fallbackAnimals = [
            {
              id: "deer", glyph: "d", hp: 3, atk: 0.6,
              spawnWeight: { FOREST: 0.7, GRASS: 0.5, BEACH: 0.0, DESERT: 0.0, SNOW: 0.1, SWAMP: 0.2, MOUNTAIN: 0.0 }
            },
            {
              id: "fox", glyph: "f", hp: 2, atk: 0.7,
              spawnWeight: { FOREST: 0.6, GRASS: 0.4, BEACH: 0.0, DESERT: 0.0, SNOW: 0.2, SWAMP: 0.1, MOUNTAIN: 0.0 }
            },
            {
              id: "boar", glyph: "b", hp: 4, atk: 0.9,
              spawnWeight: { FOREST: 0.5, GRASS: 0.3, BEACH: 0.0, DESERT: 0.0, SNOW: 0.1, SWAMP: 0.4, MOUNTAIN: 0.0 }
            }
          ];
          const GD = getGameData(ctx);
          const arrRaw = GD && Array.isArray(GD.animals) ? GD.animals : null;
          // Ensure minimal shape consistency on loaded rows (id, glyph, hp, atk, spawnWeight)
          const arr = (arrRaw && arrRaw.length) ? arrRaw : fallbackAnimals;
          const WT2 = World.TILES;
          // Compute biome fractions for spawn weighting
          const { counts: cnts, total } = countBiomes(sample);
          function frac(key) {
            try {
              const tileId = WT2[key];
              const c = cnts[tileId] || 0;
              return total ? (c / total) : 0;
            } catch (_) { return 0; }
          }
          // Score each animal by sum(weight[biome] * fraction(biome))
          const scores = arr.map((a) => {
            const sw = (a && a.spawnWeight && typeof a.spawnWeight === "object") ? a.spawnWeight : {};
            let s = 0;
            for (const k in sw) {
              const wv = Number(sw[k] || 0);
              if (wv > 0) s += wv * frac(k);
            }
            // Small base weight to avoid zero-probability when biome is sparse
            s += 0.01;
            return Math.max(0, s);
          });
          const sum = scores.reduce((acc, v) => acc + v, 0);
          if (sum <= 0) return arr[((rng() * arr.length) | 0)];
          let r = rng() * sum;
          for (let i = 0; i < arr.length; i++) {
            r -= scores[i];
            if (r <= 0) return arr[i];
          }
          return arr[arr.length - 1];
        } catch (_) {
          // Fallback hard default if something goes wrong
          return { id: "deer", glyph: "d", hp: 3, atk: 0.6, spawnWeight: { FOREST: 1.0, GRASS: 0.5 } };
        }
      }
      // Choose a valid walkable position for a given animal def respecting its spawnWeight (>0 for tile biome)
      function pickPosForAnimal(def, preferNear, cx, cy) {
        const hasWeight = (key) => {
          try { return def && def.spawnWeight && Number(def.spawnWeight[key] || 0) > 0; } catch (_) { return false; }
        };
        function tryNear(radius) {
          for (let tries = 0; tries < 160; tries++) {
            const dx = ((rng() * (radius * 2 + 1)) | 0) - radius;
            const dy = ((rng() * (radius * 2 + 1)) | 0) - radius;
            const x = cx + dx;
            const y = cy + dy;
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            if (Math.abs(dx) + Math.abs(dy) > radius) continue;
            const t = sample[y][x];
            const walkable = (t !== WT.WATER && t !== WT.RIVER && t !== WT.MOUNTAIN);
            const occupied = ctx.enemies.some(e => e && e.x === x && e.y === y);
            const atCursor = (ctx.region.cursor && ctx.region.cursor.x === x && ctx.region.cursor.y === y);
            const key = tileKeyFor(t);
            if (walkable && !occupied && !atCursor && hasWeight(key)) return { x, y };
          }
          return null;
        }
        function tryAnywhere() {
          for (let tries = 0; tries < 240; tries++) {
            const x = (rng() * w) | 0;
            const y = (rng() * h) | 0;
            const t = sample[y][x];
            const walkable = (t !== WT.WATER && t !== WT.RIVER && t !== WT.MOUNTAIN);
            const occupied = ctx.enemies.some(e => e && e.x === x && e.y === y);
            const atCursor = (ctx.region.cursor && ctx.region.cursor.x === x && ctx.region.cursor.y === y);
            const key = tileKeyFor(t);
            if (walkable && !occupied && !atCursor && hasWeight(key)) return { x, y };
          }
          return null;
        }
        if (preferNear) {
          const near = tryNear(6);
          if (near) return near;
        }
        return tryAnywhere();
      }

      let spawned = 0;
      const cx0 = (ctx.region.cursor && typeof ctx.region.cursor.x === "number") ? (ctx.region.cursor.x | 0) : 0;
      const cy0 = (ctx.region.cursor && typeof ctx.region.cursor.y === "number") ? (ctx.region.cursor.y | 0) : 0;

      for (let i = 0; i < count; i++) {
        const def = pickAnimalDef();
        const pos = pickPosForAnimal(def, i === 0, cx0, cy0);
        if (!pos) continue;
        const typeId = (def && def.id) ? def.id : (def && def.type) ? def.type : null;
        const glyph = (def && def.glyph) ? def.glyph : (typeId && typeId[0]) ? typeId[0] : "?";
        const hp = (def && typeof def.hp === "number") ? def.hp : 3;
        const atk = (def && typeof def.atk === "number") ? def.atk : 0.8;

        // Prefer per-species color from animals.json; fall back to generic regionAnimal overlay color.
        let color = null;
        try {
          if (def && typeof def.color === "string" && def.color.trim()) {
            color = def.color;
          } else {
            const pal = (typeof window !== "undefined"
              && window.GameData
              && window.GameData.palette
              && window.GameData.palette.overlays)
              ? window.GameData.palette.overlays
              : null;
            color = (pal && pal.regionAnimal) ? pal.regionAnimal : "#e9d5a1";
          }
        } catch (_) {
          color = "#e9d5a1";
        }

        ctx.enemies.push({
          x: pos.x,
          y: pos.y,
          type: typeId || "animal",
          glyph,
          hp,
          atk,
          xp: 0,
          level: 1,
          faction: "animal",
          color,
          announced: false
        });
        spawned++;
      }

      // Persist animal presence for this region (world coordinates) so we remember later
      try {
        if (spawned > 0 && ctx.region && ctx.region.enterWorldPos) {
          markAnimalsSeen(anchorX | 0, anchorY | 0);
          // Survivalism skill gain for spotting wildlife
          try { ctx.player.skills = ctx.player.skills || {}; ctx.player.skills.survivalism = (ctx.player.skills.survivalism || 0) + 1; } catch (_) {}
          // Also update flag in this session
          ctx.region._hasKnownAnimals = true;

          try {
            const SS = ctx.StateSync || getMod(ctx, "StateSync");
            if (SS && typeof SS.applyAndRefresh === "function") {
              SS.applyAndRefresh(ctx, {});
            }
          } catch (_) {}
          // Count how many are currently visible to the player
          let visibleCount = 0;
          try {
            const vis = Array.isArray(ctx.visible) ? ctx.visible : [];
            const rows = vis.length | 0;
            const cols = rows ? ((vis[0] && vis[0].length) | 0) : 0;
            for (const e of ctx.enemies) {
              if (!e) continue;
              const ex = (e.x | 0), ey = (e.y | 0);
              if (ey >= 0 && ex >= 0 && ey < rows && ex < cols) {
                if (vis[ey] && vis[ey][ex]) { visibleCount++; break; }
              }
            }
          } catch (_) {}

          if (visibleCount > 0) {
            try { ctx.log && ctx.log(`Creatures spotted (${spawned}).`, "info"); } catch (_) {}
          } else {
            try { ctx.log && ctx.log("Creatures are present in this areaea, but not in sight.", "info"); } catch (_) {}
          }
        } else {
          try { ctx.log && ctx.log("No creatures spotted in this area.", "info"); } catch (_) {}
        }
      } catch (_) {}
    } catch (_) {}
  })();

  try {
    const SS = ctx.StateSync || getMod(ctx, "StateSync");
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    }
  } catch (_) {}
  if (ctx.log) ctx.log("Region map opened. Move with arrows. Press G on an orange edge tile to close.", "info");
  return true;
}

function close(ctx) {
  if (!ctx || ctx.mode !== "region") return false;
  // Save current region state so reopening at this tile restores it
  try { saveRegionState(ctx); } catch (_) {}

  // Sync follower/ally runtime HP back to player data before leaving the region.
  try {
    syncFollowersFromDungeon(ctx);
  } catch (_) {}

  // Restore world view and player position at the exact coordinates where G was pressed
  const pos = ctx.region && ctx.region.enterWorldPos ? ctx.region.enterWorldPos : null;
  // Restore previous LOS transparency (object and original function) to avoid breaking dungeon FOV.
  try {
    const prevLOS = ctx.region && ctx.region._prevLOS ? ctx.region._prevLOS : null;
    const prevTileTransparent = ctx.region && ctx.region._prevTileTransparent ? ctx.region._prevTileTransparent : null;
    if (prevLOS) {
      // If we accidentally mutated the original object earlier, ensure its tileTransparent is restored.
      if (ctx.los === prevLOS && prevTileTransparent) {
        try { ctx.los.tileTransparent = prevTileTransparent; } catch (_) {}
      } else {
        ctx.los = prevLOS;
        if (prevTileTransparent && ctx.los) {
          try { ctx.los.tileTransparent = prevTileTransparent; } catch (_) {}
        }
      }
    } else {
      // No previous LOS; remove the region-specific LOS to allow default behavior.
      try { delete ctx.los; } catch (_) { ctx.los = null; }
    }
  } catch (_) {}

  ctx.mode = "world";
  // Restore active map to world without revealing unexplored tiles
  if (ctx.world && ctx.world.map) {
    ctx.map = ctx.world.map;
    const rows = ctx.map.length;
    const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
    if (Array.isArray(ctx.world.seenRef) && Array.isArray(ctx.world.visibleRef)) {
      ctx.seen = ctx.world.seenRef;
      ctx.visible = ctx.world.visibleRef;
    } else {
      ctx.seen = Array.from({ length: rows }, () => Array(cols).fill(false));
      ctx.visible = Array.from({ length: rows }, () => Array(cols).fill(false));
      try {
        if (typeof ctx.inBounds === "function" && ctx.inBounds(ctx.player.x, ctx.player.y)) {
          ctx.seen[ctx.player.y][ctx.player.x] = true;
          ctx.visible[ctx.player.y][ctx.player.x] = true;
        }
      } catch (_) {}
    }
  }

  if (pos) {
    ctx.player.x = pos.x | 0;
    ctx.player.y = pos.y | 0;
  }

  // Refresh via StateSync so minimap/FOV/UI update
  try {
    const SS = ctx.StateSync || getMod(ctx, "StateSync");
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    }
  } catch (_) {}

  if (ctx.log) ctx.log("Region map closed.", "info");
  return true;
}

function tryMove(ctx, dx, dy) {
  if (!ctx || ctx.mode !== "region" || !ctx.region) return false;
  const cur = ctx.region.cursor || { x: 0, y: 0 };
  const w = ctx.region.width | 0, h = ctx.region.height | 0;
  const nx = clamp(cur.x + (dx | 0), 0, w - 1);
  const ny = clamp(cur.y + (dy | 0), 0, h - 1);
  if (nx === cur.x && ny === cur.y) return false;

  // Respect overworld walkability (water/river/mountain are not walkable)
  const row = ctx.region.map[ny] || [];
  const tile = row[nx];
  let walkable = true;
  try {
    const WT = World.TILES;
    const def = getTileDef("region", tile);
    if (def && def.properties && typeof def.properties.walkable === "boolean") {
      walkable = !!def.properties.walkable;
    } else {
      const isWalkableWorld = (typeof World.isWalkable === "function") ? World.isWalkable : null;
      walkable = isWalkableWorld ? !!isWalkableWorld(tile) : (WT ? (tile !== WT.WATER && tile !== WT.RIVER && tile !== WT.MOUNTAIN) : true);
    }
  } catch (_) {}

  // Non-walkable tiles (e.g., water/river/mountain) cannot be entered in region mode
  if (!walkable) return false;

  // Allow bump interactions on any enemy occupying the target tile
  let enemy = null;
  if (Array.isArray(ctx.enemies)) {
    try { enemy = ctx.enemies.find(e => e && e.x === nx && e.y === ny) || null; } catch (_) { enemy = null; }
  }
  if (enemy) {
    // Followers: open follower inspect panel instead of attacking.
    try {
      if (enemy._isFollower) {
        const UIO = getUIOrchestration(ctx) || getMod(ctx, "UIOrchestration");
        if (UIO && typeof UIO.showFollower === "function") {
          UIO.showFollower(ctx, enemy);
          return true;
        }
      }
    } catch (_) {}

    // If this is a neutral animal, make it hostile when attacked and mark region as an encounter
    try {
      if (String(enemy.faction || "") === "animal") {
        enemy.faction = "animal_hostile";
        ctx.region._isEncounter = true;
        ctx.log && ctx.log(`The ${enemy.type} turns hostile!`, "warn");
      }
    } catch (_) {}
    const C = ctx.Combat || getMod(ctx, "Combat");
    if (C && typeof C.playerAttackEnemy === "function") {
      try { C.playerAttackEnemy(ctx, enemy); } catch (_) {}
    } else {
      const msg = "ERROR: Combat.playerAttackEnemy missing; combat fallback path would be used (region).";
      try { ctx.log && ctx.log(msg, "bad"); } catch (_) {}
      try { console.error(msg); } catch (_) {}
    }
    try { typeof ctx.turn === "function" && ctx.turn(); } catch (_) {}
    return true;
  }
  // Move cursor and player together in Region Map
  try {
    if (ctx.region && ctx.region.cursor) {
      ctx.region.cursor.x = nx; ctx.region.cursor.y = ny;
    }
  } catch (_) {}
  ctx.player.x = nx; ctx.player.y = ny;

  try {
    const SS = ctx.StateSync || getMod(ctx, "StateSync");
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    }
  } catch (_) {}
  try { typeof ctx.turn === "function" && ctx.turn(); } catch (_) {}
  return true;
}

function onAction(ctx) {
  if (!ctx || ctx.mode !== "region" || !ctx.region) return false;
  const { cursor, exitTiles } = ctx.region;
  const onExit = exitTiles.some(e => e.x === cursor.x && e.y === cursor.y);
  if (onExit) {
    close(ctx);
    return true;
  }

  // Context actions inside region:
  // 1) Loot corpse/chest underfoot — mirror dungeon flavor (cause-of-death) while using shared Loot for items
  try {
    const list = Array.isArray(ctx.corpses) ? ctx.corpses : [];
    const underfoot = list.filter(c => c && c.x === cursor.x && c.y === cursor.y);
    if (underfoot.length) {
      // Show corpse flavor consistently (victim, wound, killer, weapon/likely cause) before looting.
      try {
        const FS = (typeof window !== "undefined" ? window.FlavorService : null);
        if (FS && typeof FS.describeCorpse === "function") {
          for (const c of underfoot) {
            const meta = c && c.meta;
            if (meta && (meta.killedBy || meta.wound || meta.via || meta.likely)) {
              const line = FS.describeCorpse(meta);
              if (line) ctx.log && ctx.log(line, "flavor", { category: "Combat", side: "enemy", tone: "injury" });
            }
          }
        }
      } catch (_) {}

      // Determine whether there is any remaining loot underfoot
      const containersWithLoot = underfoot.filter(c => Array.isArray(c.loot) && c.loot.length > 0);

      if (containersWithLoot.length === 0) {
        // No items left: behave like dungeon lootHere for empty corpses/chests, but persist via Region state.
        let newlyExamined = 0;
        let examinedChestCount = 0;
        let examinedCorpseCount = 0;
        for (const c of underfoot) {
          c.looted = true;
          if (!c._examined) {
            c._examined = true;
            newlyExamined++;
            if (String(c.kind || "").toLowerCase() === "chest") examinedChestCount++;
            else examinedCorpseCount++;
          }
        }
        if (newlyExamined > 0) {
          let line = "";
          if (examinedChestCount > 0 && examinedCorpseCount === 0) {
            line = examinedChestCount === 1
              ? "You search the chest but find nothing."
              : "You search the chests but find nothing.";
          } else if (examinedCorpseCount > 0 && examinedChestCount === 0) {
            line = examinedCorpseCount === 1
              ? "You search the corpse but find nothing."
              : "You search the corpses but find nothing.";
          } else {
            line = "You search the area but find nothing.";
          }
          ctx.log && ctx.log(line);
        }
        // Persist emptied containers in Region Map state and advance time
        try { saveRegionState(ctx); } catch (_) {}
        if (typeof ctx.updateUI === "function") ctx.updateUI();
        if (typeof ctx.turn === "function") ctx.turn();
        return true;
      }

      // There is real loot underfoot: delegate to Loot subsystem for transfer/UI.
      const L = ctx.Loot || getMod(ctx, "Loot");
      if (!L || typeof L.lootHere !== "function") {
        throw new Error("Loot.lootHere missing; loot system cannot proceed in Region Map");
      }
      L.lootHere(ctx);
      // Persist region state immediately so looted containers remain emptied on reopen
      try { saveRegionState(ctx); } catch (_) {}
      return true;
    }
  } catch (_) {}

  // 2) Harvest berry bush or chop tree if standing on those tiles
  try {
    const WT = World.TILES;
    const t = (ctx.region.map[cursor.y] && ctx.region.map[cursor.y][cursor.x]);

    if (t === WT.BERRY_BUSH) {
      // Pick berries and remove bush (convert to forest)
      try {
        const inv = ctx.player.inventory || (ctx.player.inventory = []);
        const existing = inv.find(it => it && it.kind === "material" && (String(it.name || it.type || "").toLowerCase() === "berries"));
        if (existing) {
          if (typeof existing.amount === "number") existing.amount += 1;
          else if (typeof existing.count === "number") existing.count += 1;
          else existing.amount = 1;
        } else {
          inv.push({ kind: "material", type: "berries", name: "berries", amount: 1 });
        }
        // Foraging skill gain
        try { ctx.player.skills = ctx.player.skills || {}; ctx.player.skills.foraging = (ctx.player.skills.foraging || 0) + 1; } catch (_) {}
        if (ctx.log) ctx.log("You pick berries.", "info");
        // Remove the bush so it can't be farmed repeatedly
        ctx.region.map[cursor.y][cursor.x] = World.TILES.FOREST;
        // Persist removal
        try {
          if (ctx.region && typeof ctx.region._cutKey === "string" && ctx.region._cutKey) {
            addRegionCut(ctx.region._cutKey, cursor.x | 0, cursor.y | 0);
          }
        } catch (_) {}
        if (typeof ctx.updateUI === "function") ctx.updateUI();
        try {
          const SS = ctx.StateSync || getMod(ctx, "StateSync");
          if (SS && typeof SS.applyAndRefresh === "function") {
            SS.applyAndRefresh(ctx, {});
          }
        } catch (_) {}
      } catch (_) {}
      return true;
    }

    if (t === WT.TREE) {
      // Log and convert this spot back to forest for visualization
      if (ctx.log) ctx.log("You cut the tree.", "info");
      try {
        // Foraging skill gain
        try { ctx.player.skills = ctx.player.skills || {}; ctx.player.skills.foraging = (ctx.player.skills.foraging || 0) + 1; } catch (_) {}
        ctx.region.map[cursor.y][cursor.x] = World.TILES.FOREST;
        // Reflect change via orchestrator refresh
        try {
          const SS = ctx.StateSync || getMod(ctx, "StateSync");
          if (SS && typeof SS.applyAndRefresh === "function") {
            SS.applyAndRefresh(ctx, {});
          }
        } catch (_) {}
      } catch (_) {}

      // Grant planks material in inventory (stacking)
      try {
        const inv = ctx.player.inventory || (ctx.player.inventory = []);
        const existing = inv.find(it => it && it.kind === "material" && (it.type === "wood" || it.material === "wood") && (String(it.name || "").toLowerCase() === "planks"));
        if (existing) {
          if (typeof existing.amount === "number") existing.amount += 10;
          else if (typeof existing.count === "number") existing.count += 10;
          else existing.amount = 10;
        } else {
          inv.push({ kind: "material", type: "wood", name: "planks", amount: 10 });
        }
        if (typeof ctx.updateUI === "function") ctx.updateUI();
      } catch (_) {}

      // Persist cut so this tree does not respawn next time for this region
      try {
        if (ctx.region && typeof ctx.region._cutKey === "string" && ctx.region._cutKey) {
          addRegionCut(ctx.region._cutKey, cursor.x | 0, cursor.y | 0);
        }
      } catch (_) {}

      return true;
    }
  } catch (_) {}

  // 3) Fishing: if adjacent to water/river and player has a fishing pole, prompt to start mini-game
  try {
    const WT = World.TILES;
    const inBounds = (x, y) => {
      const h = ctx.region.map.length;
      const w = ctx.region.map[0] ? ctx.region.map[0].length : 0;
      return x >= 0 && y >= 0 && x < w && y < h;
    };
    const isWater = (x, y) => {
      if (!inBounds(x, y)) return false;
      try {
        const tt = ctx.region.map[y][x];
        return (tt === WT.WATER || tt === WT.RIVER);
      } catch (_) { return false; }
    };
    const nearWater = (
      isWater(cursor.x + 1, cursor.y) ||
      isWater(cursor.x - 1, cursor.y) ||
      isWater(cursor.x, cursor.y + 1) ||
      isWater(cursor.x, cursor.y - 1) ||
      isWater(cursor.x + 1, cursor.y + 1) ||
      isWater(cursor.x - 1, cursor.y + 1) ||
      isWater(cursor.x + 1, cursor.y - 1) ||
      isWater(cursor.x - 1, cursor.y - 1)
    );

    const hasPole = (function () {
      try {
        const inv = ctx.player.inventory || [];
        return inv.some(it => {
          if (!it) return false;
          const nm = String(it.name || it.type || "").toLowerCase();
          if (it.kind === "tool" && nm.includes("fishing pole")) return true;
          if (it.kind !== "tool" && nm.includes("fishing pole")) return true;
          return false;
        });
      } catch (_) { return false; }
    })();

    if (nearWater && hasPole) {
      const UIO = getUIOrchestration(ctx);
      const UB = ctx.UIBridge || getMod(ctx, "UIBridge");
      const onOk = () => {
        if (UB && typeof UB.showFishing === "function") {
          UB.showFishing(ctx, { minutesPerAttempt: 15, difficulty: 0.55 });
        } else {
          const FM = getMod(ctx, "FishingModal");
          if (FM && typeof FM.show === "function") {
            FM.show(ctx, { minutesPerAttempt: 15, difficulty: 0.55 });
          } else {
            try { ctx.log && ctx.log("Fishing UI not available.", "warn"); } catch (_) {}
          }
        }
      };
      const onCancel = () => {};
      if (UIO && typeof UIO.showConfirm === "function") {
        UIO.showConfirm(ctx, "Fish here? (15 min)", null, onOk, onCancel);
      } else {
        // No confirm UI; start immediately
        onOk();
      }
      return true;
    } else if (nearWater && !hasPole) {
      try { ctx.log && ctx.log("You need a fishing pole to fish here.", "info"); } catch (_) {}
      return true;
    }
  } catch (_) {}

  if (ctx.log) ctx.log("Move to an orange edge tile and press G to close the Region map.", "info");
  return true;
}

function tick(ctx) {
  if (!ctx || ctx.mode !== "region") return true;

  // If an encounter is active within the region map, drive simple AI and completion check
  if (ctx.region && ctx.region._isEncounter) {
    try {
      const AIH = ctx.AI || getMod(ctx, "AI");
      if (AIH && typeof AIH.enemiesAct === "function") {
        AIH.enemiesAct(ctx);
      }
    } catch (_) {}
    try {
      const OF = ctx.OccupancyFacade || getMod(ctx, "OccupancyFacade");
      if (OF && typeof OF.rebuild === "function") OF.rebuild(ctx);
    } catch (_) {}
    // Victory: no enemies remain — keep player in Region Map (no auto-close or victory log)
    try {
      if (!Array.isArray(ctx.enemies) || ctx.enemies.length === 0) {
        ctx.region._isEncounter = false;
        ctx.encounterInfo = null;
        // Also mark this overworld tile as cleared to prevent future animal spawns
        try {
          const pos = ctx.region && ctx.region.enterWorldPos ? ctx.region.enterWorldPos : null;
          if (pos) markAnimalsCleared(pos.x | 0, pos.y | 0);
        } catch (_) {}
      }
    } catch (_) {}
  } else {
    // Neutral animals wander slowly even when not in an encounter
    try {
      const RU = getRU(ctx);
      const rfn = (RU && typeof RU.getRng === "function")
        ? RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
        : ((typeof ctx.rng === "function") ? ctx.rng : null);

      const sample = (ctx.region && ctx.region.map) ? ctx.region.map : null;
      const h = sample ? sample.length : 0;
      const w = h ? (sample[0] ? sample[0].length : 0) : 0;
      if (w && h && Array.isArray(ctx.enemies) && ctx.enemies.length) {
        function walkableAt(x, y) {
          if (x < 0 || y < 0 || x >= w || y >= h) return false;
          const t = sample[y][x];
          // Prefer tiles.json walkability if present
          try {
            const def = getTileDef("region", t);
            if (def && def.properties && typeof def.properties.walkable === "boolean") return !!def.properties.walkable;
          } catch (_) {}
          // Fallback to overworld semantics
          try { return !!World.isWalkable(t); } catch (_) {}
          const WT = World.TILES;
          return (t !== WT.WATER && t !== WT.RIVER && t !== WT.MOUNTAIN);
        }
        function occupiedAt(x, y) {
          if (x === (ctx.player.x | 0) && y === (ctx.player.y | 0)) return true;
          return ctx.enemies.some(e => e && e.x === x && e.y === y);
        }

        let anyMoved = false;
        for (const e of ctx.enemies) {
          if (!e) continue;
          if (String(e.faction || "") !== "animal") continue;
          // 30% chance to attempt a small random step
          const chance = 0.30;
          const rv = (typeof rfn === "function") ? rfn() : Math.random();
          if (rv >= chance) continue;

          // Try a few random neighbor steps to find a valid move
          for (let tries = 0; tries < 6; tries++) {
            const dx = (((typeof rfn === "function" ? rfn() : Math.random()) * 3) | 0) - 1;
            const dy = (((typeof rfn === "function" ? rfn() : Math.random()) * 3) | 0) - 1;
            if (!dx && !dy) continue;
            const nx = e.x + dx, ny = e.y + dy;
            if (!walkableAt(nx, ny)) continue;
            if (occupiedAt(nx, ny)) continue;
            e.x = nx; e.y = ny;
            anyMoved = true;
            break;
          }
        }

        if (anyMoved) {
          try {
            const OF = ctx.OccupancyFacade || getMod(ctx, "OccupancyFacade");
            if (OF && typeof OF.rebuild === "function") OF.rebuild(ctx);
          } catch (_) {}
          try {
            const SS = ctx.StateSync || getMod(ctx, "StateSync");
            if (SS && typeof SS.applyAndRefresh === "function") SS.applyAndRefresh(ctx, {});
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  // Visual: fade blood decals over time in Region Map (ruins/forest encounters)
  try {
    const DC = ctx.Decals || getMod(ctx, "Decals");
    if (DC && typeof DC.tick === "function") {
      DC.tick(ctx);
    } else if (Array.isArray(ctx.decals) && ctx.decals.length) {
      for (let i = 0; i < ctx.decals.length; i++) {
        ctx.decals[i].a *= 0.92;
      }
      ctx.decals = ctx.decals.filter(d => d.a > 0.04);
    }
  } catch (_) {}

  return true;
}

// Back-compat: attach to window
attachGlobal("RegionMapRuntime", {
  open,
  close,
  tryMove,
  onAction,
  tick,
  // Persistence helpers for animals memory/clear state (per-tile exports)
  markAnimalsCleared,
  animalsClearedHere,
  markAnimalsSeen,
  animalsSeenHere
});