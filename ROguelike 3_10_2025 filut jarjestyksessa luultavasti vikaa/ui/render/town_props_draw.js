/**
 * Town props drawing (ground-level).
 */
import * as RenderCore from "../render_core.js";
import { getTileDefByKey } from "../../data/tile_lookup.js";
import { propColor as _propColor } from "../prop_palette.js";

export function drawTownProps(ctx, view) {
  const { ctx2d, TILE, TILES, COLORS, seen, visible, startX, startY, endX, endY, tileOffsetX, tileOffsetY } = Object.assign({}, view, ctx);

  if (Array.isArray(ctx.townProps)) {
    for (const p of ctx.townProps) {
      if (p.x < startX || p.x > endX || p.y < startY || p.y > endY) continue;

      if (ctx.innUpstairsActive && ctx.tavern && ctx.tavern.building) {
        const b = ctx.tavern.building;
        if (p.x > b.x && p.x < b.x + b.w - 1 && p.y > b.y && p.y < b.y + b.h - 1) {
          continue;
        }
      }

      const wasSeen = !!(seen[p.y] && seen[p.y][p.x]);
      if (!wasSeen) continue;

      const visNow = !!(visible[p.y] && visible[p.y][p.x]);

      const screenX = (p.x - startX) * TILE - tileOffsetX;
      const screenY = (p.y - startY) * TILE - tileOffsetY;

      let glyph = "";
      let color = null;

      try {
        const GD = (typeof window !== "undefined" ? window.GameData : null);
        const arr = GD && GD.props && Array.isArray(GD.props.props) ? GD.props.props : null;
        if (arr) {
          const tId = String(p.type || "").toLowerCase();
          const entry = arr.find(pp => String(pp.id || "").toLowerCase() === tId || String(pp.key || "").toLowerCase() === tId);
          if (entry && typeof entry.glyph === "string") glyph = entry.glyph;
          if (entry && entry.colors && typeof entry.colors.fg === "string") color = entry.colors.fg;
          if (!color && entry && typeof entry.color === "string") color = entry.color;
        }
      } catch (_) {}

      let tdProp = null;
      try {
        const key = String(p.type || "").toUpperCase();
        tdProp = getTileDefByKey("town", key) || getTileDefByKey("dungeon", key) || getTileDefByKey("overworld", key);
        if (tdProp) {
          if (!glyph && Object.prototype.hasOwnProperty.call(tdProp, "glyph")) glyph = tdProp.glyph || glyph;
          if (!color && tdProp.colors && tdProp.colors.fg) color = tdProp.colors.fg || color;
        }
      } catch (_) {}

      try { if (!color) color = _propColor(p.type, null) || color; } catch (_) {}

      if (!glyph || !color) {
        const t = String(p.type || "").toLowerCase();
        if (!glyph) {
          if (t === "well") glyph = "◍";
          else if (t === "lamp") glyph = "†";
          else if (t === "bench") glyph = "=";
          else if (t === "stall") glyph = "▣";
          else if (t === "crate") glyph = "▢";
          else if (t === "barrel") glyph = "◍";
          else if (t === "chest") glyph = "□";
          else if (t === "shelf") glyph = "≡";
          else if (t === "plant") glyph = "*";
          else if (t === "rug") glyph = "░";
          else if (t === "fireplace") glyph = "♨";
          else if (t === "counter") glyph = "▭";
          else if (t === "sign") glyph = "⚑";
          else glyph = (p.name && p.name[0]) ? p.name[0] : "?";
        }
        if (!color) {
          if (t === "well") color = "#9dd8ff";
          else if (t === "lamp") color = "#ffd166";
          else if (t === "bench") color = "#cbd5e1";
          else if (t === "stall") color = "#eab308";
          else if (t === "crate") color = "#cbd5e1";
          else if (t === "barrel") color = "#b5651d";
          else if (t === "chest") color = "#d7ba7d";
          else if (t === "shelf") color = "#cbd5e1";
          else if (t === "plant") color = "#65a30d";
          else if (t === "rug") color = "#b45309";
          else if (t === "fireplace") color = "#ff6d00";
          else if (t === "counter") color = "#d7ba7d";
          else if (t === "sign") color = "#d7ba7d";
          else color = "#cbd5e1";
        }
      }

      let drawDim = !visNow;
      if (visNow) {
        let hasLine = true;
        try {
          if (ctx.los && typeof ctx.los.hasLOS === "function") {
            hasLine = !!ctx.los.hasLOS(ctx, ctx.player.x, ctx.player.y, p.x, p.y);
          } else if (typeof window !== "undefined" && window.LOS && typeof window.LOS.hasLOS === "function") {
            hasLine = !!window.LOS.hasLOS(ctx, ctx.player.x, ctx.player.y, p.x, p.y);
          }
        } catch (_) {}
        if (!hasLine) drawDim = true;
      }

      try { if (typeof window !== "undefined" && window.PropsValidation && typeof window.PropsValidation.recordProp === "function") { window.PropsValidation.recordProp({ mode: "town", type: p.type, x: p.x, y: p.y }); } } catch (_) {}

      if (drawDim) {
        ctx2d.save();
        ctx2d.globalAlpha = 0.65;
        RenderCore.drawGlyph(ctx2d, screenX, screenY, glyph, color, TILE);
        ctx2d.restore();
      } else {
        RenderCore.drawGlyph(ctx2d, screenX, screenY, glyph, color, TILE);
      }
    }
  }
}