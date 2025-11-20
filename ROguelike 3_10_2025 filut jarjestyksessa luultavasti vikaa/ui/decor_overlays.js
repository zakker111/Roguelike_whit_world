/**
 * DecorOverlays: biome-driven dungeon overlays and encounter exit highlights.
 * Exports:
 * - drawBiomeDecor(ctx, view)
 * - drawEncounterExitOverlay(ctx, view)
 * - drawEncounterHUD(ctx, view)
 */
import * as RenderCore from "./render_core.js";
import { getTileDef, getTileDefByKey } from "../data/tile_lookup.js";

function fgForBiome(ctx, key, fallback) {
  try {
    const td = getTileDefByKey("overworld", key) || getTileDefByKey("region", key);
    if (td && td.colors && td.colors.fg) return td.colors.fg;
  } catch (_) {}
  return fallback;
}

/**
 * Draw sparse biome-specific glyphs on dungeon tiles to give encounters flavor.
 * Mirrors previous logic from render_dungeon.js.
 */
export function drawBiomeDecor(ctx, view) {
  const { ctx2d, TILE, TILES, map, startX, startY, endX, endY } = Object.assign({}, view, ctx);
  if (!ctx.encounterBiome) return;

  const biome = String(ctx.encounterBiome).toUpperCase();
  const fgForest = fgForBiome(ctx, "FOREST", "#3fa650");
  const fgGrass  = fgForBiome(ctx, "GRASS",  "#84cc16");
  const fgDesert = fgForBiome(ctx, "DESERT", "#d7ba7d");
  const fgBeach  = fgForBiome(ctx, "BEACH",  "#d7ba7d");
  const fgSnow   = fgForBiome(ctx, "SNOW",   "#e5e7eb");
  const fgSwamp  = fgForBiome(ctx, "SWAMP",  "#6fbf73");

  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;

  for (let y = startY; y <= endY; y++) {
    const yIn = y >= 0 && y < mapRows;
    const rowMap = yIn ? map[y] : null;
    for (let x = startX; x <= endX; x++) {
      if (!yIn || x < 0 || x >= mapCols) continue;
      const type = rowMap[x];
      const sx = (x - startX) * TILE - view.tileOffsetX;
      const sy = (y - startY) * TILE - view.tileOffsetY;

      // Deterministic scatter using hashed tile coordinate
      const hash = ((x * 73856093) ^ (y * 19349663)) >>> 0;

      // Forest: decorate walls as tree-tops; floors get sparse leaf speckles
      if (biome === "FOREST") {
        if (type === TILES.WALL) {
          let treeGlyph = "♣";
          let treeColor = fgForest;
          try {
            const t = getTileDefByKey("region", "TREE") || getTileDefByKey("town", "TREE");
            if (t) {
              if (Object.prototype.hasOwnProperty.call(t, "glyph")) treeGlyph = t.glyph || treeGlyph;
              if (t.colors && t.colors.fg) treeColor = t.colors.fg || treeColor;
            }
          } catch (_) {}
          RenderCore.drawGlyph(ctx2d, sx, sy, treeGlyph, treeColor, TILE);
        } else if (type === TILES.FLOOR && (hash & 7) === 0) {
          RenderCore.drawGlyph(ctx2d, sx, sy, "·", fgForest, TILE);
        }
      }

      // Grass plains: light green speckles on floors
      if (biome === "GRASS" && type === TILES.FLOOR && (hash % 9) === 0) {
        RenderCore.drawGlyph(ctx2d, sx, sy, "·", fgGrass, TILE);
      }

      // Desert: sand dots
      if (biome === "DESERT" && type === TILES.FLOOR && (hash % 11) === 0) {
        RenderCore.drawGlyph(ctx2d, sx, sy, "·", fgDesert, TILE);
      }

      // Beach: lighter sand dots, a bit denser
      if (biome === "BEACH" && type === TILES.FLOOR && (hash % 8) === 0) {
        RenderCore.drawGlyph(ctx2d, sx, sy, "·", fgBeach, TILE);
      }

      // Snow: sparse snow speckles (existing behavior), slightly denser to be visible
      if (biome === "SNOW" && type === TILES.FLOOR && (hash & 7) <= 1) {
        RenderCore.drawGlyph(ctx2d, sx, sy, "·", fgSnow, TILE);
      }

      // Swamp: occasional ripples
      if (biome === "SWAMP" && type === TILES.FLOOR && (hash % 13) === 0) {
        RenderCore.drawGlyph(ctx2d, sx, sy, "≈", fgSwamp, TILE);
      }
    }
  }
}

/**
 * Draw tinted overlays for encounter exits (STAIRS tiles), consistent with Region Map edges.
 */
export function drawEncounterExitOverlay(ctx, view) {
  if (ctx.mode !== "encounter") return;
  const { ctx2d, TILE, TILES, map, startX, startY, endX, endY, tileOffsetX, tileOffsetY } = Object.assign({}, view, ctx);

  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;

  try {
    ctx2d.save();
    // Derive exit overlay color from dungeon STAIRS tile definition if available
    let color = "#d7ba7d";
    try {
      const td = getTileDefByKey("dungeon", "STAIRS") || getTileDef("dungeon", (TILES && TILES.STAIRS));
      if (td && td.colors && td.colors.fg) color = td.colors.fg || color;
    } catch (_) {}
    for (let y = startY; y <= endY; y++) {
      const yIn = y >= 0 && y < mapRows;
      const rowMap = yIn ? map[y] : null;
      if (!yIn) continue;
      for (let x = startX; x <= endX; x++) {
        if (x < 0 || x >= mapCols) continue;
        if (!rowMap || rowMap[x] !== TILES.STAIRS) continue;
        const sx = (x - startX) * TILE - tileOffsetX;
        const sy = (y - startY) * TILE - tileOffsetY;
        // Fill with lower alpha, then stroke with higher alpha using the same base color
        const prevAlpha = ctx2d.globalAlpha;
        // Palette-driven alpha overrides (optional)
        let fillA = 0.28, strokeA = 0.80;
        try {
          const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
          if (pal) {
            const aFill = (pal.exitEncounterFillA != null ? pal.exitEncounterFillA : pal.exitOverlayFillA);
            const aStroke = (pal.exitEncounterStrokeA != null ? pal.exitEncounterStrokeA : pal.exitOverlayStrokeA);
            const f = Number(aFill), s = Number(aStroke);
            if (Number.isFinite(f)) fillA = Math.max(0, Math.min(1, f));
            if (Number.isFinite(s)) strokeA = Math.max(0, Math.min(1, s));
          }
        } catch (_) {}
        ctx2d.globalAlpha = fillA;
        ctx2d.fillStyle = color;
        ctx2d.fillRect(sx, sy, TILE, TILE);
        ctx2d.globalAlpha = strokeA;
        ctx2d.strokeStyle = color;
        ctx2d.lineWidth = 2;
        ctx2d.strokeRect(sx + 0.5, sy + 0.5, TILE - 1, TILE - 1);
        ctx2d.globalAlpha = prevAlpha;
      }
    }
    ctx2d.restore();
  } catch (_) {}
}

export function drawEncounterHUD(ctx, view) {
  if (ctx.mode !== "encounter") return;
  if (typeof window !== "undefined" && window.SHOW_ENCOUNTER_HUD === false) return;
  const { ctx2d } = Object.assign({}, view, ctx);
  try {
    const prevAlign = ctx2d.textAlign;
    const prevBaseline = ctx2d.textBaseline;
    ctx2d.textAlign = "left";
    ctx2d.textBaseline = "top";

    const biome = String(ctx.encounterBiome || "").toUpperCase();
    const clock = (ctx.time && ctx.time.hhmm) ? `   |   Time: ${ctx.time.hhmm}` : "";
    const titleText = `Encounter (${biome || "UNKNOWN"})${clock}`;
    const hintText = "Eliminate hostiles or reach an exit (>).";

    const bx = 8, by = 8;
    const baseW = Math.max(260, 16 * (Math.max(titleText.length, hintText.length) / 2));
    const bw = baseW | 0;
    const bh = 48;

    let panelBg = "rgba(13,16,24,0.80)";
    let panelBorder = "rgba(122,162,247,0.35)";
    try {
      const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
      if (pal) {
        panelBg = pal.panelBg || panelBg;
        panelBorder = pal.panelBorder || panelBorder;
      }
    } catch (_) {}

    ctx2d.fillStyle = panelBg;
    try {
      const r = 6;
      ctx2d.beginPath();
      ctx2d.moveTo(bx + r, by);
      ctx2d.lineTo(bx + bw - r, by);
      ctx2d.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
      ctx2d.lineTo(bx + bw, by + bh - r);
      ctx2d.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
      ctx2d.lineTo(bx + r, by + bh);
      ctx2d.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
      ctx2d.lineTo(bx, by + r);
      ctx2d.quadraticCurveTo(bx, by, bx + r, by);
      ctx2d.closePath();
      ctx2d.fill();
      ctx2d.strokeStyle = panelBorder;
      ctx2d.lineWidth = 1;
      ctx2d.stroke();
    } catch (_) {
      ctx2d.fillRect(bx, by, bw, bh);
      ctx2d.strokeStyle = panelBorder;
      ctx2d.lineWidth = 1;
      ctx2d.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    }

    ctx2d.fillStyle = "#cbd5e1";
    ctx2d.fillText(titleText, bx + 10, by + 8);
    ctx2d.fillStyle = "#a1a1aa";
    ctx2d.fillText(hintText, bx + 10, by + 26);

    ctx2d.textAlign = prevAlign;
    ctx2d.textBaseline = prevBaseline;
  } catch (_) {}
}

// Draw tinted overlays for dungeon exits (STAIRS tiles) as a subtle highlight (glyph remains visible)
export function drawDungeonExitOverlay(ctx, view) {
  if (ctx.mode !== "dungeon") return;
  const { ctx2d, TILE, TILES, map, startX, startY, endX, endY, tileOffsetX, tileOffsetY } = Object.assign({}, view, ctx);

  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;

  try {
    ctx2d.save();
    let color = "#d7ba7d";
    try {
      const td = getTileDefByKey("dungeon", "STAIRS") || getTileDef("dungeon", (TILES && TILES.STAIRS));
      if (td && td.colors && td.colors.fg) color = td.colors.fg || color;
    } catch (_) {}
    for (let y = startY; y <= endY; y++) {
      const yIn = y >= 0 && y < mapRows;
      const rowMap = yIn ? map[y] : null;
      if (!yIn) continue;
      for (let x = startX; x <= endX; x++) {
        if (x < 0 || x >= mapCols) continue;
        if (!rowMap || rowMap[x] !== TILES.STAIRS) continue;
        const sx = (x - startX) * TILE - tileOffsetX;
        const sy = (y - startY) * TILE - tileOffsetY;
        const prevAlpha = ctx2d.globalAlpha;
        // Palette-driven alpha overrides (optional)
        let fillA = 0.22, strokeA = 0.70;
        try {
          const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
          if (pal) {
            const aFill = (pal.exitDungeonFillA != null ? pal.exitDungeonFillA : pal.exitOverlayFillA);
            const aStroke = (pal.exitDungeonStrokeA != null ? pal.exitDungeonStrokeA : pal.exitOverlayStrokeA);
            const f = Number(aFill), s = Number(aStroke);
            if (Number.isFinite(f)) fillA = Math.max(0, Math.min(1, f));
            if (Number.isFinite(s)) strokeA = Math.max(0, Math.min(1, s));
          }
        } catch (_) {}
        ctx2d.globalAlpha = fillA;
        ctx2d.fillStyle = color;
        ctx2d.fillRect(sx, sy, TILE, TILE);
        ctx2d.globalAlpha = strokeA;
        ctx2d.strokeStyle = color;
        ctx2d.lineWidth = 2;
        ctx2d.strokeRect(sx + 0.5, sy + 0.5, TILE - 1, TILE - 1);
        ctx2d.globalAlpha = prevAlpha;
      }
    }
    ctx2d.restore();
  } catch (_) {}
}

// Back-compat
import { attachGlobal } from "../utils/global.js";
attachGlobal("DecorOverlays", { drawBiomeDecor, drawEncounterExitOverlay, drawDungeonExitOverlay, drawEncounterHUD });