/**
 * Region base layer: viewport draw.
 */
import * as RenderCore from "../render_core.js";
import { getTileDef } from "../../data/tile_lookup.js";
import { fillRegionFor, tilesRef } from "./region_tile_cache.js";
import * as World from "../../world/world.js";

export function drawRegionBase(ctx, view) {
  const { ctx2d, TILE, map, startX, startY, endX, endY, tileOffsetX, tileOffsetY } = Object.assign({}, view, ctx);
  const WT = World.TILES;
  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;

  for (let y = startY; y <= endY; y++) {
    const yIn = y >= 0 && y < mapRows;
    const row = yIn ? map[y] : null;
    for (let x = startX; x <= endX; x++) {
      const screenX = (x - startX) * TILE - tileOffsetX;
      const screenY = (y - startY) * TILE - tileOffsetY;

      if (!yIn || x < 0 || x >= mapCols) {
        ctx2d.fillStyle = "#0b0c10";
        ctx2d.fillRect(screenX, screenY, TILE, TILE);
        continue;
      }

      const t = row[x];
      const fill = fillRegionFor(WT, t);
      ctx2d.fillStyle = fill;
      ctx2d.fillRect(screenX, screenY, TILE, TILE);
    }
  }

  try {
    if (typeof window !== "undefined" && window.TilesValidation && typeof window.TilesValidation.recordMap === "function") {
      window.TilesValidation.recordMap({ mode: "region", map });
    }
  } catch (_) {}
}