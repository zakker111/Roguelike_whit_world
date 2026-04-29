/**
 * Town glyph overlays.
 */
import * as RenderCore from "../render_core.js";
import { getTileDef } from "../../data/tile_lookup.js";
import { glyphTownFor } from "./town_tile_cache.js";

export function drawTownGlyphOverlay(ctx, view) {
  const { ctx2d, TILE, TILES, map, startX, startY, endX, endY, tileOffsetX, tileOffsetY } = Object.assign({}, view, ctx);
  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;

  for (let y = startY; y <= endY; y++) {
    const yIn = y >= 0 && y < mapRows;
    const rowMap = yIn ? map[y] : null;
    for (let x = startX; x <= endX; x++) {
      if (!yIn || x < 0 || x >= mapCols) continue;
      const type = rowMap[x];
      if (type === TILES.DOOR) continue;

      const tg = glyphTownFor(type);
      let glyph = tg ? tg.glyph : "";
      let fg = tg ? tg.fg : null;

      const screenX = (x - startX) * TILE - tileOffsetX;
      const screenY = (y - startY) * TILE - tileOffsetY;

      if (type === TILES.STAIRS) {
        let g = ">";
        let c = "#d7ba7d";
        try {
          const tdSt = getTileDef("town", TILES.STAIRS) || getTileDef("dungeon", TILES.STAIRS);
          if (tdSt) {
            if (Object.prototype.hasOwnProperty.call(tdSt, "glyph")) g = tdSt.glyph || g;
            if (tdSt.colors && tdSt.colors.fg) c = tdSt.colors.fg || c;
          }
        } catch (_) {}
        RenderCore.drawGlyph(ctx2d, screenX, screenY, g, c, TILE);
        continue;
      }

      if (type === TILES.WINDOW) {
        if (!glyph || String(glyph).trim().length === 0) glyph = "□";
        if (!fg) fg = "#8ecae6";
        ctx2d.save();
        ctx2d.globalAlpha = 0.50;
        RenderCore.drawGlyph(ctx2d, screenX, screenY, glyph, fg, TILE);
        ctx2d.restore();
      } else {
        if (!glyph || !fg || String(glyph).trim().length === 0) continue;
        RenderCore.drawGlyph(ctx2d, screenX, screenY, glyph, fg, TILE);
      }
    }
  }
}

export function drawStairsGlyphTop(ctx, view) {
  const { ctx2d, TILE, TILES, map, seen, startX, startY, endX, endY, tileOffsetX, tileOffsetY } = Object.assign({}, view, ctx);
  try {
    for (let y = startY; y <= endY; y++) {
      const yIn = y >= 0 && y < map.length;
      if (!yIn) continue;
      for (let x = startX; x <= endX; x++) {
        if (x < 0 || x >= (map[0] ? map[0].length : 0)) continue;
        const type = map[y][x];
        if (type !== TILES.STAIRS) continue;
        const everSeen = !!(seen[y] && seen[y][x]);
        if (!everSeen) continue;
        const screenX = (x - startX) * TILE - tileOffsetX;
        const screenY = (y - startY) * TILE - tileOffsetY;
        (function () {
          let g = ">";
          let c = "#d7ba7d";
          try {
            const tdSt = getTileDef("town", TILES.STAIRS) || getTileDef("dungeon", TILES.STAIRS);
            if (tdSt) {
              if (Object.prototype.hasOwnProperty.call(tdSt, "glyph")) g = tdSt.glyph || g;
              if (tdSt.colors && tdSt.colors.fg) c = tdSt.colors.fg || c;
            }
          } catch (_) {}
          RenderCore.drawGlyph(ctx2d, screenX, screenY, g, c, TILE);
        })();
      }
    }
  } catch (_) {}
}