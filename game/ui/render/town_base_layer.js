/**
 * Town base layer: offscreen base build with biome tint and fallback viewport draw.
 */
import * as RenderCore from "../render_core.js";
import { getTileDef } from "../../data/tile_lookup.js";
import { fillTownFor, tilesRef, fallbackFillTown } from "./town_tile_cache.js";

// Base layer offscreen cache for town (tiles only; overlays drawn per frame)
const TOWN = { mapRef: null, canvas: null, wpx: 0, hpx: 0, TILE: 0, _tilesRef: null, _biomeKey: null, _townKey: null, _maskRef: null, _palRef: null, _pierMaskRef: null, _boatMaskRef: null };

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
// Each town should have a single, pinned biome on its world record (rec.biome).
// Renderer reads that value; if missing (older saves), we derive once via TownState
// and persist, then reuse it on all future frames/visits.
function ensureTownBiome(ctx) {
  try {
    if (!ctx) return;

    // RenderTown.draw receives a lightweight render context, not the full game
    // ctx. For stable town biome pinning we must operate on the authoritative
    // game ctx (via GameAPI.getCtx) and mirror the result back onto the render
    // ctx. This prevents per-frame re-derivation when the render ctx object is
    // recreated each draw.
    let base = ctx;
    try {
      if (typeof window !== "undefined" && window.GameAPI && typeof window.GameAPI.getCtx === "function") {
        const c = window.GameAPI.getCtx();
        if (c && typeof c === "object") base = c;
      }
    } catch (_) {}

    const world = base.world || {};
    const towns = (base.world && Array.isArray(base.world.towns)) ? base.world.towns : [];

    // Resolve a stable key for this town based on its overworld entry coordinates.
    let townKey = null;
    try {
      if (base.worldReturnPos && typeof base.worldReturnPos.x === "number" && typeof base.worldReturnPos.y === "number") {
        townKey = `${base.worldReturnPos.x | 0},${base.worldReturnPos.y | 0}`;
      }
    } catch (_) {}

    // Initialize per-town pinned biome map on the base ctx (in-memory only for this session).
    try {
      if (!base._townBiomePinned || typeof base._townBiomePinned !== "object") {
        base._townBiomePinned = Object.create(null);
      }
    } catch (_) {
      if (!base._townBiomePinned || typeof base._townBiomePinned !== "object") {
        base._townBiomePinned = base._townBiomePinned || {};
      }
    }
    const pinnedMap = base._townBiomePinned || null;

    // 1) If we already have a pinned biome for this townKey, trust it unconditionally.
    if (townKey && pinnedMap && Object.prototype.hasOwnProperty.call(pinnedMap, townKey)) {
      const pinned = pinnedMap[townKey];
      if (pinned) {
        base.townBiome = pinned;
        ctx.townBiome = pinned;
      } else {
        if (!base.townBiome) base.townBiome = "GRASS";
        if (!ctx.townBiome) ctx.townBiome = base.townBiome;
      }
      try { base._townBiomeResolved = true; } catch (_) {}
      try { ctx._townBiomeResolved = true; } catch (_) {}
      return;
    }

    // 2) If a previous resolution marked the biome as resolved and base.townBiome
    // is already a string, backfill the pin map and return.
    if (base._townBiomeResolved && typeof base.townBiome === "string" && base.townBiome) {
      if (townKey && pinnedMap && !Object.prototype.hasOwnProperty.call(pinnedMap, townKey)) {
        pinnedMap[townKey] = base.townBiome;
      }
      ctx.townBiome = base.townBiome;
      try { ctx._townBiomeResolved = true; } catch (_) {}
      return;
    }

    // 3) Fresh resolution: reuse previous logic but also pin the result per town.
    let rec = null;
    let wx = null, wy = null;
    const hasWRP = !!(base.worldReturnPos && typeof base.worldReturnPos.x === "number" && typeof base.worldReturnPos.y === "number");
    if (hasWRP) {
      wx = base.worldReturnPos.x | 0;
      wy = base.worldReturnPos.y | 0;
      for (let i = 0; i < towns.length; i++) {
        const t = towns[i];
        if (t && (t.x | 0) === wx && (t.y | 0) === wy) { rec = t; break; }
      }
    }

    // If direct match failed but there is exactly one town in this world snapshot,
    // treat that as the active town (defensive fallback for legacy saves).
    if (!rec && towns.length === 1) {
      rec = towns[0];
      try {
        wx = rec && typeof rec.x === "number" ? (rec.x | 0) : wx;
        wy = rec && typeof rec.y === "number" ? (rec.y | 0) : wy;
      } catch (_) {}
    }

    let biome = null;

    // 3a) If the town record already has a pinned biome, use it.
    if (rec && rec.biome) {
      biome = rec.biome;
    } else {
      // 3b) Derive once from overworld tiles using a stable coordinate and persist.
      // Prefer the town record's own coords when available; otherwise fall back
      // to worldReturnPos or origin+player.
      if (rec && typeof rec.x === "number" && typeof rec.y === "number") {
        wx = rec.x | 0;
        wy = rec.y | 0;
      } else if (!hasWRP) {
        const ox = world.originX | 0;
        const oy = world.originY | 0;
        wx = (ox + (base.player ? (base.player.x | 0) : 0)) | 0;
        wy = (oy + (base.player ? (base.player.y | 0) : 0)) | 0;
      }

      try {
        const TS = base.TownState || (typeof window !== "undefined" ? window.TownState : null);
        if (TS && typeof TS.deriveTownBiomeFromWorld === "function" && typeof wx === "number" && typeof wy === "number") {
          biome = TS.deriveTownBiomeFromWorld(base, wx, wy);
        }
      } catch (_) {}

      if (!biome) biome = base.townBiome || ctx.townBiome || "GRASS";

      // Only write to rec.biome when it was previously unset, so once pinned
      // we never change a town's biome again.
      try {
        if (rec && typeof rec === "object" && !rec.biome) rec.biome = biome;
      } catch (_) {}
    }

    const finalBiome = biome || "GRASS";
    base.townBiome = finalBiome;
    ctx.townBiome = finalBiome;

    // Pin this biome for the current townKey so repeated resolutions for this
    // town in this session always reuse the same value even if other heuristics
    // would disagree.
    if (townKey && pinnedMap && !Object.prototype.hasOwnProperty.call(pinnedMap, townKey)) {
      pinnedMap[townKey] = finalBiome;
    }

    try { base._townBiomeResolved = true; } catch (_) {}
    try { ctx._townBiomeResolved = true; } catch (_) {}
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
        || TOWN._palRef !== palRef
        || TOWN._pierMaskRef !== ctx.townPierMask
        || TOWN._boatMaskRef !== ctx.townBoatMask;

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
        const biomeFill = resolvedTownBiomeFill(ctx);
        TOWN._maskRef = ctx.townOutdoorMask;
        TOWN._pierMaskRef = ctx.townPierMask;
        TOWN._boatMaskRef = ctx.townBoatMask;

        for (let yy = 0; yy < mapRows; yy++) {
          const rowMap = map[yy];
          for (let xx = 0; xx < mapCols; xx++) {
            const type = rowMap[xx];
            const sx = xx * TILE, sy = yy * TILE;
            let fill = fillTownFor(TILES, type, COLORS);
            try {
              const isOutdoorFloor = (type === TILES.FLOOR) && !!(ctx.townOutdoorMask && ctx.townOutdoorMask[yy] && ctx.townOutdoorMask[yy][xx]);
              const isOutdoorRoad = (type === TILES.ROAD) && !insideAnyBuildingAt(ctx, xx, yy);
              if (biomeFill && (isOutdoorFloor || isOutdoorRoad)) {
                fill = biomeFill;
              }
              // Boat deck: always draw with ship colors regardless of biome tint.
              if (ctx.townBoatMask && ctx.townBoatMask[yy] && ctx.townBoatMask[yy][xx]) {
                // Distinguish inner deck vs deck edge to give ships a visible hull belt.
                if (type === TILES.SHIP_EDGE) {
                  fill = "#7a613f";
                } else {
                  fill = "#9b7a48";
                }
              } else if (ctx.townPierMask && ctx.townPierMask[yy] && ctx.townPierMask[yy][xx]) {
                // Tint pier tiles to a warmer brown so piers stand out clearly.
                fill = "#7b5a35";
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
        if (biomeFill && (isOutdoorFloor || isOutdoorRoad)) {
          fill = biomeFill;
        }
        if (ctx.townBoatMask && ctx.townBoatMask[y] && ctx.townBoatMask[y][x]) {
          if (type === TILES.SHIP_EDGE) {
            fill = "#7a613f";
          } else {
            fill = "#9b7a48";
          }
        } else if (ctx.townPierMask && ctx.townPierMask[y] && ctx.townPierMask[y][x]) {
          fill = "#7b5a35";
        }
      } catch (_) {}
      ctx2d.fillStyle = fill;
      ctx2d.fillRect(screenX, screenY, TILE, TILE);
    }
  }
}