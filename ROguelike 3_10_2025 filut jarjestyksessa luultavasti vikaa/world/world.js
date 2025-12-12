/**
 * World: expanded overworld with multiple biomes, rivers, towns, and dungeon entrances.
 *
 * Exports (ESM + window.World):
 * - TILES: { WATER, GRASS, FOREST, MOUNTAIN, TOWN, DUNGEON, SWAMP, RIVER, BEACH, DESERT, SNOW }
 * - generate(ctx, opts?): returns { map, width, height, towns:[{x,y}], dungeons:[{x,y}] }
 * - isWalkable(tile): returns boolean
 * - pickTownStart(world, rng): returns a {x,y} start at/near a town
 * - biomeName(tile): returns a human-readable biome string
 */
import { attachGlobal } from "../utils/global.js";
import { TILES, isWalkable, biomeName } from "./world_tiles.js";

function clamp(v, lo, hi) {
  try {
    if (typeof window !== "undefined" && window.Bounds && typeof window.Bounds.clamp === "function") {
      return window.Bounds.clamp(v, lo, hi);
    }
  } catch (_) {}
  return Math.max(lo, Math.min(hi, v));
}



function inBounds(x, y, w, h) {
  return x >= 0 && y >= 0 && x < w && y < h;
}

function getOverworldConfig() {
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const cfg = GD && GD.worldgenOverworld && typeof GD.worldgenOverworld === "object"
      ? GD.worldgenOverworld
      : null;
    return cfg || null;
  } catch (_) {
    return null;
  }
}

export function generate(ctx, opts = {}) {
  const rng = (function () {
    try {
      if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function") {
        return window.RNGUtils.getRng((ctx && typeof ctx.rng === "function") ? ctx.rng : undefined);
      }
    } catch (_) {}
    return (ctx && typeof ctx.rng === "function") ? ctx.rng : null;
  })();

  const cfg = getOverworldConfig();
  const defaultWidth = (cfg && cfg.size && typeof cfg.size.defaultWidth === "number") ? cfg.size.defaultWidth : 120;
  const defaultHeight = (cfg && cfg.size && typeof cfg.size.defaultHeight === "number") ? cfg.size.defaultHeight : 80;
  const minWidth = (cfg && cfg.size && typeof cfg.size.minWidth === "number") ? cfg.size.minWidth : 48;
  const maxWidth = (cfg && cfg.size && typeof cfg.size.maxWidth === "number") ? cfg.size.maxWidth : 512;
  const minHeight = (cfg && cfg.size && typeof cfg.size.minHeight === "number") ? cfg.size.minHeight : 48;
  const maxHeight = (cfg && cfg.size && typeof cfg.size.maxHeight === "number") ? cfg.size.maxHeight : 512;

  const width = clamp((opts.width | 0) || defaultWidth, minWidth, maxWidth);
  const height = clamp((opts.height | 0) || defaultHeight, minHeight, maxHeight);
  const map = Array.from({ length: height }, () => Array(width).fill(TILES.GRASS));

  // Scatter noise: lakes, forests, mountains
  const area = width * height;
  const baseBlobDensity = (cfg && cfg.scatter && typeof cfg.scatter.baseBlobDensity === "number")
    ? cfg.scatter.baseBlobDensity
    : (1 / 450);
  const blobs = Math.floor(area * baseBlobDensity);
  function scatter(kind, count, radius) {
    for (let i = 0; i < count; i++) {
      const cx = (rng() * width) | 0;
      const cy = (rng() * height) | 0;
      const r = (radius | 0) + ((rng() * radius) | 0);
      for (let y = Math.max(0, (cy - r) | 0); y < Math.min(height, (cy + r) | 0); y++) {
        for (let x = Math.max(0, (cx - r) | 0); x < Math.min(width, (cx + r) | 0); x++) {
          const dx = x - cx, dy = y - cy;
          if (dx * dx + dy * dy <= r * r && rng() < 0.7) {
            map[y][x] = kind;
          }
        }
      }
    }
  }

  const waterCfg = cfg && cfg.scatter && cfg.scatter.water ? cfg.scatter.water : null;
  const forestCfg = cfg && cfg.scatter && cfg.scatter.forest ? cfg.scatter.forest : null;
  const mountainCfg = cfg && cfg.scatter && cfg.scatter.mountain ? cfg.scatter.mountain : null;

  const waterCount = waterCfg && typeof waterCfg.countPerTile === "number"
    ? Math.max(waterCfg.minCount | 0, Math.floor(area * waterCfg.countPerTile))
    : Math.max(3, blobs | 0);
  const waterRadius = waterCfg && typeof waterCfg.radius === "number" ? waterCfg.radius : 6;

  const forestCount = forestCfg && typeof forestCfg.countPerTile === "number"
    ? Math.max(forestCfg.minCount | 0, Math.floor(area * forestCfg.countPerTile))
    : Math.max(4, (blobs * 2) | 0);
  const forestRadius = forestCfg && typeof forestCfg.radius === "number" ? forestCfg.radius : 5;

  const mountainCount = mountainCfg && typeof mountainCfg.countPerTile === "number"
    ? Math.max(mountainCfg.minCount | 0, Math.floor(area * mountainCfg.countPerTile))
    : Math.max(3, blobs | 0);
  const mountainRadius = mountainCfg && typeof mountainCfg.radius === "number" ? mountainCfg.radius : 4;

  scatter(TILES.WATER, waterCount, waterRadius);
  scatter(TILES.FOREST, forestCount, forestRadius);
  scatter(TILES.MOUNTAIN, mountainCount, mountainRadius);

  // Mountain ridges (simple random walks)
  const ridges = 2 + ((rng() * 3) | 0);
  for (let i = 0; i < ridges; i++) {
    let x = (rng() * width) | 0;
    let y = (rng() * height) | 0;
    let dx = rng() < 0.5 ? 1 : -1;
    let dy = rng() < 0.5 ? 1 : -1;
    let steps = 120 + ((rng() * 180) | 0);
    while (steps-- > 0 && inBounds(x, y, width, height)) {
      map[y][x] = TILES.MOUNTAIN;
      if (rng() < 0.4 && inBounds(x + 1, y, width, height)) map[y][x + 1] = TILES.MOUNTAIN;
      if (rng() < 0.4 && inBounds(x, y + 1, width, height)) map[y + 1][x] = TILES.MOUNTAIN;
      if (rng() < 0.08) dx = -dx;
      if (rng() < 0.08) dy = -dy;
      x += dx; y += dy;
    }
  }

  // Extra small forest patches for individual trees feel
  scatter(TILES.FOREST, Math.max(6, (blobs * 2) | 0), 2);

  // Carve rivers: meandering paths from one edge to another
  const riversCfg = cfg && cfg.rivers ? cfg.rivers : null;
  const riverMin = riversCfg && typeof riversCfg.minCount === "number" ? riversCfg.minCount : 2;
  const riverMax = riversCfg && typeof riversCfg.maxCount === "number" ? riversCfg.maxCount : 4;
  const riverSpan = Math.max(0, (riverMax | 0) - (riverMin | 0));
  const riverCount = (riverMin | 0) + (riverSpan > 0 ? ((rng() * (riverSpan + 1)) | 0) : 0);
  for (let r = 0; r < riverCount; r++) {
    // pick start at a random edge
    let x, y, dir;
    const edge = (rng() * 4) | 0;
    if (edge === 0) { x = 0; y = (rng() * height) | 0; dir = { dx: 1, dy: 0 }; }
    else if (edge === 1) { x = width - 1; y = (rng() * height) | 0; dir = { dx: -1, dy: 0 }; }
    else if (edge === 2) { x = (rng() * width) | 0; y = 0; dir = { dx: 0, dy: 1 }; }
    else { x = (rng() * width) | 0; y = height - 1; dir = { dx: 0, dy: -1 }; }

    let steps = (width + height) * 2;
    let meander = 0;
    while (steps-- > 0 && inBounds(x, y, width, height)) {
      // carve river tile and slight banks
      map[y][x] = TILES.RIVER;
      if (rng() < 0.35) {
        if (inBounds(x + 1, y, width, height)) map[y][x + 1] = TILES.RIVER;
        if (inBounds(x - 1, y, width, height)) map[y][x - 1] = TILES.RIVER;
      }

      // meander turn
      if (rng() < 0.18 || meander > 6) {
        meander = 0;
        if (dir.dx !== 0) dir = { dx: 0, dy: rng() < 0.5 ? 1 : -1 };
        else dir = { dx: rng() < 0.5 ? 1 : -1, dy: 0 };
      } else {
        meander++;
      }

      // bias slightly toward map center to avoid hugging edges forever
      const cx = width / 2, cy = height / 2;
      if (rng() < 0.15) {
        dir.dx += Math.sign(cx - x) * (rng() < 0.5 ? 1 : 0);
        dir.dy += Math.sign(cy - y) * (rng() < 0.5 ? 1 : 0);
        dir.dx = Math.max(-1, Math.min(1, dir.dx | 0));
        dir.dy = Math.max(-1, Math.min(1, dir.dy | 0));
        if (dir.dx === 0 && dir.dy === 0) dir.dx = 1;
      }

      x += dir.dx;
      y += dir.dy;
    }
  }

  // Swamps and beaches near water/river
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = map[y][x];
      let nearWater = false;
      for (let dy = -1; dy <= 1 && !nearWater; dy++) {
        for (let dx = -1; dx <= 1 && !nearWater; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (!inBounds(nx, ny, width, height)) continue;
          const n = map[ny][nx];
          if (n === TILES.WATER || n === TILES.RIVER) nearWater = true;
        }
      }
      if (t === TILES.GRASS && nearWater) {
        // Mix of swamp and beach along shores
        if (rng() < 0.35) map[y][x] = TILES.SWAMP;
        else if (rng() < 0.55) map[y][x] = TILES.BEACH;
      }
      if (t === TILES.FOREST && nearWater && rng() < 0.15) {
        map[y][x] = TILES.GRASS; // thin forests right at the shore
      }
    }
  }

  // Climate-based conversion to DESERT and SNOW on plains
  for (let y = 0; y < height; y++) {
    const temp = 1 - (y / (height - 1)); // top cold (1->0 reversed later)
    const temperature = 1 - temp; // top cold ~0, bottom hot ~1
    for (let x = 0; x < width; x++) {
      if (map[y][x] !== TILES.GRASS) continue;
      // moisture proxy: any water within radius 4
      let moist = 0;
      for (let ry = -4; ry <= 4; ry++) {
        for (let rx = -4; rx <= 4; rx++) {
          const nx = x + rx, ny = y + ry;
          if (!inBounds(nx, ny, width, height)) continue;
          const nt = map[ny][nx];
          if (nt === TILES.WATER || nt === TILES.RIVER || nt === TILES.SWAMP) { moist++; }
        }
      }
      const moisture = Math.min(1, moist / 40);
      if (temperature > 0.65 && moisture < 0.15 && rng() < 0.9) {
        map[y][x] = TILES.DESERT;
      } else if (temperature < 0.25 && moisture < 0.6 && rng() < 0.9) {
        // Split cold plains into open snow vs forested snow based on moisture.
        if (moisture > 0.4 && rng() < 0.6) {
          map[y][x] = TILES.SNOW_FOREST;
        } else {
          map[y][x] = TILES.SNOW;
        }
      }
    }
  }

  // Carve towns and dungeons (prefer towns near water/river/beach)
  const towns = [];
  const dungeons = [];
  const ruins = [];

  // Increase town density and scale by area for richer worlds, using config when available
  const townsCfg = cfg && cfg.towns ? cfg.towns : null;
  const dungeonsCfg = cfg && cfg.dungeons ? cfg.dungeons : null;
  const ruinsCfg = cfg && cfg.ruins ? cfg.ruins : null;

  const baseTowns = townsCfg && typeof townsCfg.perTile === "number"
    ? Math.max((townsCfg.minCount | 0) || 0, Math.floor(area * townsCfg.perTile))
    : Math.max(14, Math.floor(area / 700)); // ~14 for 120x80; grows with area
  const townsJitterFrac = townsCfg && typeof townsCfg.jitterFraction === "number" ? townsCfg.jitterFraction : 0.4;
  const townsJitterBase = Math.max(1, Math.floor(baseTowns * Math.max(0, townsJitterFrac)));
  const wantTowns = baseTowns + ((rng() * townsJitterBase) | 0);

  // Scale dungeon count with map area and increase baseline density
  const baseDungeons = dungeonsCfg && typeof dungeonsCfg.perTile === "number"
    ? Math.max((dungeonsCfg.minCount | 0) || 0, Math.floor(area * dungeonsCfg.perTile))
    : Math.max(22, Math.floor(area / 500)); // ~22 for 120x80; grows with area
  const dungeonsJitterFrac = dungeonsCfg && typeof dungeonsCfg.jitterFraction === "number" ? dungeonsCfg.jitterFraction : 0.5;
  const dungeonsJitterBase = Math.max(1, Math.floor(baseDungeons * Math.max(0, dungeonsJitterFrac)));
  const wantDungeons = baseDungeons + ((rng() * dungeonsJitterBase) | 0);

  // Ruins density: between towns and dungeons; scale with area
  const baseRuins = ruinsCfg && typeof ruinsCfg.perTile === "number"
    ? Math.max((ruinsCfg.minCount | 0) || 0, Math.floor(area * ruinsCfg.perTile))
    : Math.max(18, Math.floor(area / 600)); // ~18 for 120x80; grows with area
  const ruinsJitterFrac = ruinsCfg && typeof ruinsCfg.jitterFraction === "number" ? ruinsCfg.jitterFraction : 0.5;
  const ruinsJitterBase = Math.max(1, Math.floor(baseRuins * Math.max(0, ruinsJitterFrac)));
  const wantRuins = baseRuins + ((rng() * ruinsJitterBase) | 0);

  // Decide town size distribution: configurable; default small ~60%, big ~30%, city ~10%
  const townSizeWeights = (cfg && cfg.townSizeWeights && typeof cfg.townSizeWeights === "object") ? cfg.townSizeWeights : null;
  function pickTownSize() {
    const smallW = townSizeWeights && typeof townSizeWeights.small === "number" ? townSizeWeights.small : 0.6;
    const bigW = townSizeWeights && typeof townSizeWeights.big === "number" ? townSizeWeights.big : 0.3;
    const cityW = townSizeWeights && typeof townSizeWeights.city === "number" ? townSizeWeights.city : 0.1;
    const sum = Math.max(0.0001, smallW + bigW + cityW);
    const s = smallW / sum;
    const b = bigW / sum;
    const r = rng();
    if (r < s) return "small";
    if (r < s + b) return "big";
    return "city";
  }

  function placeWithPredicate(n, predicate, write) {
    let placed = 0, attempts = 0, maxAttempts = n * 400;
    while (placed < n && attempts++ < maxAttempts) {
      const x = (rng() * width) | 0;
      const y = (rng() * height) | 0;
      if (predicate(x, y)) {
        write(x, y);
        placed++;
      }
    }
  }

  placeWithPredicate(
    wantTowns,
    (x, y) => {
      const t = map[y][x];
      // allow GRASS/BEACH and occasionally DESERT/SNOW towns (including forested snow)
      if (!(t === TILES.GRASS || t === TILES.BEACH || t === TILES.DESERT || t === TILES.SNOW || t === TILES.SNOW_FOREST)) return false;
      // prefer near water or river
      for (let dy = -5; dy <= 5; dy++) {
        for (let dx = -5; dx <= 5; dx++) {
          const nx = x + dx, ny = y + dy;
          if (!inBounds(nx, ny, width, height)) continue;
          const n = map[ny][nx];
          if (n === TILES.WATER || n === TILES.RIVER || n === TILES.BEACH) {
            return true;
          }
        }
      }
      // bias: occasional towns away from water (slightly higher than before)
      return rng() < 0.12;
    },
    (x, y) => {
      map[y][x] = TILES.TOWN;
      const size = pickTownSize();
      towns.push({ x, y, size });
    }
  );

  // Choose one town to be Jekku's home (only once per world) and one for Pulla
if (towns.length) {
  const jekkuIndex = (rng() * towns.length) | 0;
  towns[jekkuIndex].jekkuHome = true;

  let pullaIndex = (rng() * towns.length) | 0;
  if (towns.length > 1 && pullaIndex === jekkuIndex) {
    pullaIndex = (pullaIndex + 1) % towns.length;
  }
  towns[pullaIndex].pullaHome = true;
}

  // Helper: pick dungeon size with probabilities influenced by terrain
  function pickDungeonSizeFor(tile) {
    // Base weights: small 0.45, medium 0.40, large 0.15
    let wSmall = 0.45, wMed = 0.40, wLarge = 0.15;
    // Bias by terrain
    if (tile === TILES.MOUNTAIN) { wLarge += 0.15; wMed += 0.05; wSmall -= 0.20; }
    else if (tile === TILES.FOREST) { wMed += 0.10; wLarge += 0.05; wSmall -= 0.15; }
    else if (tile === TILES.GRASS) { wSmall += 0.10; wMed += 0.05; wLarge -= 0.15; }
    else if (tile === TILES.SWAMP) { wMed += 0.10; wSmall += 0.05; wLarge -= 0.15; }
    else if (tile === TILES.DESERT) { wMed += 0.10; wLarge += 0.05; wSmall -= 0.15; }
    else if (tile === TILES.SNOW || tile === TILES.SNOW_FOREST) { wMed += 0.10; wSmall += 0.05; wLarge -= 0.15; }
    // normalize
    const sum = Math.max(0.001, wSmall + wMed + wLarge);
    const ps = [wSmall / sum, wMed / sum, wLarge / sum];
    const r = rng();
    if (r < ps[0]) return "small";
    if (r < ps[0] + ps[1]) return "medium";
    return "large";
  }

  placeWithPredicate(
    wantDungeons,
    (x, y) => {
      const t = map[y][x];
      if (t === TILES.FOREST || t === TILES.MOUNTAIN) return true;
      if (t === TILES.GRASS) return rng() < 0.16; // more likely on plains
      // Allow a small chance in DESERT and SNOW (including forested snow) to diversify placement
      if (t === TILES.DESERT || t === TILES.SNOW || t === TILES.SNOW_FOREST) return rng() < 0.06;
      // avoid water/river/beach/swamp for entrances; bias to solid terrain
      return false;
    },
    (x, y) => {
      const t = map[y][x];
      map[y][x] = TILES.DUNGEON;
      // Assign a dungeon level (difficulty) and size
      // Level: 1..5 skewed toward mid-range
      const level = 1 + ((rng() * rng() * 5) | 0); // bias toward 1..3
      // Size chosen with terrain-weighted probabilities
      const size = pickDungeonSizeFor(t);
      dungeons.push({ x, y, level, size });
    }
  );

  // Place ruins (avoid water/river/swamp; prefer grass/forest/desert/snow)
  placeWithPredicate(
    wantRuins,
    (x, y) => {
      const t = map[y][x];
      if (t === TILES.WATER || t === TILES.RIVER || t === TILES.SWAMP) return false;
      if (t === TILES.GRASS || t === TILES.FOREST) return rng() < 0.25;
      if (t === TILES.DESERT || t === TILES.SNOW || t === TILES.SNOW_FOREST) return rng() < 0.12;
      if (t === TILES.BEACH) return rng() < 0.05;
      return false;
    },
    (x, y) => {
      map[y][x] = TILES.RUINS;
      ruins.push({ x, y });
    }
  );

  // Ensure connectivity between all towns and dungeons by carving walkable paths
  const POIS = towns.concat(dungeons);
  const walkable = (x, y) => inBounds(x, y, width, height) && isWalkable(map[y][x]);

  function bfsReachable(sx, sy) {
    const q = [{ x: sx, y: sy }];
    const seen = new Set([`${sx},${sy}`]);
    const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
    while (q.length) {
      const cur = q.shift();
      for (const d of dirs) {
        const nx = cur.x + d.dx, ny = cur.y + d.dy;
        const key = `${nx},${ny}`;
        if (seen.has(key) || !inBounds(nx, ny, width, height)) continue;
        if (!isWalkable(map[ny][nx])) continue;
        seen.add(key);
        q.push({ x: nx, y: ny });
      }
    }
    return seen;
  }

  function carvePath(x0, y0, x1, y1) {
    // Bresenham-ish line, carve blockers into walkable tiles
    let x = x0, y = y0;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      if (inBounds(x, y, width, height)) {
        const t = map[y][x];
        if (t === TILES.WATER || t === TILES.RIVER) map[y][x] = TILES.BEACH;
        else if (t === TILES.MOUNTAIN) map[y][x] = TILES.GRASS;
        // leave forests/grass as is; towns/dungeons untouched
      }
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }

  function ensureConnectivity() {
    if (POIS.length === 0) return;
    // Start from first POI; connect others one by one to the growing connected set
    let connected = new Set();
    // pick first POI as seed
    const seed = POIS[0];
    connected.add(`${seed.x},${seed.y}`);
    let reach = bfsReachable(seed.x, seed.y);

    for (let i = 1; i < POIS.length; i++) {
      const p = POIS[i];
      if (reach.has(`${p.x},${p.y}`)) continue;
      // find nearest already-reachable tile to p to carve a corridor to
      let best = null, bestDist = Infinity;
      for (const key of reach) {
        const [sx, sy] = key.split(",").map(Number);
        const d = Math.abs(sx - p.x) + Math.abs(sy - p.y);
        if (d < bestDist) { bestDist = d; best = { x: sx, y: sy }; }
      }
      if (best) {
        carvePath(best.x, best.y, p.x, p.y);
        // update reachability after carving
        reach = bfsReachable(seed.x, seed.y);
      }
    }
  }

  ensureConnectivity();

  // Overworld roads overlays have been removed; keep empty arrays for back-compat with renderers.
  const roads = [];
  const bridges = [];

  return { map, width, height, towns, dungeons, ruins, roads, bridges };
}

export function pickTownStart(world, rng) {
  const r = (function () {
    try {
      if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function") {
        return window.RNGUtils.getRng(rng);
      }
    } catch (_) {}
    return (typeof rng === "function") ? rng : null;
  })();
  if (world.towns && world.towns.length) {
    // Prefer towns that have a dungeon within a reasonable walking radius
    const radius = 20;
    const townsNearDungeon = world.towns.filter(t => {
      return (world.dungeons || []).some(d => Math.abs(d.x - t.x) + Math.abs(d.y - t.y) <= radius);
    });
    if (townsNearDungeon.length) {
      return townsNearDungeon[(r() * townsNearDungeon.length) | 0];
    }
    // Else fallback to any town
    
    return world.towns[(r() * world.towns.length) | 0];
  }
  // fallback to first walkable tile near a dungeon if possible
  const ds = world.dungeons || [];
  if (ds.length) {
    const d = ds[(r() * ds.length) | 0];
    // Find nearest walkable tile to the dungeon entrance
    const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
    if (isWalkable(world.map[d.y][d.x])) {
      
      return { x: d.x, y: d.y };
    }
    for (const dir of dirs) {
      const nx = d.x + dir.dx, ny = d.y + dir.dy;
      if (nx >= 0 && ny >= 0 && nx < world.width && ny < world.height && isWalkable(world.map[ny][nx])) {
        
        return { x: nx, y: ny };
      }
    }
  }
  // ultimate fallback: first walkable tile
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      if (isWalkable(world.map[y][x])) {
        
        return { x, y };
      }
    }
  }
  
  return { x: 1, y: 1 };
}

// Back-compat: attach to window via helper
attachGlobal("World", { TILES, generate, isWalkable, pickTownStart, biomeName });