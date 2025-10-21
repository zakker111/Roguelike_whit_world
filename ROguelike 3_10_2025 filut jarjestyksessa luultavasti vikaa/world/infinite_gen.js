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

  let cfg = {
    // Feature scales (bigger -> broader features)
    elevationFreq: 1 / 48,
    moistureFreq: 1 / 36,
    detailFreq: 1 / 6,
    riverFreq: 1 / 64,
    // Placement (slightly denser than before per request)
    townGrid: 42,         // was 48
    dungeonGrid: 32,      // was 36
    townChance: 0.34,     // was 0.32
    dungeonChance: 0.44,  // was 0.42
    ...opts,
  };

  // Optional density tuning knob:
  // - window.POI_DENSITY (number, e.g. 1.0 default, 1.5 denser, 0.7 sparser)
  // - or localStorage "POI_DENSITY"
  try {
    let dens = 1;
    if (typeof window !== "undefined") {
      if (typeof window.POI_DENSITY === "number" && isFinite(window.POI_DENSITY) && window.POI_DENSITY > 0) {
        dens = window.POI_DENSITY;
      } else {
        const raw = localStorage.getItem("POI_DENSITY");
        if (raw != null) {
          const v = parseFloat(raw);
          if (isFinite(v) && v > 0) dens = v;
        }
      }
    }
    if (dens && dens !== 1) {
      // Scale grid by ~1/sqrt(dens) so area density scales roughly linearly
      const gScale = Math.max(0.35, 1 / Math.sqrt(dens));
      cfg.townGrid = Math.max(16, Math.round(cfg.townGrid * gScale));
      cfg.dungeonGrid = Math.max(16, Math.round(cfg.dungeonGrid * gScale));
      // Increase placement chance as well, clipped to below 1
      const cScale = Math.min(0.95, cfg.townChance * dens);
      const dScale = Math.min(0.95, cfg.dungeonChance * dens);
      cfg.townChance = cScale;
      cfg.dungeonChance = dScale;
    }
  } catch (_) {}

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

    // Rivers: variable width (1..3) bands with slight meander, trending toward the up-ocean (negative y)
    const rBase = valueNoise2(s ^ 0xD7, x + 999, y - 999, cfg.riverFreq);
    const rMeander = valueNoise2(s ^ 0xDA, x - 321, y + 777, cfg.riverFreq * 1.8);
    // Column/row hashed width 1..3
    const wHash = hash2(s ^ 0xED, Math.floor(x / 3), Math.floor(y / 3));
    const rWidth = 1 + ((wHash * 3) | 0); // 1..3
    // Core threshold around 0.5 with width-dependent tolerance
    let tol = 0.010 + (rWidth - 1) * 0.008; // 0.010..0.026
    // Bias toward flowing to negative y (up) by tightening band when far from ocean and widening slightly as y gets smaller
    const flowBias = clamp((0 - y) / 1200, 0, 0.25); // increases as we go up
    tol += flowBias * 0.02;
    const nearRiver = Math.abs((rBase * 0.8 + rMeander * 0.2) - 0.5) < tol;

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
    // Deterministic per-cell anchor so at most ONE tile in a coarse cell becomes a POI.
    const cellTownX = Math.floor(x / cfg.townGrid), cellTownY = Math.floor(y / cfg.townGrid);
    const cellDungX = Math.floor(x / cfg.dungeonGrid), cellDungY = Math.floor(y / cfg.dungeonGrid);

    // Pick an anchor within each cell using a margin so it isn't right on the edges.
    const marginTown = 3;
    const baseTownX = cellTownX * cfg.townGrid;
    const baseTownY = cellTownY * cfg.townGrid;
    const offTownX = marginTown + Math.floor(hash2(s ^ 0x3333, cellTownX, cellTownY) * Math.max(1, cfg.townGrid - marginTown * 2));
    const offTownY = marginTown + Math.floor(hash2(s ^ 0x4444, cellTownX, cellTownY) * Math.max(1, cfg.townGrid - marginTown * 2));
    const anchorTownX = baseTownX + offTownX;
    const anchorTownY = baseTownY + offTownY;

    const marginDung = 3;
    const baseDungX = cellDungX * cfg.dungeonGrid;
    const baseDungY = cellDungY * cfg.dungeonGrid;
    const offDungX = marginDung + Math.floor(hash2(s ^ 0x5555, cellDungX, cellDungY) * Math.max(1, cfg.dungeonGrid - marginDung * 2));
    const offDungY = marginDung + Math.floor(hash2(s ^ 0x6666, cellDungX, cellDungY) * Math.max(1, cfg.dungeonGrid - marginDung * 2));
    const anchorDungX = baseDungX + offDungX;
    const anchorDungY = baseDungY + offDungY;

    // Only consider POI placement when queried exactly at the anchor coordinate
    const atTownAnchor = (x === anchorTownX && y === anchorTownY);
    const atDungAnchor = (x === anchorDungX && y === anchorDungY);

    // Avoid water/river/swamp for entrances
    const tHere = classify(x, y);
    if (tHere === TILES.WATER || tHere === TILES.RIVER || tHere === TILES.SWAMP) return null;

    // Towns near coasts/rivers preferred
    const coastBias = (classify(x + 1, y) === TILES.WATER || classify(x - 1, y) === TILES.WATER
      || classify(x, y + 1) === TILES.WATER || classify(x, y - 1) === TILES.WATER
      || classify(x + 1, y) === TILES.RIVER || classify(x - 1, y) === TILES.RIVER
      || classify(x, y + 1) === TILES.RIVER || classify(x, y - 1) === TILES.RIVER) ? 0.08 : 0.0;

    // Town roll (only at the town anchor of the cell)
    if (atTownAnchor) {
      const rTown = hash2(s ^ 0x1111, cellTownX, cellTownY);
      if (rTown < (cfg.townChance + coastBias)) return TILES.TOWN;
    }

    // Dungeon roll (only at the dungeon anchor of the cell)
    if (atDungAnchor) {
      const rDung = hash2(s ^ 0x2222, cellDungX, cellDungY);
      if (rDung < cfg.dungeonChance) return TILES.DUNGEON;
    }

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