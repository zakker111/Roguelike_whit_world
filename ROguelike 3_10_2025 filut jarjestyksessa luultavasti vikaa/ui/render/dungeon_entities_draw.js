/**
 * Dungeon entities: enemies and player rendering.
 */
import * as RenderCore from "../render_core.js";
import { getFollowerDef } from "../../entities/followers.js";

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

    // Followers/allies use their own glyph/color from GameData.followers so they
    // look consistent across dungeon, town, and region maps.
    const isFollower = !!(e && e._isFollower);
    let glyph = e.glyph || "e";
    let color = RenderCore.enemyColor(ctx, e.type, COLORS);
    if (isFollower) {
      const fid = e._followerId;
      const def = fid ? getFollowerDef(ctx, fid) : null;
      if (!def) {
        throw new Error(`Follower definition not found for id=${fid} (dungeon)`);
      }
      if (typeof def.glyph !== "string" || !def.glyph.trim()) {
        throw new Error(`Follower glyph missing for id=${fid}`);
      }
      if (typeof def.color !== "string" || !def.color.trim()) {
        throw new Error(`Follower color missing for id=${fid}`);
      }
      glyph = def.glyph;
      color = def.color;
    }

    // Followers: draw a soft backdrop so they stand out from enemies.
    if (isFollower) {
      ctx2d.save();
      ctx2d.globalAlpha = 0.55;
      // Slightly lighter background so black glyph remains visible.
      const pad = 4;
      const bgColor = (color === "#000000") ? "#4b5563" : color;
      ctx2d.fillStyle = bgColor;
      ctx2d.fillRect(screenX + pad, screenY + pad, TILE - pad * 2, TILE - pad * 2);
      ctx2d.restore();
    }

    // Base enemy body
    if (!isFollower && enemyKey && tilesetReady && TS.draw && TS.draw(ctx2d, enemyKey, screenX, screenY, TILE)) {
      // drawn via tileset
    } else {
      RenderCore.drawGlyph(ctx2d, screenX, screenY, glyph, color, TILE);
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