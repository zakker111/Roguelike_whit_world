/**
 * RegionMapRuntime: overlay mode showing a large-scale map for navigation context.
 *
 * Exports (ESM + window.RegionMapRuntime):
 * - open(ctx): switch to region mode, using the current world map as the base
 * - tryMove(ctx, dx, dy): move the region cursor (player marker) without advancing time
 * - onAction(ctx): press G on the orange edge tile to return to the overworld
 * - tick(ctx): optional per-turn hook (no-op)
 */
export function open(ctx) {
  if (!ctx || ctx.mode !== "world" || !ctx.world || !ctx.world.map) return false;

  const w = ctx.world.width || (ctx.world.map[0] ? ctx.world.map[0].length : 0);
  const h = ctx.world.height || ctx.world.map.length;
  const px = ctx.player.x | 0;
  const py = ctx.player.y | 0;

  // Use the world map directly for the region view; rendering is driven by tiles.json ("region").
  const regionMap = ctx.world.map;

  // Exit tiles: center tiles on each edge
  const exitTiles = [
    { x: Math.floor(w / 2), y: 0 },          // top
    { x: Math.floor(w / 2), y: h - 1 },      // bottom
    { x: 0, y: Math.floor(h / 2) },          // left
    { x: w - 1, y: Math.floor(h / 2) },      // right
  ];

  ctx.region = {
    width: w,
    height: h,
    map: regionMap,
    cursor: { x: px, y: py },
    exitTiles,
    enterWorldPos: { x: px, y: py },
  };

  // Switch to region mode and adopt the region map
  ctx.mode = "region";
  ctx.map = regionMap;

  // Reveal the entire region view (overlay); LOS/FOV are not used for gating here
  const rows = regionMap.length;
  const cols = rows ? (regionMap[0] ? regionMap[0].length : 0) : 0;
  ctx.seen = Array.from({ length: rows }, () => Array(cols).fill(true));
  ctx.visible = Array.from({ length: rows }, () => Array(cols).fill(true));

  try { typeof ctx.updateCamera === "function" && ctx.updateCamera(); } catch (_) {}
  return true;
}

export function tryMove(ctx, dx, dy) {
  if (!ctx || ctx.mode !== "region" || !ctx.region || !ctx.map) return false;
  const nx = (ctx.player.x | 0) + (dx | 0);
  const ny = (ctx.player.y | 0) + (dy | 0);
  const rows = ctx.map.length;
  const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
  if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return false;

  // Free movement across the overlay (no walkability restrictions)
  ctx.player.x = nx;
  ctx.player.y = ny;
  if (ctx.region && ctx.region.cursor) {
    ctx.region.cursor.x = nx;
    ctx.region.cursor.y = ny;
  }

  try { typeof ctx.updateCamera === "function" && ctx.updateCamera(); } catch (_) {}
  try { typeof ctx.requestDraw === "function" && ctx.requestDraw(); } catch (_) {}
  return true;
}

export function onAction(ctx) {
  if (!ctx || ctx.mode !== "region" || !ctx.region) return false;
  const x = ctx.player.x | 0;
  const y = ctx.player.y | 0;
  const exits = Array.isArray(ctx.region.exitTiles) ? ctx.region.exitTiles : [];

  const atExit = exits.some(e => (e.x | 0) === x && (e.y | 0) === y);
  if (!atExit) {
    try { typeof ctx.log === "function" && ctx.log("Move to the orange edge and press G to return.", "info"); } catch (_) {}
    return false;
  }
  return close(ctx);
}

export function close(ctx) {
  if (!ctx || ctx.mode !== "region") return false;
  // Restore overworld state
  const returnPos = (ctx.region && ctx.region.enterWorldPos) ? ctx.region.enterWorldPos : { x: ctx.player.x, y: ctx.player.y };
  ctx.mode = "world";
  ctx.map = (ctx.world && ctx.world.map) ? ctx.world.map : ctx.map;
  ctx.player.x = returnPos.x | 0;
  ctx.player.y = returnPos.y | 0;

  // Reveal overworld fully
  const rows = ctx.map.length;
  const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
  ctx.seen = Array.from({ length: rows }, () => Array(cols).fill(true));
  ctx.visible = Array.from({ length: rows }, () => Array(cols).fill(true));

  try { typeof ctx.updateCamera === "function" && ctx.updateCamera(); } catch (_) {}
  try { typeof ctx.requestDraw === "function" && ctx.requestDraw(); } catch (_) {}
  return true;
}

export function tick(ctx) {
  // No stateful behavior needed in region mode yet
  return true;
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.RegionMapRuntime = { open, tryMove, onAction, close, tick };
}