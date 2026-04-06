/**
 * Overworld coastline/shoreline outlines for water/river adjacency.
 */
import { getTileDef } from "../../data/tile_lookup.js";
import { shade as _shade } from "../color_utils.js";
import * as World from "../../world/world.js";

export function drawCoastOutline(ctx, view) {
  const { ctx2d, TILE, map, startX, startY, endX, endY, tileOffsetX, tileOffsetY } = Object.assign({}, view, ctx);
  const WT = World.TILES;
  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;

  try {
    let coastColor = "#a8dadc";
    try {
      const wDef2 = getTileDef("overworld", WT.WATER);
      const wFill2 = (wDef2 && wDef2.colors && wDef2.colors.fill) ? wDef2.colors.fill : "#0a1b2a";
      coastColor = _shade(wFill2, 1.4) || coastColor;
    } catch (_) {}
    for (let y = startY; y <= endY; y++) {
      const yIn = y >= 0 && y < mapRows;
      if (!yIn) continue;
      for (let x = startX; x <= endX; x++) {
        if (x < 0 || x >= mapCols) continue;
        const t = map[y][x];
        if (t !== WT.WATER && t !== WT.RIVER) continue;
        const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
        for (const d of dirs) {
          const nx = x + d.dx, ny = y + d.dy;
          if (nx < 0 || ny < 0 || nx >= mapCols || ny >= mapRows) continue;
          const nt = map[ny][nx];
          if (nt === WT.WATER || nt === WT.RIVER) continue;
          const sx = (nx - startX) * TILE - tileOffsetX;
          const sy = (ny - startY) * TILE - tileOffsetY;
          ctx2d.save();
          ctx2d.globalAlpha = 0.16;
          ctx2d.fillStyle = coastColor;
          ctx2d.fillRect(sx, sy, TILE, TILE);
          ctx2d.restore();
        }
      }
    }
  } catch (_) {}
}