/**
 * RenderTown: draws town map tiles, shops, props, NPCs, player, and overlays.
 *
 * Notes:
 * - Outdoor ground tint is biome-driven; applied to FLOOR outdoors and ROAD tiles outside buildings.
 * - Inn upstairs overlay hides ground-level props inside the inn footprint and draws upstairs tiles/props over the hall.
 * - Shop markers: flag glyph at shop doors once seen; suppressed when an interior sign prop exists.
 *
 * Exports (ESM + window.RenderTown):
 * - draw(ctx, view)
 */
import * as RenderCore from "./render_core.js";
import { getTileDef, getTileDefByKey } from "../data/tile_lookup.js";
import { attachGlobal } from "../utils/global.js";
import { propColor as _propColor } from "./prop_palette.js";

// Modularized helpers
import { drawTownBase } from "./render/town_base_layer.js";
import { fillTownFor, glyphTownFor, tilesRef, fallbackFillTown } from "./render/town_tile_cache.js";
import { drawTownGlyphOverlay, drawStairsGlyphTop } from "./render/town_glyph_overlay.js";
import { drawInnUpstairsTiles, drawInnUpstairsProps } from "./render/town_inn_upstairs_overlay.js";
import { drawTownProps as drawTownPropsLayer } from "./render/town_props_draw.js";
import { drawShopMarkers as drawShopMarkersLayer } from "./render/town_shop_markers.js";
import { drawNPCs } from "./render/town_npc_draw.js";
import { drawGateOverlay } from "./render/town_gate_overlay.js";
import { drawTownDayNightTint } from "./render/town_tints.js";
import { drawTownDebugOverlay } from "./render/town_debug_overlay.js";
import { drawTownPaths } from "./render/town_paths.js";
import { drawTownHomePaths } from "./render/town_home_paths.js";
import { drawTownRoutePaths } from "./render/town_route_paths.js";
import { drawLampGlow } from "./render/lamp_glow.js";


export function draw(ctx, view) {
  const {
    ctx2d, TILE, COLORS, TILES, map, seen, visible, player, shops,
    cam, tileOffsetX, tileOffsetY, startX, startY, endX, endY
  } = Object.assign({}, view, ctx);

  
  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;

  

  // Helpers for biome-based outdoor ground tint
  function ensureTownBiome(ctx) {
    try {
      // If TownState or Town generation already set a biome, trust it
      if (ctx.townBiome) return;

      const world = ctx.world || {};
      const WMOD = (typeof window !== "undefined" ? window.World : null);
      const WT = WMOD && WMOD.TILES ? WMOD.TILES : null;

      // Absolute world coords for this town: prefer persisted worldReturnPos, else derive from window origin + local player pos.
      const hasWRP = !!(ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number" && typeof ctx.worldReturnPos.y === "number");
      let wx, wy;
      if (hasWRP) {
        wx = ctx.worldReturnPos.x | 0;
        wy = ctx.worldReturnPos.y | 0;
      } else {
        const ox = world.originX | 0, oy = world.originY | 0;
        wx = (ox + (ctx.player ? (ctx.player.x | 0) : 0)) | 0;
        wy = (oy + (ctx.player ? (ctx.player.y | 0) : 0)) | 0;
      }

      // Use persisted biome if available
      try {
        const rec = (ctx.world && Array.isArray(ctx.world.towns)) ? ctx.world.towns.find(t => t && t.x === wx && t.y === wy) : null;
        if (rec && rec.biome) { ctx.townBiome = rec.biome; return; }
      } catch (_) {}

      // Helper: get tile at absolute world coords (prefer current window; fallback to generator)
      function worldTileAtAbs(ax, ay) {
        const wmap = world.map || null;
        const ox = world.originX | 0, oy = world.originY | 0;
        const lx = (ax - ox) | 0, ly = (ay - oy) | 0;
        if (Array.isArray(wmap) && ly >= 0 && lx >= 0 && ly < wmap.length && lx < (wmap[0] ? wmap[0].length : 0)) {
          return wmap[ly][lx];
        }
        if (world.gen && typeof world.gen.tileAt === "function") return world.gen.tileAt(ax, ay);
        return null;
      }

      // Sample neighborhood around town (skip POIs) to infer biome
      let counts = { DESERT:0, SNOW:0, BEACH:0, SWAMP:0, FOREST:0, GRASS:0 };
      function bump(tile) {
        if (!WT) return;
        if (tile === WT.DESERT) counts.DESERT++;
        else if (tile === WT.SNOW) counts.SNOW++;
        else if (tile === WT.BEACH) counts.BEACH++;
        else if (tile === WT.SWAMP) counts.SWAMP++;
        else if (tile === WT.FOREST) counts.FOREST++;
        else if (tile === WT.GRASS) counts.GRASS++;
      }
      const MAX_R = 6;
      for (let r = 1; r <= MAX_R; r++) {
        let any = false;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const t = worldTileAtAbs(wx + dx, wy + dy);
            if (t == null) continue;
            if (WT && (t === WT.TOWN || t === WT.DUNGEON || t === WT.RUINS)) continue;
            bump(t);
            any = true;
          }
        }
        const total = counts.DESERT + counts.SNOW + counts.BEACH + counts.SWAMP + counts.FOREST + counts.GRASS;
        if (any && total > 0) break;
      }
      const order = ["FOREST","GRASS","DESERT","BEACH","SNOW","SWAMP"];
      let best = "GRASS", bestV = -1;
      for (const k of order) { const v = counts[k] | 0; if (v > bestV) { bestV = v; best = k; } }
      ctx.townBiome = best || "GRASS";

      // Persist for future visits
      try {
        const rec = (ctx.world && Array.isArray(ctx.world.towns)) ? ctx.world.towns.find(t => t && t.x === wx && t.y === wy) : null;
        if (rec && typeof rec === "object") rec.biome = ctx.townBiome;
      } catch (_) {}
    } catch (_) { /* leave ctx.townBiome as-is */ }
  }
  function townBiomeFill(ctx) {
    try {
      const GD = (typeof window !== "undefined" ? window.GameData : null);
      const pal = GD && GD.palette && GD.palette.townBiome ? GD.palette.townBiome : null;
      if (!pal) return null;
      const k = String(ctx.townBiome || "").toUpperCase();
      return pal[k] || null;
    } catch (_) { return null; }
  }
  // Palette/tint readiness and fallbacks
  function paletteTownRef() {
    try {
      const GD = (typeof window !== "undefined" ? window.GameData : null);
      return GD && GD.palette && GD.palette.townBiome ? GD.palette.townBiome : null;
    } catch (_) { return null; }
  }
  function tintReady(ctx) {
    try {
      const pal = paletteTownRef();
      if (!pal) return false;
      const k = String(ctx.townBiome || "").toUpperCase();
      return !!pal[k];
    } catch (_) { return false; }
  }
  function resolvedTownBiomeFill(ctx) {
    const c = townBiomeFill(ctx);
    if (c) return c;
    // Stable in-code fallback hues per biome key
    const FALLBACK = {
      FOREST: "#1f3d2a",
      GRASS:  "#2b5d39",
      DESERT: "#a58c63",
      BEACH:  "#d9cfad",
      SNOW:   "#d7dee9",
      SWAMP:  "#364738"
    };
    const k = String(ctx.townBiome || "GRASS").toUpperCase();
    return FALLBACK[k] || FALLBACK.GRASS;
  }
  // Building footprint test, shared across passes
  function insideAnyBuildingAt(ctx, x, y) {
    try {
      const tbs = Array.isArray(ctx.townBuildings) ? ctx.townBuildings : [];
      for (let i = 0; i < tbs.length; i++) {
        const B = tbs[i];
        if (x > B.x && x < B.x + B.w - 1 && y > B.y && y < B.y + B.h - 1) return true;
      }
    } catch (_) {}
    return false;
  }
  function ensureOutdoorMask(ctx) {
    // Rebuild if missing or dimensions mismatch current map
    if (Array.isArray(ctx.townOutdoorMask)) {
      try {
        const rows = mapRows, cols = mapCols;
        const ok = (ctx.townOutdoorMask.length === rows)
          && rows > 0
          && Array.isArray(ctx.townOutdoorMask[0])
          && ctx.townOutdoorMask[0].length === cols;
        if (ok) return;
      } catch (_) {}
    }
    try {
      const rows = mapRows, cols = mapCols;
      const mask = Array.from({ length: rows }, () => Array(cols).fill(false));
      const tbs = Array.isArray(ctx.townBuildings) ? ctx.townBuildings : [];
      function insideAnyBuilding(x, y) {
        for (let i = 0; i < tbs.length; i++) {
          const B = tbs[i];
          if (x > B.x && x < B.x + B.w - 1 && y > B.y && y < B.y + B.h - 1) return true;
        }
        return false;
      }
      for (let yy = 0; yy < rows; yy++) {
        for (let xx = 0; xx < cols; xx++) {
          const t = map[yy][xx];
          if (t === TILES.FLOOR && !insideAnyBuilding(xx, yy)) {
            mask[yy][xx] = true;
          }
        }
      }
      ctx.townOutdoorMask = mask;
    } catch (_) {}
  }

  // Base layer (offscreen cache + fallback)
  try { drawTownBase(ctx, view); } catch (_) {}

  // Record map for tiles coverage smoketest (optional)
  try {
    if (typeof window !== "undefined" && window.TilesValidation && typeof window.TilesValidation.recordMap === "function") {
      window.TilesValidation.recordMap({ mode: "town", map });
    }
  } catch (_) {}
  // Road overlay pass (palette/tiles-driven):
  // - If tiles.json defines a ROAD fill, we skip overlay because the base layer already draws it correctly.
  // - Otherwise, draw a muted fallback overlay color.
  (function drawRoadOverlay() {
    try {
      const tdRoad = getTileDef("town", TILES.ROAD) || getTileDef("dungeon", TILES.ROAD);
      const hasRoadFill = !!(tdRoad && tdRoad.colors && tdRoad.colors.fill);

      // quick scan to see if there are explicit ROAD tiles
      let anyRoad = false;
      for (let y = startY; y <= endY && !anyRoad; y++) {
        const yIn = y >= 0 && y < mapRows;
        if (!yIn) continue;
        for (let x = startX; x <= endX; x++) {
          if (x < 0 || x >= mapCols) continue;
          if (map[y][x] === TILES.ROAD) { anyRoad = true; break; }
        }
      }

      // If JSON defines ROAD fill, do not overlay explicit ROAD tiles
      if (anyRoad && hasRoadFill) return;

      // Fallback overlay color when road fill is not provided in JSON
      const overlayColor = hasRoadFill ? null : "#6b7280";

      if (anyRoad && overlayColor) {
        ctx2d.save();
        ctx2d.globalAlpha = 0.65;
        for (let y = startY; y <= endY; y++) {
          const yIn = y >= 0 && y < mapRows;
          if (!yIn) continue;
          for (let x = startX; x <= endX; x++) {
            if (x < 0 || x >= mapCols) continue;
            if (map[y][x] !== TILES.ROAD) continue;
            const screenX = (x - startX) * TILE - tileOffsetX;
            const screenY = (y - startY) * TILE - tileOffsetY;
            ctx2d.fillStyle = overlayColor;
            ctx2d.fillRect(screenX, screenY, TILE, TILE);
          }
        }
        ctx2d.restore();
        return;
      }

      // Legacy towns saved without explicit ROAD tiles: use townRoads mask over FLOOR
      if (!anyRoad && ctx.townRoads && overlayColor) {
        ctx2d.save();
        ctx2d.globalAlpha = 0.65;
        for (let y = startY; y <= endY; y++) {
          const yIn = y >= 0 && y < mapRows;
          if (!yIn) continue;
          for (let x = startX; x <= endX; x++) {
            if (x < 0 || x >= mapCols) continue;
            if (!(ctx.townRoads[y] && ctx.townRoads[y][x])) continue;
            if (map[y][x] !== TILES.FLOOR) continue;
            const screenX = (x - startX) * TILE - tileOffsetX;
            const screenY = (y - startY) * TILE - tileOffsetY;
            ctx2d.fillStyle = overlayColor;
            ctx2d.fillRect(screenX, screenY, TILE, TILE);
          }
        }
        ctx2d.restore();
      }
    } catch (_) {}
  })();

  // Inn upstairs overlay tiles
  try { drawInnUpstairsTiles(ctx, view); } catch (_) {}

  // Glyph overlays
  try { drawTownGlyphOverlay(ctx, view); } catch (_) {}

  // Visibility overlays within viewport (void for unseen, dim for seen-but-not-visible)
  for (let y = startY; y <= endY; y++) {
    const yIn = y >= 0 && y < mapRows;
    const rowSeen = yIn ? (seen[y] || []) : [];
    const rowVis = yIn ? (visible[y] || []) : [];
    for (let x = startX; x <= endX; x++) {
      const screenX = (x - startX) * TILE - tileOffsetX;
      const screenY = (y - startY) * TILE - tileOffsetY;
      if (!yIn || x < 0 || x >= mapCols) {
        ctx2d.fillStyle = COLORS.wallDark;
        ctx2d.fillRect(screenX, screenY, TILE, TILE);
        continue;
      }
      const vis = !!rowVis[x];
      const everSeen = !!rowSeen[x];
      if (!everSeen) {
        ctx2d.fillStyle = COLORS.wallDark;
        ctx2d.fillRect(screenX, screenY, TILE, TILE);
      } else if (!vis) {
        ctx2d.fillStyle = COLORS.dim;
        ctx2d.fillRect(screenX, screenY, TILE, TILE);
      }
    }
  }

  // Stairs glyph above tint
  try { drawStairsGlyphTop(ctx, view); } catch (_) {}

  // Props layer
  try { drawTownPropsLayer(ctx, view); } catch (_) {}

  // Upstairs props overlay
  try { drawInnUpstairsProps(ctx, view); } catch (_) {}

  // Shop markers
  try { drawShopMarkersLayer(ctx, view); } catch (_) {}

  // NPCs
  try { drawNPCs(ctx, view); } catch (_) {}

  // Debug overlays and effects
  try { drawTownDebugOverlay(ctx, view); } catch (_) {}
  try { drawTownPaths(ctx, view); } catch (_) {}
  try { drawTownHomePaths(ctx, view); } catch (_) {}
  try { drawTownRoutePaths(ctx, view); } catch (_) {}
  try { drawLampGlow(ctx, view); } catch (_) {}

  // Gate overlay
  try { drawGateOverlay(ctx, view); } catch (_) {}

  // player - add subtle backdrop + outlined glyph so it stands out in town view
  if (player.x >= startX && player.x <= endX && player.y >= startY && player.y <= endY) {
    const screenX = (player.x - startX) * TILE - tileOffsetX;
    const screenY = (player.y - startY) * TILE - tileOffsetY;

    ctx2d.save();
    // Palette-driven player backdrop
    let pbFill = "rgba(255,255,255,0.16)";
    let pbStroke = "rgba(255,255,255,0.35)";
    try {
      const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
      if (pal) {
        pbFill = pal.playerBackdropFill || pbFill;
        pbStroke = pal.playerBackdropStroke || pbStroke;
      }
    } catch (_) {}
    ctx2d.fillStyle = pbFill;
    ctx2d.fillRect(screenX + 4, screenY + 4, TILE - 8, TILE - 8);
    ctx2d.strokeStyle = pbStroke;
    ctx2d.lineWidth = 1;
    ctx2d.strokeRect(screenX + 4.5, screenY + 4.5, TILE - 9, TILE - 9);

    const half = TILE / 2;
    ctx2d.lineWidth = 2;
    ctx2d.strokeStyle = "#0b0f16";
    ctx2d.strokeText("@", screenX + half, screenY + half + 1);
    ctx2d.fillStyle = COLORS.player || "#9ece6a";
    ctx2d.fillText("@", screenX + half, screenY + half + 1);
    ctx2d.restore();
  }

  // Ensure gate glyph 'G' draws above the player so it's visible even when standing on the gate.
  if (ctx.townExitAt) {
    const gx = ctx.townExitAt.x, gy = ctx.townExitAt.y;
    if (gx >= startX && gx <= endX && gy >= startY && gy <= endY) {
      const screenX = (gx - startX) * TILE - tileOffsetX;
      const screenY = (gy - startY) * TILE - tileOffsetY;
      ctx2d.save();
      // Solid glyph above any previous draw calls
      ctx2d.globalAlpha = 1.0;
      let exitColor = "#9ece6a";
      try {
        const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
        if (pal && pal.exitTown) exitColor = pal.exitTown || exitColor;
      } catch (_) {}
      RenderCore.drawGlyph(ctx2d, screenX, screenY, "G", exitColor, TILE);
      ctx2d.restore();
    }
  }

  // Day/night tint
  try { drawTownDayNightTint(ctx, view); } catch (_) {}

  // Grid overlay (if enabled)
  RenderCore.drawGridOverlay(view);
}

// Back-compat: attach to window via helper
attachGlobal("RenderTown", { draw });