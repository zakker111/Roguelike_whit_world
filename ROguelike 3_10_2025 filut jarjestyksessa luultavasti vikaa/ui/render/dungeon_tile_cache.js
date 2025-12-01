/**
 * Dungeon tile cache helpers: fill/glyph caching keyed by tiles.json ref and encounter biome.
 */
import { getTileDef } from "../../data/tile_lookup.js";

// Robust fallback fill for dungeon tiles when tiles.json is missing/incomplete
export function fallbackFillDungeon(TILES, type, COLORS) {
  try {
    if (type === TILES.WALL) return (COLORS && COLORS.wall) || "#1b1f2a";
    if (type === TILES.FLOOR) return (COLORS && COLORS.floorLit) || (COLORS && COLORS.floor) || "#0f1628";
    if (type === TILES.DOOR) return "#3a2f1b";
    if (type === TILES.STAIRS) return "#3a2f1b";
    if (type === TILES.WINDOW) return "#295b6e";
    if (type === TILES.ROAD) return "#b0a58a";
  } catch (_) {}
  return "#0b0c10";
}

// Tile cache to avoid repeated JSON lookups inside hot loops (depends on tiles.json ref and encounter biome)
const TILE_CACHE = { ref: null, biome: null, fill: Object.create(null), glyph: Object.create(null), fg: Object.create(null) };

export function cacheResetIfNeeded(encounterBiomeRef) {
  const ref = (typeof window !== "undefined" && window.GameData) ? window.GameData.tiles : null;
  const bKey = String(encounterBiomeRef || "");
  if (TILE_CACHE.ref !== ref || TILE_CACHE.biome !== bKey) {
    TILE_CACHE.ref = ref;
    TILE_CACHE.biome = bKey;
    TILE_CACHE.fill = Object.create(null);
    TILE_CACHE.glyph = Object.create(null);
    TILE_CACHE.fg = Object.create(null);
  }
}

export function fillDungeonFor(TILES, type, COLORS, themeFn) {
  cacheResetIfNeeded(typeof themeFn === "function" ? themeFn.__biomeKey : null);
  const k = type | 0;
  let v = TILE_CACHE.fill[k];
  if (v) return v;
  const td = getTileDef("dungeon", type);
  const theme = typeof themeFn === "function" ? themeFn(type) : null;
  v = theme || (td && td.colors && td.colors.fill) || fallbackFillDungeon(TILES, type, COLORS);
  TILE_CACHE.fill[k] = v;
  return v;
}

export function glyphDungeonFor(type) {
  cacheResetIfNeeded(null);
  const k = type | 0;
  let g = TILE_CACHE.glyph[k];
  let c = TILE_CACHE.fg[k];
  if (typeof g !== "undefined" && typeof c !== "undefined") return { glyph: g, fg: c };
  const td = getTileDef("dungeon", type);
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