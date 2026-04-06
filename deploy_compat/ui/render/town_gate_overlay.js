/**
 * Town gate highlight overlay.
 */
import * as RenderCore from "../render_core.js";

export function drawGateOverlay(ctx, view) {
  const { ctx2d, TILE, map, startX, startY, endX, endY, tileOffsetX, tileOffsetY } = Object.assign({}, view, ctx);
  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;
  const TILES = ctx.TILES;

  (function drawGate() {
    let gx = null, gy = null;
    if (ctx.townExitAt && typeof ctx.townExitAt.x === "number" && typeof ctx.townExitAt.y === "number") {
      gx = ctx.townExitAt.x; gy = ctx.townExitAt.y;
    } else {
      try {
        const rows = mapRows, cols = mapCols;
        for (let x = 0; x < cols && gx == null; x++) {
          if (map[0][x] === TILES.DOOR) { gx = x; gy = 1; }
        }
        for (let x = 0; x < cols && gx == null; x++) {
          if (map[rows - 1][x] === TILES.DOOR) { gx = x; gy = rows - 2; }
        }
        for (let y = 0; y < rows && gx == null; y++) {
          if (map[y][0] === TILES.DOOR) { gx = 1; gy = y; }
        }
        for (let y = 0; y < rows && gx == null; y++) {
          if (map[y][cols - 1] === TILES.DOOR) { gx = cols - 2; gy = y; }
        }
      } catch (_) {}
    }
    if (gx == null || gy == null) return;
    if (gx < startX || gx > endX || gy < startY || gy > endY) return;

    const screenX = (gx - startX) * TILE - tileOffsetX;
    const screenY = (gy - startY) * TILE - tileOffsetY;
    ctx2d.save();
    const t = Date.now();
    const pulse = 0.55 + 0.45 * Math.abs(Math.sin(t / 520));
    ctx2d.globalAlpha = pulse;
    ctx2d.lineWidth = 3;
    let exitColor = "#9ece6a";
    try {
      const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
      if (pal && pal.exitTown) exitColor = pal.exitTown || exitColor;
    } catch (_) {}
    ctx2d.strokeStyle = exitColor;
    ctx2d.strokeRect(screenX + 2.5, screenY + 2.5, TILE - 5, TILE - 5);
    try {
      ctx2d.globalAlpha = 0.95;
      RenderCore.drawGlyph(ctx2d, screenX, screenY, "G", exitColor, TILE);
    } catch (_) {}
    ctx2d.restore();
  })();

  if (ctx.townExitAt) {
    const gx = ctx.townExitAt.x, gy = ctx.townExitAt.y;
    if (gx >= startX && gx <= endX && gy >= startY && gy <= endY) {
      const screenX = (gx - startX) * TILE - tileOffsetX;
      const screenY = (gy - startY) * TILE - tileOffsetY;
      ctx2d.save();
      ctx2d.globalAlpha = 1.0;
      let exitColor = "#9ece6a";
      try {
        const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
        if (pal && pal.exitTown) exitColor = pal.exitTown || exitColor;
      } catch (_) {}
      RenderCore.drawGlyph(ctx2d, screenX, screenY, "G", exitColor, TILE);
      ctx2d.restore();
    }
  }
}