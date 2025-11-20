/**
 * Town inn upstairs overlay: tiles and props.
 */
import * as RenderCore from "../render_core.js";
import { getTileDef } from "../../data/tile_lookup.js";
import { fillTownFor } from "./town_tile_cache.js";
import { propColor as _propColor } from "../prop_palette.js";
import { getTileDefByKey } from "../../data/tile_lookup.js";

export function drawInnUpstairsTiles(ctx, view) {
  const { ctx2d, TILE, TILES, COLORS, map, startX, startY, endX, endY, tileOffsetX, tileOffsetY } = Object.assign({}, view, ctx);
  try {
    const up = ctx.innUpstairs;
    const tav = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
    if (!ctx.innUpstairsActive || !up || !tav) return;

    const x0 = up.offset ? up.offset.x : (tav.x + 1);
    const y0 = up.offset ? up.offset.y : (tav.y + 1);
    const w = up.w | 0;
    const h = up.h | 0;
    const x1 = x0 + w - 1;
    const y1 = y0 + h - 1;

    const yyStartFill = Math.max(startY, y0);
    const yyEndFill = Math.min(endY, y1);
    const xxStartFill = Math.max(startX, x0);
    const xxEndFill = Math.min(endX, x1);
    const floorFill = fillTownFor(TILES, TILES.FLOOR, COLORS);
    for (let y = yyStartFill; y <= yyEndFill; y++) {
      for (let x = xxStartFill; x <= xxEndFill; x++) {
        const screenX = (x - startX) * TILE - tileOffsetX;
        const screenY = (y - startY) * TILE - tileOffsetY;
        ctx2d.fillStyle = floorFill;
        ctx2d.fillRect(screenX, screenY, TILE, TILE);
      }
    }

    const yyStart = yyStartFill;
    const yyEnd = yyEndFill;
    const xxStart = xxStartFill;
    const xxEnd = xxEndFill;

    for (let y = yyStart; y <= yyEnd; y++) {
      const ly = y - y0;
      const rowUp = (up.tiles && up.tiles[ly]) ? up.tiles[ly] : null;
      if (!rowUp) continue;
      for (let x = xxStart; x <= xxEnd; x++) {
        const lx = x - x0;
        if (lx < 0 || ly < 0 || lx >= w || ly >= h) continue;
        const type = rowUp[lx];
        const screenX = (x - startX) * TILE - tileOffsetX;
        const screenY = (y - startY) * TILE - tileOffsetY;
        const fill = fillTownFor(TILES, type, COLORS);
        ctx2d.fillStyle = fill;
        ctx2d.fillRect(screenX, screenY, TILE, TILE);
        if (type === TILES.STAIRS) {
          let g = ">";
          let c = "#d7ba7d";
          try {
            const tdSt = getTileDef("town", TILES.STAIRS) || getTileDef("dungeon", TILES.STAIRS);
            if (tdSt) {
              if (Object.prototype.hasOwnProperty.call(tdSt, "glyph")) g = tdSt.glyph || g;
              if (tdSt.colors && tdSt.colors.fg) c = tdSt.colors.fg || c;
            }
          } catch (_) {}
          RenderCore.drawGlyph(ctx2d, screenX, screenY, g, c, TILE);
        }
      }
    }
  } catch (_) {}
}

export function drawInnUpstairsProps(ctx, view) {
  const { ctx2d, TILE, TILES, COLORS, seen, visible, startX, startY, endX, endY, tileOffsetX, tileOffsetY } = Object.assign({}, view, ctx);
  try {
    if (!ctx.innUpstairsActive || !ctx.innUpstairs || !Array.isArray(ctx.innUpstairs.props)) return;
    const props = ctx.innUpstairs.props;
    for (const p of props) {
      if (p.x < startX || p.x > endX || p.y < startY || p.y > endY) continue;
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
          if (t === "crate") glyph = "▢";
          else if (t === "barrel") glyph = "◍";
          else if (t === "chest") glyph = "□";
          else if (t === "shelf") glyph = "≡";
          else if (t === "plant") glyph = "*";
          else if (t === "rug") glyph = "░";
          else if (t === "bed") glyph = "u";
          else if (t === "table") glyph = "⊏";
          else if (t === "chair") glyph = "n";
          else if (t === "counter") glyph = "▭";
          else if (t === "sign") glyph = "⚑";
          else glyph = (p.name && p.name[0]) ? p.name[0] : "?";
        }
        if (!color) {
          if (t === "crate") color = "#cbd5e1";
          else if (t === "barrel") color = "#b5651d";
          else if (t === "chest") color = "#d7ba7d";
          else if (t === "shelf") color = "#cbd5e1";
          else if (t === "plant") color = "#65a30d";
          else if (t === "rug") color = "#b45309";
          else if (t === "bed") color = "#cbd5e1";
          else if (t === "table") color = "#cbd5e1";
          else if (t === "chair") color = "#cbd5e1";
          else if (t === "counter") color = "#d7ba7d";
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

      if (drawDim) {
        ctx2d.save();
        ctx2d.globalAlpha = 0.65;
        RenderCore.drawGlyph(ctx2d, screenX, screenY, glyph, color, TILE);
        ctx2d.restore();
      } else {
        RenderCore.drawGlyph(ctx2d, screenX, screenY, glyph, color, TILE);
      }
    }
  } catch (_) {}
}