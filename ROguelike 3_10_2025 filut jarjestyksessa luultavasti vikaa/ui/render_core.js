/**
 * RenderCore: shared helpers for rendering and viewport calculation.
 *
 * Exports (window.RenderCore):
 * - computeView(ctx): returns { ctx2d, TILE, ROWS, COLS, COLORS, TILES, cam, tileOffsetX, tileOffsetY, startX, startY, endX, endY, mapRows, mapCols, drawGrid, TS, tilesetReady }
 * - drawGlyph(ctx2d, x, y, ch, color, TILE)
 * - enemyColor(ctx, type, COLORS)
 * - drawGridOverlay(view): draws a light grid aligned to tile boundaries when enabled
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

  function posMod(n, m) {
    var r = n % m;
    return r < 0 ? r + m : r;
  }

  function computeView(ctx) {
    const { ctx2d, TILE, ROWS, COLS, COLORS, TILES, map, camera: camMaybe } = ctx;

    const cam = camMaybe || { x: 0, y: 0, width: COLS * TILE, height: ROWS * TILE };
    // Normalize offsets to [0, TILE)
    const tileOffsetX = posMod(cam.x, TILE);
    const tileOffsetY = posMod(cam.y, TILE);
    // Allow negative start indices so camera can truly center on player near edges
    const startX = Math.floor(cam.x / TILE);
    const startY = Math.floor(cam.y / TILE);
    const mapRows = map.length;
    const mapCols = map[0] ? map[0].length : 0;
    // Draw a full COLS x ROWS window regardless of map bounds; renderers must guard OOB
    const endX = startX + COLS - 1;
    const endY = startY + ROWS - 1;

    // Clear and set text properties once per frame
    ctx2d.clearRect(0, 0, cam.width, cam.height);
    ctx2d.font = "bold 20px JetBrains Mono, monospace";
    ctx2d.textAlign = "center";
    ctx2d.textBaseline = "middle";

    const drawGrid = (typeof window !== "undefined" && typeof window.DRAW_GRID === "boolean") ? window.DRAW_GRID : true;

    const TS = ctx.Tileset || (typeof window !== "undefined" ? window.Tileset : null);
    const tilesetReady = !!(TS && typeof TS.isReady === "function" && TS.isReady());

    return {
      ctx2d, TILE, ROWS, COLS, COLORS, TILES,
      cam, tileOffsetX, tileOffsetY, startX, startY, endX, endY, mapRows, mapCols,
      drawGrid, TS, tilesetReady
    };
  }

  function drawGridOverlay(view) {
    try {
      const { ctx2d, TILE, COLS, ROWS, tileOffsetX, tileOffsetY, cam, drawGrid } = view || {};
      if (!ctx2d || !TILE || !COLS || !ROWS || !cam) return;
      const enabled = (typeof drawGrid === "boolean") ? drawGrid
        : ((typeof window !== "undefined" && typeof window.DRAW_GRID === "boolean") ? window.DRAW_GRID : true);
      if (!enabled) return;

      ctx2d.save();
      ctx2d.strokeStyle = "rgba(122,162,247,0.08)";
      ctx2d.lineWidth = 1;

      // Vertical lines
      ctx2d.beginPath();
      for (let c = 0; c <= COLS; c++) {
        const x = Math.floor(c * TILE - tileOffsetX) + 0.5;
        ctx2d.moveTo(x, 0);
        ctx2d.lineTo(x, cam.height);
      }
      // Horizontal lines
      for (let r = 0; r <= ROWS; r++) {
        const y = Math.floor(r * TILE - tileOffsetY) + 0.5;
        ctx2d.moveTo(0, y);
        ctx2d.lineTo(cam.width, y);
      }
      ctx2d.stroke();
      ctx2d.restore();
    } catch (_) {}
  }

  window.RenderCore = { computeView, drawGlyph, enemyColor, drawGridOverlay };
})();