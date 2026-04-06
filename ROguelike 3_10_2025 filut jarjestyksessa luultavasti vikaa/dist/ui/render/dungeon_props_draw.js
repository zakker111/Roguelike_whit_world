/**
 * Dungeon and encounter props drawing.
 */
import * as RenderCore from "../render_core.js";
import { shade as _shade, rgba as _rgba } from "../color_utils.js";
import { propColor as _propColor } from "../prop_palette.js";
import { getTileDefByKey } from "../../data/tile_lookup.js";

export function drawEncounterProps(ctx, view) {
  const {
    ctx2d, TILE, COLORS, tilesetReady, TS,
    map, seen, visible, startX, startY, endX, endY, tileOffsetX, tileOffsetY
  } = Object.assign({}, view, ctx);

  const props = Array.isArray(ctx.encounterProps) ? ctx.encounterProps : [];
  if (!props.length) return;

  for (const p of props) {
    const px = p.x | 0, py = p.y | 0;
    if (px < startX || px > endX || py < startY || py > endY) continue;
    const everSeen = !!(seen[py] && seen[py][px]);
    if (!everSeen) continue;
    const visNow = !!(visible[py] && visible[py][px]);
    const sx = (px - startX) * TILE - tileOffsetX;
    const sy = (py - startY) * TILE - tileOffsetY;

    try { if (typeof window !== "undefined" && window.PropsValidation && typeof window.PropsValidation.recordProp === "function") { window.PropsValidation.recordProp({ mode: (ctx.mode || "dungeon"), type: p.type, x: p.x, y: p.y }); } } catch (_) {}

    if (p.type === "campfire") {
      let glyph = "♨";
      let color = null;
      try {
        const td = getTileDefByKey("town", "FIREPLACE");
        if (td) {
          if (Object.prototype.hasOwnProperty.call(td, "glyph")) glyph = td.glyph || glyph;
          if (td.colors && td.colors.fg) color = td.colors.fg || color;
        }
      } catch (_) {}
      try { if (!color) color = _propColor("fireplace", null); } catch (_) {}
      if (!color) color = "#ff6d00";

      try {
        const phase = (ctx.time && ctx.time.phase) || "day";
        const phaseMult = (phase === "night") ? 1.0 : (phase === "dusk" || phase === "dawn") ? 0.7 : 0.45;
        const cx = sx + TILE / 2;
        const cy = sy + TILE / 2;
        const r = TILE * (2.0 * phaseMult + 1.2);

        let a0 = 0.55, a1 = 0.30, a2 = 0.0;
        try {
          const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
          if (pal) {
            const v0 = Number(pal.glowStartA), v1 = Number(pal.glowMidA), v2 = Number(pal.glowEndA);
            if (Number.isFinite(v0)) a0 = Math.max(0, Math.min(1, v0));
            if (Number.isFinite(v1)) a1 = Math.max(0, Math.min(1, v1));
            if (Number.isFinite(v2)) a2 = Math.max(0, Math.min(1, v2));
          }
        } catch (_) {}

        const grad = ctx2d.createRadialGradient(cx, cy, Math.max(2, TILE * 0.10), cx, cy, r);
        grad.addColorStop(0, _rgba(color, a0 * phaseMult));
        grad.addColorStop(0.4, _rgba(color, a1 * phaseMult));
        grad.addColorStop(1, _rgba(color, a2));
        ctx2d.save();
        ctx2d.globalCompositeOperation = "lighter";
        ctx2d.fillStyle = grad;
        ctx2d.beginPath();
        ctx2d.arc(cx, cy, r, 0, Math.PI * 2);
        ctx2d.fill();
        ctx2d.restore();
      } catch (_) {}

      if (!tilesetReady || !TS || typeof TS.draw !== "function" || !TS.draw(ctx2d, "campfire", sx, sy, TILE)) {
        if (!visNow) {
          ctx2d.save();
          ctx2d.globalAlpha = 0.65;
          RenderCore.drawGlyph(ctx2d, sx, sy, glyph, color, TILE);
          ctx2d.restore();
        } else {
          RenderCore.drawGlyph(ctx2d, sx, sy, glyph, color, TILE);
        }
      }
    } else if (p.type === "crate" || p.type === "barrel" || p.type === "bench") {
      let key = p.type;
      let drawn = false;
      if (tilesetReady && TS && typeof TS.draw === "function") {
        drawn = TS.draw(ctx2d, key, sx, sy, TILE);
      }
      if (!drawn) {
        let glyph = "";
        let color = COLORS.corpse || "#c3cad9";
        try {
          const GD = (typeof window !== "undefined" ? window.GameData : null);
          const arr = GD && GD.props && Array.isArray(GD.props.props) ? GD.props.props : null;
          if (arr) {
            const tId = String(p.type || "").toLowerCase();
            const entry = arr.find(pp => String(pp.id || "").toLowerCase() === tId || String(pp.key || "").toLowerCase() === tId);
            if (entry) {
              if (typeof entry.glyph === "string") glyph = entry.glyph;
              if (entry.colors && typeof entry.colors.fg === "string") color = entry.colors.fg || color;
              if (!color && typeof entry.color === "string") color = entry.color;
            }
          }
        } catch (_) {}
        if (!glyph || !color) {
          try {
            const jsonKey = (p.type === "crate") ? "CRATE" : (p.type === "barrel") ? "BARREL" : "BENCH";
            const td = getTileDefByKey("dungeon", jsonKey) || getTileDefByKey("town", jsonKey);
            if (td) {
              if (!glyph && Object.prototype.hasOwnProperty.call(td, "glyph")) glyph = td.glyph || glyph;
              if (!color && td.colors && td.colors.fg) color = td.colors.fg || color;
            }
          } catch (_) {}
        }
        try { if (!color) color = _propColor(p.type, null) || color; } catch (_) {}
        if (!glyph) {
          if (p.type === "crate") glyph = "□";
          else if (p.type === "barrel") glyph = "◍";
          else glyph = "≡";
        }
        if (p.type === "barrel" && (!color || color === (COLORS.corpse || "#c3cad9"))) {
          color = "#b5651d";
        }
        if (!visNow) {
          ctx2d.save();
          ctx2d.globalAlpha = 0.65;
          RenderCore.drawGlyph(ctx2d, sx, sy, glyph, color, TILE);
          ctx2d.restore();
        } else {
          RenderCore.drawGlyph(ctx2d, sx, sy, glyph, color, TILE);
        }
      }
    } else if (p.type === "merchant") {
      let drawn = false;
      if (tilesetReady && TS && typeof TS.draw === "function") {
        drawn = TS.draw(ctx2d, "shopkeeper", sx, sy, TILE);
      }
      if (!drawn) {
        const glyph = "S";
        const color = "#eab308";
        if (!visNow) {
          ctx2d.save();
          ctx2d.globalAlpha = 0.85;
          RenderCore.drawGlyph(ctx2d, sx, sy, glyph, color, TILE);
          ctx2d.restore();
        } else {
          RenderCore.drawGlyph(ctx2d, sx, sy, glyph, color, TILE);
        }
      }
    } else if (p.type === "tree") {
      // Optional explicit tree prop support if generators add them
      let glyph = "♣";
      let color = "#3fa650";
      try {
        const td = getTileDefByKey("region", "TREE") || getTileDefByKey("town", "TREE");
        if (td) {
          if (Object.prototype.hasOwnProperty.call(td, "glyph")) glyph = td.glyph || glyph;
          if (td.colors && td.colors.fg) color = td.colors.fg || color;
        }
      } catch (_) {}
      try { color = _propColor("tree", color) || color; } catch (_) {}
      if (!visNow) {
        ctx2d.save();
        ctx2d.globalAlpha = 0.70;
        RenderCore.drawGlyph(ctx2d, sx, sy, glyph, color, TILE);
        ctx2d.restore();
      } else {
        RenderCore.drawGlyph(ctx2d, sx, sy, glyph, color, TILE);
      }
    } else if (p.type === "captive") {
      let glyph = "☺";
      let color = "#eab308";
      try {
        const td = getTileDefByKey("town", "NPC") || getTileDefByKey("town", "VILLAGER") || getTileDefByKey("dungeon", "PRISONER");
        if (td) {
          if (Object.prototype.hasOwnProperty.call(td, "glyph")) glyph = td.glyph || glyph;
          if (td.colors && td.colors.fg) color = td.colors.fg || color;
        }
      } catch (_) {}
      if (!visNow) {
        ctx2d.save();
        ctx2d.globalAlpha = 0.75;
        RenderCore.drawGlyph(ctx2d, sx, sy, glyph, color, TILE);
        ctx2d.restore();
      } else {
        RenderCore.drawGlyph(ctx2d, sx, sy, glyph, color, TILE);
      }
    }
  }
}

export function drawDungeonProps(ctx, view) {
  const {
    ctx2d, TILE, COLORS,
    map, seen, visible, startX, startY, endX, endY, tileOffsetX, tileOffsetY
  } = Object.assign({}, view, ctx);

  const props = Array.isArray(ctx.dungeonProps) ? ctx.dungeonProps : [];
  if (!props.length) return;

  for (const p of props) {
    const px = p.x | 0, py = p.y | 0;
    if (px < startX || px > endX || py < startY || py > endY) continue;
    const everSeen = !!(seen[py] && seen[py][px]);
    if (!everSeen) continue;
    const visNow = !!(visible[py] && visible[py][px]);
    const sx = (px - startX) * TILE - tileOffsetX;
    const sy = (py - startY) * TILE - tileOffsetY;

    let glyph = "";
    let color = "#ffd166";
    try {
      const GD = (typeof window !== "undefined" ? window.GameData : null);
      const arr = GD && GD.props && Array.isArray(GD.props.props) ? GD.props.props : null;
      if (arr) {
        const tId = String(p.type || "").toLowerCase();
        const entry = arr.find(pp => String(pp.id || "").toLowerCase() === tId || String(pp.key || "").toLowerCase() === tId);
        if (entry) {
          if (typeof entry.glyph === "string") glyph = entry.glyph;
          if (entry.colors && typeof entry.colors.fg === "string") color = entry.colors.fg || color;
          if (!color && typeof entry.color === "string") color = entry.color;
        }
      }
    } catch (_) {}
    try { if (!color) color = _propColor(p.type, null) || color; } catch (_) {}
    if (!glyph) glyph = "†";

    if (!visNow) {
      ctx2d.save();
      ctx2d.globalAlpha = 0.70;
      RenderCore.drawGlyph(ctx2d, sx, sy, glyph, color, TILE);
      ctx2d.restore();
    } else {
      RenderCore.drawGlyph(ctx2d, sx, sy, glyph, color, TILE);
    }
  }
}