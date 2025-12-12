/**
 * Shared visibility overlay for dungeon/town/region-style renderers.
 *
 * Fills:
 * - wallDark for tiles outside map bounds or never seen
 * - dim for tiles seen but not currently visible
 *
 * Expects ctx/view to provide:
 * - ctx2d, TILE, COLORS, map, seen, visible,
 * - startX, startY, endX, endY, tileOffsetX, tileOffsetY
 */
export function drawVisibilityOverlay(ctx, view) {
  const {
    ctx2d,
    TILE,
    COLORS,
    map,
    seen,
    visible,
    startX,
    startY,
    endX,
    endY,
    tileOffsetX,
    tileOffsetY,
  } = Object.assign({}, view, ctx);

  if (!Array.isArray(map) || map.length === 0) return;

  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;

  for (let y = startY; y <= endY; y++) {
    const yIn = y >= 0 && y < mapRows;
    const rowSeen = yIn ? (seen[y] || []) : [];
    const rowVis = yIn ? (visible[y] || []) : [];
    for (let x = startX; x <= endX; x++) {
      const screenX = (x - startX) * TILE - tileOffsetX;
      const screenY = (y - startY) * TILE - tileOffsetY;

      if (!yIn || x < 0 || x >= mapCols) {
        ctx2d.fillStyle = COLORS.wallDark;
        ctx2d.fillRect(screenX, screenY, TILE, TILE);
        continue;
      }

      const vis = !!rowVis[x];
      const everSeen = !!rowSeen[x];
      if (!everSeen) {
        ctx2d.fillStyle = COLORS.wallDark;
        ctx2d.fillRect(screenX, screenY, TILE, TILE);
      } else if (!vis) {
        ctx2d.fillStyle = COLORS.dim;
        ctx2d.fillRect(screenX, screenY, TILE, TILE);
      }
    }
  }
}