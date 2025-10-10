/**
 * FOV/Camera glue: centralized camera update helper.
 *
 * Exports (window.FOVCamera):
 * - updateCamera(ctx): centers camera on player, clamped to map bounds.
 *
 * Notes:
 * - Uses ctx.map shape and ctx.TILE to compute screen coordinates.
 */
(function () {
  function updateCamera(ctx) {
    try {
      const camera = ctx.camera || (ctx.getCamera ? ctx.getCamera() : null);
      const TILE = ctx.TILE || 32;
      const mapCols = ctx.map && ctx.map[0] ? ctx.map[0].length : (ctx.COLS || 30);
      const mapRows = Array.isArray(ctx.map) ? ctx.map.length : (ctx.ROWS || 20);
      const mapWidth = mapCols * TILE;
      const mapHeight = mapRows * TILE;

      if (!camera) return;

      const targetX = ctx.player.x * TILE + TILE / 2 - camera.width / 2;
      const targetY = ctx.player.y * TILE + TILE / 2 - camera.height / 2;

      camera.x = Math.max(0, Math.min(targetX, Math.max(0, mapWidth - camera.width)));
      camera.y = Math.max(0, Math.min(targetY, Math.max(0, mapHeight - camera.height)));
    } catch (_) {}
  }

  window.FOVCamera = { updateCamera };
})();