/**
 * RegionMapRuntime
 * Lightweight, fixed-size overlay map shown from overworld when pressing G on a walkable tile.
 *
 * Exports (ESM + window.RegionMapRuntime):
 * - open(ctx, size?): builds a local downscaled view of the world and enters "region" mode.
 * - close(ctx): returns to overworld at the same coordinates where G was pressed.
 * - tryMove(ctx, dx, dy): moves the region cursor within bounds; respects overworld walkability.
 * - onAction(ctx): pressing G inside region map; closes only when on an orange edge tile.
 * - tick(ctx): optional no-op hook.
 */
import * as World from "../world/world.js";

const DEFAULT_WIDTH = 28;
const DEFAULT_HEIGHT = 18;

// Deterministic RNG for region map based on global seed and world position
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

// Helper: get tile def from GameData.tiles for a given mode and numeric id
function getTileDef(mode, id) {
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const arr = GD && GD.tiles && Array.isArray(GD.tiles.tiles) ? GD.tiles.tiles : null;
    if (!arr) return null;
    const m = String(mode || "").toLowerCase();
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      if ((t.id | 0) === (id | 0) && Array.isArray(t.appearsIn) && t.appearsIn.some(s => String(s).toLowerCase() === m)) {
        return t;
      }
    }
  } catch (_) {}
  return null;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Build a local downscaled sample centered around the player's world position.
// Samples a window ~35% of the world dimensions to reflect nearby biomes rather than the whole map.
function buildLocalDownscaled(world, px, py, w, h) {
  const out = Array.from({ length: h }, () => Array(w).fill(0));
  const Ww = world.width || (world.map[0] ? world.map[0].length : 0);
  const Wh = world.height || world.map.length;
  if (!Ww || !Wh) return out;

  const winW = clamp(Math.floor(Ww * 0.35), 12, Ww);
  const winH = clamp(Math.floor(Wh * 0.35), 8, Wh);
  const minX = clamp(px - Math.floor(winW / 2), 0, Math.max(0, Ww - winW));
  const minY = clamp(py - Math.floor(winH / 2), 0, Math.max(0, Wh - winH));

  for (let ry = 0; ry < h; ry++) {
    for (let rx = 0; rx < w; rx++) {
      const nx = minX + Math.round(rx * (winW - 1) / Math.max(1, (w - 1)));
      const ny = minY + Math.round(ry * (winH - 1) / Math.max(1, (h - 1)));
      out[ry][rx] = world.map[ny][nx];
    }
  }
  return out;
}

function countBiomes(sample) {
  const WT = World.TILES;
  const counts = {
    [WT.WATER]: 0, [WT.RIVER]: 0, [WT.BEACH]: 0,
    [WT.SWAMP]: 0, [WT.FOREST]: 0, [WT.GRASS]: 0,
    [WT.MOUNTAIN]: 0, [WT.DESERT]: 0, [WT.SNOW]: 0,
    [WT.TOWN]: 0, [WT.DUNGEON]: 0, [WT.TREE]: 0
  };
  for (let y = 0; y < sample.length; y++) {
    const row = sample[y] || [];
    for (let x = 0; x < row.length; x++) {
      const t = row[x];
      if (typeof counts[t] === "number") counts[t] += 1;
    }
  }
  const total = sample.length * (sample[0] ? sample[0].length : 0);
  return { counts, total };
}

// Add small ponds to otherwise uniform regions (grass/forest dominated),
// and add beach shorelines near any water.
// Uses deterministic rng() to keep region map stable per world tile.
function addMinorWaterAndBeaches(sample, rng) {
  const WT = World.TILES;
  const h = sample.length, w = sample[0] ? sample[0].length : 0;
  if (!w || !h) return;

  const { counts, total } = countBiomes(sample);
  const waterTiles = (counts[WT.WATER] || 0) + (counts[WT.RIVER] || 0);
  const grassTiles = (counts[WT.GRASS] || 0);
  const forestTiles = (counts[WT.FOREST] || 0);

  // Inject a few ponds if no water and dominated by grass/forest
  if (waterTiles < Math.max(1, Math.floor(total * 0.01)) && (grassTiles + forestTiles) > Math.floor(total * 0.65)) {
    const ponds = Math.floor(rng() * 3); // 0..2 small ponds
    for (let p = 0; p < ponds; p++) {
      const cx = clamp((rng() * w) | 0, 2, w - 3);
      const cy = clamp((rng() * h) | 0, 2, h - 3);
      const rx = 2 + ((rng() * 2) | 0);
      const ry = 1 + ((rng() * 2) | 0);
      for (let dy = -ry; dy <= ry; dy++) {
        for (let dx = -rx; dx <= rx; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const e = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
          if (e <= 1.0) {
            sample[ny][nx] = WT.WATER;
          }
        }
      }
    }
  }

  // Shoreline pass: convert tiles adjacent to water into BEACH to reflect coastlines
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = sample[y][x];
      if (t === WT.WATER) continue;
      let nearWater = false;
      for (let dy = -1; dy <= 1 && !nearWater; dy++) {
        for (let dx = -1; dx <= 1 && !nearWater; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nt = sample[ny][nx];
          if (nt === WT.WATER || nt === WT.RIVER) nearWater = true;
        }
      }
      if (nearWater && (t === WT.GRASS || t === WT.FOREST)) {
        sample[y][x] = WT.BEACH;
      }
    }
  }
}

// Collect the set of immediate neighboring tiles around the player (8-neighborhood).
function collectNeighborSet(world, px, py) {
  const Ww = world.width || (world.map[0] ? world.map[0].length : 0);
  const Wh = world.height || world.map.length;
  const set = new Set();
  const counts = new Map();
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = px + dx, ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= Ww || ny >= Wh) continue;
      const t = world.map[ny][nx];
      set.add(t);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return { set, counts };
}

function choosePrimaryTile(counts, fallback) {
  let bestTile = fallback;
  let bestCount = -1;
  for (const [tile, cnt] of counts.entries()) {
    if (cnt > bestCount) { bestCount = cnt; bestTile = tile; }
  }
  return bestTile;
}

// Filter a sampled region to only use tiles present in neighborSet; replace others with primaryTile.
function filterSampleByNeighborSet(sample, neighborSet, primaryTile) {
  for (let y = 0; y < sample.length; y++) {
    const row = sample[y] || [];
    for (let x = 0; x < row.length; x++) {
      const t = row[x];
      if (!neighborSet.has(t)) {
        row[x] = primaryTile;
      }
    }
  }
}

// ---- Persistence of cut trees per region (do not respawn after cutting) ----
const REGION_CUTS_LS_KEY = "REGION_CUTS_V1";

function _loadCutsMap() {
  try {
    const raw = localStorage.getItem(REGION_CUTS_LS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? obj : {};
  } catch (_) {
    return {};
  }
}
function _saveCutsMap(map) {
  try {
    localStorage.setItem(REGION_CUTS_LS_KEY, JSON.stringify(map || {}));
  } catch (_) {}
}
function regionCutKey(worldX, worldY, width, height) {
  return `r:${worldX},${worldY}:${width}x${height}`;
}
function applyRegionCuts(sample, key) {
  if (!key) return;
  const map = _loadCutsMap();
  const arr = Array.isArray(map[key]) ? map[key] : [];
  if (!arr.length) return;
  const h = sample.length, w = sample[0] ? sample[0].length : 0;
  const WT = World.TILES;
  for (const s of arr) {
    const parts = String(s).split(",");
    if (parts.length !== 2) continue;
    const x = (Number(parts[0]) | 0), y = (Number(parts[1]) | 0);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    // Only convert if currently a TREE to avoid clobbering non-tree tiles
    try {
      if (sample[y][x] === WT.TREE) sample[y][x] = WT.FOREST;
    } catch (_) {}
  }
}
function addRegionCut(key, x, y) {
  if (!key) return;
  const map = _loadCutsMap();
  const k = String(key);
  const arr = Array.isArray(map[k]) ? map[k] : [];
  const tag = `${x | 0},${y | 0}`;
  if (!arr.includes(tag)) arr.push(tag);
  map[k] = arr;
  _saveCutsMap(map);
}

// Robust directional sampling around the player using angular sectors (8-way).
// Bins tiles within a radius into N, NE, E, SE, S, SW, W, NW by angle.
// Returns predominant tile per sector and a dominance weight (0..1) per cardinal.
function computeDirectionalTiles(world, px, py, radius = 6) {
  const Ww = world.width || (world.map[0] ? world.map[0].length : 0);
  const Wh = world.height || world.map.length;

  // Map sector name to array of tiles seen
  const bins = {
    N: [], NE: [], E: [], SE: [], S: [], SW: [], W: [], NW: []
  };

  function sectorOf(dx, dy) {
    // atan2: y down positive; convert to degrees [0,360)
    const ang = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    // E-centered sectors (22.5° width half-angle)
    if (ang >= 337.5 || ang < 22.5) return "E";
    if (ang < 67.5) return "NE";
    if (ang < 112.5) return "N";
    if (ang < 157.5) return "NW";
    if (ang < 202.5) return "W";
    if (ang < 247.5) return "SW";
    if (ang < 292.5) return "S";
    return "SE";
  }

  // Weighted sampling within radius; give slightly more weight to nearer tiles to avoid far noise
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = px + dx, ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= Ww || ny >= Wh) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const s = sectorOf(dx, dy);
      // Weight: closer tiles count a bit more (inverse distance), clamp
      const w = Math.max(0.5, 1.5 - Math.sqrt(d2) / (radius || 1));
      const t = world.map[ny][nx];
      // Push repeated entries to approximate weight without extra structures
      const repeats = Math.max(1, Math.round(w));
      for (let k = 0; k < repeats; k++) bins[s].push(t);
    }
  }

  function predominant(arr) {
    if (!arr.length) return { tile: null, weight: 0 };
    const m = new Map();
    for (const t of arr) m.set(t, (m.get(t) || 0) + 1);
    let best = null, bestCnt = -1, total = 0;
    for (const [t, cnt] of m.entries()) {
      total += cnt;
      if (cnt > bestCnt) { best = t; bestCnt = cnt; }
    }
    const weight = total > 0 ? (bestCnt / total) : 0;
    return { tile: best, weight };
  }

  const N = predominant(bins.N), S = predominant(bins.S), E = predominant(bins.E), W = predominant(bins.W);
  const NE = predominant(bins.NE), NW = predominant(bins.NW), SE = predominant(bins.SE), SW = predominant(bins.SW);

  return {
    cardinals: { N: N.tile, S: S.tile, E: E.tile, W: W.tile },
    diagonals: { NE: NE.tile, NW: NW.tile, SE: SE.tile, SW: SW.tile },
    weights: {
      N: N.weight, S: S.weight, E: E.weight, W: W.weight
    }
  };
}


// Orient the region sample so that cardinal biomes appear toward their respective edges,
// and diagonals fill corner wedges to better line up with overworld.
// Top band -> N tile, bottom band -> S tile, left band -> W tile, right band -> E tile.
// Corner wedges: NW/NE/SW/SE fill a triangular corner area to blend edges naturally.
// weights: optional dominance factors (0..1) per cardinal to scale band thickness.
function orientSampleByCardinals(sample, cardinals, edgeFrac = 0.33, diagonals = null, weights = null) {
  const h = sample.length, w = sample[0] ? sample[0].length : 0;
  if (!w || !h) return;
  const clampFrac = (v) => Math.max(0.18, Math.min(0.5, v));
  const wN = weights && typeof weights.N === "number" ? weights.N : 1.0;
  const wS = weights && typeof weights.S === "number" ? weights.S : 1.0;
  const wW = weights && typeof weights.W === "number" ? weights.W : 1.0;
  const wE = weights && typeof weights.E === "number" ? weights.E : 1.0;
  // Scale edge thickness by dominance: stronger dominance -> slightly thicker band
  const topH = Math.max(1, Math.floor(h * clampFrac(edgeFrac * (0.8 + 0.4 * wN))));
  const botH = Math.max(1, Math.floor(h * clampFrac(edgeFrac * (0.8 + 0.4 * wS))));
  const leftW = Math.max(1, Math.floor(w * clampFrac(edgeFrac * (0.8 + 0.4 * wW))));
  const rightW = Math.max(1, Math.floor(w * clampFrac(edgeFrac * (0.8 + 0.4 * wE))));

  // Top band (north)
  if (cardinals.N != null) {
    for (let y = 0; y < topH; y++) {
      const row = sample[y];
      for (let x = 0; x < w; x++) {
        row[x] = cardinals.N;
      }
    }
  }

  // Bottom band (south)
  if (cardinals.S != null) {
    for (let y = h - botH; y < h; y++) {
      const row = sample[y];
      for (let x = 0; x < w; x++) {
        row[x] = cardinals.S;
      }
    }
  }

  // Left band (west)
  if (cardinals.W != null) {
    for (let y = 0; y < h; y++) {
      const row = sample[y];
      for (let x = 0; x < leftW; x++) {
        row[x] = cardinals.W;
      }
    }
  }

  // Right band (east)
  if (cardinals.E != null) {
    for (let y = 0; y < h; y++) {
      const row = sample[y];
      for (let x = w - rightW; x < w; x++) {
        row[x] = cardinals.E;
      }
    }
  }

  // Corner wedges using diagonals to improve alignment with overworld
  if (diagonals) {
    const cornerW = Math.max(1, Math.floor(Math.min(leftW, rightW) * 0.8));
    const cornerH = Math.max(1, Math.floor(Math.min(topH, botH) * 0.8));
    // NW corner
    if (diagonals.NW != null) {
      for (let y = 0; y < cornerH; y++) {
        for (let x = 0; x < cornerW - Math.floor((cornerW * y) / Math.max(1, cornerH - 1)); x++) {
          sample[y][x] = diagonals.NW;
        }
      }
    }
    // NE corner
    if (diagonals.NE != null) {
      for (let y = 0; y < cornerH; y++) {
        for (let x = 0; x < cornerW - Math.floor((cornerW * y) / Math.max(1, cornerH - 1)); x++) {
          const xx = w - 1 - x;
          sample[y][xx] = diagonals.NE;
        }
      }
    }
    // SW corner
    if (diagonals.SW != null) {
      for (let y = 0; y < cornerH; y++) {
        const yy = h - 1 - y;
        for (let x = 0; x < cornerW - Math.floor((cornerW * y) / Math.max(1, cornerH - 1)); x++) {
          sample[yy][x] = diagonals.SW;
        }
      }
    }
    // SE corner
    if (diagonals.SE != null) {
      for (let y = 0; y < cornerH; y++) {
        const yy = h - 1 - y;
        for (let x = 0; x < cornerW - Math.floor((cornerW * y) / Math.max(1, cornerH - 1)); x++) {
          const xx = w - 1 - x;
          sample[yy][xx] = diagonals.SE;
        }
      }
    }
  }
}

// Sprinkle sparse TREE tiles inside FOREST tiles for region map visualization.
// Avoid placing trees adjacent to each other to keep them sparse.
// Uses deterministic rng() to keep region map stable per world tile.
function addSparseTreesInForests(sample, density = 0.08, rng) {
  const WT = World.TILES;
  const h = sample.length, w = sample[0] ? sample[0].length : 0;
  if (!w || !h) return;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (sample[y][x] !== WT.FOREST) continue;
      if (rng() >= density) continue;
      // avoid adjacent trees to keep sparsity
      let nearTree = false;
      for (let dy = -1; dy <= 1 && !nearTree; dy++) {
        for (let dx = -1; dx <= 1 && !nearTree; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (sample[ny][nx] === WT.TREE) nearTree = true;
        }
      }
      if (!nearTree) sample[y][x] = WT.TREE;
    }
  }
}

function open(ctx, size) {
  if (!ctx || ctx.mode !== "world" || !ctx.world || !ctx.world.map) return false;
  // Capture world position for persistence keying
  const worldX = ctx.player.x | 0;
  const worldY = ctx.player.y | 0;
  // Only allow from walkable, non-town, non-dungeon tiles
  const WT = World.TILES;
  const tile = ctx.world.map[worldY][worldX];
  if (tile === WT.TOWN || tile === WT.DUNGEON) return false;
  const isWalkable = (typeof World.isWalkable === "function") ? World.isWalkable(tile) : true;
  if (!isWalkable) return false;

  const width = clamp((size && size.width) || DEFAULT_WIDTH, 12, 80);
  const height = clamp((size && size.height) || DEFAULT_HEIGHT, 8, 60);

  // Build local sample reflecting biomes near the player.
  let sample = buildLocalDownscaled(ctx.world, worldX, worldY, width, height);

  // Restrict the region map to only the immediate neighbor biomes around the player (+ current tile).
  const playerTile = tile;
  const { set: neighborSet, counts: neighborCounts } = collectNeighborSet(ctx.world, worldX, worldY);
  neighborSet.add(playerTile);
  const primaryTile = choosePrimaryTile(neighborCounts, playerTile);
  filterSampleByNeighborSet(sample, neighborSet, primaryTile);

  // Orient biomes by robust directional sampling (cardinals + diagonals) to line up with overworld
  const dirs = computeDirectionalTiles(ctx.world, worldX, worldY, 7);
  orientSampleByCardinals(sample, dirs.cardinals, 0.33, dirs.diagonals, dirs.weights);

  // Enhance per rules: minor water ponds in uniform grass/forest and shoreline beaches near water
  const rng = getRegionRng(ctx);
  addMinorWaterAndBeaches(sample, rng);
  // Sprinkle sparse trees in forest tiles for region visualization
  addSparseTreesInForests(sample, 0.10, rng);
  // Apply persisted tree cuts for this region so trees don't respawn
  try {
    const cutKey = regionCutKey(worldX, worldY, width, height);
    applyRegionCuts(sample, cutKey);
    // Stash key for onAction persistence
    if (!ctx.region) ctx.region = {};
    ctx.region._cutKey = cutKey;
  } catch (_) {}

  const exitNorth = { x: (width / 2) | 0, y: 0 };
  const exitSouth = { x: (width / 2) | 0, y: height - 1 };
  const exitWest = { x: 0, y: (height / 2) | 0 };
  const exitEast = { x: width - 1, y: (height / 2) | 0 };

  // Choose spawn exit closest to the player's overworld position relative to world edges
  const worldW = (ctx.world && (ctx.world.width || (ctx.world.map[0] ? ctx.world.map[0].length : 0))) || 0;
  const worldH = (ctx.world && (ctx.world.height || ctx.world.map.length)) || 0;
  const dNorth = worldY;
  const dSouth = Math.max(0, (worldH - 1) - worldY);
  const dWest = worldX;
  const dEast = Math.max(0, (worldW - 1) - worldX);
  let spawnExit = exitNorth;
  const minD = Math.min(dNorth, dSouth, dWest, dEast);
  if (minD === dSouth) spawnExit = exitSouth;
  else if (minD === dWest) spawnExit = exitWest;
  else if (minD === dEast) spawnExit = exitEast;

  ctx.region = {
    ...(ctx.region || {}),
    width,
    height,
    map: sample,
    cursor: { x: spawnExit.x | 0, y: spawnExit.y | 0 },
    exitTiles: [exitNorth, exitSouth, exitWest, exitEast],
    enterWorldPos: { x: worldX, y: worldY },
    _prevLOS: ctx.los || null,
  };

  // Region behaves like a normal mode: use region map as active map and player follows cursor
  ctx.map = sample;
  // Initialize FOV memory and visibility (unseen by default; recomputeFOV will fill visible)
  ctx.seen = Array.from({ length: height }, () => Array(width).fill(false));
  ctx.visible = Array.from({ length: height }, () => Array(width).fill(false));
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

  // Rare neutral animals in region: deer/boar/fox that wander; become hostile only if attacked.
  (function spawnNeutralAnimals() {
    try {
      const WT = World.TILES;
      const rng = getRegionRng(ctx);
      const sample = ctx.region.map;
      const h = sample.length, w = sample[0] ? sample[0].length : 0;
      if (!w || !h) return;
      // Base rarity: 0–2 animals, more likely in forest/grass/beach; very rare in desert/snow/swamp.
      const { counts } = countBiomes(sample);
      const forestBias = (counts[WT.FOREST] || 0) / (w * h);
      const grassBias = (counts[WT.GRASS] || 0) / (w * h);
      const beachBias = (counts[WT.BEACH] || 0) / (w * h);
      const base = 0 + (rng() < (0.15 + forestBias * 0.30 + grassBias * 0.20 + beachBias * 0.10) ? 1 : 0) + (rng() < (forestBias * 0.25) ? 1 : 0);
      const count = Math.min(2, base);
      if (count <= 0) return;
      ctx.enemies = Array.isArray(ctx.enemies) ? ctx.enemies : [];
      const types = ["deer","boar","fox"];
      function pickType() {
        const r = rng();
        if (r < 0.45) return "deer";
        if (r < 0.75) return "fox";
        return "boar";
      }
      function randomWalkable() {
        for (let tries = 0; tries < 200; tries++) {
          const x = (rng() * w) | 0;
          const y = (rng() * h) | 0;
          const t = sample[y][x];
          const walkable = (t !== WT.WATER && t !== WT.RIVER && t !== WT.MOUNTAIN);
          const occupied = ctx.enemies.some(e => e && e.x === x && e.y === y);
          const atCursor = (ctx.region.cursor && ctx.region.cursor.x === x && ctx.region.cursor.y === y);
          if (walkable && !occupied && !atCursor) return { x, y };
        }
        return null;
      }
      for (let i = 0; i < count; i++) {
        const pos = randomWalkable();
        if (!pos) break;
        const t = pickType();
        const hp = t === "deer" ? 3 : t === "fox" ? 2 : 4;
        const atk = t === "deer" ? 0.6 : t === "fox" ? 0.7 : 0.9;
        ctx.enemies.push({ x: pos.x, y: pos.y, type: t, glyph: (t[0] || "?"), hp, atk, xp: 0, level: 1, faction: "animal", announced: false });
      }
    } catch (_) {}
  })();

  try { typeof ctx.updateCamera === "function" && ctx.updateCamera(); } catch (_) {}
  try { typeof ctx.recomputeFOV === "function" && ctx.recomputeFOV(); } catch (_) {}
  try { ctx.updateUI && ctx.updateUI(); } catch (_) {}
  try { ctx.requestDraw && ctx.requestDraw(); } catch (_) {}
  if (ctx.log) ctx.log("Region map opened. Move with arrows. Press G on an orange edge tile to close.", "info");
  return true;
}

function close(ctx) {
  if (!ctx || ctx.mode !== "region") return false;
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
  // Restore active map to world
  if (ctx.world && ctx.world.map) {
    ctx.map = ctx.world.map;
    const rows = ctx.map.length;
    const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
    // Reveal world fully
    ctx.seen = Array.from({ length: rows }, () => Array(cols).fill(true));
    ctx.visible = Array.from({ length: rows }, () => Array(cols).fill(true));
  }
  if (pos) {
    ctx.player.x = pos.x | 0;
    ctx.player.y = pos.y | 0;
  }
  try { typeof ctx.updateCamera === "function" && ctx.updateCamera(); } catch (_) {}
  try { typeof ctx.recomputeFOV === "function" && ctx.recomputeFOV(); } catch (_) {}
  try { ctx.updateUI && ctx.updateUI(); } catch (_) {}
  try { ctx.requestDraw && ctx.requestDraw(); } catch (_) {}
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
    const isWalkableWorld = (typeof World.isWalkable === "function") ? World.isWalkable : null;
    walkable = isWalkableWorld ? !!isWalkableWorld(tile) : (WT ? (tile !== WT.WATER && tile !== WT.RIVER && tile !== WT.MOUNTAIN) : true);
  } catch (_) {}

  // Allow bump attacks on any enemy occupying the target tile
  let enemy = null;
  if (Array.isArray(ctx.enemies)) {
    try { enemy = ctx.enemies.find(e => e && e.x === nx && e.y === ny) || null; } catch (_) { enemy = null; }
  }
  if (enemy) {
    // If this is a neutral animal, make it hostile when attacked and mark region as an encounter
    try {
      if (String(enemy.faction || "") === "animal") {
        enemy.faction = "animal_hostile";
        ctx.region._isEncounter = true;
        ctx.log && ctx.log(`The ${enemy.type} turns hostile!`, "warn");
      }
    } catch (_) {}
    const C = ctx.Combat || (typeof window !== "undefined" ? window.Combat : null);
    if (C && typeof C.playerAttackEnemy === "function") {
      try { C.playerAttackEnemy(ctx, enemy); } catch (_) {}
      try { typeof ctx.turn === "function" && ctx.turn(); } catch (_) {}
      return true;
    }
    // Minimal fallback
    try {
      const loc = { part: "torso", mult: 1.0, blockMod: 1.0, critBonus: 0.0 };
      const blockChance = (typeof ctx.getEnemyBlockChance === "function") ? ctx.getEnemyBlockChance(enemy, loc) : 0;
      const rb = (typeof ctx.rng === "function") ? ctx.rng() : Math.random();
      if (rb < blockChance) {
        ctx.log && ctx.log(`${(enemy.type || "enemy")} blocks your attack.`, "block");
      } else {
        const atk = (typeof ctx.getPlayerAttack === "function") ? ctx.getPlayerAttack() : 1;
        const dmg = Math.max(0.1, Math.round(atk * 10) / 10);
        enemy.hp -= dmg;
        ctx.log && ctx.log(`You hit the ${(enemy.type || "enemy")} for ${dmg}.`);
        if (enemy.hp <= 0 && typeof ctx.onEnemyDied === "function") ctx.onEnemyDied(enemy);
      }
    } catch (_) {}
    try { typeof ctx.turn === "function" && ctx.turn(); } catch (_) {}
    return true;
  }

  if (!walkable) {
    try { ctx.requestDraw && ctx.requestDraw(); } catch (_) {}
    return false;
  }

  ctx.region.cursor = { x: nx, y: ny };
  ctx.player.x = nx; ctx.player.y = ny;

  try { typeof ctx.updateCamera === "function" && ctx.updateCamera(); } catch (_) {}
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

  // Context action inside region: chop tree if standing on a TREE tile
  try {
    const WT = World.TILES;
    const t = (ctx.region.map[cursor.y] && ctx.region.map[cursor.y][cursor.x]);
    if (t === WT.TREE) {
      // Log and convert this spot back to forest for visualization
      if (ctx.log) ctx.log("You cut the tree.", "notice");
      try {
        ctx.region.map[cursor.y][cursor.x] = WT.FOREST;
        // Reflect change in active map and request redraw
        if (ctx.map === ctx.region.map && typeof ctx.requestDraw === "function") ctx.requestDraw();
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

  if (ctx.log) ctx.log("Move to an orange edge tile and press G to close the Region map.", "info");
  return true;
}

function tick(ctx) {
  if (!ctx || ctx.mode !== "region") return true;
  // If an encounter is active within the region map, drive simple AI and completion check
  if (ctx.region && ctx.region._isEncounter) {
    try {
      const AIH = ctx.AI || (typeof window !== "undefined" ? window.AI : null);
      if (AIH && typeof AIH.enemiesAct === "function") {
        AIH.enemiesAct(ctx);
      }
    } catch (_) {}
    try {
      const OG = ctx.OccupancyGrid || (typeof window !== "undefined" ? window.OccupancyGrid : null);
      if (OG && typeof OG.build === "function") {
        ctx.occupancy = OG.build({ map: ctx.map, enemies: ctx.enemies, npcs: ctx.npcs, props: ctx.townProps, player: ctx.player });
      }
    } catch (_) {}
    // Victory: no enemies remain
    try {
      if (!Array.isArray(ctx.enemies) || ctx.enemies.length === 0) {
        ctx.region._isEncounter = false;
        ctx.encounterInfo = null;
        if (ctx.log) ctx.log("You prevail and return to the overworld.", "good");
        close(ctx);
        return true;
      }
    } catch (_) {}
  }
  return true;
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.RegionMapRuntime = { open, close, tryMove, onAction, tick };
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.RegionMapRuntime = { open, close, tryMove, onAction, tick };
}