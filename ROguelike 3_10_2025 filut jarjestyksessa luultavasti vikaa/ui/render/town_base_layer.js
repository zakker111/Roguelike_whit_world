/**
 * Town base layer: offscreen base build with biome tint and fallback viewport draw.
 */
import * as RenderCore from "../render_core.js";
import { getTileDef } from "../../data/tile_lookup.js";
import { fillTownFor, tilesRef, fallbackFillTown } from "./town_tile_cache.js";

// Base layer offscreen cache for town (tiles only; overlays drawn per frame)
const TOWN = { mapRef: null, canvas: null, wpx: 0, hpx: 0, TILE: 0, _tilesRef: null, _biomeKey: null, _townKey: null, _maskRef: null, _palRef: null };

// Building footprint test (internal)
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

// Helpers for biome-based outdoor ground tint
function ensureTownBiome(ctx) {
  try {
    if (ctx.townBiome) return;
    const world = ctx.world || {};
    const WMOD = (typeof window !== "undefined" ? window.World : null);
    const WT = WMOD && WMOD.TILES ? WMOD.TILES : null;

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

    try {
      const rec = (ctx.world && Array.isArray(ctx.world.towns)) ? ctx.world.towns.find(t => t && t.x === wx && t.y === wy) : null;
      if (rec && rec.biome) { ctx.townBiome = rec.biome; return; }
    } catch (_) {}

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
    try {
      const rec = (ctx.world && Array.isArray(ctx.world.towns)) ? ctx.world.towns.find(t => t && t.x === wx && t.y === wy) : null;
      if (rec && typeof rec === "object") rec.biome = ctx.townBiome;
    } catch (_) {}
  } catch (_) {}
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
function ensureOutdoorMask(ctx, map) {
  try {
    const rows = map.length, cols = map[0] ? map[0].length : 0;
    const ok = Array.isArray(ctx.townOutdoorMask)
      && ctx.townOutdoorMask.length === rows
      && rows > 0
      && Array.isArray(ctx.townOutdoorMask[0])
      && ctx.townOutdoorMask[0].length === cols;
    if (ok) return;
  } catch (_) {}
  try {
    const rows = map.length, cols = map[0] ? map[0].length : 0;
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
        if (t === ctx.TILES.FLOOR && !insideAnyBuilding(xx, yy)) {
          mask[yy][xx] = true;
        }
      }
    }
    ctx.townOutdoorMask = mask;
  } catch (_) {}
}

export function drawTownBase(ctx, view) {
  const {
    ctx2d, TILE, COLORS, TILES,
    map, cam, tileOffsetX, tileOffsetY, startX, startY, endX, endY
  } = Object.assign({}, view, ctx);

  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;

  try {
    if (mapRows && mapCols) {
      ensureTownBiome(ctx);
      const biomeKey = String(ctx.townBiome || "");
      const townKey = (ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number" && typeof ctx.worldReturnPos.y === "number")
        ? `${ctx.worldReturnPos.x|0},${ctx.worldReturnPos.y|0}` : null;

      const wpx = mapCols * TILE;
      const hpx = mapRows * TILE;
      const palRef = paletteTownRef();
      const needsRebuild = (!TOWN.canvas)
        || TOWN.mapRef !== map
        || TOWN.wpx !== wpx
        || TOWN.hpx !== hpx
        || TOWN.TILE !== TILE
        || TOWN._tilesRef !== tilesRef()
        || TOWN._biomeKey !== biomeKey
        || TOWN._townKey !== townKey
        || TOWN._maskRef !== ctx.townOutdoorMask
        || TOWN._palRef !== palRef;

      if (needsRebuild && tintReady(ctx)) {
        TOWN.mapRef = map;
        TOWN.wpx = wpx;
        TOWN.hpx = hpx;
        TOWN.TILE = TILE;
        TOWN._tilesRef = tilesRef();
        TOWN._biomeKey = biomeKey;
        TOWN._townKey = townKey;
        TOWN._palRef = palRef;

        const off = RenderCore.createOffscreen(wpx, hpx);
        const oc = off.getContext("2d");
        try {
          oc.font = "bold 20px JetBrains Mono, monospace";
          oc.textAlign = "center";
          oc.textBaseline = "middle";
        } catch (_) {}
        ensureOutdoorMask(ctx, map);
        const biomeFill = townBiomeFill(ctx);
        TOWN._maskRef = ctx.townOutdoorMask;

        for (let yy = 0; yy < mapRows; yy++) {
          const rowMap = map[yy];
          for (let xx = 0; xx < mapCols; xx++) {
            const type = rowMap[xx];
            const sx = xx * TILE, sy = yy * TILE;
            let fill = fillTownFor(TILES, type, COLORS);
            try {
              const isOutdoorFloor = (type === TILES.FLOOR) && !!(ctx.townOutdoorMask && ctx.townOutdoorMask[yy] && ctx.townOutdoorMask[yy][xx]);
              const isOutdoorRoad = (type === TILES.ROAD) && !insideAnyBuildingAt(ctx, xx, yy);
              if ((isOutdoorFloor || isOutdoorRoad) && biomeFill) {
                fill = biomeFill;
              }
            } catch (_) {}
            oc.fillStyle = fill;
            oc.fillRect(sx, sy, TILE, TILE);
          }
        }
        TOWN.canvas = off;
      }
    }
  } catch (_) {}

  if (TOWN.canvas) {
    try {
      RenderCore.blitViewport(ctx2d, TOWN.canvas, cam, TOWN.wpx, TOWN.hpx);
      return;
    } catch (_) {}
  }

  // Fallback: draw base tiles in viewport using JSON colors or robust fallback
  ensureTownBiome(ctx);
  ensureOutdoorMask(ctx, map);
  const biomeFill = resolvedTownBiomeFill(ctx);
  for (let y = startY; y <= endY; y++) {
    const yIn = y >= 0 && y < mapRows;
    const rowMap = yIn ? map[y] : null;
    for (let x = startX; x <= endX; x++) {
      const screenX = (x - startX) * TILE - tileOffsetX;
      const screenY = (y - startY) * TILE - tileOffsetY;
      if (!yIn || x < 0 || x >= mapCols) {
        ctx2d.fillStyle = COLORS.wallDark;
        ctx2d.fillRect(screenX, screenY, TILE, TILE);
        continue;
      }
      const type = rowMap[x];
      const td = getTileDef("town", type) || getTileDef("dungeon", type) || null;
      let fill = (td && td.colors && td.colors.fill) ? td.colors.fill : fallbackFillTown(TILES, type, COLORS);
      try {
        const isOutdoorFloor = (type === TILES.FLOOR) && !!(ctx.townOutdoorMask && ctx.townOutdoorMask[y] && ctx.townOutdoorMask[y][x]);
        const isOutdoorRoad = (type === TILES.ROAD) && !insideAnyBuildingAt(ctx, x, y);
        if ((isOutdoorFloor || isOutdoorRoad) && biomeFill) {
          fill = biomeFill;
        }
      } catch (_) {}
      ctx2d.fillStyle = fill;
      ctx2d.fillRect(screenX, screenY, TILE, TILE);
    }
  }
}