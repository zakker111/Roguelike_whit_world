/**
 * ChunkedWorld (streaming-capable, noise-driven biomes)
 * Deterministic, noise-driven overworld with helper APIs for sampling by absolute world coordinates.
 *
 * Exports (ESM + window.ChunkedWorld):
 * - TILES: reuse World.TILES if present, else define local
 * - generate(ctx, opts?): returns { map, width, height, origin:{x0,y0}, towns, dungeons, roads, bridges, seed }
 * - isWalkable(tile)
 * - pickTownStart(world, rng)
 * - tileAt(world, x, y): sample a tile at absolute world coordinates
 * - recompose(world, centerX, centerY, width, height): rebuild world.map window around absolute center
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
  if (elev < 0.22) return TILES.WATER;
  if (elev < 0.26) return TILES.BEACH;

  if (temp < 0.22) {
    if (elev > 0.65 && moist > 0.40) return TILES.SWAMP;
    return TILES.SNOW;
  }

  if (temp > 0.68 && moist < 0.28) {
    if (elev > 0.70) return TILES.MOUNTAIN;
    return TILES.DESERT;
  }

  if (moist > 0.62) {
    if (elev > 0.70) return TILES.MOUNTAIN;
    return TILES.SWAMP;
  }
  if (moist > 0.40) {
    return TILES.FOREST;
  }

  if (elev > 0.78) return TILES.MOUNTAIN;
  return TILES.GRASS;
}

// River mask based on banded noise; forms long continuous stripes
function riverMask(noise, x, y) {
  const v = noise(x * 0.7, y * 0.7);
  // Near threshold bands become rivers
  const band = Math.abs(v - 0.5);
  return band < 0.015; // thin river bands
}

function latBias(height, y) { return clamp(y / (height || 1), 0, 1); }

function makeSampler(seed) {
  const noiseElev = makeNoise(seed ^ 0xa2f1e1);
  const noiseMoist = makeNoise(seed ^ 0xb7c3a9);
  const noiseTemp = makeNoise(seed ^ 0xc9f2d6);
  return (x, y) => {
    const e = noiseElev(x, y);
    const m = noiseMoist(x, y);
    const t = clamp(noiseTemp(x, y) * 0.6 + latBias(1024, y) * 0.4, 0, 1);
    let tile = classifyBiome(e, m, t);
    if (riverMask(noiseElev, x, y)) tile = TILES.RIVER;
    return tile;
  };
}

// Deterministic POIs in a rect by hashing coords
function getPOIsInRect(sampler, x0, y0, w, h) {
  const towns = [];
  const dungeons = [];
  function hash(x, y) {
    const n = (((x * 73856093) ^ (y * 19349663)) >>> 0) & 0xffffffff;
    return n;
  }
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const t = sampler(x, y);
      const hv = hash(x, y);
      // towns near water/shore: chance gated
      if ((t === TILES.GRASS || t === TILES.FOREST || t === TILES.BEACH || t === TILES.DESERT || t === TILES.SNOW) && ((hv & 0xfff) === 0)) {
        const sizePick = (hv >>> 12) & 0xff;
        const size = sizePick < 140 ? "small" : (sizePick < 230 ? "big" : "city");
        towns.push({ x, y, size });
      }
      // dungeons in forest/mountain; occasional plains/desert/snow
      if ((t === TILES.FOREST || t === TILES.MOUNTAIN || ((t === TILES.GRASS || t === TILES.DESERT || t === TILES.SNOW) && ((hv & 0x3ff) === 0x1f))) && ((hv & 0x7fff) === 0x1234)) {
        const level = 1 + ((hv >>> 16) % 5);
        const size = (t === TILES.MOUNTAIN) ? "large" : (t === TILES.FOREST ? "medium" : "small");
        dungeons.push({ x, y, level, size });
      }
    }
  }
  return { towns, dungeons };
}

// Build a composite window map by sampling absolute coords
function buildComposite(sampler, centerX, centerY, width, height) {
  const w = clamp(width | 0, 48, 256);
  const h = clamp(height | 0, 48, 256);
  const x0 = (centerX | 0) - (w / 2) | 0;
  const y0 = (centerY | 0) - (h / 2) | 0;
  const map = Array.from({ length: h }, () => Array(w).fill(TILES.GRASS));
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const wx = x0 + xx;
      const wy = y0 + yy;
      map[yy][xx] = sampler(wx, wy);
    }
  }
  const { towns, dungeons } = getPOIsInRect(sampler, x0, y0, w, h);
  return { map, width: w, height: h, origin: { x0, y0 }, towns, dungeons, roads: [], bridges: [] };
}

export function generate(ctx, opts = {}) {
  const rng = seededRng(ctx);
  const width = clamp((opts.width | 0) || 200, 64, 256);
  const height = clamp((opts.height | 0) || 140, 64, 256);

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

  const sampler = makeSampler(seed);
  // Initial center: arbitrary near middle latitude; we can refine by picking a town start afterward.
  const centerX = 512, centerY = 512;
  let world = buildComposite(sampler, centerX, centerY, width, height);
  world.seed = seed;

  // Pick a town start from discovered POIs; fallback by scanning for walkable near center.
  function isWalkableTile(t) { return isWalkable(t); }
  let start = null;
  if (world.towns && world.towns.length) {
    const radius = 20;
    const townsNearDungeon = world.towns.filter(t => (world.dungeons || []).some(d => Math.abs(d.x - t.x) + Math.abs(d.y - t.y) <= radius));
    start = (townsNearDungeon.length ? townsNearDungeon[(rng() * townsNearDungeon.length) | 0] : world.towns[(rng() * world.towns.length) | 0]);
  }
  if (!start) {
    // nearest walkable to center
    const cx = centerX, cy = centerY;
    for (let rad = 0; rad < Math.max(width, height); rad++) {
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const wx = cx + dx, wy = cy + dy;
          const t = sampler(wx, wy);
          if (isWalkableTile(t)) { start = { x: wx, y: wy }; break; }
        }
        if (start) break;
      }
      if (start) break;
    }
  }
  world._sampler = sampler;
  world._center = { x: centerX, y: centerY };
  world._startAbs = start || { x: centerX, y: centerY };
  return world;
}

export function pickTownStart(world, rng) {
  const r = (typeof rng === "function") ? rng : seededRng();
  const s = world._startAbs;
  return { x: s.x, y: s.y };
}

export function tileAt(world, x, y) {
  const f = world && typeof world._sampler === "function" ? world._sampler : null;
  if (!f) return TILES.GRASS;
  return f(x | 0, y | 0);
}

export function recompose(world, centerX, centerY, width, height) {
  const sampler = world && typeof world._sampler === "function" ? world._sampler : null;
  if (!sampler) return world;
  const next = buildComposite(sampler, centerX | 0, centerY | 0, width | 0, height | 0);
  next.seed = world.seed;
  next._sampler = sampler;
  next._center = { x: centerX | 0, y: centerY | 0 };
  next._startAbs = world._startAbs;
  return next;
}

// Attach to window and export for ESM
attachGlobal("ChunkedWorld", { TILES, generate, isWalkable, pickTownStart, tileAt, recompose });
export default { TILES, generate, isWalkable, pickTownStart, tileAt, recompose };