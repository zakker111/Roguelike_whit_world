/**
 * ChunkedWorld (finite-first implementation with distinct biomes; groundwork for streaming)
 * Deterministic, noise-driven overworld generator producing richer, distinct biomes.
 *
 * Exports (ESM + window.ChunkedWorld):
 * - TILES: reuse World.TILES if present, else define local
 * - generate(ctx, opts?): returns { map, width, height, towns, dungeons, roads, bridges }
 * - isWalkable(tile): same semantics as World.isWalkable
 * - pickTownStart(world, rng): pick a start near a town
 *
 * Notes:
 * - This implementation generates a single finite map using seed-mixed noise fields,
 *   giving markedly distinct biomes (FOREST, DESERT, SNOW, SWAMP, BEACH, MOUNTAIN, GRASS, WATER, RIVER).
 * - It lays the foundation for true chunk-streaming later (tileAt(x,y) + chunk manager),
 *   but keeps compatibility with current renderer by returning a full map.
 */

import { attachGlobal } from "../utils/global.js";
import { getTileDef } from "../data/tile_lookup.js";

// Reuse tiles constants if available
const WT_BASE = (typeof window !== "undefined" && window.World && window.World.TILES) ? window.World.TILES : {
  WATER: 0, GRASS: 1, FOREST: 2, MOUNTAIN: 3, TOWN: 4, DUNGEON: 5,
  SWAMP: 6, RIVER: 7, BEACH: 8, DESERT: 9, SNOW: 10, TREE: 11
};
export const TILES = WT_BASE;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function inBounds(x, y, w, h) { return x >= 0 && y >= 0 && x < w && y < h; }
function mix(a, b, t) { return a * (1 - t) + b * t; }

function seededRng(ctx) {
  try {
    if (typeof window !== "undefined" && window.RNG && typeof window.RNG.rng === "function") {
      return window.RNG.rng;
    }
  } catch (_) {}
  return Math.random;
}

// Simple value-noise (tileable per octave) for deterministic fields
function makeNoise(seed) {
  function h(x, y) {
    // 2D hash -> [0,1)
    const n = (((x * 374761393) ^ (y * 668265263) ^ seed) >>> 0) & 0xffffffff;
    const m = (n ^ (n >>> 13)) >>> 0;
    return (m % 100000) / 100000;
  }
  function smoothNoise(x, y, scale) {
    // Sample four corners around (x,y), bilinear blend
    const sx = Math.floor(x / scale), sy = Math.floor(y / scale);
    const fx = (x / scale) - sx, fy = (y / scale) - sy;
    const v00 = h(sx, sy), v10 = h(sx + 1, sy), v01 = h(sx, sy + 1), v11 = h(sx + 1, sy + 1);
    const i1 = mix(v00, v10, fx);
    const i2 = mix(v01, v11, fx);
    return mix(i1, i2, fy);
  }
  // Fractal sum (3 octaves)
  return (x, y) => {
    const n1 = smoothNoise(x, y, 9);
    const n2 = smoothNoise(x, y, 23);
    const n3 = smoothNoise(x, y, 57);
    return clamp((n1 * 0.55 + n2 * 0.30 + n3 * 0.15), 0, 1);
  };
}

export function isWalkable(tile) {
  // Prefer tiles.json property; fallback: water/river/mountain not walkable
  try {
    const td = getTileDef("overworld", tile);
    if (td && td.properties && typeof td.properties.walkable === "boolean") {
      return !!td.properties.walkable;
    }
  } catch (_) {}
  return tile !== TILES.WATER && tile !== TILES.RIVER && tile !== TILES.MOUNTAIN;
}

function classifyBiome(elev, moist, temp) {
  // Distinct biome classification
  // Elevation: 0..1 (low/high), Moisture: 0..1 (dry/wet), Temp: 0..1 (cold/hot)
  // Primary bands
  if (elev < 0.22) return TILES.WATER;
  if (elev < 0.26) return TILES.BEACH;

  // Cold band -> SNOW unless very wet (SWAMP at mid elev)
  if (temp < 0.22) {
    if (elev > 0.65 && moist > 0.40) return TILES.SWAMP; // cold wet highlands
    return TILES.SNOW;
  }

  // Hot + dry -> DESERT
  if (temp > 0.68 && moist < 0.28) {
    if (elev > 0.70) return TILES.MOUNTAIN; // rocky mesas
    return TILES.DESERT;
  }

  // Mid elevations: forests vs plains vs swamps
  if (moist > 0.62) {
    if (elev > 0.70) return TILES.MOUNTAIN;
    return TILES.SWAMP;
  }
  if (moist > 0.40) {
    return TILES.FOREST;
  }
  // High elevation mountains
  if (elev > 0.78) return TILES.MOUNTAIN;

  return TILES.GRASS;
}

function carveRivers(map, width, height, seed) {
  // Generate flow field from elevation gradient: follow decreasing elevation
  // For simplicity, reuse noise again as pseudo-elevation for river path drift
  const noise = makeNoise(seed ^ 0x9e3779b9);
  const riverAttempts = Math.max(3, Math.floor((width + height) / 40));
  for (let i = 0; i < riverAttempts; i++) {
    // Start at a random highland near top/left/right edges
    let x = (Math.random() * width) | 0;
    let y = (Math.random() * Math.min(12, Math.floor(height * 0.20))) | 0;
    let steps = (width + height) * 2;
    while (steps-- > 0 && inBounds(x, y, width, height)) {
      // Carve
      map[y][x] = TILES.RIVER;
      // widen occasionally
      if (Math.random() < 0.35) {
        if (inBounds(x + 1, y, width, height)) map[y][x + 1] = TILES.RIVER;
        if (inBounds(x - 1, y, width, height)) map[y][x - 1] = TILES.RIVER;
      }
      // Drift "downhill": bias y+ to go south; add lateral noise-based meander
      const m = noise(x * 0.8, y * 0.8);
      const turn = m < 0.33 ? -1 : (m > 0.66 ? 1 : 0);
      if (Math.random() < 0.80) y += 1; // southward bias
      x += turn;
      if (!inBounds(x, y, width, height)) break;
    }
  }
}

function scatterPOIs(world, rng) {
  const { map, width, height } = world;
  const towns = [];
  const dungeons = [];

  function nearWater(x, y, rad = 4) {
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const nx = x + dx, ny = y + dy;
        if (!inBounds(nx, ny, width, height)) continue;
        const t = map[ny][nx];
        if (t === TILES.WATER || t === TILES.RIVER || t === TILES.BEACH) return true;
      }
    }
    return false;
  }

  // Towns: prefer GRASS/FOREST/BEACH; allow occasional DESERT/SNOW
  const townTarget = Math.max(12, Math.floor((width * height) / 800));
  let placedT = 0, attemptsT = townTarget * 300;
  while (placedT < townTarget && attemptsT-- > 0) {
    const x = (rng() * width) | 0;
    const y = (rng() * height) | 0;
    const t = map[y][x];
    if (!(t === TILES.GRASS || t === TILES.FOREST || t === TILES.BEACH || t === TILES.DESERT || t === TILES.SNOW)) continue;
    // prefer near water
    if (!nearWater(x, y, 5) && rng() > 0.12) continue;
    const sizeRand = rng();
    const size = sizeRand < 0.60 ? "small" : (sizeRand < 0.90 ? "big" : "city");
    map[y][x] = TILES.TOWN;
    towns.push({ x, y, size });
    placedT++;
  }

  // Dungeons: prefer FOREST/MOUNTAIN; occasional GRASS/DESERT/SNOW
  const dungTarget = Math.max(20, Math.floor((width * height) / 600));
  let placedD = 0, attemptsD = dungTarget * 300;
  while (placedD < dungTarget && attemptsD-- > 0) {
    const x = (rng() * width) | 0;
    const y = (rng() * height) | 0;
    const t = map[y][x];
    const ok = (t === TILES.FOREST || t === TILES.MOUNTAIN) ||
               ((t === TILES.GRASS || t === TILES.DESERT || t === TILES.SNOW) && rng() < 0.20);
    if (!ok) continue;
    map[y][x] = TILES.DUNGEON;
    const level = 1 + ((rng() * rng() * 5) | 0);
    const size = (t === TILES.MOUNTAIN) ? "large" : (t === TILES.FOREST ? (rng() < 0.5 ? "medium" : "small") : "small");
    dungeons.push({ x, y, level, size });
    placedD++;
  }

  world.towns = towns;
  world.dungeons = dungeons;
}

function connectPOIs(world) {
  const { map, width, height, towns, dungeons } = world;
  const roads = [];
  const bridges = [];
  const roadSet = new Set(), bridgeSet = new Set();

  function addRoadPoint(x, y) { const k = `${x},${y}`; if (!roadSet.has(k)) { roadSet.add(k); roads.push({ x, y }); } }
  function addBridgePoint(x, y) { const k = `${x},${y}`; if (!bridgeSet.has(k)) { bridgeSet.add(k); bridges.push({ x, y }); } }

  function carveRoad(x0, y0, x1, y1) {
    let x = x0, y = y0;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      if (inBounds(x, y, width, height)) {
        const t = map[y][x];
        if (t === TILES.WATER || t === TILES.RIVER) { map[y][x] = TILES.BEACH; addBridgePoint(x, y); }
        else if (t === TILES.MOUNTAIN) { map[y][x] = TILES.GRASS; }
        addRoadPoint(x, y);
      }
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }
  function nearest(list, p) {
    let best = null, bd = Infinity;
    for (const q of list) {
      const d = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }

  for (const t of towns) {
    const t2 = nearest(towns.filter(x => x !== t), t);
    if (t2) carveRoad(t.x, t.y, t2.x, t2.y);
    const d = nearest(dungeons, t);
    if (d) carveRoad(t.x, t.y, d.x, d.y);
  }

  world.roads = roads;
  world.bridges = bridges;
}

export function generate(ctx, opts = {}) {
  const rng = seededRng(ctx);
  const width = clamp((opts.width | 0) || 200, 64, 512);
  const height = clamp((opts.height | 0) || 140, 64, 512);

  const seed = (() => {
    try {
      if (typeof window !== "undefined" && window.RNG && typeof window.RNG.getSeed === "function") {
        const s = window.RNG.getSeed();
        if (typeof s === "number") return s >>> 0;
        if (typeof s === "string") return (Number(s) >>> 0) || 0;
      } else if (typeof localStorage !== "undefined") {
        const sRaw = localStorage.getItem("SEED");
        if (sRaw != null) return (Number(sRaw) >>> 0) || 0;
      }
    } catch (_) {}
    return 1337 >>> 0;
  })();

  const noiseElev = makeNoise(seed ^ 0xa2f1e1);
  const noiseMoist = makeNoise(seed ^ 0xb7c3a9);
  const noiseTemp = makeNoise(seed ^ 0xc9f2d6);

  const map = Array.from({ length: height }, () => Array(width).fill(TILES.GRASS));

  // Latitude temperature bias: colder near top, hotter near bottom
  const latBias = (y) => clamp(y / (height - 1), 0, 1);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const e = noiseElev(x, y);
      const m = noiseMoist(x, y);
      const t = clamp(noiseTemp(x, y) * 0.6 + latBias(y) * 0.4, 0, 1);
      const tile = classifyBiome(e, m, t);
      map[y][x] = tile;
    }
  }

  // Carve rivers after base biomes
  carveRivers(map, width, height, seed);

  const world = { map, width, height, towns: [], dungeons: [], roads: [], bridges: [] };
  scatterPOIs(world, rng);
  connectPOIs(world);
  return world;
}

export function pickTownStart(world, rng) {
  const r = (typeof rng === "function") ? rng : seededRng();
  if (world.towns && world.towns.length) {
    // Prefer towns near a dungeon
    const radius = 20;
    const townsNearDungeon = world.towns.filter(t => (world.dungeons || []).some(d => Math.abs(d.x - t.x) + Math.abs(d.y - t.y) <= radius));
    if (townsNearDungeon.length) return townsNearDungeon[(r() * townsNearDungeon.length) | 0];
    return world.towns[(r() * world.towns.length) | 0];
  }
  // Fallback to a walkable tile near any dungeon
  const ds = world.dungeons || [];
  if (ds.length) {
    const d = ds[(r() * ds.length) | 0];
    const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
    if (isWalkable(world.map[d.y][d.x])) return { x: d.x, y: d.y };
    for (const dir of dirs) {
      const nx = d.x + dir.dx, ny = d.y + dir.dy;
      if (inBounds(nx, ny, world.width, world.height) && isWalkable(world.map[ny][nx])) return { x: nx, y: ny };
    }
  }
  // First walkable tile
  for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
    if (isWalkable(world.map[y][x])) return { x, y };
  }
  return { x: 1, y: 1 };
}

// Attach to window and export for ESM
attachGlobal("ChunkedWorld", { TILES, generate, isWalkable, pickTownStart });
export default { TILES, generate, isWalkable, pickTownStart };