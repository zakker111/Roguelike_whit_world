/**
 * Region edge/exit tiles overlay.
 */
export function drawRegionExitOverlay(ctx, view) {
  const { ctx2d, TILE, map, startX, startY, endX, endY, tileOffsetX, tileOffsetY } = Object.assign({}, view, ctx);

  try {
    ctx2d.save();
    let fillCol = "rgba(241,153,40,0.28)";
    let strokeCol = "rgba(241,153,40,0.80)";
    try {
      const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
      if (pal) {
        fillCol = pal.exitRegionFill || fillCol;
        strokeCol = pal.exitRegionStroke || strokeCol;
      }
    } catch (_) {}
    ctx2d.fillStyle = fillCol;
    ctx2d.strokeStyle = strokeCol;
    ctx2d.lineWidth = 2;
    for (const e of (ctx.region.exitTiles || [])) {
      const ex = (e.x | 0), ey = (e.y | 0);
      if (ex >= startX && ex <= endX && ey >= startY && ey <= endY) {
        const sx = (ex - startX) * TILE - tileOffsetX;
        const sy = (ey - startY) * TILE - tileOffsetY;
        ctx2d.fillRect(sx, sy, TILE, TILE);
        ctx2d.strokeRect(sx + 0.5, sy + 0.5, TILE - 1, TILE - 1);
      }
    }
    ctx2d.restore();
  } catch (_) {}
}