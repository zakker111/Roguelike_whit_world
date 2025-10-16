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
    [WT.TOWN]: 0, [WT.DUNGEON]: 0
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
function addMinorWaterAndBeaches(sample) {
  const WT = World.TILES;
  const h = sample.length, w = sample[0] ? sample[0].length : 0;
  if (!w || !h) return;

  const { counts, total } = countBiomes(sample);
  const waterTiles = (counts[WT.WATER] || 0) + (counts[WT.RIVER] || 0);
  const grassTiles = (counts[WT.GRASS] || 0);
  const forestTiles = (counts[WT.FOREST] || 0);

  // Inject a few ponds if no water and dominated by grass/forest
  if (waterTiles < Math.max(1, Math.floor(total * 0.01)) && (grassTiles + forestTiles) > Math.floor(total * 0.65)) {
    const ponds = Math.floor(Math.random() * 3); // 0..2 small ponds
    for (let p = 0; p < ponds; p++) {
      const cx = clamp((Math.random() * w) | 0, 2, w - 3);
      const cy = clamp((Math.random() * h) | 0, 2, h - 3);
      const rx = 2 + ((Math.random() * 2) | 0);
      const ry = 1 + ((Math.random() * 2) | 0);
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

export function open(ctx, size) {
  if (!ctx || ctx.mode !== "world" || !ctx.world || !ctx.world.map) return false;
  // Only allow from walkable, non-town, non-dungeon tiles
  const WT = World.TILES;
  const tile = ctx.world.map[ctx.player.y][ctx.player.x];
  if (tile === WT.TOWN || tile === WT.DUNGEON) return false;
  const isWalkable = (typeof World.isWalkable === "function") ? World.isWalkable(tile) : true;
  if (!isWalkable) return false;

  const width = clamp((size && size.width) || DEFAULT_WIDTH, 12, 80);
  const height = clamp((size && size.height) || DEFAULT_HEIGHT, 8, 60);

  // Build local sample reflecting biomes near the player, then enhance per rules (minor water, beaches)
  const sample = buildLocalDownscaled(ctx.world, ctx.player.x | 0, ctx.player.y | 0, width, height);
  addMinorWaterAndBeaches(sample);

  const exitNorth = { x: (width / 2) | 0, y: 0 };
  const exitSouth = { x: (width / 2) | 0, y: height - 1 };
  const exitWest = { x: 0, y: (height / 2) | 0 };
  const exitEast = { x: width - 1, y: (height / 2) | 0 };

  // Choose spawn exit closest to the player's overworld position relative to world edges
  const worldW = (ctx.world && (ctx.world.width || (ctx.world.map[0] ? ctx.world.map[0].length : 0))) || 0;
  const worldH = (ctx.world && (ctx.world.height || ctx.world.map.length)) || 0;
  const dNorth = ctx.player.y | 0;
  const dSouth = Math.max(0, (worldH - 1) - (ctx.player.y | 0));
  const dWest = ctx.player.x | 0;
  const dEast = Math.max(0, (worldW - 1) - (ctx.player.x | 0));
  let spawnExit = exitNorth;
  const minD = Math.min(dNorth, dSouth, dWest, dEast);
  if (minD === dSouth) spawnExit = exitSouth;
  else if (minD === dWest) spawnExit = exitWest;
  else if (minD === dEast) spawnExit = exitEast;

  ctx.region = {
    width,
    height,
    map: sample,
    cursor: { x: spawnExit.x | 0, y: spawnExit.y | 0 },
    exitTiles: [exitNorth, exitSouth, exitWest, exitEast],
    enterWorldPos: { x: ctx.player.x, y: ctx.player.y },
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

  // Override LOS transparency in region mode: mountains block FOV, water/river do not.
  try {
    const WT2 = World.TILES;
    const los = ctx.los || {};
    los.tileTransparent = (c, x, y) => {
      const rows = c.map.length;
      const cols = rows ? (c.map[0] ? c.map[0].length : 0) : 0;
      if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
      const t = c.map[y][x];
      if (WT2 && t === WT2.MOUNTAIN) return false;   // block FOV on mountains
      return true;                                    // all other biomes are transparent for FOV in region
    };
    ctx.los = los;
  } catch (_) {}

  ctx.mode = "region";
  try { typeof ctx.updateCamera === "function" && ctx.updateCamera(); } catch (_) {}
  try { typeof ctx.recomputeFOV === "function" && ctx.recomputeFOV(); } catch (_) {}
  try { ctx.updateUI && ctx.updateUI(); } catch (_) {}
  try { ctx.requestDraw && ctx.requestDraw(); } catch (_) {}
  if (ctx.log) ctx.log("Region map opened. Move with arrows. Press G on an orange edge tile to close.", "info");
  return true;
}

export function close(ctx) {
  if (!ctx || ctx.mode !== "region") return false;
  // Restore world view and player position at the exact coordinates where G was pressed
  const pos = ctx.region && ctx.region.enterWorldPos ? ctx.region.enterWorldPos : null;
  // Restore previous LOS transparency
  try {
    if (ctx.region && ctx.region._prevLOS) {
      ctx.los = ctx.region._prevLOS;
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

export function tryMove(ctx, dx, dy) {
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

export function onAction(ctx) {
  if (!ctx || ctx.mode !== "region" || !ctx.region) return false;
  const { cursor, exitTiles } = ctx.region;
  const onExit = exitTiles.some(e => e.x === cursor.x && e.y === cursor.y);
  if (onExit) {
    close(ctx);
    return true;
  }
  if (ctx.log) ctx.log("Move to an orange edge tile and press G to close the Region map.", "info");
  return true;
}

export function tick(ctx) { return true; }

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.RegionMapRuntime = { open, close, tryMove, onAction, tick };
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.RegionMapRuntime = { open, close, tryMove, onAction, tick };
}