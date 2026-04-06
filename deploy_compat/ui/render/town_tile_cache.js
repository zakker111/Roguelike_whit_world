/**
 * Town tile cache helpers and tilesRef().
 */
import { getTileDef } from "../../data/tile_lookup.js";

// Helper: current tiles.json reference (for cache invalidation)
export function tilesRef() {
  try {
    return (typeof window !== "undefined" && window.GameData && window.GameData.tiles) ? window.GameData.tiles : null;
  } catch (_) { return null; }
}

// Robust fallback fill for town tiles when tiles.json is missing/incomplete
export function fallbackFillTown(TILES, type, COLORS) {
  try {
    if (type === TILES.WALL) return (COLORS && COLORS.wall) || "#1b1f2a";
    if (type === TILES.FLOOR) return (COLORS && COLORS.floorLit) || (COLORS && COLORS.floor) || "#0f1628";
    if (type === TILES.ROAD) return "#b0a58a";
    if (type === TILES.DOOR) return "#3a2f1b";
    if (type === TILES.WINDOW) return "#26728c";
    if (type === TILES.STAIRS) return "#3a2f1b";
  } catch (_) {}
  return "#0b0c10";
}

// Tile cache to avoid repeated JSON lookups inside hot loops
const TILE_CACHE = { ref: null, fill: Object.create(null), glyph: Object.create(null), fg: Object.create(null) };
function cacheResetIfNeeded() {
  const ref = tilesRef();
  if (TILE_CACHE.ref !== ref) {
    TILE_CACHE.ref = ref;
    TILE_CACHE.fill = Object.create(null);
    TILE_CACHE.glyph = Object.create(null);
    TILE_CACHE.fg = Object.create(null);
  }
}

export function fillTownFor(TILES, type, COLORS) {
  cacheResetIfNeeded();
  const k = type | 0;
  let v = TILE_CACHE.fill[k];
  if (v) return v;
  const td = getTileDef("town", type) || getTileDef("dungeon", type) || null;
  v = (td && td.colors && td.colors.fill) ? td.colors.fill : fallbackFillTown(TILES, type, COLORS);
  TILE_CACHE.fill[k] = v;
  return v;
}

export function glyphTownFor(type) {
  cacheResetIfNeeded();
  const k = type | 0;
  let g = TILE_CACHE.glyph[k];
  let c = TILE_CACHE.fg[k];
  if (typeof g !== "undefined" && typeof c !== "undefined") return { glyph: g, fg: c };
  const td = getTileDef("town", type) || getTileDef("dungeon", type) || null;
  if (td) {
    g = Object.prototype.hasOwnProperty.call(td, "glyph") ? td.glyph : "";
    c = td.colors && td.colors.fg ? td.colors.fg : null;
  } else {
    g = "";
    c = null;
  }
  TILE_CACHE.glyph[k] = g;
  TILE_CACHE.fg[k] = c;
  return { glyph: g, fg: c };
}