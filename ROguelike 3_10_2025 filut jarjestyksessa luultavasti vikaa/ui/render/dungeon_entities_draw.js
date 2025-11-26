/**
 * Dungeon entities: enemies and player rendering.
 */
import * as RenderCore from "../render_core.js";

export function drawEnemies(ctx, view) {
  const {
    ctx2d, TILE, COLORS, TILES, TS, tilesetReady,
    map, visible, startX, startY, endX, endY, tileOffsetX, tileOffsetY
  } = Object.assign({}, view, ctx);

  const enemies = Array.isArray(ctx.enemies) ? ctx.enemies : [];
  for (const e of enemies) {
    if (!visible[e.y] || !visible[e.y][e.x]) continue;
    if (e.x < startX || e.x > endX || e.y < startY || e.y > endY) continue;
    const screenX = (e.x - startX) * TILE - tileOffsetX;
    const screenY = (e.y - startY) * TILE - tileOffsetY;
    const enemyKey = e.type ? `enemy.${e.type}` : null;

    // Base enemy body
    if (enemyKey && tilesetReady && TS.draw && TS.draw(ctx2d, enemyKey, screenX, screenY, TILE)) {
      // drawn via tileset
    } else {
      RenderCore.drawGlyph(ctx2d, screenX, screenY, e.glyph || "e", RenderCore.enemyColor(ctx, e.type, COLORS), TILE);
    }

    // Simple burning overlay when enemy is on fire (inFlamesTurns > 0)
    try {
      if (e.inFlamesTurns && e.inFlamesTurns > 0) {
        ctx2d.save();
        const half = TILE / 2;
        ctx2d.textAlign = "center";
        ctx2d.textBaseline = "middle";
        // Subtle flicker using remaining turns to vary alpha slightly
        const baseA = 0.9;
        const flicker = ((e.inFlamesTurns * 37) % 10) / 100; // 0..0.09
        ctx2d.globalAlpha = Math.max(0.6, Math.min(1.0, baseA - flicker));
        // Fire color from palette if available, else fallback
        let fireColor = "#f97316";
        try {
          const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays)
            ? window.GameData.palette.overlays
            : null;
          if (pal && pal.fire) fireColor = pal.fire;
        } catch (_) {}
        ctx2d.fillStyle = fireColor;
        ctx2d.font = `${Math.floor(TILE * 0.9)}px JetBrains Mono, monospace`;
        ctx2d.fillText("✦", screenX + half, screenY + half);
        ctx2d.restore();
      }
    } catch (_) {}
  }
}

export function drawPlayer(ctx, view) {
  const {
    ctx2d, TILE, COLORS, startX, startY, endX, endY, tileOffsetX, tileOffsetY, TS, tilesetReady
  } = Object.assign({}, view, ctx);

  const player = ctx.player;
  if (!player) return;
  if (player.x >= startX && player.x <= endX && player.y >= startY && player.y <= endY) {
    const screenX = (player.x - startX) * TILE - tileOffsetX;
    const screenY = (player.y - startY) * TILE - tileOffsetY;
    if (!(tilesetReady && TS.draw && TS.draw(ctx2d, "player", screenX, screenY, TILE))) {
      RenderCore.drawGlyph(ctx2d, screenX, screenY, "@", COLORS.player, TILE);
    }
  }
}