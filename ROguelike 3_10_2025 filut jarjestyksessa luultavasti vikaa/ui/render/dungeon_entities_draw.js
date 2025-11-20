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
    if (enemyKey && tilesetReady && TS.draw && TS.draw(ctx2d, enemyKey, screenX, screenY, TILE)) {
      // drawn via tileset
    } else {
      RenderCore.drawGlyph(ctx2d, screenX, screenY, e.glyph || "e", RenderCore.enemyColor(ctx, e.type, COLORS), TILE);
    }
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