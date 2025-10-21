/**
 * InfiniteGen: deterministic tile generator for an effectively infinite overworld.
 *
 * API:
 * - create(seed:uint32, opts?): returns { tileAt(x,y), isWalkable(tile), pickStart() }
 *
 * Notes:
 * - Uses a simple coordinate-hash noise to derive elevation/moisture/temperature.
 * - Coarse grid features ensure large biomes; fine noise adds variation.
 * - Towns/dungeons placed sparsely on a coarse lattice using the same hash.
 */
import { attachGlobal } from "../utils/global.js";

// Keep IDs aligned with World.TILES so renderers and logic work as-is
const TILES = {
  WATER: 0,
  GRASS: 1,
  FOREST: 2,
  MOUNTAIN: 3,
  TOWN: 4,
  DUNGEON: 5,
  SWAMP: 6,
  RIVER: 7,
  BEACH: 8,
  DESERT: 9,
  SNOW: 10,
};

function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(seed, x, y) {
  // Deterministic 2D hash -> [0,1)
  let n = (x * 374761393 + y * 668265263 + (seed | 0)) | 0;
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177) | 0;
  n = (n ^ (n >>> 16)) >>> 0;
  return n / 4294967296;
}

function lerp(a, b, t) { return a + (b - a) * t; }

// Cheap value-noise: bilinear interp of hashed lattice
function valueNoise2(seed, x, y, freq = 1 / 16) {
  const xf = x * freq, yf = y * freq;
  const x0 = Math.floor(xf), y0 = Math.floor(yf);
  const tx = xf - x0, ty = yf - y0;
  const v00 = hash2(seed, x0, y0);
  const v10 = hash2(seed, x0 + 1, y0);
  const v01 = hash2(seed, x0, y0 + 1);
  const v11 = hash2(seed, x0 + 1, y0 + 1);
  const vx0 = lerp(v00, v10, tx);
  const vx1 = lerp(v01, v11, tx);
  return lerp(vx0, vx1, ty);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function create(seed, opts = {}) {
  const s = (Number(seed) >>> 0) || 1;
  const rng = mulberry32(s);

  const cfg = {
    // Feature scales (bigger -> broader features)
    elevationFreq: 1 / 48,
    moistureFreq: 1 / 36,
    detailFreq: 1 / 6,
    riverFreq: 1 / 64,
    // Placement
    townGrid: 64,         // coarse lattice spacing
    dungeonGrid: 48,
    townChance: 0.12,     // probability on lattice to place town if terrain permits
    dungeonChance: 0.16,
    ...opts,
  };

  function temperatureAt(y) {
    // Latitude proxy: colder near negative y, hotter near positive y
    const t = clamp((y / 400), -1, 1); // -1..1 across ~800 tiles
    // Map to 0..1 (0 cold, 1 hot)
    return (t + 1) / 2;
  }

  function classify(x, y) {
    // Base noises
    const elev = valueNoise2(s ^ 0xA1, x, y, cfg.elevationFreq); // 0..1
    const moist = valueNoise2(s ^ 0xB3, x + 73, y - 19, cfg.moistureFreq);
    // Add detail for coastline/forest speckle
    const detail = valueNoise2(s ^ 0xC5, x - 11, y + 37, cfg.detailFreq) * 0.25;

    // River mask: pseudo-lines by thresholding low-frequency noise near ~0.5 with slight wobble
    const rNoise = valueNoise2(s ^ 0xD7, x + 999, y - 999, cfg.riverFreq);
    const nearRiver = Math.abs(rNoise - 0.5) < 0.02; // narrow band

    // Temperature bias by latitude
    const temp = temperatureAt(y);

    // Elevation thresholds to water/land
    const elevation = clamp(elev + detail * 0.5, 0, 1);
    if (nearRiver) {
      return TILES.RIVER;
    }
    if (elevation < 0.28) return TILES.WATER;
    if (elevation < 0.31) return TILES.BEACH;

    // Land biomes by moisture and temperature
    if (temp > 0.7 && moist < 0.25) return TILES.DESERT;
    if (temp < 0.25 && moist < 0.7) return TILES.SNOW;

    // Mountains at high elevation
    if (elevation > 0.78) return TILES.MOUNTAIN;

    // Swamp near water with high moisture
    if (moist > 0.75 && elevation < 0.46) return TILES.SWAMP;

    // Forest where moisture is decent and not too hot/cold
    if (moist > 0.55) return TILES.FOREST;

    return TILES.GRASS;
  }

  function placePOI(x, y) {
    // On coarse lattice, roll for a POI if terrain is suitable
    const tx = Math.floor(x / cfg.townGrid);
    const ty = Math.floor(y / cfg.townGrid);
    const dx = Math.floor(x / cfg.dungeonGrid);
    const dy = Math.floor(y / cfg.dungeonGrid);

    // Avoid water/river for entrances
    const t = classify(x, y);
    if (t === TILES.WATER || t === TILES.RIVER || t === TILES.SWAMP) return null;

    // Towns near coasts/rivers preferred
    const coastBias = (classify(x + 1, y) === TILES.WATER || classify(x - 1, y) === TILES.WATER
      || classify(x, y + 1) === TILES.WATER || classify(x, y - 1) === TILES.WATER
      || classify(x + 1, y) === TILES.RIVER || classify(x - 1, y) === TILES.RIVER
      || classify(x, y + 1) === TILES.RIVER || classify(x, y - 1) === TILES.RIVER) ? 0.08 : 0.0;

    // Town roll
    const rTown = hash2(s ^ 0x1111, tx, ty);
    if (rTown < (cfg.townChance + coastBias)) return TILES.TOWN;

    // Dungeon roll
    const rDung = hash2(s ^ 0x2222, dx, dy);
    if (rDung < cfg.dungeonChance) return TILES.DUNGEON;

    return null;
  }

  function tileAt(x, y) {
    // POIs supersede base biome on lattice cells
    const poi = placePOI(x, y);
    if (poi != null) return poi;
    return classify(x, y);
  }

  function isWalkable(tile) {
    return tile !== TILES.WATER && tile !== TILES.RIVER && tile !== TILES.MOUNTAIN;
  }

  function pickStart() {
    // Search a spiral around (0,0) for a walkable, non-swamp tile near a town if possible
    const maxR = 200;
    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        const x = r, y = dy;
        const cand = [
          { x, y }, { x: -x, y }, { x: dy, y: r }, { x: dy, y: -r }
        ];
        for (const p of cand) {
          const t = tileAt(p.x, p.y);
          if (isWalkable(t) && t !== TILES.SWAMP) {
            // Prefer proximity to town/dungeon
            const nearTown = tileAt(p.x + 1, p.y) === TILES.TOWN
              || tileAt(p.x - 1, p.y) === TILES.TOWN
              || tileAt(p.x, p.y + 1) === TILES.TOWN
              || tileAt(p.x, p.y - 1) === TILES.TOWN;
            if (nearTown) return p;
          }
        }
      }
    }
    return { x: 0, y: 0 };
  }

  return { tileAt, isWalkable, pickStart, TILES };
}

// Back-compat: attach to window
attachGlobal("InfiniteGen", { create });

export { create, TILES };