/**
 * Overworld fog-of-war overlay.
 */
export function drawFog(ctx, view) {
  const { ctx2d, TILE, COLORS, map, startX, startY, endX, endY, tileOffsetX, tileOffsetY } = Object.assign({}, view, ctx);
  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;

  try {
    for (let y = startY; y <= endY; y++) {
      if (y < 0 || y >= mapRows) continue;
      const seenRow = ctx.seen && ctx.seen[y];
      const visRow = ctx.visible && ctx.visible[y];
      for (let x = startX; x <= endX; x++) {
        if (x < 0 || x >= mapCols) continue;
        const sx = (x - startX) * TILE - tileOffsetX;
        const sy = (y - startY) * TILE - tileOffsetY;
        const seenHere = !!(seenRow && seenRow[x]);
        const visHere = !!(visRow && visRow[x]);
        if (!seenHere) {
          ctx2d.fillStyle = "#0b0c10";
          ctx2d.fillRect(sx, sy, TILE, TILE);
        } else if (!visHere) {
          ctx2d.fillStyle = COLORS.dim || "rgba(0,0,0,0.35)";
          ctx2d.fillRect(sx, sy, TILE, TILE);
        }
      }
    }
  } catch (_) {}
}