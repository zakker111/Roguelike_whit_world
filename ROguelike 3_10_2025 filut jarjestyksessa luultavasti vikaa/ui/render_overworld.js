/**
 * RenderOverworld: draws overworld tiles, glyphs from tiles.json, minimap, NPCs, player, and time tint.
 *
 * Caching:
 * - World base offscreen cache keyed by map reference, dimensions, TILE, and tiles.json ref; glyph overlays drawn per-frame.
 * - Minimap uses its own offscreen cache keyed by map reference, tiles.json ref, scale, and player position.
 *
 * Draw order (summary):
 * - Base layer → shoreline banding → coast borders → fog-of-war → POI markers (towns/dungeons/quest) →
 *   biome embellishments → roads/bridges → per-tile glyph overlays → HUD biome/time label → minimap →
 *   player marker → day/night tint → vignette → grid overlay → topmost player outline.
 *
 * Exports (ESM + window.RenderOverworld):
 * - draw(ctx, view)
 */
import * as RenderCore from "./render_core.js";
import * as World from "../world/world.js";
import { getTileDef, getTileDefByKey } from "../data/tile_lookup.js";
import { attachGlobal } from "../utils/global.js";
import { shade as _shade, mix as _mix, rgba as _rgba, parseHex as _parseHex, toHex as _toHex } from "./color_utils.js";

// Modularized helpers
import { drawWorldBase } from "./render/overworld_base_layer.js";
import { fillOverworldFor, glyphOverworldFor, tilesRef, fallbackFillOverworld } from "./render/overworld_tile_cache.js";
import { drawShoreline } from "./render/overworld_shoreline.js";
import { drawCoastOutline } from "./render/overworld_coast_outline.js";
import { drawFog } from "./render/overworld_fog.js";
import { drawPOIs } from "./render/overworld_poi.js";
import { drawBridges } from "./render/overworld_roads_bridges.js";
import { drawGlyphOverlay } from "./render/overworld_glyph_overlay.js";
import { drawBiomeClockLabel } from "./render/overworld_hud.js";
import { drawMinimap } from "./render/overworld_minimap.js";
import { drawPlayerMarker, drawPlayerTopOutline } from "./render/overworld_player.js";
import { drawDayNightTint, drawVignette } from "./render/overworld_tints.js";

// Color helpers moved to ./color_utils.js (imported above)

export function draw(ctx, view) {
  const {
    ctx2d, TILE, COLORS, map, player, camera: camMaybe, TS, tilesetReady,
    cam, tileOffsetX, tileOffsetY, startX, startY, endX, endY
  } = Object.assign({}, view, ctx);

  const WT = World.TILES;
  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;

  // Base layer (offscreen cache + fallback)
  try { drawWorldBase(ctx, view); } catch (_) {}
  // Shoreline banding and foam at top edge
  try { drawShoreline(ctx, view); } catch (_) {}

  // Coastline/shoreline outlines for water/river adjacency
  try { drawCoastOutline(ctx, view); } catch (_) {}

  // Fog of war overlay
  try { drawFog(ctx, view); } catch (_) {}

  // POI markers: towns, dungeons, quests
  try { drawPOIs(ctx, view); } catch (_) {}

  // Subtle biome embellishments to reduce flat look
  try {
    // Stable hash for x,y -> [0,1)
    function h2(x, y) {
      // large primes, clamp to 32-bit, normalize
      const n = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      return (n % 1000) / 1000;
    }
    // derive river shimmer color from RIVER tile
    let riverShimmerColor = "#cfe9ff";
    try {
      const rDef = getTileDef("overworld", WT.RIVER);
      const rFill = (rDef && rDef.colors && rDef.colors.fill) ? rDef.colors.fill : fallbackFillOverworld(WT, WT.RIVER);
      riverShimmerColor = _shade(rFill, 1.35) || riverShimmerColor;
    } catch (_) {}

    // derive biome embellishment colors from tiles.json (with robust fallbacks)
    let forestDotColor = "#173d2b";
    let mountainHighlightColor = "#2a3342";
    let desertSpeckColor = "#b69d78";
    let snowShadeColor = "#94b7ff";
    try {
      const forestFill = fillOverworldFor(WT, WT.FOREST);
      forestDotColor = _shade(forestFill, 0.85) || forestDotColor;
    } catch (_) {}
    try {
      const mountainFill = fillOverworldFor(WT, WT.MOUNTAIN);
      mountainHighlightColor = _shade(mountainFill, 1.06) || mountainHighlightColor;
    } catch (_) {}
    try {
      const desertFill = fillOverworldFor(WT, WT.DESERT);
      desertSpeckColor = _shade(desertFill, 0.92) || desertSpeckColor;
    } catch (_) {}
    try {
      const snowFill = fillOverworldFor(WT, WT.SNOW);
      const waterFillForMix = fillOverworldFor(WT, WT.WATER);
      // blend a bit of water hue into snow to get a subtle cool tint
      snowShadeColor = _mix(snowFill, waterFillForMix, 0.35) || snowShadeColor;
    } catch (_) {}

    for (let y = startY; y <= endY; y++) {
      if (y < 0 || y >= mapRows) continue;
      const row = map[y];
      for (let x = startX; x <= endX; x++) {
        if (x < 0 || x >= mapCols) continue;
        const t = row[x];
        const sx = (x - startX) * TILE - tileOffsetX;
        const sy = (y - startY) * TILE - tileOffsetY;

        // Forest canopy dots
        if (t === WT.FOREST) {
          const r = h2(x, y);
          if (r < 0.75) {
            const dots = 1 + ((r * 3) | 0);
            ctx2d.save();
            ctx2d.globalAlpha = 0.15;
            ctx2d.fillStyle = forestDotColor;
            for (let i = 0; i < dots; i++) {
              const ox = ((h2(x + i, y + i) * (TILE - 6)) | 0) + 3;
              const oy = ((h2(x - i, y - i) * (TILE - 6)) | 0) + 3;
              ctx2d.fillRect(sx + ox, sy + oy, 2, 2);
            }
            ctx2d.restore();
          }
        }

        // Mountain ridge highlight (top-left light)
        if (t === WT.MOUNTAIN) {
          ctx2d.save();
          ctx2d.globalAlpha = 0.20;
          ctx2d.fillStyle = mountainHighlightColor;
          ctx2d.fillRect(sx + 1, sy + 1, TILE - 2, 3);
          ctx2d.fillRect(sx + 1, sy + 1, 3, TILE - 2);
          ctx2d.restore();
        }

        // Desert specks
        if (t === WT.DESERT) {
          const r = h2(x, y);
          if (r > 0.25) {
            ctx2d.save();
            ctx2d.globalAlpha = 0.18;
            ctx2d.fillStyle = desertSpeckColor;
            const ox = ((h2(x + 7, y + 3) * (TILE - 6)) | 0) + 3;
            const oy = ((h2(x + 11, y + 5) * (TILE - 6)) | 0) + 3;
            ctx2d.fillRect(sx + ox, sy + oy, 2, 2);
            const ox2 = ((h2(x + 13, y + 9) * (TILE - 6)) | 0) + 3;
            const oy2 = ((h2(x + 17, y + 1) * (TILE - 6)) | 0) + 3;
            ctx2d.fillRect(sx + ox2, sy + oy2, 1, 1);
            ctx2d.restore();
          }
        }

        // Snow subtle blue shade variation
        if (t === WT.SNOW) {
          ctx2d.save();
          ctx2d.globalAlpha = 0.08;
          ctx2d.fillStyle = snowShadeColor;
          const ox = ((h2(x + 19, y + 23) * (TILE - 6)) | 0) + 3;
          const oy = ((h2(x + 29, y + 31) * (TILE - 6)) | 0) + 3;
          ctx2d.fillRect(sx + ox, sy + oy, 3, 3);
          ctx2d.restore();
        }

        // River shimmer (thin highlight line)
        if (t === WT.RIVER) {
          const r = ((x + y) & 1) === 0;
          ctx2d.save();
          ctx2d.globalAlpha = 0.12;
          ctx2d.fillStyle = riverShimmerColor;
          if (r) {
            ctx2d.fillRect(sx + 4, sy + (TILE / 2) | 0, TILE - 8, 2);
          } else {
            ctx2d.fillRect(sx + (TILE / 2) | 0, sy + 4, 2, TILE - 8);
          }
          ctx2d.restore();
        }
      }
    }
  } catch (_) {}

  // Bridges only (overworld roads removed)
  try { drawBridges(ctx, view); } catch (_) {}

  // Main-map POI icons: towns and dungeons — moved to draw AFTER fog-of-war so markers are visible even on undiscovered tiles

  // Per-frame glyph overlay
  try { drawGlyphOverlay(ctx, view); } catch (_) {}

  // HUD: biome label + clock
  try { drawBiomeClockLabel(ctx, view); } catch (_) {}

  // Minimap (top-right)
  try { drawMinimap(ctx, view); } catch (_) {}

  // Do not draw town NPCs in overworld renderer; towns are drawn by render_town.js
  // (If we later add world-wandering NPCs, render a separate ctx.worldNpcs list instead.)

  // Player marker
  try { drawPlayerMarker(ctx, view); } catch (_) {}

  // Day/night tint
  try { drawDayNightTint(ctx, view); } catch (_) {}

  // Vignette
  try { drawVignette(ctx, view); } catch (_) {}

  // Grid overlay (if enabled)
  RenderCore.drawGridOverlay(view);

  // Topmost player outline
  try { drawPlayerTopOutline(ctx, view); } catch (_) {}

}

 // Back-compat: attach to window via helper
attachGlobal("RenderOverworld", { draw });