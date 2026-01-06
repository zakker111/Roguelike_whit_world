/**
 * Town NPC drawing with LOS/dim and sleeping 'Z' effect.
 */
import * as RenderCore from "../render_core.js";

export function drawNPCs(ctx, view) {
  const { ctx2d, TILE, COLORS, player, startX, startY, endX, endY, tileOffsetX, tileOffsetY } = Object.assign({}, view, ctx);

  if (!Array.isArray(ctx.npcs)) return;
  for (const n of ctx.npcs) {
    if (n.x < startX || n.x > endX || n.y < startY || n.y > endY) continue;

    if (ctx.innUpstairsActive && ctx.tavern && ctx.tavern.building) {
      const b = ctx.tavern.building;
      if (n.x > b.x && n.x < b.x + b.w - 1 && n.y > b.y && n.y < b.y + b.h - 1) {
        continue;
      }
    }

    // In town mode, draw NPCs whenever they are on screen; do not gate by fog-of-war.
    // This keeps things simple and ensures special NPCs (like caravan masters) are always visible.

    const isVisible = !!(ctx.visible[n.y] && ctx.visible[n.y][n.x]);

    let hasLine = true;
    if (isVisible) {
      try {
        if (ctx.los && typeof ctx.los.hasLOS === "function") {
          hasLine = !!ctx.los.hasLOS(ctx, player.x, player.y, n.x, n.y);
        } else if (typeof window !== "undefined" && window.LOS && typeof window.LOS.hasLOS === "function") {
          hasLine = !!window.LOS.hasLOS(ctx, player.x, player.y, n.x, n.y);
        }
      } catch (_) {}
    }

    const screenX = (n.x - startX) * TILE - tileOffsetX;
    const screenY = (n.y - startY) * TILE - tileOffsetY;

    let glyph = "n";
    let color = "#b4f9f8";
    if (n.isPet) {
      if (n.kind === "cat") glyph = "c";
      else if (n.kind === "dog") glyph = "d";
    } else if (n.isSeppo || n.seppo) {
      glyph = "S";
      color = "#f6c177";
    } else if (n.isBandit) {
      // Use the canonical bandit definition from data/entities/enemies.json for glyph/color.
      try {
        const EM = (typeof window !== "undefined" ? window.Enemies : null);
        const td = EM && typeof EM.getTypeDef === "function") ? EM.getTypeDef("bandit") : null;
        glyph = (td && td.glyph) ? td.glyph : "b";
        color = (td && td.color) ? td.color : "#c59d5f";
      } catch (_) {
        glyph = "b";
        color = "#c59d5f";
      }
    } else if (n.isGuard) {
      // Use the same guard/elite-guard visuals as encounter/caravan guards.
      try {
        const EM = (typeof window !== "undefined" ? window.Enemies : null);
        const typeId = (n.guardType || n.type || "guard");
        const td = EM && typeof EM.getTypeDef === "function") ? EM.getTypeDef(typeId) : null;
        glyph = (td && td.glyph) ? td.glyph : "G";
        color = (td && td.color) ? td.color : "#2563eb";
      } catch (_) {
        glyph = "G";
        color = "#2563eb";
      }
    } else if (n._isFollower) {
      // Use follower visuals from data/entities/followers.json when available
      try {
        const GD = (typeof window !== "undefined" ? window.GameData : null);
        const list = GD && Array.isArray(GD.followers) ? GD.followers : null;
        const fid = n._followerId || "guard_follower";
        if (list) {
          const def = list.find(f => f && String(f.id) === String(fid));
          glyph = (def && def.glyph) ? def.glyph : "G";
          color = (def && def.color) ? def.color : "#2563eb";
        } else {
          glyph = "G";
          color = "#2563eb";
        }
      } catch (_) {
        glyph = "G";
        color = "#2563eb";
      }
    } else if (n.isShopkeeper || n._shopRef) {
      try {
        const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
        color = pal && pal.shopkeeper ? pal.shopkeeper : "#ffd166";
      } catch (_) {
        color = "#ffd166";
      }
    }

    const drawDim = (!isVisible || !hasLine);

    // Followers: add a subtle backdrop to distinguish them from generic NPCs.
    if (n._isFollower) {
      ctx2d.save();
      ctx2d.globalAlpha = drawDim ? 0.45 : 0.65;
      ctx2d.fillStyle = color;
      const pad = 4;
      ctx2d.fillRect(screenX + pad, screenY + pad, TILE - pad * 2, TILE - pad * 2);
      ctx2d.restore();
    }

    if (drawDim) {
      ctx2d.save();
      ctx2d.globalAlpha = 0.70;
      RenderCore.drawGlyph(ctx2d, screenX, screenY, glyph, color, TILE);
      ctx2d.restore();
    } else {
      RenderCore.drawGlyph(ctx2d, screenX, screenY, glyph, color, TILE);
    }

    if (n._sleeping) {
      const t = Date.now();
      const phase = Math.floor(t / 600) % 2;
      const zChar = phase ? "Z" : "z";
      const bob = Math.sin(t / 500) * 3;
      const zx = screenX + TILE / 2 + 8;
      const zy = screenY + TILE / 2 - TILE * 0.6 + bob;
      ctx2d.save();
      ctx2d.globalAlpha = drawDim ? 0.55 : 0.9;
      let zColor = "#a3be8c";
      try {
        const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
        if (pal && pal.sleepingZ) zColor = pal.sleepingZ || zColor;
      } catch (_) {}
      ctx2d.fillStyle = zColor;
      ctx2d.fillText(zChar, zx, zy);
      ctx2d.restore();
    }
  }
}