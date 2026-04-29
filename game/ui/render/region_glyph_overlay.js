/**
 * Region glyph overlay.
 */
import * as RenderCore from "../render_core.js";
import * as World from "../../world/world.js";
import { glyphRegionFor } from "./region_tile_cache.js";

export function drawRegionGlyphOverlay(ctx, view) {
  const { ctx2d, TILE, map, startX, startY, endX, endY, tileOffsetX, tileOffsetY } = Object.assign({}, view, ctx);
  const WT = World.TILES;
  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;

  for (let y = startY; y <= endY; y++) {
    const yIn = y >= 0 && y < mapRows;
    const row = yIn ? map[y] : null;
    for (let x = startX; x <= endX; x++) {
      if (!yIn || x < 0 || x >= mapCols) continue;
      const t = row[x];
      const tg = glyphRegionFor(t);
      let glyph = tg.glyph;
      let fg = tg.fg;

      if ((!glyph || !fg) && t === WT.TREE) {
        if (!glyph || !String(glyph).trim().length) glyph = "♣";
        if (!fg) fg = "#3fa650";
      }

      if (glyph && String(glyph).trim().length > 0 && fg) {
        const screenX = (x - startX) * TILE - tileOffsetX;
        const screenY = (y - startY) * TILE - tileOffsetY;
        RenderCore.drawGlyph(ctx2d, screenX, screenY, glyph, fg, TILE);
      }
    }
  }
}