/**
 * Region player marker (only when visible).
 */
import * as RenderCore from "../render_core.js";

export function drawRegionPlayer(ctx, view) {
  const { ctx2d, TILE, COLORS, player, visible, startX, startY, endX, endY, tileOffsetX, tileOffsetY } = Object.assign({}, view, ctx);

  const px = player.x | 0, py = player.y | 0;
  if (px >= startX && px <= endX && py >= startY && py <= endY && visible[py] && visible[py][px]) {
    const screenX = (px - startX) * TILE - tileOffsetX;
    const screenY = (py - startY) * TILE - tileOffsetY;

    ctx2d.save();
    let pbFill = "rgba(255,255,255,0.16)";
    let pbStroke = "rgba(255,255,255,0.35)";
    try {
      const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
      if (pal) {
        pbFill = pal.playerBackdropFill || pbFill;
        pbStroke = pal.playerBackdropStroke || pbStroke;
      }
    } catch (_) {}
    ctx2d.fillStyle = pbFill;
    ctx2d.fillRect(screenX + 4, screenY + 4, TILE - 8, TILE - 8);
    ctx2d.strokeStyle = pbStroke;
    ctx2d.lineWidth = 1;
    ctx2d.strokeRect(screenX + 4.5, screenY + 4.5, TILE - 9, TILE - 9);

    const half = TILE / 2;
    ctx2d.lineWidth = 2;
    ctx2d.strokeStyle = "#0b0f16";
    ctx2d.strokeText("@", screenX + half, screenY + half + 1);
    ctx2d.fillStyle = COLORS.player || "#9ece6a";
    ctx2d.fillText("@", screenX + half, screenY + half + 1);
    ctx2d.restore();
  }
}