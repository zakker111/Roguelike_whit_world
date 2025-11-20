/**
 * Dungeon base layer: offscreen tile cache build and base rendering.
 */
import * as RenderCore from "../render_core.js";
import { shade as _shade } from "../color_utils.js";
import { getTileDef, getTileDefByKey } from "../../data/tile_lookup.js";
import { fillDungeonFor } from "./dungeon_tile_cache.js";

// Internal offscreen cache
const DUN = { mapRef: null, canvas: null, wpx: 0, hpx: 0, TILE: 0, _tilesRef: null };

export function biomeBaseFill(ctx) {
  const b = String(ctx.encounterBiome || "").toUpperCase();
  if (!b) return null;
  const key = (b === "FOREST") ? "FOREST"
            : (b === "GRASS") ? "GRASS"
            : (b === "DESERT") ? "DESERT"
            : (b === "SNOW") ? "SNOW"
            : (b === "BEACH") ? "BEACH"
            : (b === "SWAMP") ? "SWAMP"
            : null;
  // Prefer palette.json encounterBiome table
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const pal = GD && GD.palette && GD.palette.encounterBiome ? GD.palette.encounterBiome : null;
    const hexFromPalette = pal && b ? pal[b] : null;
    if (hexFromPalette) return hexFromPalette;
  } catch (_) {}
  // Next, try tiles.json (overworld/region entries)
  try {
    const td = key ? (getTileDefByKey("overworld", key) || getTileDefByKey("region", key)) : null;
    const hex = (td && td.colors && td.colors.fill) ? td.colors.fill : null;
    if (hex) return hex;
  } catch (_) {}
  // Fallback palette for encounters when data is missing
  const fallback = {
    FOREST: "#163a22",
    GRASS:  "#1c522b",
    DESERT: "#cdaa70",
    BEACH:  "#dbc398",
    SNOW:   "#dfe5eb",
    SWAMP:  "#1e3c27"
  };
  return fallback[b] || "#1f2937"; // neutral dark slate fallback
}

export function encounterFillForFactory(ctx) {
  const TILES = ctx.TILES || (typeof window !== "undefined" && window.GameVisuals ? window.GameVisuals.TILES : null);
  const bFill = biomeBaseFill(ctx);
  function encounterFillFor(type) {
    if (!ctx.encounterBiome) return null;
    const base = bFill;
    if (!base) return null;
    // Match pre-refactor behavior: slight shade differences per tile type
    if (type === TILES.WALL) return _shade(base, 0.88); // slightly darker to distinguish walls
    if (type === TILES.DOOR) return _shade(base, 1.06); // slight highlight
    if (type === TILES.FLOOR || type === TILES.STAIRS) return base;
    return null;
  }
  try { encounterFillFor.__biomeKey = String(ctx.encounterBiome || ""); } catch (_) {}
  return encounterFillFor;
}

export function drawBaseLayer(ctx, view) {
  const {
    ctx2d, TILE, COLORS, TILES, TS, tilesetReady,
    map, cam, tileOffsetX, tileOffsetY, startX, startY, endX, endY
  } = Object.assign({}, view, ctx);

  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;
  const canTileset = !!(tilesetReady && TS && typeof TS.draw === "function" && ctx.mode !== "encounter");

  const encounterFillFor = encounterFillForFactory(ctx);

  try {
    if (mapRows && mapCols) {
      const wpx = mapCols * TILE;
      const hpx = mapRows * TILE;
      const needsRebuild = (!DUN.canvas) || DUN.mapRef !== map || DUN.wpx !== wpx || DUN.hpx !== hpx || DUN.TILE !== TILE || DUN._tilesRef !== (typeof window !== "undefined" && window.GameData ? window.GameData.tiles : null);
      if (needsRebuild) {
        DUN.mapRef = map;
        DUN.wpx = wpx;
        DUN.hpx = hpx;
        DUN.TILE = TILE;
        DUN._tilesRef = (typeof window !== "undefined" && window.GameData ? window.GameData.tiles : null);
        const off = RenderCore.createOffscreen(wpx, hpx);
        const oc = off.getContext("2d");
        try {
          oc.font = "bold 20px JetBrains Mono, monospace";
          oc.textAlign = "center";
          oc.textBaseline = "middle";
        } catch (_) {}
        for (let yy = 0; yy < mapRows; yy++) {
          const rowMap = map[yy];
          for (let xx = 0; xx < mapCols; xx++) {
            const type = rowMap[xx];
            const sx = xx * TILE, sy = yy * TILE;
            let key = "floor";
            if (type === TILES.WALL) key = "wall";
            else if (type === TILES.STAIRS) key = "stairs";
            else if (type === TILES.DOOR) key = "door";
            let drawn = false;
            if (canTileset) {
              drawn = TS.draw(oc, key, sx, sy, TILE);
            }
            if (!drawn) {
              const fill = fillDungeonFor(TILES, type, COLORS, encounterFillFor);
              oc.fillStyle = fill;
              oc.fillRect(sx, sy, TILE, TILE);
              if (type === TILES.STAIRS && !canTileset) {
                if (ctx.mode !== "encounter") {
                  const tdStairs = getTileDef("dungeon", type) || getTileDef("dungeon", TILES.STAIRS);
                  const glyph = (tdStairs && Object.prototype.hasOwnProperty.call(tdStairs, "glyph")) ? tdStairs.glyph : ">";
                  const fg = (tdStairs && tdStairs.colors && tdStairs.colors.fg) || "#d7ba7d";
                  RenderCore.drawGlyph(oc, sx, sy, glyph, fg, TILE);
                }
              }
            }
          }
        }
        DUN.canvas = off;
        try {
          if (typeof window !== "undefined" && window.TilesValidation && typeof window.TilesValidation.recordMap === "function") {
            window.TilesValidation.recordMap({ mode: "dungeon", map });
          }
        } catch (_) {}
      }
    }
  } catch (_) {}

  if (DUN.canvas) {
    try {
      RenderCore.blitViewport(ctx2d, DUN.canvas, cam, DUN.wpx, DUN.hpx);
    } catch (_) {}
  } else {
    for (let y = startY; y <= endY; y++) {
      const yIn = y >= 0 && y < mapRows;
      const rowMap = yIn ? map[y] : null;
      for (let x = startX; x <= endX; x++) {
        const screenX = (x - startX) * TILE - tileOffsetX;
        const screenY = (y - startY) * TILE - tileOffsetY;
        if (!yIn || x < 0 || x >= mapCols) {
          ctx2d.fillStyle = COLORS.wallDark;
          ctx2d.fillRect(screenX, screenY, TILE, TILE);
          continue;
        }
        const type = rowMap[x];
        let key = "floor";
        if (type === TILES.WALL) key = "wall";
        else if (type === TILES.STAIRS) key = "stairs";
        else if (type === TILES.DOOR) key = "door";
        let drawn = false;
        if (canTileset) {
          drawn = TS.draw(ctx2d, key, screenX, screenY, TILE);
        }
        if (!drawn) {
          const fill = fillDungeonFor(TILES, type, COLORS, encounterFillFor);
          ctx2d.fillStyle = fill;
          ctx2d.fillRect(screenX, screenY, TILE, TILE);
        }
      }
    }
  }
}