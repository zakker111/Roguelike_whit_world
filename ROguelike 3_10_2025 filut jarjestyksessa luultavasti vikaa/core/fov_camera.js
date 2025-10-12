/**
 * FOV/Camera glue: centralized camera update helper.
 *
 * Exports (ESM + window.FOVCamera):
 * - updateCamera(ctx): centers camera on player with half-viewport slack beyond map edges.
 *
 * Notes:
 * - Uses ctx.map shape and ctx.TILE to compute screen coordinates.
 * - Allows the camera to extend up to half the viewport beyond edges so the player stays centered at borders.
 */

export function updateCamera(ctx) {
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

    // Half-viewport slack keeps player centered even at edges
    const slackX = Math.max(0, camera.width / 2 - TILE / 2);
    const slackY = Math.max(0, camera.height / 2 - TILE / 2);
    const minX = -slackX;
    const minY = -slackY;
    const maxX = (mapWidth - camera.width) + slackX;
    const maxY = (mapHeight - camera.height) + slackY;

    camera.x = Math.max(minX, Math.min(targetX, maxX));
    camera.y = Math.max(minY, Math.min(targetY, maxY));
  } catch (_) {}
}

// Back-compat: attach to window for classic scripts
if (typeof window !== "undefined") {
  window.FOVCamera = { updateCamera };
}