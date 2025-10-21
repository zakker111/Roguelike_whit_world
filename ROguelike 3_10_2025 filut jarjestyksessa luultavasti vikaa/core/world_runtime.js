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

// Expand helpers: mutate ctx.world.map in-place and adjust metadata/POIs
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
  world.map = newRows.concat(world.map);
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
  return true;
}

// Preemptive expansion so player never sees void beyond edges
function ensureExpandedAroundPlayer(ctx) {
  if (!ctx || !ctx.world || !Array.isArray(ctx.world.map)) return false;
  const map = ctx.world.map;
  const rows = map.length;
  const cols = rows ? (map[0] ? map[0].length : 0) : 0;
  const px = ctx.player.x | 0;
  const py = ctx.player.y | 0;
  if (!rows || !cols) return false;

  const margin = 5; // tiles from edge to trigger expansion
  // Chunk size scales with current world to keep redraw time reasonable
  const cw = Math.max(32, Math.min(80, Math.floor(cols * 0.40)));
  const ch = Math.max(24, Math.min(60, Math.floor(rows * 0.40)));

  let changed = false;
  if (px <= margin) { changed = expandLeft(ctx, cw) || changed; }
  if (px >= cols - 1 - margin) { changed = expandRight(ctx, cw) || changed; }
  if (py <= margin) { changed = expandTop(ctx, ch) || changed; }
  if (py >= rows - 1 - margin) { changed = expandBottom(ctx, ch) || changed; }

  if (changed) {
    // Sync map reference and visibility arrays to new shape; world mode prefers full reveal
    ctx.map = ctx.world.map;
    try { typeof ctx.recomputeFOV === "function" && ctx.recomputeFOV(); } catch (_) {}
    try { typeof ctx.updateCamera === "function" && ctx.updateCamera(); } catch (_) {}
    try { typeof ctx.requestDraw === "function" && ctx.requestDraw(); } catch (_) {}
  }
  return changed;
}

export function generate(ctx, opts = {}) {
  const W = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
  if (!(W && typeof W.generate === "function")) {
    ctx.log && ctx.log("World module missing; generating dungeon instead.", "warn");
    ctx.mode = "dungeon";
    try { if (typeof ctx.generateLevel === "function") ctx.generateLevel(ctx.floor || 1); } catch (_) {}
    return false;
  }

  const width = (typeof opts.width === "number") ? opts.width : (ctx.MAP_COLS || 120);
  const height = (typeof opts.height === "number") ? opts.height : (ctx.MAP_ROWS || 80);

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

export function tryMovePlayerWorld(ctx, dx, dy) {
  if (!ctx || ctx.mode !== "world" || !ctx.world || !ctx.world.map) return false;

  // Preemptively expand when near edges to avoid void
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

/**
 * Optional per-turn hook for world mode.
 * Keeps the interface consistent with TownRuntime/DungeonRuntime tick hooks.
 * Currently a no-op placeholder for future world-side time/day effects.
 */
export function tick(ctx) {
  // Intentionally minimal; world mode reveals everything and has no occupancy/NPCs.
  // Modules can extend this later for overlays or time-driven effects.
  return true;
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.WorldRuntime = { generate, tryMovePlayerWorld, tick };
}