/**
 * FOV/Camera glue: centralized camera update helper.
 *
 * Exports (ESM + window.FOVCamera):
 * - updateCamera(ctx): centers camera on player. In world mode, clamps camera to map bounds (no slack).
 *
 * Notes:
 * - Uses ctx.map shape and ctx.TILE to compute screen coordinates.
 * - Dungeon/town modes allow half-viewport slack so player stays centered at borders.
 * - World mode clamps to bounds to avoid showing off-map void.
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

    const isWorld = (ctx && ctx.mode === "world");

    // Slack only outside world mode; world clamps to bounds to avoid black void
    const slackX = isWorld ? 0 : Math.max(0, camera.width / 2 - TILE / 2);
    const slackY = isWorld ? 0 : Math.max(0, camera.height / 2 - TILE / 2);

    const minX = isWorld ? 0 : -slackX;
    const minY = isWorld ? 0 : -slackY;
    const maxX = isWorld ? Math.max(0, mapWidth - camera.width) : (mapWidth - camera.width) + slackX;
    const maxY = isWorld ? Math.max(0, mapHeight - camera.height) : (mapHeight - camera.height) + slackY;

    camera.x = Math.max(minX, Math.min(targetX, maxX));
    camera.y = Math.max(minY, Math.min(targetY, maxY));
  } catch (_) {}
}

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("FOVCamera", { updateCamera });