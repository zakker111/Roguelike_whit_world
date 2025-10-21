/**
 * WorldRuntime: generation and helpers for overworld mode.
 *
 * Exports (ESM + window.WorldRuntime):
 * - generate(ctx, { width, height }?)
 * - tryMovePlayerWorld(ctx, dx, dy)
 * - tick(ctx)      // optional per-turn hook for world mode
 */

// Stable coord hash -> [0,1) for procedural chunk generation
function h2(x, y, seed) {
  // Mix coordinates with seed using 32-bit math (mulberry/xxhash-inspired)
  let h = (Number(seed) >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ ((x * 0x85ebca6b) >>> 0), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ ((y * 0xc2b2ae35) >>> 0), 0xc2b2ae35) >>> 0;
  return (h >>> 0) / 4294967296;
}

// Low-frequency noise by snapping to a coarse grid for contiguous patches
function coarse(x, y, seed, scale = 6, salt = 0) {
  const gx = Math.floor(x / scale);
  const gy = Math.floor(y / scale);
  return h2(gx + salt, gy + salt, seed);
}

// Determine current RNG seed for determinism
function currentSeed() {
  try {
    if (typeof window !== "undefined" && window.RNG && typeof window.RNG.getSeed === "function") {
      const s = window.RNG.getSeed();
      if (typeof s === "number") return s >>> 0;
    }
  } catch (_) {}
  // Fallback: derive from time once (non-deterministic)
  try { return (Date.now() % 0xffffffff) >>> 0; } catch (_) { return 123456789; }
}

// Generate a tile for global coords (gx, gy) using deterministic noise and simple climate rules
function genTileAt(WT, gx, gy, seed, originY, totalH) {
  // Base probabilities from coarse noise
  const rWater = coarse(gx, gy, seed, 7, 11);
  const rForest = coarse(gx, gy, seed, 5, 23);
  const rMount = coarse(gx, gy, seed, 6, 37);

  let t = WT.GRASS;
  if (rWater < 0.16) t = WT.WATER;
  else if (rMount < 0.12) t = WT.MOUNTAIN;
  else if (rForest < 0.28) t = WT.FOREST;

  // Climate bands (simple north/south gradient): snow up north, desert down south
  try {
    const H = Math.max(1, totalH | 0);
    const yNorm = (H > 0) ? ((gy - (originY | 0)) / H) : 0.5; // normalize to [0,1] across current world
    if (t === WT.GRASS) {
      if (yNorm < 0.20 && h2(gx, gy, seed ^ 0x111) < 0.85) t = WT.SNOW;
      else if (yNorm > 0.75 && h2(gx, gy, seed ^ 0x222) < 0.85) t = WT.DESERT;
    }
  } catch (_) {}

  return t;
}

// Post-process adjacency: beaches/swamps around water/river
function shoreAdjust(segRow, WT) {
  const W = segRow.length;
  // local adjacency pass
  for (let x = 0; x < W; x++) {
    const t = segRow[x];
    if (t !== WT.GRASS && t !== WT.FOREST) continue;
    // neighbor water/river within 1 tile?
    let nearWater = false;
    for (let dx = -1; dx <= 1 && !nearWater; dx++) {
      const nx = x + dx;
      if (nx < 0 || nx >= W) continue;
      const n = segRow[nx];
      if (n === WT.WATER || n === WT.RIVER) nearWater = true;
    }
    if (nearWater) {
      // mix beach/swamp along shores
      if (t === WT.GRASS) segRow[x] = (x & 1) ? WT.BEACH : WT.SWAMP;
      else if (t === WT.FOREST) segRow[x] = WT.GRASS;
    }
  }
}

// Expand helpers and overlays: mutate ctx.world.map in-place, add POIs and roads/bridges
function ensureWorldArrays(ctx) {
  if (!ctx.world.roads) ctx.world.roads = [];
  if (!ctx.world.bridges) ctx.world.bridges = [];
  if (!ctx.world.towns) ctx.world.towns = [];
  if (!ctx.world.dungeons) ctx.world.dungeons = [];
}

// Road/bridge overlays (Bresenham-ish path)
function carveRoadOverlay(ctx, x0, y0, x1, y1) {
  const Wmod = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
  const WT = Wmod && Wmod.TILES ? Wmod.TILES : null;
  if (!WT) return false;
  ensureWorldArrays(ctx);
  const map = ctx.world.map;
  const width = map[0] ? map[0].length : 0;
  const height = map.length;

  const roadSet = new Set((ctx.world.roads || []).map(p => `${p.x},${p.y}`));
  const bridgeSet = new Set((ctx.world.bridges || []).map(p => `${p.x},${p.y}`));

  const addRoadPoint = (x, y) => {
    const key = `${x},${y}`;
    if (!roadSet.has(key)) { roadSet.add(key); ctx.world.roads.push({ x, y }); }
  };
  const addBridgePoint = (x, y) => {
    const key = `${x},${y}`;
    if (!bridgeSet.has(key)) { bridgeSet.add(key); ctx.world.bridges.push({ x, y }); }
  };

  let x = x0, y = y0;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    if (x >= 0 && y >= 0 && x < width && y < height) {
      const t = map[y][x];
      if (t === WT.WATER || t === WT.RIVER) {
        map[y][x] = WT.BEACH;
        addBridgePoint(x, y);
      } else if (t === WT.MOUNTAIN) {
        map[y][x] = WT.GRASS;
      }
      addRoadPoint(x, y);
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return true;
}

function nearestDungeonFor(ctx, p) {
  let best = null, bd = Infinity;
  const ds = Array.isArray(ctx.world.dungeons) ? ctx.world.dungeons : [];
  for (const d of ds) {
    const dist = Math.abs(d.x - p.x) + Math.abs(d.y - p.y);
    if (dist < bd) { bd = dist; best = d; }
  }
  return best;
}

function nearestTownFor(ctx, p) {
  let best = null, bd = Infinity;
  const ts = Array.isArray(ctx.world.towns) ? ctx.world.towns : [];
  for (const t of ts) {
    if (!t) continue;
    const dist = Math.abs(t.x - p.x) + Math.abs(t.y - p.y);
    if (dist < bd) { bd = dist; best = t; }
  }
  return best;
}

function pickTownSize(seedNoise) {
  const r = seedNoise;
  if (r < 0.60) return "small";
  if (r < 0.90) return "big";
  return "city";
}

function placeTownsInArea(ctx, x0, y0, x1, y1) {
  const Wmod = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
  const WT = Wmod && Wmod.TILES ? Wmod.TILES : null;
  if (!WT) return 0;
  ensureWorldArrays(ctx);
  const map = ctx.world.map;
  const seed = currentSeed();
  let placed = 0;

  for (let y = y0; y <= y1; y++) {
    const row = map[y];
    for (let x = x0; x <= x1; x++) {
      const t = row[x];
      if (!(t === WT.GRASS || t === WT.BEACH || t === WT.DESERT || t === WT.SNOW)) continue;
      const noise = h2(x + (ctx.world.originX|0), y + (ctx.world.originY|0), seed ^ 0xa11ce);
      // Prefer near water within immediate neighborhood
      let nearWater = false;
      for (let dy = -2; dy <= 2 && !nearWater; dy++) {
        for (let dx = -2; dx <= 2 && !nearWater; dx++) {
          const nx = x + dx, ny = y + dy;
          if (ny < 0 || ny >= map.length || nx < 0 || nx >= row.length) continue;
          const nt = map[ny][nx];
          if (nt === WT.WATER || nt === WT.RIVER || nt === WT.BEACH) nearWater = true;
        }
      }
      const pTown = nearWater ? 0.010 : 0.003; // bias near water
      if (noise < pTown) {
        // avoid clustering with existing towns
        const tooClose = (ctx.world.towns || []).some(town => Math.abs(town.x - x) + Math.abs(town.y - y) < 6);
        if (tooClose) continue;
        const size = pickTownSize(h2(x*3+7, y*3+11, seed ^ 0xb00));
        ctx.world.towns.push({ x, y, size });
        // connect roads: to nearest existing town and nearest dungeon
        const t2 = nearestTownFor(ctx, { x, y });
        if (t2) carveRoadOverlay(ctx, x, y, t2.x, t2.y);
        const d = nearestDungeonFor(ctx, { x, y });
        if (d) carveRoadOverlay(ctx, x, y, d.x, d.y);
        placed++;
      }
    }
  }
  return placed;
}

function placeDungeonsInArea(ctx, x0, y0, x1, y1) {
  const Wmod = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
  const WT = Wmod && Wmod.TILES ? Wmod.TILES : null;
  if (!WT) return 0;
  ensureWorldArrays(ctx);
  const map = ctx.world.map;
  const seed = currentSeed();
  let placed = 0;

  function pickSizeFor(tile, noise) {
    // Base weights; adjust per terrain
    let wS = 0.45, wM = 0.40, wL = 0.15;
    if (tile === WT.MOUNTAIN) { wL += 0.15; wM += 0.05; wS -= 0.20; }
    else if (tile === WT.FOREST) { wM += 0.10; wL += 0.05; wS -= 0.15; }
    else if (tile === WT.GRASS) { wS += 0.10; wM += 0.05; wL -= 0.15; }
    else if (tile === WT.SWAMP) { wM += 0.10; wS += 0.05; wL -= 0.15; }
    else if (tile === WT.DESERT) { wM += 0.10; wL += 0.05; wS -= 0.15; }
    else if (tile === WT.SNOW) { wM += 0.10; wS += 0.05; wL -= 0.15; }
    const sum = Math.max(0.001, wS + wM + wL);
    const ps = [wS/sum, wM/sum, wL/sum];
    if (noise < ps[0]) return "small";
    if (noise < ps[0] + ps[1]) return "medium";
    return "large";
  }

  for (let y = y0; y <= y1; y++) {
    const row = map[y];
    for (let x = x0; x <= x1; x++) {
      const t = row[x];
      // prefer forest/mountain; allow some grass/desert/snow
      let ok = (t === WT.FOREST || t === WT.MOUNTAIN);
      if (!ok && t === WT.GRASS) ok = h2(x + 13, y + 17, seed ^ 0xddd) < 0.16;
      if (!ok && (t === WT.DESERT || t === WT.SNOW)) ok = h2(x + 19, y + 23, seed ^ 0xeee) < 0.06;
      if (!ok) continue;

      const noise = h2(x + (ctx.world.originX|0), y + (ctx.world.originY|0), seed ^ 0x5ca1ab1e);
      const pDungeon = 0.0045;
      if (noise < pDungeon) {
        const tooClose = (ctx.world.dungeons || []).some(d => Math.abs(d.x - x) + Math.abs(d.y - y) < 5);
        if (tooClose) continue;
        const level = 1 + ((h2(x*5+3, y*7+9, seed ^ 0xabc) * 5) | 0);
        const size = pickSizeFor(t, h2(x*11+1, y*13+2, seed ^ 0xdef));
        ctx.world.dungeons.push({ x, y, level, size });
        // connect to nearest town
        const t2 = nearestTownFor(ctx, { x, y });
        if (t2) carveRoadOverlay(ctx, x, y, t2.x, t2.y);
        placed++;
      }
    }
  }
  return placed;
}

function expandLeft(ctx, cw) {
  const Wmod = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
  const WT = Wmod && Wmod.TILES ? Wmod.TILES : null;
  if (!WT) return false;
  const world = ctx.world;
  const seed = currentSeed();
  const H = world.map.length;
  const oldW = world.map[0] ? world.map[0].length : 0;
  const originY = (typeof world.originY === "number") ? world.originY : 0;
  const originX = (typeof world.originX === "number") ? world.originX : 0;

  for (let y = 0; y < H; y++) {
    const seg = new Array(cw);
    for (let i = 0; i < cw; i++) {
      const gx = originX - cw + i;
      const gy = originY + y;
      seg[i] = genTileAt(WT, gx, gy, seed, originY, world.height || H);
    }
    shoreAdjust(seg, WT);
    world.map[y] = seg.concat(world.map[y]);
  }
  world.width = oldW + cw;
  world.originX = originX - cw;

  // Shift POIs right by cw so local coords stay aligned
  try {
    if (Array.isArray(world.towns)) world.towns.forEach(t => { t.x += cw; });
    if (Array.isArray(world.dungeons)) world.dungeons.forEach(d => { d.x += cw; });
    if (Array.isArray(world.roads)) world.roads.forEach(p => { p.x += cw; });
    if (Array.isArray(world.bridges)) world.bridges.forEach(p => { p.x += cw; });
  } catch (_) {}

  // Player and gate/return anchors shift right
  ctx.player.x += cw;
  if (ctx.worldReturnPos) { ctx.worldReturnPos.x += cw; }

  // Populate POIs and roads in the new area
  ensureWorldArrays(ctx);
  placeTownsInArea(ctx, 0, 0, cw - 1, H - 1);
  placeDungeonsInArea(ctx, 0, 0, cw - 1, H - 1);

  return true;
}

function expandRight(ctx, cw) {
  const Wmod = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
  const WT = Wmod && Wmod.TILES ? Wmod.TILES : null;
  if (!WT) return false;
  const world = ctx.world;
  const seed = currentSeed();
  const H = world.map.length;
  const oldW = world.map[0] ? world.map[0].length : 0;
  const originY = (typeof world.originY === "number") ? world.originY : 0;
  const originX = (typeof world.originX === "number") ? world.originX : 0;

  for (let y = 0; y < H; y++) {
    const seg = new Array(cw);
    for (let i = 0; i < cw; i++) {
      const gx = originX + oldW + i;
      const gy = originY + y;
      seg[i] = genTileAt(WT, gx, gy, seed, originY, world.height || H);
    }
    shoreAdjust(seg, WT);
    world.map[y] = world.map[y].concat(seg);
  }
  world.width = oldW + cw;

  // Populate POIs and roads in the new area (right band)
  ensureWorldArrays(ctx);
  placeTownsInArea(ctx, oldW, 0, oldW + cw - 1, H - 1);
  placeDungeonsInArea(ctx, oldW, 0, oldW + cw - 1, H - 1);

  return true;
}

function expandTop(ctx, ch) {
  const Wmod = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
  const WT = Wmod && Wmod.TILES ? Wmod.TILES : null;
  if (!WT) return false;
  const world = ctx.world;
  const seed = currentSeed();
  const oldW = world.map[0] ? world.map[0].length : 0;
  const originY = (typeof world.originY === "number") ? world.originY : 0;
  const originX = (typeof world.originX === "number") ? world.originX : 0;

  const newRows = [];
  for (let i = 0; i < ch; i++) {
    const gy = originY - ch + i;
    const row = new Array(oldW);
    for (let x = 0; x < oldW; x++) {
      const gx = originX + x;
      row[x] = genTileAt(WT, gx, gy, seed, originY, world.height || (world.map.length));
    }
    shoreAdjust(row, WT);
    newRows.push(row);
  }
  // Keep the same top-level array identity to avoid stale references in orchestrator
  for (let i = newRows.length - 1; i >= 0; i--) {
    world.map.unshift(newRows[i]);
  }
  world.height = (world.height || world.map.length) + ch;
  world.originY = originY - ch;

  // Shift POIs down by ch so local coords stay aligned
  try {
    if (Array.isArray(world.towns)) world.towns.forEach(t => { t.y += ch; });
    if (Array.isArray(world.dungeons)) world.dungeons.forEach(d => { d.y += ch; });
    if (Array.isArray(world.roads)) world.roads.forEach(p => { p.y += ch; });
    if (Array.isArray(world.bridges)) world.bridges.forEach(p => { p.y += ch; });
  } catch (_) {}

  // Player and anchors shift down
  ctx.player.y += ch;
  if (ctx.worldReturnPos) { ctx.worldReturnPos.y += ch; }

  // Populate POIs and roads in the new area (top band)
  ensureWorldArrays(ctx);
  placeTownsInArea(ctx, 0, 0, oldW - 1, ch - 1);
  placeDungeonsInArea(ctx, 0, 0, oldW - 1, ch - 1);

  return true;
}

function expandBottom(ctx, ch) {
  const Wmod = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
  const WT = Wmod && Wmod.TILES ? Wmod.TILES : null;
  if (!WT) return false;
  const world = ctx.world;
  const seed = currentSeed();
  const oldW = world.map[0] ? world.map[0].length : 0;
  const originY = (typeof world.originY === "number") ? world.originY : 0;
  const originX = (typeof world.originX === "number") ? world.originX : 0;
  const oldH = world.map.length;

  for (let i = 0; i < ch; i++) {
    const gy = originY + oldH + i;
    const row = new Array(oldW);
    for (let x = 0; x < oldW; x++) {
      const gx = originX + x;
      row[x] = genTileAt(WT, gx, gy, seed, originY, world.height || oldH);
    }
    shoreAdjust(row, WT);
    world.map.push(row);
  }
  world.height = (world.height || oldH) + ch;

  // Populate POIs and roads in the new area (bottom band)
  ensureWorldArrays(ctx);
  placeTownsInArea(ctx, 0, oldH, oldW - 1, oldH + ch - 1);
  placeDungeonsInArea(ctx, 0, oldH, oldW - 1, oldH + ch - 1);

  return true;
}

// Preemptive expansion so player never sees edges; triggers early so borders never enter the viewport
function ensureExpandedAroundPlayer(ctx) {
  if (!ctx || !ctx.world || !Array.isArray(ctx.world.map)) return false;
  const map = ctx.world.map;
  const rows = map.length;
  const cols = rows ? (map[0] ? map[0].length : 0) : 0;
  const px = ctx.player.x | 0;
  const py = ctx.player.y | 0;
  if (!rows || !cols) return false;

  // Chunk size scales with current world to keep redraw time reasonable
  const cw = Math.max(32, Math.min(80, Math.floor(cols * 0.40)));
  const ch = Math.max(24, Math.min(60, Math.floor(rows * 0.40)));

  let changed = false;

  // Player-based triggers (fallback)
  const marginTiles = 5;
  if (px <= marginTiles) { changed = expandLeft(ctx, cw) || changed; }
  if (px >= cols - 1 - marginTiles) { changed = expandRight(ctx, cw) || changed; }
  if (py <= marginTiles) { changed = expandTop(ctx, ch) || changed; }
  if (py >= rows - 1 - marginTiles) { changed = expandBottom(ctx, ch) || changed; }

  // Camera-based triggers (expand before viewport touches borders)
  try {
    const TILE = ctx.TILE || 32;
    const COLS = ctx.COLS || 30;
    const ROWS = ctx.ROWS || 20;
    const cam = (ctx.getCamera ? ctx.getCamera() : ctx.camera) || null;
    if (cam) {
      const startX = Math.floor((cam.x || 0) / TILE);
      const startY = Math.floor((cam.y || 0) / TILE);
      const endX = startX + (COLS - 1);
      const endY = startY + (ROWS - 1);
      const padX = Math.max(3, Math.floor(COLS * 0.45)); // expand when within ~45% of viewport from edge
      const padY = Math.max(2, Math.floor(ROWS * 0.45));
      if (startX <= padX) { changed = expandLeft(ctx, cw) || changed; }
      if (endX >= cols - 1 - padX) { changed = expandRight(ctx, cw) || changed; }
      if (startY <= padY) { changed = expandTop(ctx, ch) || changed; }
      if (endY >= rows - 1 - padY) { changed = expandBottom(ctx, ch) || changed; }
    }
  } catch (_) {}

  if (changed) {
    // Sync map reference and visibility arrays to new shape; world mode prefers full reveal
    ctx.map = ctx.world.map;
    try { typeof ctx.recomputeFOV === "function" && ctx.recomputeFOV(); } catch (_) {}
    try { typeof ctx.updateCamera === "function" && ctx.updateCamera(); } catch (_) {}
    try { typeof ctx.requestDraw === "function" && ctx.requestDraw(); } catch (_) {}
  }
  return changed;
}

export function tryMovePlayerWorld(ctx, dx, dy) {
  if (!ctx || ctx.mode !== "world" || !ctx.world || !ctx.world.map) return false;

  // Update camera first so expansion can react to current viewport
  try { typeof ctx.updateCamera === "function" && ctx.updateCamera(); } catch (_) {}

  // Preemptively expand when near edges to avoid borders entering viewport
  ensureExpandedAroundPlayer(ctx);

  const nx = ctx.player.x + (dx | 0);
  const ny = ctx.player.y + (dy | 0);
  const wmap = ctx.world.map;
  const rows = wmap.length, cols = rows ? (wmap[0] ? wmap[0].length : 0) : 0;

  // If stepping out-of-bounds, attempt expansion on-demand and recompute bounds
  if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
    const changed = ensureExpandedAroundPlayer(ctx);
    const rows2 = ctx.world.map.length;
    const cols2 = rows2 ? (ctx.world.map[0] ? ctx.world.map[0].length : 0) : 0;
    if (nx < 0 || ny < 0 || nx >= cols2 || ny >= rows2) return false;
  }

  const W = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
  const walkable = (W && typeof W.isWalkable === "function") ? !!W.isWalkable(ctx.world.map[ny][nx]) : true;
  if (!walkable) return false;

  ctx.player.x = nx; ctx.player.y = ny;
  try { typeof ctx.updateCamera === "function" && ctx.updateCamera(); } catch (_) {}
  // Roll for encounter first so acceptance can switch mode before advancing world time
  try {
    const ES = ctx.EncounterService || (typeof window !== "undefined" ? window.EncounterService : null);
    if (ES && typeof ES.maybeTryEncounter === "function") {
      ES.maybeTryEncounter(ctx);
    }
  } catch (_) {}
  // Advance a turn after the roll (if an encounter opened, next turn will tick region)
  try { typeof ctx.turn === "function" && ctx.turn(); } catch (_) {}
  return true;
}

  export function generate(ctx, opts = {}) {
  const W = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
  if (!(W && typeof W.generate === "function")) {
    ctx.log && ctx.log("World module missing; generating dungeon instead.", "warn");
    ctx.mode = "dungeon";
    try { if (typeof ctx.generateLevel === "function") ctx.generateLevel(ctx.floor || 1); } catch (_) {}
    return false;
  }

  // Start with a small initial world roughly the size of the viewport + margin.
  const startW = Math.max(48, (ctx.COLS || 30) + 20);
  const startH = Math.max(48, (ctx.ROWS || 20) + 20);
  const width = startW;
  const height = startH;

  try {
    ctx.world = W.generate(ctx, { width, height });
  } catch (e) {
    ctx.log && ctx.log("World generation failed; falling back to dungeon.", "warn");
    ctx.mode = "dungeon";
    try { if (typeof ctx.generateLevel === "function") ctx.generateLevel(ctx.floor || 1); } catch (_) {}
    return false;
  }

  const start = (typeof W.pickTownStart === "function")
    ? W.pickTownStart(ctx.world, (ctx.rng || Math.random))
    : { x: 1, y: 1 };

  ctx.player.x = start.x;
  ctx.player.y = start.y;
  ctx.mode = "world";

  // Initialize expansion metadata
  try {
    if (typeof ctx.world.width !== "number") {
      ctx.world.width = (ctx.world.map[0] ? ctx.world.map[0].length : width);
    }
    if (typeof ctx.world.height !== "number") {
      ctx.world.height = (ctx.world.map ? ctx.world.map.length : height);
    }
    ctx.world.originX = 0;
    ctx.world.originY = 0;
  } catch (_) {}

  // Clear non-world entities
  ctx.enemies = [];
  ctx.corpses = [];
  ctx.decals = [];
  ctx.npcs = [];   // no NPCs on overworld
  ctx.shops = [];  // no shops on overworld

  // Apply world map and reveal it fully
  ctx.map = ctx.world.map;
  const rows = ctx.map.length;
  const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
  ctx.seen = Array.from({ length: rows }, () => Array(cols).fill(true));
  ctx.visible = Array.from({ length: rows }, () => Array(cols).fill(true));

  // Camera/FOV/UI
  try { typeof ctx.updateCamera === "function" && ctx.updateCamera(); } catch (_) {}
  try { typeof ctx.recomputeFOV === "function" && ctx.recomputeFOV(); } catch (_) {}
  try { typeof ctx.updateUI === "function" && ctx.updateUI(); } catch (_) {}

  // Pre-expand so the viewport starts comfortably away from edges.
  try {
    typeof ctx.updateCamera === "function" && ctx.updateCamera();
    for (let i = 0; i < 6; i++) {
      const changed = !!ensureExpandedAroundPlayer(ctx);
      if (!changed) break;
      typeof ctx.updateCamera === "function" && ctx.updateCamera();
    }
  } catch (_) {}

  // Arrival log
  ctx.log && ctx.log("You arrive in the overworld. Towns: small (t), big (T), cities (C). Dungeons (D). Press G on a town/dungeon tile to enter/exit.", "notice");

  // Hide town exit button via TownRuntime
  try {
    const TR = (ctx && ctx.TownRuntime) || (typeof window !== "undefined" ? window.TownRuntime : null);
    if (TR && typeof TR.hideExitButton === "function") TR.hideExitButton(ctx);
  } catch (_) {}

  // Draw is handled by the orchestrator (core/game.js) after sync; avoid redundant frames here.
  return true;
}

export function tick(ctx) {
  // Keep expanding around the player as they explore; world mode reveals everything.
  try {
    if (ctx && ctx.mode === "world") ensureExpandedAroundPlayer(ctx);
  } catch (_) {}
  return true;
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.WorldRuntime = { generate, tryMovePlayerWorld, tick };
}

  