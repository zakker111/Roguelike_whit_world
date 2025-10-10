/**
 * RenderCore: shared helpers for rendering and viewport calculation.
 *
 * Exports (window.RenderCore):
 * - computeView(ctx): returns { ctx2d, TILE, ROWS, COLS, COLORS, TILES, cam, tileOffsetX, tileOffsetY, startX, startY, endX, endY, mapRows, mapCols, drawGrid, TS, tilesetReady }
 * - drawGlyph(ctx2d, x, y, ch, color, TILE)
 * - enemyColor(ctx, type, COLORS)
 */
(function () {
  function enemyColor(ctx, type, COLORS) {
    if (ctx && typeof ctx.enemyColor === "function") {
      try { return ctx.enemyColor(type); } catch (_) {}
    }
    if (typeof window !== "undefined" && window.Enemies && typeof Enemies.colorFor === "function") {
      return Enemies.colorFor(type);
    }
    return (COLORS && COLORS.enemy) || "#f7768e";
  }

  function drawGlyph(ctx2d, x, y, ch, color, TILE) {
    const half = TILE / 2;
    ctx2d.fillStyle = color;
    ctx2d.fillText(ch, x + half, y + half + 1);
  }

  function computeView(ctx) {
    const { ctx2d, TILE, ROWS, COLS, COLORS, TILES, map, camera: camMaybe } = ctx;

    const cam = camMaybe || { x: 0, y: 0, width: COLS * TILE, height: ROWS * TILE };
    const tileOffsetX = cam.x % TILE;
    const tileOffsetY = cam.y % TILE;
    const startX = Math.max(0, Math.floor(cam.x / TILE));
    const startY = Math.max(0, Math.floor(cam.y / TILE));
    const mapRows = map.length;
    const mapCols = map[0] ? map[0].length : 0;
    const endX = Math.min(mapCols - 1, startX + COLS - 1);
    const endY = Math.min(mapRows - 1, startY + ROWS - 1);

    // Clear and set text properties once per frame
    ctx2d.clearRect(0, 0, cam.width, cam.height);
    ctx2d.font = "bold 20px JetBrains Mono, monospace";
    ctx2d.textAlign = "center";
    ctx2d.textBaseline = "middle";

    const drawGrid = (typeof window !== "undefined" && typeof window.DRAW_GRID === "boolean") ? window.DRAW_GRID : true;
    if (drawGrid) {
      ctx2d.strokeStyle = "rgba(122,162,247,0.05)";
    }

    const TS = ctx.Tileset || (typeof window !== "undefined" ? window.Tileset : null);
    const tilesetReady = !!(TS && typeof TS.isReady === "function" && TS.isReady());

    return {
      ctx2d, TILE, ROWS, COLS, COLORS, TILES,
      cam, tileOffsetX, tileOffsetY, startX, startY, endX, endY, mapRows, mapCols,
      drawGrid, TS, tilesetReady
    };
  }

  window.RenderCore = { computeView, drawGlyph, enemyColor };
})();