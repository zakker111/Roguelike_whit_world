/**
 * RegionMapRuntime
 * Lightweight, fixed-size overlay map shown from overworld when pressing G on a walkable tile.
 *
 * Exports (ESM + window.RegionMapRuntime):
 * - open(ctx, size?): builds a downscaled view of the world and enters "region" mode.
 * - close(ctx): returns to overworld at the same coordinates where G was pressed.
 * - tryMove(ctx, dx, dy): moves the region cursor within bounds (no time advance).
 * - onAction(ctx): pressing G inside region map; closes only when on an orange edge tile.
 * - tick(ctx): optional no-op hook.
 */
import * as World from "../world/world.js";

const DEFAULT_WIDTH = 28;
const DEFAULT_HEIGHT = 18;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function colorForTile(t) {
  const WT = World.TILES;
  const WCOL = {
    water: "#0a1b2a",
    river: "#0e2f4a",
    grass: "#10331a",
    forest: "#0d2615",
    swamp: "#1b2a1e",
    beach: "#b59b6a",
    desert: "#c2a36b",
    snow: "#b9c7d3",
    mountain: "#2f2f34",
    town: "#3a2f1b",
    dungeon: "#2a1b2a",
    unknown: "#0b0c10",
  };
  if (!WT) return WCOL.unknown;
  if (t === WT.WATER) return WCOL.water;
  if (t === WT.RIVER) return WCOL.river;
  if (t === WT.SWAMP) return WCOL.swamp;
  if (t === WT.BEACH) return WCOL.beach;
  if (t === WT.DESERT) return WCOL.desert;
  if (t === WT.SNOW) return WCOL.snow;
  if (t === WT.FOREST) return WCOL.forest;
  if (t === WT.MOUNTAIN) return WCOL.mountain;
  if (t === WT.DUNGEON) return WCOL.dungeon;
  if (t === WT.TOWN) return WCOL.town;
  return WCOL.grass;
}

function buildDownscaled(world, w, h) {
  const out = Array.from({ length: h }, () => Array(w).fill(0));
  const Ww = world.width || (world.map[0] ? world.map[0].length : 0);
  const Wh = world.height || world.map.length;
  if (!Ww || !Wh) return out;
  for (let ry = 0; ry < h; ry++) {
    for (let rx = 0; rx < w; rx++) {
      const nx = Math.round(rx * (Ww - 1) / Math.max(1, (w - 1)));
      const ny = Math.round(ry * (Wh - 1) / Math.max(1, (h - 1)));
      out[ry][rx] = world.map[ny][nx];
    }
  }
  return out;
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

  const sample = buildDownscaled(ctx.world, width, height);

  const exitNorth = { x: (width / 2) | 0, y: 0 };
  const exitSouth = { x: (width / 2) | 0, y: height - 1 };
  const exitWest = { x: 0, y: (height / 2) | 0 };
  const exitEast = { x: width - 1, y: (height / 2) | 0 };

  ctx.region = {
    width,
    height,
    map: sample,
    cursor: { x: (width / 2) | 0, y: (height / 2) | 0 },
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
    // No movement; still consume a draw for feedback
    try { ctx.requestDraw && ctx.requestDraw(); } catch (_) {}
    return false;
  }

  ctx.region.cursor = { x: nx, y: ny };
  // Keep player in sync with region cursor for camera centering
  ctx.player.x = nx; ctx.player.y = ny;

  try { typeof ctx.updateCamera === "function" && ctx.updateCamera(); } catch (_) {}
  // Act like other modes: advance a turn on movement
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