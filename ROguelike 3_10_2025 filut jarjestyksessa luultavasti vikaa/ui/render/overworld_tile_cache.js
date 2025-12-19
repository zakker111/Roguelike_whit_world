/**
 * Overworld tile cache helpers and tilesRef().
 */
import { getTileDef } from "../../data/tile_lookup.js";

// Helper: current tiles.json reference (for cache invalidation)
export function tilesRef() {
  try {
    return (typeof window !== "undefined" && window.GameData && window.GameData.tiles) ? window.GameData.tiles : null;
  } catch (_) { return null; }
}

// Robust fallback fill color mapping when tiles.json is missing/incomplete
export function fallbackFillOverworld(WT, id) {
  try {
    if (id === WT.WATER) return "#0a1b2a";
    if (id === WT.RIVER) return "#0e2f4a";
    if (id === WT.BEACH) return "#b59b6a";
    if (id === WT.SWAMP) return "#1b2a1e";
    if (id === WT.FOREST) return "#0d2615";
    if (id === WT.GRASS) return "#10331a";
    if (id === WT.MOUNTAIN) return "#2f2f34";
    if (id === WT.DESERT) return "#c2a36b";
    if (id === WT.SNOW) return "#b9c7d3";
    if (id === WT.SNOW_FOREST) return "#8298aa";
    if (id === WT.TOWN) return "#3a2f1b";
    if (id === WT.DUNGEON) return "#2a1b2a";
    if (WT.TOWER != null && id === WT.TOWER) return "#312e81";
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

export function fillOverworldFor(WT, id) {
  cacheResetIfNeeded();
  const k = id | 0;
  let v = TILE_CACHE.fill[k];
  if (v) return v;
  const td = getTileDef("overworld", id);
  v = (td && td.colors && td.colors.fill) ? td.colors.fill : fallbackFillOverworld(WT, id);
  TILE_CACHE.fill[k] = v;
  return v;
}

export function glyphOverworldFor(id) {
  cacheResetIfNeeded();
  const k = id | 0;
  let g = TILE_CACHE.glyph[k];
  let c = TILE_CACHE.fg[k];
  if (typeof g !== "undefined" && typeof c !== "undefined") return { glyph: g, fg: c };
  const td = getTileDef("overworld", id);
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