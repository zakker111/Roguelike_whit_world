/**
 * RenderTown: draws town map tiles, shops, props, NPCs, player, and overlays.
 *
 * Exports (ESM + window.RenderTown):
 * - draw(ctx, view)
 */
import * as RenderCore from "./render_core.js";
import * as RenderOverlays from "./render_overlays.js";
import { getTileDef, getTileDefByKey } from "../data/tile_lookup.js";
import { attachGlobal } from "../utils/global.js";

// Tile cache to avoid repeated JSON lookups inside hot loops
const TILE_CACHE = { ref: null, fill: Object.create(null), glyph: Object.create(null), fg: Object.create(null) };
function cacheResetIfNeeded() {
  const ref = tilesRef();
  if (TILE_CACHE.ref !== ref) {
    TILE_CACHE.ref = ref;
    TILE_CACHE.fill = Object.create(null);
    TILE_CACHE.glyph = Object.create(null);
    TILE_CACHE.fg = Object.create(null);
  }
}
function fillTownFor(TILES, type, COLORS) {
  cacheResetIfNeeded();
  const k = type | 0;
  let v = TILE_CACHE.fill[k];
  if (v) return v;
  const td = getTileDef("town", type) || getTileDef("dungeon", type) || null;
  v = (td && td.colors && td.colors.fill) ? td.colors.fill : fallbackFillTown(TILES, type, COLORS);
  TILE_CACHE.fill[k] = v;
  return v;
}
function glyphTownFor(type) {
  cacheResetIfNeeded();
  const k = type | 0;
  let g = TILE_CACHE.glyph[k];
  let c = TILE_CACHE.fg[k];
  if (typeof g !== "undefined" && typeof c !== "undefined") return { glyph: g, fg: c };
  const td = getTileDef("town", type) || getTileDef("dungeon", type) || null;
  if (td) {
    g = Object.prototype.hasOwnProperty.call(td, "glyph") ? td.glyph : "";
    c = td.colors && td.colors.fg ? td.colors.fg : null;
  } else {
    g = "";
    c = null;
  }
  TILE_CACHE.glyph[k] = g;
  TILE_CACHE.fg[k] = c;
  return { glyph: g, fg: c };
}

// getTileDef moved to centralized helper in ../data/tile_lookup.js

// Robust fallback fill for town tiles when tiles.json is missing/incomplete
function fallbackFillTown(TILES, type, COLORS) {
  try {
    if (type === TILES.WALL) return (COLORS && COLORS.wall) || "#1b1f2a";
    if (type === TILES.FLOOR) return (COLORS && COLORS.floorLit) || (COLORS && COLORS.floor) || "#0f1628";
    if (type === TILES.ROAD) return "#b0a58a"; // muted brown road
    if (type === TILES.DOOR) return "#3a2f1b";
    if (type === TILES.WINDOW) return "#26728c";
    if (type === TILES.STAIRS) return "#3a2f1b";
  } catch (_) {}
  return "#0b0c10";
}

// getTileDefByKey moved to centralized helper in ../data/tile_lookup.js

// Helper: current tiles.json reference (for cache invalidation)
function tilesRef() {
  try {
    return (typeof window !== "undefined" && window.GameData && window.GameData.tiles) ? window.GameData.tiles : null;
  } catch (_) { return null; }
}

// Base layer offscreen cache for town (tiles only; overlays drawn per frame)
let TOWN = { mapRef: null, canvas: null, wpx: 0, hpx: 0, TILE: 0, _tilesRef: null, _biomeKey: null, _townKey: null, _maskRef: null };


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

      // We require absolute world coordinates for this town; do not guess from player (town-local) coords.
      const hasWRP = !!(ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number" && typeof ctx.worldReturnPos.y === "number");
      if (!hasWRP) {
        // As a last resort, do nothing; rendering will fallback to default floor colors without biome tint.
        return;
      }
      const wx = ctx.worldReturnPos.x | 0;
      const wy = ctx.worldReturnPos.y | 0;

      // Use persisted biome if available
      try {
        const rec = (ctx.world && Array.isArray(ctx.world.towns)) ? ctx.world.towns.find(t => t && t.x === wx && t.y === wy) : null;
        if (rec && rec.biome) {
          ctx.townBiome = rec.biome;
          try { ctx._townBiomeSource = "persisted"; ctx._townBiomeWorldPos = { x: wx, y: wy }; ctx._townBiomeCounts = null; } catch (_) {}
          return;
        }
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
      try {
        ctx._townBiomeSource = "derived";
        ctx._townBiomeCounts = { ...counts };
        ctx._townBiomeWorldPos = { x: wx, y: wy };
      } catch (_) {}
      
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

  // Build base offscreen once per map/TILE/biome change
  try {
    if (mapRows && mapCols) {
      // Ensure biome is determined first
      ensureTownBiome(ctx);
      const biomeKey = String(ctx.townBiome || "");
      const townKey = (ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number" && typeof ctx.worldReturnPos.y === "number")
        ? `${ctx.worldReturnPos.x|0},${ctx.worldReturnPos.y|0}` : null;

      const wpx = mapCols * TILE;
      const hpx = mapRows * TILE;
      const needsRebuild = (!TOWN.canvas)
        || TOWN.mapRef !== map
        || TOWN.wpx !== wpx
        || TOWN.hpx !== hpx
        || TOWN.TILE !== TILE
        || TOWN._tilesRef !== tilesRef()
        || TOWN._biomeKey !== biomeKey
        || TOWN._townKey !== townKey
        || TOWN._maskRef !== ctx.townOutdoorMask;

      if (needsRebuild) {
        TOWN.mapRef = map;
        TOWN.wpx = wpx;
        TOWN.hpx = hpx;
        TOWN.TILE = TILE;
        TOWN._tilesRef = tilesRef();
        TOWN._biomeKey = biomeKey;
        TOWN._townKey = townKey;

        const off = RenderCore.createOffscreen(wpx, hpx);
        const oc = off.getContext("2d");
        try {
          oc.font = "bold 20px JetBrains Mono, monospace";
          oc.textAlign = "center";
          oc.textBaseline = "middle";
        } catch (_) {}
        // Prepare biome fill and outdoor mask
        ensureOutdoorMask(ctx);
        const biomeFill = townBiomeFill(ctx);
        // Track mask reference to trigger rebuild when it changes externally
        TOWN._maskRef = ctx.townOutdoorMask;

        // Count diagnostics for base draw
        let floorCount = 0;
        const colorCounts = Object.create(null);

        for (let yy = 0; yy < mapRows; yy++) {
          const rowMap = map[yy];
          for (let xx = 0; xx < mapCols; xx++) {
            const type = rowMap[xx];
            const sx = xx * TILE, sy = yy * TILE;
            if (type === TILES.FLOOR) floorCount++;
            // Cached fill color: prefer town JSON, then dungeon JSON; else robust fallback
            let fill = fillTownFor(TILES, type, COLORS);
            // Apply outdoor biome tint only to non-road FLOOR tiles; rely on tile type for roads
            try {
              if (type === TILES.FLOOR && biomeFill && ctx.townOutdoorMask && ctx.townOutdoorMask[yy] && ctx.townOutdoorMask[yy][xx]) {
                // Outdoor ground tint by biome for non-road FLOOR tiles
                fill = biomeFill;
              }
            } catch (_) {}
            oc.fillStyle = fill;
            oc.fillRect(sx, sy, TILE, TILE);
            colorCounts[fill] = (colorCounts[fill] | 0) + 1;
          }
        }
        TOWN.canvas = off;
        // Reset overlay log for new base
        TOWN._overlayLogged = false;
        try {
          ctx.log && ctx.log(`[RenderTown.base] biome=${biomeKey || "(none)"} floorTiles=${floorCount} offscreenBuilt.`, "notice");
        } catch (_) {}
        try {
          const pairs = Object.entries(colorCounts).sort((a, b) => (b[1] | 0) - (a[1] | 0));
          const top = pairs.slice(0, 6).map(([c, n]) => `${c}=${n}`).join(", ");
          ctx.log && ctx.log(`[RenderTown.baseColors] biomeFill=${biomeFill || "(none)"} top=${top}`, "notice");
        } catch (_) {}
        // Log base fill source details for FLOOR tiles (biome vs tile JSON vs fallback)
        try {
          const tdTownFloor = getTileDef("town", TILES.FLOOR) || getTileDef("dungeon", TILES.FLOOR) || null;
          const tileJsonFloorColor = (tdTownFloor && tdTownFloor.colors && tdTownFloor.colors.fill) ? tdTownFloor.colors.fill : null;
          const fallbackFloorColor = fallbackFillTown(TILES, TILES.FLOOR, COLORS);
          const floorBiomeUsed = !!biomeFill;
          const firstDelayMs = (typeof window !== "undefined" && typeof window.TOWN_GEN_DELAY === "number") ? (window.TOWN_GEN_DELAY | 0) : null;
          ctx.log && ctx.log(
            `[RenderTown.baseSource] floorBiomeUsed=${floorBiomeUsed ? "yes" : "no"} biomeFillColor=${biomeFill || "(none)"} tileJSONFloorColor=${tileJsonFloorColor || "(none)"} fallbackFloorColor=${fallbackFloorColor || "(none)"}${firstDelayMs != null ? " firstDelayMs=" + firstDelayMs : ""}`,
            "notice"
          );
          // Biome pick diagnostics (source + counts)
          try {
            const src = String(ctx._townBiomeSource || "");
            const counts = ctx._townBiomeCounts || null;
            if (src || counts) {
              const cstr = counts ? ` DESERT=${counts.DESERT|0} SNOW=${counts.SNOW|0} BEACH=${counts.BEACH|0} SWAMP=${counts.SWAMP|0} FOREST=${counts.FOREST|0} GRASS=${counts.GRASS|0}` : "";
              ctx.log && ctx.log(`[RenderTown.biomePick] source=${src || "(unknown)"} chosen=${biomeKey || "(none)"}${cstr}`, "notice");
            }
          } catch (_) {}
          // Palette of base tile colors and their sources (tileJSON vs fallback; FLOOR uses biome)
          try {
            const palette = {
              WALL: fillTownFor(TILES, TILES.WALL, COLORS),
              FLOOR: biomeFill || fillTownFor(TILES, TILES.FLOOR, COLORS),
              ROAD: fillTownFor(TILES, TILES.ROAD, COLORS),
              DOOR: fillTownFor(TILES, TILES.DOOR, COLORS),
              WINDOW: fillTownFor(TILES, TILES.WINDOW, COLORS),
              STAIRS: fillTownFor(TILES, TILES.STAIRS, COLORS),
            };
            const srcFor = (id, name) => {
              if (name === "FLOOR" && biomeFill) return "biome";
              const td = getTileDef("town", id) || getTileDef("dungeon", id) || null;
              return td ? "tileJSON" : "fallback";
            };
            const sources = {
              WALL: srcFor(TILES.WALL, "WALL"),
              FLOOR: srcFor(TILES.FLOOR, "FLOOR"),
              ROAD: srcFor(TILES.ROAD, "ROAD"),
              DOOR: srcFor(TILES.DOOR, "DOOR"),
              WINDOW: srcFor(TILES.WINDOW, "WINDOW"),
              STAIRS: srcFor(TILES.STAIRS, "STAIRS"),
            };
            ctx.log && ctx.log(`[RenderTown.baseTilePalette] ${Object.entries(palette).map(([k,v]) => `${k}=${v}`).join(" ")}`, "notice");
            ctx.log && ctx.log(`[RenderTown.baseTileSources] ${Object.entries(sources).map(([k,v]) => `${k}=${v}`).join(" ")}`, "notice");
          } catch (_) {}
          // First-pass samples: gate interior and plaza center
          try {
            const sampleColorAt = (x, y) => {
              if (y < 0 || y >= mapRows || x < 0 || x >= mapCols) return { type: null, color: null };
              const type = map[y][x];
              let fill = fillTownFor(TILES, type, COLORS);
              if (type === TILES.FLOOR && biomeFill) fill = biomeFill;
              return { type, color: fill };
            };
            const gx = (ctx.townExitAt && typeof ctx.townExitAt.x === "number") ? ctx.townExitAt.x : null;
            const gy = (ctx.townExitAt && typeof ctx.townExitAt.y === "number") ? ctx.townExitAt.y : null;
            const gateS = (gx != null && gy != null) ? sampleColorAt(gx, gy) : null;
            const px = (ctx.townPlaza && typeof ctx.townPlaza.x === "number") ? (ctx.townPlaza.x | 0) : ((mapCols/2)|0);
            const py = (ctx.townPlaza && typeof ctx.townPlaza.y === "number") ? (ctx.townPlaza.y | 0) : ((mapRows/2)|0);
            const plazaS = sampleColorAt(px, py);
            ctx.log && ctx.log(`[RenderTown.firstSamples] gate=${gx != null ? `${gx},${gy}` : "(n/a)"} gateTile=${gateS ? gateS.type : "(n/a)"} gateColor=${gateS ? gateS.color : "(n/a)"} plaza=${px},${py} plazaTile=${plazaS.type} plazaColor=${plazaS.color}`, "notice");
          } catch (_) {}
        } catch (_) {}
      }
    }
  } catch (_) {}

  // Blit base layer if available
  if (TOWN.canvas) {
    try {
      RenderCore.blitViewport(ctx2d, TOWN.canvas, cam, TOWN.wpx, TOWN.hpx);
    } catch (_) {}
  } else {
    // Fallback: draw base tiles in viewport using JSON colors or robust fallback
    ensureTownBiome(ctx);
    ensureOutdoorMask(ctx);
    const biomeFill = townBiomeFill(ctx);
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
        // Apply outdoor tint only to FLOOR; rely on tile type for roads
        try {
          if (type === TILES.FLOOR && biomeFill && ctx.townOutdoorMask && ctx.townOutdoorMask[y] && ctx.townOutdoorMask[y][x]) {
            fill = biomeFill;
          }
        } catch (_) {}
        ctx2d.fillStyle = fill;
        ctx2d.fillRect(screenX, screenY, TILE, TILE);
      }
    }
  }

  // Road overlay pass:
  // 1) Prefer explicit ROAD tiles (authoritative).
  // 2) If no typed ROAD tiles exist anywhere, fall back to townRoads mask (only when dims match and mask has any 'true').
  (function drawRoadOverlay() {
    try {
      // Count typed roads across the entire map
      let typedRoadCount = 0;
      for (let y = 0; y < mapRows; y++) {
        for (let x = 0; x < mapCols; x++) {
          if (map[y][x] === TILES.ROAD) typedRoadCount++;
        }
      }
      const hasTyped = typedRoadCount > 0;

      // Validate fallback mask dimensions and count 'true' cells
      let dimsOk = false;
      let maskTrueCount = 0;
      if (ctx.townRoads && Array.isArray(ctx.townRoads) && ctx.townRoads.length === mapRows) {
        const row0 = ctx.townRoads[0];
        if (Array.isArray(row0) && row0.length === mapCols) {
          dimsOk = true;
          for (let y = 0; y < mapRows; y++) {
            const rowMask = ctx.townRoads[y];
            for (let x = 0; x < mapCols; x++) {
              if (rowMask && rowMask[x]) maskTrueCount++;
            }
          }
        }
      }

      // Log once per base rebuild
      if (!TOWN._overlayLogged) {
        try {
          ctx.log && ctx.log(
            `[RenderTown.overlay] typedRoads=${typedRoadCount} useTyped=${hasTyped ? "yes" : "no"} fallbackPresent=${ctx.townRoads ? "yes" : "no"} dimsOk=${dimsOk ? "yes" : "no"} maskTrue=${maskTrueCount} roadColor=#b0a58a`,
            "notice"
          );
        } catch (_) {}
        TOWN._overlayLogged = true;
      }

      if (hasTyped) {
        // Draw typed roads within the current viewport only.
        for (let y = startY; y <= endY; y++) {
          const yIn = y >= 0 && y < mapRows;
          if (!yIn) continue;
          for (let x = startX; x <= endX; x++) {
            if (x < 0 || x >= mapCols) continue;
            if (map[y][x] !== TILES.ROAD) continue;
            const screenX = (x - startX) * TILE - tileOffsetX;
            const screenY = (y - startY) * TILE - tileOffsetY;
            ctx2d.fillStyle = "#b0a58a"; // road color
            ctx2d.fillRect(screenX, screenY, TILE, TILE);
          }
        }
      } else if (ctx.townRoads && dimsOk && maskTrueCount > 0) {
        // Fallback: draw roads from persisted mask only when the map contains no typed roads at all, mask dims match, and mask has any roads.
        for (let y = startY; y <= endY; y++) {
          const yIn = y >= 0 && y < mapRows;
          if (!yIn) continue;
          for (let x = startX; x <= endX; x++) {
            if (x < 0 || x >= mapCols) continue;
            // Only paint where the saved mask indicates a road and the map tile is FLOOR
            if (!(ctx.townRoads[y] && ctx.townRoads[y][x])) continue;
            if (map[y][x] !== TILES.FLOOR) continue;
            const screenX = (x - startX) * TILE - tileOffsetX;
            const screenY = (y - startY) * TILE - tileOffsetY;
            ctx2d.fillStyle = "#b0a58a";
            ctx2d.fillRect(screenX, screenY, TILE, TILE);
          }
        }
      } else {
        // No typed roads and no valid fallback mask; skip overlay entirely.
      }
    } catch (_) {}
  })();

  // Inn upstairs overlay: draw upstairs tiles over the inn footprint when active
  (function drawInnUpstairsOverlay() {
    try {
      const up = ctx.innUpstairs;
      const tav = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
      if (!ctx.innUpstairsActive || !up || !tav) return;

      // 1) Cover only the inn interior area with a neutral upstairs floor fill
      //    to hide downstairs doors inside the hall while preserving perimeter walls.
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

      // 2) Draw the upstairs interior tiles over the inn interior (offset inside perimeter)
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
          // Upstairs stairs glyph disabled in overlay to avoid accidental mass draw.
        }
      }
    } catch (_) {}
  })();

  // Per-frame glyph overlay (drawn before visibility overlays)
  // Keep town clean: suppress door glyphs; show stairs ('>') clearly; windows get a subtle pane glyph for readability
  for (let y = startY; y <= endY; y++) {
    const yIn = y >= 0 && y < mapRows;
    const rowMap = yIn ? map[y] : null;
    for (let x = startX; x <= endX; x++) {
      if (!yIn || x < 0 || x >= mapCols) continue;
      const type = rowMap[x];

      // Suppress DOOR glyphs
      if (type === TILES.DOOR) continue;

      const tg = glyphTownFor(type);
      let glyph = tg ? tg.glyph : "";
      let fg = tg ? tg.fg : null;

      const screenX = (x - startX) * TILE - tileOffsetX;
      const screenY = (y - startY) * TILE - tileOffsetY;

      // Stairs glyphs disabled in per-frame overlay to avoid overdraw glitches.
      // Base tiles or upstairs overlay visuals should make stairs discoverable.

      if (type === TILES.WINDOW) {
        if (!glyph || String(glyph).trim().length === 0) glyph = "□";
        if (!fg) fg = "#8ecae6";
        ctx2d.save();
        ctx2d.globalAlpha = 0.50;
        RenderCore.drawGlyph(ctx2d, screenX, screenY, glyph, fg, TILE);
        ctx2d.restore();
      } else {
        if (!glyph || !fg || String(glyph).trim().length === 0) continue;
        RenderCore.drawGlyph(ctx2d, screenX, screenY, glyph, fg, TILE);
      }
    }
  }

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

  // Stairs glyph overlay above visibility tint so it's always readable once seen
  // Stairs glyph top overlay disabled to prevent mass '>' rendering issues.
  (function drawStairsGlyphTop() { /* no-op */ })();

  // Props: draw remembered (seen) props dimmed; draw fully only when currently visible with direct LOS.
  // When upstairs overlay is active, suppress ground props inside the inn footprint and draw upstairs props instead.
  if (Array.isArray(ctx.townProps)) {
    for (const p of ctx.townProps) {
      if (p.x < startX || p.x > endX || p.y < startY || p.y > endY) continue;

      // Suppress ground-level props inside inn when upstairs overlay is active
      if (ctx.innUpstairsActive && ctx.tavern && ctx.tavern.building) {
        const b = ctx.tavern.building;
        if (p.x > b.x && p.x < b.x + b.w - 1 && p.y > b.y && p.y < b.y + b.h - 1) {
          continue;
        }
      }

      const wasSeen = !!(seen[p.y] && seen[p.y][p.x]);
      if (!wasSeen) continue;

      const visNow = !!(visible[p.y] && visible[p.y][p.x]);

      // Lookup by key in JSON: prefer town mode, then dungeon/overworld; fallback glyph/color if missing
      const screenX = (p.x - startX) * TILE - tileOffsetX;
      const screenY = (p.y - startY) * TILE - tileOffsetY;

      let glyph = "";
      let color = null;

      // Prefer glyph and color from props registry if present (data-driven props styling)
      try {
        const GD = (typeof window !== "undefined" ? window.GameData : null);
        const arr = GD && GD.props && Array.isArray(GD.props.props) ? GD.props.props : null;
        if (arr) {
          const tId = String(p.type || "").toLowerCase();
          const entry = arr.find(pp => String(pp.id || "").toLowerCase() === tId || String(pp.key || "").toLowerCase() === tId);
          if (entry && typeof entry.glyph === "string") glyph = entry.glyph;
          if (entry && entry.colors && typeof entry.colors.fg === "string") color = entry.colors.fg;
          // Back-compat: allow plain 'color' field if present
          if (!color && entry && typeof entry.color === "string") color = entry.color;
        }
      } catch (_) {}

      // Next, consult tiles.json by key to fill in missing glyph/color
      let tdProp = null;
      try {
        const key = String(p.type || "").toUpperCase();
        tdProp = getTileDefByKey("town", key) || getTileDefByKey("dungeon", key) || getTileDefByKey("overworld", key);
        if (tdProp) {
          if (!glyph && Object.prototype.hasOwnProperty.call(tdProp, "glyph")) glyph = tdProp.glyph || glyph;
          if (!color && tdProp.colors && tdProp.colors.fg) color = tdProp.colors.fg || color;
        }
      } catch (_) {}

      // Fallback glyphs/colors for common props
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

      // Decide opacity: full if visible and LOS; dim if not visible or visible-without-LOS
      let drawDim = !visNow;
      if (visNow) {
        let hasLine = true;
        try {
          if (ctx.los && typeof ctx.los.hasLOS === "function") {
            hasLine = !!ctx.los.hasLOS(ctx, player.x, player.y, p.x, p.y);
          } else if (typeof window !== "undefined" && window.LOS && typeof window.LOS.hasLOS === "function") {
            hasLine = !!window.LOS.hasLOS(ctx, player.x, player.y, p.x, p.y);
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
  }

  // Upstairs props overlay when active
  (function drawInnUpstairsProps() {
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
              hasLine = !!ctx.los.hasLOS(ctx, player.x, player.y, p.x, p.y);
            } else if (typeof window !== "undefined" && window.LOS && typeof window.LOS.hasLOS === "function") {
              hasLine = !!window.LOS.hasLOS(ctx, player.x, player.y, p.x, p.y);
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
  })();

  // Shop markers: draw a small flag ⚑ at shop doors once seen.
  // To avoid \"double sign\" visuals, suppress the door marker if a shop already has an interior sign prop.
  (function drawShopMarkers() {
    try {
      if (!Array.isArray(ctx.shops) || !ctx.shops.length) return;
      for (const s of ctx.shops) {
        const dx = (s.building && s.building.door && typeof s.building.door.x === "number") ? s.building.door.x : s.x;
        const dy = (s.building && s.building.door && typeof s.building.door.y === "number") ? s.building.door.y : s.y;
        if (dx < startX || dx > endX || dy < startY || dy > endY) continue;
        const everSeen = !!(seen[dy] && seen[dy][dx]);
        if (!everSeen) continue;

        // Suppress marker if there is already a sign inside this shop's building
        let hasSignInside = false;
        try {
          if (Array.isArray(ctx.townProps) && s.building) {
            hasSignInside = ctx.townProps.some(p =>
              p && String(p.type || "").toLowerCase() === "sign" &&
              p.x > s.building.x && p.x < s.building.x + s.building.w - 1 &&
              p.y > s.building.y && p.y < s.building.y + s.building.h - 1
            );
          }
        } catch (_) {}

        if (hasSignInside) continue;

        const screenX = (dx - startX) * TILE - tileOffsetX;
        const screenY = (dy - startY) * TILE - tileOffsetY;
        // match sign color; draw above tiles/props
        RenderCore.drawGlyph(ctx2d, screenX, screenY, "⚑", "#d7ba7d", TILE);
      }
    } catch (_) {}
  })();

  // NPCs: draw when the tile has been seen; dim if not currently visible or no LOS.
  // This avoids \"disappearing\" when visibility is affected by lamp-light or corners.
  if (Array.isArray(ctx.npcs)) {
    for (const n of ctx.npcs) {
      if (n.x < startX || n.x > endX || n.y < startY || n.y > endY) continue;

      // Suppress downstairs NPCs inside the inn footprint when upstairs overlay is active
      if (ctx.innUpstairsActive && ctx.tavern && ctx.tavern.building) {
        const b = ctx.tavern.building;
        if (n.x > b.x && n.x < b.x + b.w - 1 && n.y > b.y && n.y < b.y + b.h - 1) {
          continue;
        }
      }

      const everSeen = !!(seen[n.y] && seen[n.y][n.x]);
      if (!everSeen) continue;

      const isVisible = !!(visible[n.y] && visible[n.y][n.x]);

      // Only check LOS when currently visible; otherwise we'll draw dim without LOS gating
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

      // Pets: cat 'c', dog 'd'; Seppo 'S'; others 'n'
      let glyph = "n";
      let color = "#b4f9f8";
      if (n.isPet) {
        if (n.kind === "cat") glyph = "c";
        else if (n.kind === "dog") glyph = "d";
      } else if (n.isSeppo || n.seppo) {
        glyph = "S";
        color = "#f6c177";
      } else if (n.isShopkeeper || n._shopRef) {
        // Highlight shopkeepers so the player can spot them easily
        color = "#ffd166"; // warm gold
      }

      // Dim draw when not visible or visible-without-LOS; full draw when visible with LOS
      const drawDim = (!isVisible || !hasLine);
      if (drawDim) {
        ctx2d.save();
        ctx2d.globalAlpha = 0.70;
        RenderCore.drawGlyph(ctx2d, screenX, screenY, glyph, color, TILE);
        ctx2d.restore();
      } else {
        RenderCore.drawGlyph(ctx2d, screenX, screenY, glyph, color, TILE);
      }

      // Sleeping indicator: show 'Z' decal even when dim; reduce alpha if not in LOS
      if (n._sleeping) {
        const t = Date.now();
        const phase = Math.floor(t / 600) % 2; // toggle every ~0.6s
        const zChar = phase ? "Z" : "z";
        const bob = Math.sin(t / 500) * 3;
        const zx = screenX + TILE / 2 + 8;          // slight right offset
        const zy = screenY + TILE / 2 - TILE * 0.6 + bob; // above head
        ctx2d.save();
        ctx2d.globalAlpha = drawDim ? 0.55 : 0.9;
        ctx2d.fillStyle = "#a3be8c";
        ctx2d.fillText(zChar, zx, zy);
        ctx2d.restore();
      }
    }
  }

  // Debug overlays and effects
  RenderOverlays.drawTownDebugOverlay(ctx, view);
  RenderOverlays.drawTownPaths(ctx, view);
  RenderOverlays.drawTownHomePaths(ctx, view);
  RenderOverlays.drawTownRoutePaths(ctx, view);
  RenderOverlays.drawLampGlow(ctx, view);

  // Gate highlight: draw a bright outline and a large 'G' glyph on the gate interior tile.
  // If ctx.townExitAt is missing, fall back to scanning the perimeter door and computing the adjacent interior tile.
  (function drawGate() {
    let gx = null, gy = null;
    if (ctx.townExitAt && typeof ctx.townExitAt.x === "number" && typeof ctx.townExitAt.y === "number") {
      gx = ctx.townExitAt.x; gy = ctx.townExitAt.y;
    } else {
      try {
        const rows = mapRows, cols = mapCols;
        // top row -> inside at y=1
        for (let x = 0; x < cols && gx == null; x++) {
          if (map[0][x] === TILES.DOOR) { gx = x; gy = 1; }
        }
        // bottom row -> inside at y=rows-2
        for (let x = 0; x < cols && gx == null; x++) {
          if (map[rows - 1][x] === TILES.DOOR) { gx = x; gy = rows - 2; }
        }
        // left column -> inside at x=1
        for (let y = 0; y < rows && gx == null; y++) {
          if (map[y][0] === TILES.DOOR) { gx = 1; gy = y; }
        }
        // right column -> inside at x=cols-2
        for (let y = 0; y < rows && gx == null; y++) {
          if (map[y][cols - 1] === TILES.DOOR) { gx = cols - 2; gy = y; }
        }
      } catch (_) {}
    }
    if (gx == null || gy == null) return;
    if (gx < startX || gx > endX || gy < startY || gy > endY) return;

    const screenX = (gx - startX) * TILE - tileOffsetX;
    const screenY = (gy - startY) * TILE - tileOffsetY;
    ctx2d.save();
    const t = Date.now();
    const pulse = 0.55 + 0.45 * Math.abs(Math.sin(t / 520));
    ctx2d.globalAlpha = pulse;
    ctx2d.lineWidth = 3;
    ctx2d.strokeStyle = "#9ece6a";
    ctx2d.strokeRect(screenX + 2.5, screenY + 2.5, TILE - 5, TILE - 5);
    // Large 'G' glyph centered on the gate tile
    try {
      ctx2d.globalAlpha = 0.95;
      RenderCore.drawGlyph(ctx2d, screenX, screenY, "G", "#9ece6a", TILE);
    } catch (_) {}
    ctx2d.restore();
  })();

  // player - add subtle backdrop + outlined glyph so it stands out in town view
  if (player.x >= startX && player.x <= endX && player.y >= startY && player.y <= endY) {
    const screenX = (player.x - startX) * TILE - tileOffsetX;
    const screenY = (player.y - startY) * TILE - tileOffsetY;

    ctx2d.save();
    ctx2d.fillStyle = "rgba(255,255,255,0.16)";
    ctx2d.fillRect(screenX + 4, screenY + 4, TILE - 8, TILE - 8);
    ctx2d.strokeStyle = "rgba(255,255,255,0.35)";
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
      RenderCore.drawGlyph(ctx2d, screenX, screenY, "G", "#9ece6a", TILE);
      ctx2d.restore();
    }
  }

  // Day/night tint overlay
  try {
    const time = ctx.time;
    if (time && time.phase) {
      ctx2d.save();
      if (time.phase === "night") {
        ctx2d.fillStyle = "rgba(0,0,0,0.35)";
        ctx2d.fillRect(0, 0, cam.width, cam.height);
      } else if (time.phase === "dusk") {
        ctx2d.fillStyle = "rgba(255,120,40,0.12)";
        ctx2d.fillRect(0, 0, cam.width, cam.height);
      } else if (time.phase === "dawn") {
        ctx2d.fillStyle = "rgba(120,180,255,0.10)";
        ctx2d.fillRect(0, 0, cam.width, cam.height);
      }
      ctx2d.restore();
    }
  } catch (_) {}

  // Grid overlay (if enabled)
  RenderCore.drawGridOverlay(view);
}

// Back-compat: attach to window via helper
attachGlobal("RenderTown", { draw });