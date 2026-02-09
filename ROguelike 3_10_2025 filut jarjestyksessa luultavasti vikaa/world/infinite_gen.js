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
 * - Phase 1: sinusoidal climate temperature field and ridge-shaped mountains for the overworld.
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
  RUINS: 12,
  SHALLOW: 22, // shallow water/ford; keep id aligned with World.TILES
  CASTLE: 15,
  SNOW_FOREST: 16, // snowy forest biome (snow with dense trees)
  TOWER: 17,       // overworld tower POI; kept aligned with World.TILES
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
    ruinsGrid: 40,        // ruins lattice
    townChance: 0.34,     // was 0.32
    dungeonChance: 0.44,  // was 0.42
    ruinsChance: 0.30,    // ruins spawn chance at anchor
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
      cfg.ruinsGrid = Math.max(16, Math.round(cfg.ruinsGrid * gScale));
      // Increase placement chance as well, clipped to below 1
      const cScale = Math.min(0.95, cfg.townChance * dens);
      const dScale = Math.min(0.95, cfg.dungeonChance * dens);
      const rScale = Math.min(0.95, cfg.ruinsChance * dens);
      cfg.townChance = cScale;
      cfg.dungeonChance = dScale;
      cfg.ruinsChance = rScale;
    }
  } catch (_) {}

  const RIDGE_ANGLE = Math.PI / 4;
  const COS_RIDGE = Math.cos(RIDGE_ANGLE);
  const SIN_RIDGE = Math.sin(RIDGE_ANGLE);

  function temperatureAt(x, y) {
    const period = 900;
    const phase = (y / period) * Math.PI * 2;
    const lat = -Math.cos(phase); // -1 cold, 0 mild, 1 hot
    const noise = valueNoise2(s ^ 0xF1, x + 1234, y - 5678, 1 / 256);
    const noiseCentered = noise * 2 - 1; // -1..1
    let t = lat * 0.8 + noiseCentered * 0.2;
    t = clamp(t, -1, 1);
    return (t + 1) / 2;
  }

  function classify(x, y) {
    // Base noises
    const elevBase = valueNoise2(s ^ 0xA1, x, y, cfg.elevationFreq); // 0..1
    const moist = valueNoise2(s ^ 0xB3, x + 73, y - 19, cfg.moistureFreq);
    // Add detail for coastline/forest speckle
    const detail = valueNoise2(s ^ 0xC5, x - 11, y + 37, cfg.detailFreq) * 0.25;

    // Temperature field varies smoothly with latitude and low-frequency noise
    const temp = temperatureAt(x, y);

    // Elevation with ridged mountain ranges
    const xr = x * COS_RIDGE - y * SIN_RIDGE;
    const yr = x * SIN_RIDGE + y * COS_RIDGE;
    const ridgeBase = valueNoise2(s ^ 0xE1, xr, yr, 1 / 96);
    let ridge = 1 - Math.abs(ridgeBase * 2 - 1);
    const ridgeWarp = valueNoise2(s ^ 0xE2, x - 2000, y + 2000, 1 / 64);
    ridge *= 0.6 + ridgeWarp * 0.4;

    // Coarse lake depressions to encourage larger inland lakes
    const lakeNoise = valueNoise2(s ^ 0xFACE, x + 5000, y - 5000, 1 / 96);
    const lakeFactor = lakeNoise > 0.7 ? (lakeNoise - 0.7) * 0.5 : 0;

    const elevation = clamp(elevBase - lakeFactor + ridge * 0.35 + detail * 0.5, 0, 1);

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

    // Slightly widen river bands in and near highlands so rivers are a bit more common around mountains.
    const highland = elevation > 0.7 ? (elevation - 0.7) / 0.3 : 0; // 0..1
    tol += highland * 0.005;

    const nearRiver = Math.abs((rBase * 0.8 + rMeander * 0.2) - 0.5) < tol;

    // Rivers take priority over all other terrain, but allow occasional shallow fords.
    if (nearRiver) {
      // Narrow, jagged fords cutting across the river band.
      const fordNoise = valueNoise2(s ^ 0xF0F0, x + 17, y - 31, 1 / 64);
      const fordMask = Math.abs(fordNoise - 0.5) < 0.02;

      if (fordMask) {
        return TILES.SHALLOW;
      }
      return TILES.RIVER;
    }

    // Multi-band elevation shaping around the waterline
    if (elevation < 0.20) return TILES.WATER; // deep water
    if (elevation < 0.25) return TILES.WATER; // shallow water band (same tile; renderer can style differently)

    if (elevation < 0.30) {
      // Shore ring: BEACH or SWAMP based on local climate
      const isCold = temp < 0.30;
      if (!isCold && moist > 0.60) return TILES.SWAMP;
      return TILES.BEACH;
    }

    // Land biomes by moisture and temperature
    const veryCold = temp < 0.20;
    const veryHot = temp >= 0.80;
    const dry = moist < 0.25;

    // Occasional oases in deserts: small WATER + GRASS patches inside the desert belt
    const oasisNoise = valueNoise2(s ^ 0x0A515, x - 7000, y + 7000, 1 / 16);

    // Desert only in hot+dry band, but allow very high elevation to remain mountain later.
    let forceDesert = false;
    if (veryHot && dry) {
      if (oasisNoise > 0.82 && moist > 0.20) {
        return TILES.WATER; // oasis pool
      }
      if (oasisNoise > 0.74 && moist > 0.18) {
        return TILES.GRASS; // green ring around oasis
      }
      forceDesert = true;
    }

    // Snow only in very cold band (split by moisture into open vs forested snow)
    if (!forceDesert && veryCold && moist < 0.7) {
      // Split cold land into open snow vs forested snow based on moisture.
      // Drier cold -> open SNOW, more moist cold -> SNOW_FOREST.
      if (moist > 0.45) return TILES.SNOW_FOREST;
      return TILES.SNOW;
    }

    // Precompute potential mountain-pass corridors: rare, wiggly stripes
    const passNoiseX = valueNoise2(s ^ 0xA51, x, y, 1 / 96);
    const passNoiseY = valueNoise2(s ^ 0xA52, x, y, 1 / 96);
    const passBand =
      Math.abs(passNoiseX - 0.5) < 0.03 ||
      Math.abs(passNoiseY - 0.5) < 0.03;

    // Mountains at high elevation
    if (elevation > 0.78) {
      if (passBand) return TILES.GRASS; // mountain pass
      return TILES.MOUNTAIN;
    }

    // If we are in the hot+dry desert-prone zone and not a mountain, resolve to desert now
    if (forceDesert) {
      return TILES.DESERT;
    }

    // Swamp in warm, low, very wet areas (inland; shore band handled above)
    const isCold = temp < 0.30;
    if (!isCold && moist > 0.75 && elevation < 0.46) {
      return TILES.SWAMP;
    }

    // Forest where moisture is decent and not too hot/cold
    if (moist > 0.55) return TILES.FOREST;

    return TILES.GRASS;
  }

  function hasNonBlockingWithinRadius(x, y, maxR = 2) {
    const block = new Set([TILES.WATER, TILES.RIVER, TILES.MOUNTAIN]);
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const t = classify(x + dx, y + dy);
          if (!block.has(t)) return true;
        }
      }
    }
    return false;
  }

  function placePOI(x, y) {
    // Deterministic per-cell anchor so at most ONE tile in a coarse cell becomes a POI.
    const cellTownX = Math.floor(x / cfg.townGrid), cellTownY = Math.floor(y / cfg.townGrid);
    const cellDungX = Math.floor(x / cfg.dungeonGrid), cellDungY = Math.floor(y / cfg.dungeonGrid);
    const cellRuinsX = Math.floor(x / cfg.ruinsGrid), cellRuinsY = Math.floor(y / cfg.ruinsGrid);

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

    const marginRuins = 3;
    const baseRuinsX = cellRuinsX * cfg.ruinsGrid;
    const baseRuinsY = cellRuinsY * cfg.ruinsGrid;
    const offRuinsX = marginRuins + Math.floor(hash2(s ^ 0x7777, cellRuinsX, cellRuinsY) * Math.max(1, cfg.ruinsGrid - marginRuins * 2));
    const offRuinsY = marginRuins + Math.floor(hash2(s ^ 0x8888, cellRuinsX, cellRuinsY) * Math.max(1, cfg.ruinsGrid - marginRuins * 2));
    const anchorRuinsX = baseRuinsX + offRuinsX;
    const anchorRuinsY = baseRuinsY + offRuinsY;

    // Only consider POI placement when queried exactly at the anchor coordinate
    const atTownAnchor = (x === anchorTownX && y === anchorTownY);
    const atDungAnchor = (x === anchorDungX && y === anchorDungY);
    const atRuinsAnchor = (x === anchorRuinsX && y === anchorRuinsY);

    // Avoid water/river/swamp for entrances
    const tHere = classify(x, y);
    if (tHere === TILES.WATER || tHere === TILES.RIVER || tHere === TILES.SWAMP) return null;

    // Quick accessibility check: require some non-blocking ground (not water/river/mountain)
    // within a small radius so POIs are not buried deep inside mountain ranges.
    const hasExit = hasNonBlockingWithinRadius(x, y, 2);

    // Towns near coasts/rivers preferred
    const coastBias = (classify(x + 1, y) === TILES.WATER || classify(x - 1, y) === TILES.WATER
      || classify(x, y + 1) === TILES.WATER || classify(x, y - 1) === TILES.WATER
      || classify(x + 1, y) === TILES.RIVER || classify(x - 1, y) === TILES.RIVER
      || classify(x, y + 1) === TILES.RIVER || classify(x, y - 1) === TILES.RIVER) ? 0.08 : 0.0;

    // Town / castle roll (only at the town anchor of the cell)
    if (atTownAnchor) {
      // Disallow towns/castles placed deep inside mountain clusters with no nearby open ground.
      if (tHere === TILES.MOUNTAIN || !hasExit) return null;

      // Castle placement, preferring coasts/rivers
      const rCastle = hash2(s ^ 0x1010, cellTownX, cellTownY);
      // Base: ~1.0% per town cell; up to ~2.5% when near water/river
      let castleChance = 0.01;
      if (coastBias > 0) castleChance += 0.015;
      if (rCastle < castleChance) return TILES.CASTLE;

      const rTown = hash2(s ^ 0x1111, cellTownX, cellTownY);
      if (rTown < (cfg.townChance + coastBias)) return TILES.TOWN;
    }

    // Dungeon / tower roll (only at the dungeon anchor of the cell)
    if (atDungAnchor) {
      // Skip dungeon anchors that are fully buried in mountains with no nearby open ground.
      if (!hasExit) return null;

      const rDung = hash2(s ^ 0x2222, cellDungX, cellDungY);

      // Prefer dungeon entrances on or near mountain edges to support mountain-pass dungeons.
      let chance = cfg.dungeonChance;
      let nearMountain = false;

      if (tHere === TILES.MOUNTAIN) {
        nearMountain = true;
      } else {
        // Check immediate neighbours for mountains (edge of a ridge)
        for (let dy = -1; dy <= 1 && !nearMountain; dy++) {
          for (let dx = -1; dx <= 1 && !nearMountain; dx++) {
            if (!dx && !dy) continue;
            const nt = classify(x + dx, y + dy);
            if (nt === TILES.MOUNTAIN) nearMountain = true;
          }
        }
      }

      if (nearMountain) {
        // Strongly bias toward mountains/edges; clamp to avoid 100% certainty
        chance = Math.min(0.95, chance * 1.9);
      } else {
        // Slightly reduce non-mountain dungeon density to keep total numbers reasonable
        chance = chance * 0.7;
      }

      if (rDung < chance) {
        // When near rivers, occasionally place a tower instead of a regular dungeon.
        let nearRiver = false;
        try {
          for (let dy = -2; dy <= 2 && !nearRiver; dy++) {
            for (let dx = -2; dx <= 2 && !nearRiver; dx++) {
              if (!dx && !dy) continue;
              const nt = classify(x + dx, y + dy);
              if (nt === TILES.RIVER) nearRiver = true;
            }
          }
        } catch (_) {}

        if (nearRiver) {
          const rTower = hash2(s ^ 0xABCD, cellDungX, cellDungY);
          // Rare but not ultra-rare towers near rivers.
          if (rTower < 0.30) return TILES.TOWER;
        }
        return TILES.DUNGEON;
      }
    }

    // Ruins roll (only at the ruins anchor of the cell)
    if (atRuinsAnchor) {
      // Avoid spawning ruins deep inside inaccessible mountain pockets.
      if (!hasExit) return null;
      const rRuins = hash2(s ^ 0x9999, cellRuinsX, cellRuinsY);
      if (rRuins < cfg.ruinsChance) return TILES.RUINS;
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
    // Derive a seed-based search center for more variety across seeds
    // Offsets in a large square, deterministic from RNG seeded by 's'
    const offX = Math.floor((rng() - 0.5) * 800); // -400..400 (approx)
    const offY = Math.floor((rng() - 0.5) * 800); // -400..400 (approx)

    // Spiral search around (offX, offY) for a walkable, non-swamp tile near a town if possible
    const maxR = 240;
    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        const x = offX + r, y = offY + dy;
        const cand = [
          { x, y }, { x: offX - r, y }, { x: offX + dy, y: offY + r }, { x: offX + dy, y: offY - r }
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
    // Fallback: origin
    return { x: 0, y: 0 };
  }

  return { tileAt, isWalkable, pickStart, TILES };
}

// Back-compat: attach to window
attachGlobal("InfiniteGen", { create });

export { create, TILES };