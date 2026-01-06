/**
 * Region entities overlay: enemies/animals markers when visible.
 */
import { getFollowerDef } from "../../entities/followers.js";

export function drawRegionEntities(ctx, view) {
  const { ctx2d, TILE, COLORS, visible, startX, startY, endX, endY, tileOffsetX, tileOffsetY } = Object.assign({}, view, ctx);

  try {
    if (!Array.isArray(ctx.enemies)) return;
    for (const e of ctx.enemies) {
      if (!e) continue;
      const ex = e.x | 0, ey = e.y | 0;
      if (ex < startX || ex > endX || ey < startY || ey > endY) continue;
      if (!visible[ey] || !visible[ey][ex]) continue;
      const sx = (ex - startX) * TILE - tileOffsetX;
      const sy = (ey - startY) * TILE - tileOffsetY;
      const faction = String(e.faction || "");
      const isFollower = !!(e && e._isFollower);
      let color = "#f7768e";
      if (faction === "animal") {
        try {
          const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
          color = (pal && pal.regionAnimal) ? pal.regionAnimal : "#e9d5a1";
        } catch (_) {
          color = "#e9d5a1";
        }
      } else if (isFollower) {
        // Followers use their own palette color from data/entities/followers.json via Followers.getFollowerDef
        try {
          const fid = e._followerId || "guard_follower";
          const def = getFollowerDef(ctx, fid);
          color = (def && def.color) ? def.color : "#000000";
        } catch (_) {
          color = "#000000";
        }
      } else if (typeof ctx.enemyColor === "function") {
        try { color = ctx.enemyColor(e.type || "enemy"); } catch (_) {}
      }
      ctx2d.save();
      if (isFollower) {
        // Followers: use the same visual language as dungeon/town allies:
        // a solid backdrop plus a black glyph.
        const pad = 4;
        ctx2d.globalAlpha = 0.9;
        const bgColor = (color === "#000000") ? "#4b5563" : color;
        ctx2d.fillStyle = bgColor;
        ctx2d.fillRect(sx + pad, sy + pad, TILE - pad * 2, TILE - pad * 2);
        ctx2d.restore();

        // Draw the follower glyph (e.g. 'G') in glyph color (black by default)
        try {
          const half = TILE / 2;
          ctx2d.save();
          ctx2d.textAlign = "center";
          ctx2d.textBaseline = "middle";
          ctx2d.fillStyle = color;
          ctx2d.fillText(String((e.glyph && String(e.glyph).trim()) ? e.glyph : (e.type ? e.type.charAt(0) : "?")), sx + half, sy + half);
          ctx2d.restore();
        } catch (_) {}
        continue;
      }

      if (faction === "animal") {
        ctx2d.beginPath();
        ctx2d.arc(sx + TILE / 2, sy + TILE / 2, Math.max(6, (TILE - 12) / 2), 0, Math.PI * 2);
        ctx2d.fillStyle = color;
        ctx2d.fill();
      } else {
        // Non-follower enemies: solid square marker with dark glyph
        const pad = 6;
        ctx2d.fillStyle = color;
        ctx2d.fillRect(sx + pad, sy + pad, TILE - pad * 2, TILE - pad * 2);
        try {
          const half = TILE / 2;
          ctx2d.textAlign = "center";
          ctx2d.textBaseline = "middle";
          ctx2d.fillStyle = "#0b0f16";
          ctx2d.fillText(String((e.glyph && String(e.glyph).trim()) ? e.glyph : (e.type ? e.type.charAt(0) : "?")), sx + half, sy + half);
        } catch (_) {}
      }
      // Simple burning marker in Region Map when enemy is on fire
      try {
        if (e.inFlamesTurns && e.inFlamesTurns > 0) {
          const half = TILE / 2;
          ctx2d.textAlign = "center";
          ctx2d.textBaseline = "middle";
          let fireColor = "#f97316";
          try {
            const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays)
              ? window.GameData.palette.overlays
              : null;
            if (pal && pal.fire) fireColor = pal.fire;
          } catch (_) {}
          ctx2d.fillStyle = fireColor;
          ctx2d.globalAlpha = 0.9;
          ctx2d.font = `${Math.floor(TILE * 0.7)}px JetBrains Mono, monospace`;
          ctx2d.fillText("✦", sx + half, sy + half);
        }
      } catch (_) {}
      ctx2d.restore();
    }
  } catch (_) {}
}