/**
 * LOS: Lightweight line-of-sight helpers.
 *
 * Exports (ESM + window.LOS):
 * - tileTransparent(ctx, x, y)
 * - hasLOS(ctx, x0, y0, x1, y1)
 *
 * Notes:
 * - Expects a ctx with { inBounds(x,y), map, TILES }.
 * - hasLOS uses a Bresenham-style step; checks transparency along the segment,
 *   excluding the start and exact target tile.
 */
import { getTileDef } from "../data/tile_lookup.js";
import { attachGlobal } from "../utils/global.js";



export function tileTransparent(ctx, x, y) {
  if (!ctx || typeof ctx.inBounds !== "function") return false;
  if (!ctx.inBounds(x, y)) return false;
  // Prefer tiles.json blocksFOV property based on mode if available
  try {
    let mode = String(ctx.mode || "").toLowerCase() || "dungeon";
    // Treat encounters as dungeon for tile property lookups
    if (mode === "encounter") mode = "dungeon";
    const t = ctx.map[y][x];
    const td = getTileDef(mode, t);
    if (td && td.properties) {
      if (typeof td.properties.blocksFOV === "boolean") {
        return !td.properties.blocksFOV;
      }
      // Secondary fallback: if a tile is explicitly non-walkable and blocksFOV is not defined,
      // treat it as opaque in non-overworld modes (covers unknown solids in dungeon/town).
      const modeSolid = (mode === "dungeon" || mode === "town");
      if (modeSolid && typeof td.properties.walkable === "boolean" && td.properties.walkable === false) {
        return false;
      }
    }
  } catch (_) {}
  // Fallback:
  // - In overworld/region modes, nothing blocks LOS (we don't use tile occlusion there)
  // - Else, only walls block LOS
  try {
    const mode = String(ctx.mode || "").toLowerCase();
    if (mode === "world" || mode === "region") return true;
  } catch (_) {}
  return ctx.map[y][x] !== ctx.TILES.WALL;
}

export function hasLOS(ctx, x0, y0, x1, y1) {
  // Bresenham; check transparency along the line excluding the end tile.
  let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, e2;
  while (!(x0 === x1 && y0 === y1)) {
    e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
    if (x0 === x1 && y0 === y1) break;
    if (!tileTransparent(ctx, x0, y0)) return false;
  }
  return true;
}

// Back-compat: attach to window via helper
attachGlobal("LOS", { tileTransparent, hasLOS });