/**
 * Region corpses overlay: draw '%' on visible bodies.
 */
import * as RenderCore from "../render_core.js";

export function drawRegionCorpses(ctx, view) {
  const { ctx2d, TILE, COLORS, map, visible, startX, startY, endX, endY, tileOffsetX, tileOffsetY } = Object.assign({}, view, ctx);

  if (!Array.isArray(ctx.corpses)) return;
  for (const c of ctx.corpses) {
    if (!c) continue;
    const cx = c.x | 0, cy = c.y | 0;
    if (cx < startX || cx > endX || cy < startY || cy > endY) continue;
    if (!visible[cy] || !visible[cy][cx]) continue;
    const sx = (cx - startX) * TILE - tileOffsetX;
    const sy = (cy - startY) * TILE - tileOffsetY;
    const fg = c.looted ? (COLORS.corpseEmpty || "#6b7280") : (COLORS.corpse || "#c3cad9");
    RenderCore.drawGlyph(ctx2d, sx, sy, "%", fg, TILE);
  }
}