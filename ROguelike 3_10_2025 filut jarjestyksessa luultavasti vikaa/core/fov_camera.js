/**
 * FOV/Camera glue: centralized camera update helper.
 *
 * Exports (window.FOVCamera):
 * - updateCamera(ctx): centers camera on player (no clamping).
 *
 * Notes:
 * - Uses ctx.map shape and ctx.TILE to compute screen coordinates.
 * - Rendering code is responsible for handling off-map space near edges.
 */
(function () {
  function updateCamera(ctx) {
    try {
      const camera = ctx.camera || (ctx.getCamera ? ctx.getCamera() : null);
      const TILE = ctx.TILE || 32;
      if (!camera) return;

      const targetX = ctx.player.x * TILE + TILE / 2 - camera.width / 2;
      const targetY = ctx.player.y * TILE + TILE / 2 - camera.height / 2;

      camera.x = targetX;
      camera.y = targetY;
    } catch (_) {}
  }

  window.FOVCamera = { updateCamera };
})();