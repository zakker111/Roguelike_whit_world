import * as World from "../world/world.js";

// Shared clamp helper for region map sampling and sizing.
export function clamp(v, lo, hi) {
  try {
    if (typeof window !== "undefined" && window.Bounds && typeof window.Bounds.clamp === "function") {
      return window.Bounds.clamp(v, lo, hi);
    }
  } catch (_) {}
  return Math.max(lo, Math.min(hi, v));
}

// Build a local downscaled sample centered around the player's world position.
// Samples a window ~35% of the world dimensions to reflect nearby biomes rather than the whole map.
export function buildLocalDownscaled(world, px, py, w, h) {
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

// Count basic biome tiles within a sampled region.
export function countBiomes(sample) {
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
export function addMinorWaterAndBeaches(sample, rng) {
  const WT = World.TILES;
  const h = sample.length;
  const w = sample[0] ? sample[0].length : 0;
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
          const nx = cx + dx;
          const ny = cy + dy;
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
          const nx = x + dx;
          const ny = y + dy;
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
export function collectNeighborSet(world, px, py) {
  const Ww = world.width || (world.map[0] ? world.map[0].length : 0);
  const Wh = world.height || world.map.length;
  const set = new Set();
  const counts = new Map();
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = px + dx;
      const ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= Ww || ny >= Wh) continue;
      const t = world.map[ny][nx];
      set.add(t);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return { set, counts };
}

export function choosePrimaryTile(counts, fallback) {
  let bestTile = fallback;
  let bestCount = -1;
  for (const [tile, cnt] of counts.entries()) {
    if (cnt > bestCount) {
      bestCount = cnt;
      bestTile = tile;
    }
  }
  return bestTile;
}

// Filter a sampled region to only use tiles present in neighborSet; replace others with primaryTile.
export function filterSampleByNeighborSet(sample, neighborSet, primaryTile) {
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

// Robust directional sampling around the player using angular sectors (8-way).
// Bins tiles within a radius into N, NE, E, SE, S, SW, W, NW by angle.
// Returns predominant tile per sector and a dominance weight (0..1) per cardinal.
export function computeDirectionalTiles(world, px, py, radius = 6) {
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
      const nx = px + dx;
      const ny = py + dy;
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
    let best = null;
    let bestCnt = -1;
    let total = 0;
    for (const [t, cnt] of m.entries()) {
      total += cnt;
      if (cnt > bestCnt) {
        best = t;
        bestCnt = cnt;
      }
    }
    const weight = total > 0 ? (bestCnt / total) : 0;
    return { tile: best, weight };
  }

  const N = predominant(bins.N);
  const S = predominant(bins.S);
  const E = predominant(bins.E);
  const W = predominant(bins.W);
  const NE = predominant(bins.NE);
  const NW = predominant(bins.NW);
  const SE = predominant(bins.SE);
  const SW = predominant(bins.SW);

  return {
    cardinals: { N: N.tile, S: S.tile, E: E.tile, W: W.tile },
    diagonals: { NE: NE.tile, NW: NW.tile, SE: SE.tile, SW: SW.tile },
    weights: {
      N: N.weight,
      S: S.weight,
      E: E.weight,
      W: W.weight
    }
  };
}

// Orient the region sample so that cardinal biomes appear toward their respective edges,
// and diagonals fill corner wedges to better line up with overworld.
// Top band -> N tile, bottom band -> S tile, left band -> W tile, right band -> E tile.
// Corner wedges: NW/NE/SW/SE fill a triangular corner area to blend edges naturally.
// weights: optional dominance factors (0..1) per cardinal to scale band thickness.
export function orientSampleByCardinals(sample, cardinals, edgeFrac = 0.33, diagonals = null, weights = null) {
  const h = sample.length;
  const w = sample[0] ? sample[0].length : 0;
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

  // Safe setter to guard against out-of-bounds indexing for rare edge cases
  const setTileSafe = (yy, xx, val) => {
    if (yy >= 0 && yy < h && xx >= 0 && xx < w && sample[yy]) {
      sample[yy][xx] = val;
    }
  };

  // Top band (north)
  if (cardinals.N != null) {
    for (let y = 0; y < topH; y++) {
      for (let x = 0; x < w; x++) {
        setTileSafe(y, x, cardinals.N);
      }
    }
  }

  // Bottom band (south)
  if (cardinals.S != null) {
    for (let y = h - botH; y < h; y++) {
      for (let x = 0; x < w; x++) {
        setTileSafe(y, x, cardinals.S);
      }
    }
  }

  // Left band (west)
  if (cardinals.W != null) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < leftW; x++) {
        setTileSafe(y, x, cardinals.W);
      }
    }
  }

  // Right band (east)
  if (cardinals.E != null) {
    for (let y = 0; y < h; y++) {
      for (let x = w - rightW; x < w; x++) {
        setTileSafe(y, x, cardinals.E);
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
          setTileSafe(y, x, diagonals.NW);
        }
      }
    }
    // NE corner
    if (diagonals.NE != null) {
      for (let y = 0; y < cornerH; y++) {
        for (let x = 0; x < cornerW - Math.floor((cornerW * y) / Math.max(1, cornerH - 1)); x++) {
          const xx = w - 1 - x;
          setTileSafe(y, xx, diagonals.NE);
        }
      }
    }
    // SW corner
    if (diagonals.SW != null) {
      for (let y = 0; y < cornerH; y++) {
        const yy = h - 1 - y;
        for (let x = 0; x < cornerW - Math.floor((cornerW * y) / Math.max(1, cornerH - 1)); x++) {
          setTileSafe(yy, x, diagonals.SW);
        }
      }
    }
    // SE corner
    if (diagonals.SE != null) {
      for (let y = 0; y < cornerH; y++) {
        const yy = h - 1 - y;
        for (let x = 0; x < cornerW - Math.floor((cornerW * y) / Math.max(1, cornerH - 1)); x++) {
          const xx = w - 1 - x;
          setTileSafe(yy, xx, diagonals.SE);
        }
      }
    }
  }
}

// Sprinkle sparse TREE tiles inside FOREST-like tiles for region map visualization.
// Treat both FOREST and SNOW_FOREST as wooded ground, and avoid placing trees adjacent
// to each other to keep them sparse. Uses deterministic rng() to keep region map stable
// per world tile.
export function addSparseTreesInForests(sample, density = 0.08, rng) {
  const WT = World.TILES;
  const h = sample.length;
  const w = sample[0] ? sample[0].length : 0;
  if (!w || !h) return;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = sample[y][x];
      // Consider both regular forest and snowy forest as tree-capable ground.
      if (!(t === WT.FOREST || t === WT.SNOW_FOREST)) continue;
      if (rng() >= density) continue;
      // avoid adjacent trees to keep sparsity
      let nearTree = false;
      for (let dy = -1; dy <= 1 && !nearTree; dy++) {
        for (let dx = -1; dx <= 1 && !nearTree; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (sample[ny][nx] === WT.TREE) nearTree = true;
        }
      }
      if (!nearTree) sample[y][x] = WT.TREE;
    }
  }
}

// Sprinkle scarce BERRY_BUSH tiles in wooded areas (mostly forest), never in desert.
// Does not block FOV. Avoid adjacency to other bushes and trees.
export function addBerryBushesInForests(sample, forestDensity = 0.025, rng) {
  const WT = World.TILES;
  const h = sample.length;
  const w = sample[0] ? sample[0].length : 0;
  if (!w || !h) return;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = sample[y][x];
      if (t !== WT.FOREST) continue; // only in forests for now
      if (rng() >= forestDensity) continue;
      let nearBusy = false;
      for (let dy = -1; dy <= 1 && !nearBusy; dy++) {
        for (let dx = -1; dx <= 1 && !nearBusy; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nt = sample[ny][nx];
          if (nt === WT.TREE || nt === WT.BERRY_BUSH) nearBusy = true;
        }
      }
      if (!nearBusy) sample[y][x] = WT.BERRY_BUSH;
    }
  }
}
