/**
 * Region entities overlay: enemies/animals markers when visible.
 *
 * On Region Map:
 * - Neutral/hostile animals: glyph-only (no background), using their species color.
 * - Followers: square + glyph (as allies elsewhere).
 * - Other enemies: square + glyph.
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

      // Treat anything whose type matches animals.json as an animal visually,
      // even if its faction changed after being attacked.
      let isAnimal = (faction === "animal");
      try {
        if (!isAnimal && e.type && typeof window !== "undefined" && window.GameData && Array.isArray(window.GameData.animals)) {
          const t = String(e.type).toLowerCase();
          isAnimal = window.GameData.animals.some(a => {
            if (!a) return false;
            const id = String(a.id || a.type || "").toLowerCase();
            return id && id === t;
          });
        }
      } catch (_) {}

      let color = "#f7768e";
      if (isAnimal) {
        // Prefer per-entity color (set at spawn), fall back to overlay palette.
        try {
          if (e.color && typeof e.color === "string" && e.color.trim()) {
            color = e.color;
          } else {
            const pal = (typeof window !== "undefined"
              && window.GameData
              && window.GameData.palette
              && window.GameData.palette.overlays)
              ? window.GameData.palette.overlays
              : null;
            color = (pal && pal.regionAnimal) ? pal.regionAnimal : "#e9d5a1";
          }
        } catch (_) {
          color = "#e9d5a1";
        }
      } else if (isFollower) {
        // Followers use their own palette color from data/entities/followers.json via Followers.getFollowerDef
        const fid = e._followerId;
        const def = fid ? getFollowerDef(ctx, fid) : null;
        if (!def) {
          throw new Error(`Follower definition not found for id=${fid} (region)`);
        }
        if (typeof def.color !== "string" || !def.color.trim()) {
          throw new Error(`Follower color missing for id=${fid}`);
        }
        color = def.color;
      } else if (typeof ctx.enemyColor === "function") {
        try { color = ctx.enemyColor(e.type || "enemy"); } catch (_) {}
      }

      ctx2d.save();

      if (isFollower) {
        // Followers: use the same visual language as dungeon/town allies:
        // a solid backdrop plus glyph.
        const pad = 4;
        ctx2d.globalAlpha = 0.9;
        const bgColor = (color === "#000000") ? "#4b5563" : color;
        ctx2d.fillStyle = bgColor;
        ctx2d.fillRect(sx + pad, sy + pad, TILE - pad * 2, TILE - pad * 2);

        // Draw the follower glyph (e.g. 'G')
        try {
          const half = TILE / 2;
          ctx2d.textAlign = "center";
          ctx2d.textBaseline = "middle";
          ctx2d.fillStyle = COLORS && COLORS.text ? COLORS.text : "#0b0f16";
          ctx2d.fillText(
            String((e.glyph && String(e.glyph).trim()) ? e.glyph : (e.type ? e.type.charAt(0) : "?")),
            sx + half,
            sy + half
          );
        } catch (_) {}
        ctx2d.restore();
        continue;
      }

      if (isAnimal) {
        // Animals: glyph only, no background, even when hostile.
        try {
          const half = TILE / 2;
          ctx2d.textAlign = "center";
          ctx2d.textBaseline = "middle";
          try {
            ctx2d.font = `${Math.floor(TILE * 0.7)}px JetBrains Mono, monospace`;
          } catch (_) {}
          const glyph = String(
            (e.glyph && String(e.glyph).trim())
              ? e.glyph
              : (e.type ? e.type.charAt(0) : "?")
          );
          ctx2d.fillStyle = color;
          ctx2d.fillText(glyph, sx + half, sy + half);
        } catch (_) {}
      } else {
        // Non-follower, non-animal enemies: solid square marker with dark glyph
        const pad = 6;
        ctx2d.fillStyle = color;
        ctx2d.fillRect(sx + pad, sy + pad, TILE - pad * 2, TILE - pad * 2);
        try {
          const half = TILE / 2;
          ctx2d.textAlign = "center";
          ctx2d.textBaseline = "middle";
          ctx2d.fillStyle = "#0b0f16";
          ctx2d.fillText(
            String((e.glyph && String(e.glyph).trim()) ? e.glyph : (e.type ? e.type.charAt(0) : "?")),
            sx + half,
            sy + half
          );
        } catch (_) {}
      }

      // Simple burning marker in Region Map when enemy is on fire (both animals and other enemies)
      try {
        if (e.inFlamesTurns && e.inFlamesTurns > 0) {
          const half = TILE / 2;
          ctx2d.textAlign = "center";
          ctx2d.textBaseline = "middle";
          let fireColor = "#f97316";
          try {
            const pal = (typeof window !== "undefined"
              && window.GameData
              && window.GameData.palette
              && window.GameData.palette.overlays)
              ? window.GameData.palette.overlays
              : null;
            if (pal && pal.fire) fireColor = pal.fire;
          } catch (_) {}
          ctx2d.fillStyle = fireColor;
          ctx2d.globalAlpha = 0.9;
          try {
            ctx2d.font = `${Math.floor(TILE * 0.7)}px JetBrains Mono, monospace`;
          } catch (_) {}
          ctx2d.fillText("✦", sx + half, sy + half);
        }
      } catch (_) {}

      ctx2d.restore();
    }
  } catch (_) {}
}