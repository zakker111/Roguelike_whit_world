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
    // Treat ROAD like FLOOR for fallback to avoid legacy brown leakage.
    if (type === TILES.ROAD) return (COLORS && COLORS.floorLit) || (COLORS && COLORS.floor) || "#0f1628";
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

  
  // Developer toggles via URL params or localStorage (safe fallbacks)
  function readToggle(name, lsKey, defaultVal = false) {
    try {
      const params = new URLSearchParams(location.search);
      let v = params.get(name);
      if (v != null) {
        v = String(v).toLowerCase();
        if (v === "1" || v === "true") return true;
        if (v === "0" || v === "false") return false;
      }
    } catch (_) {}
    try {
      const ls = localStorage.getItem(lsKey);
      if (ls === "1") return true;
      if (ls === "0") return false;
    } catch (_) {}
    return !!defaultVal;
  }
  const __forceGrass = readToggle("town_force_grass", "TOWN_FORCE_GRASS", false);
  const __roadsAsFloor = readToggle("town_roads_as_floor", "TOWN_ROADS_AS_FLOOR", false);
  // Default ON for diagnostic deploy; disable with ?town_biome_debug=0
  const __biomeDebug = readToggle("town_biome_debug", "TOWN_BIOME_DEBUG", true);
  // Verbose ground logging so we can trace exactly which color floors use. Disable with ?town_ground_log=0
  const __groundLog = readToggle("town_ground_log", "TOWN_GROUND_LOG", true);
  // Wait for palette-derived ground color before building the base cache. Disable with ?town_wait_pal=0
  const __waitForPalette = readToggle("town_wait_pal", "TOWN_WAIT_PAL", true);
  // Extremely detailed per-tile trace for ground: FLOOR/ROAD lines including final colors.
  const __tileTrace = readToggle("town_tile_trace", "TOWN_TILE_TRACE", true);
  const __tileTracePlayer = readToggle("town_tile_trace_player", "TOWN_TILE_TRACE_PLAYER", true);
  function readNumber(name, lsKey, defVal = 2000) {
    let v = defVal;
    try {
      const params = new URLSearchParams(location.search);
      const p = params.get(name);
      if (p != null) { const n = parseInt(p, 10); if (!Number.isNaN(n)) v = n; }
    } catch (_) {}
    try {
      const ls = localStorage.getItem(lsKey);
      if (ls != null) { const n = parseInt(ls, 10); if (!Number.isNaN(n)) v = n; }
    } catch (_) {}
    return v;
  }
  // Hex reader for overrides
  function readHex(name, lsKey) {
    function okHex(v) { return /^#?[0-9a-f]{6}$/i.test(v || ""); }
    let out = null;
    try {
      const params = new URLSearchParams(location.search);
      const p = params.get(name);
      if (p && okHex(p)) out = p.startsWith("#") ? p : ("#" + p);
    } catch (_) {}
    try {
      const ls = localStorage.getItem(lsKey);
      if (ls && okHex(ls)) out = ls.startsWith("#") ? ls : ("#" + ls);
    } catch (_) {}
    return out;
  }
  const __tileTraceMax = readNumber("town_tile_trace_max", "TOWN_TILE_TRACE_MAX", 3000);
  // Color audit for summary of final colors used on ground
  const __colorAudit = readToggle("town_color_audit", "TOWN_COLOR_AUDIT", true);
  const __auditMaxPos = readNumber("town_color_audit_max_pos", "TOWN_COLOR_AUDIT_MAX_POS", 40);
  // Disable road overlay entirely (to isolate base colors)
  const __noRoadOverlay = readToggle("town_no_road_overlay", "TOWN_NO_ROAD_OVERLAY", false);
  // Global kill-switch: do not render or treat any roads specially; flatten to floor in rendering.
  const __noRoads = readToggle("town_no_roads", "TOWN_NO_ROADS", true);
  // Force override of biome ground hex (e.g., town_ground_override=ffffff)
  const __groundOverrideHex = readHex("town_ground_override", "TOWN_GROUND_OVERRIDE");

  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;

  if (__noRoads && __groundLog) {
    try { L("No-roads mode: rendering flattens ROAD->FLOOR and skips overlay."); } catch (_) {}
  }

  // Local logger helper (also buffers messages for on-screen overlay)
  function L(msg, level = "notice") {
    try {
      if (!__groundLog) return;
      const m = String(msg);
      const tone = level || "notice";
      if (ctx && typeof ctx.log === "function") ctx.log(m, tone);
      if (typeof console !== "undefined") console.log("[RenderTown] " + m);
      try {
        ctx.__groundMsgs = Array.isArray(ctx.__groundMsgs) ? ctx.__groundMsgs : [];
        ctx.__groundMsgs.push(m);
        if (ctx.__groundMsgs.length > 24) ctx.__groundMsgs.shift();
      } catch (_) {}
    } catch (_) {}
  }

  // Tile trace helpers
  function toName(type) {
    try {
      const T = TILES;
      if (type === T.WALL) return "WALL";
      if (type === T.FLOOR) return "FLOOR";
      if (type === T.ROAD) return "ROAD";
      if (type === T.DOOR) return "DOOR";
      if (type === T.WINDOW) return "WINDOW";
      if (type === T.STAIRS) return "STAIRS";
      return String(type);
    } catch (_) { return String(type); }
  }
  function commitTileTrace(lines, label) {
    try {
      if (!__tileTrace) return;
      ctx.__tileTrace = Array.isArray(lines) ? lines : [];
      const total = ctx.__tileTrace.length;
      L(`${label}: tileTrace=${total} lines.`, "notice");
      if (!__tileTracePlayer) return;
      // Emit at most __tileTraceMax lines into player log
      const cap = Math.max(0, __tileTraceMax | 0);
      const toEmit = cap > 0 ? ctx.__tileTrace.slice(0, cap) : ctx.__tileTrace;
      const chunk = 150;
      for (let i = 0; i < toEmit.length; i += chunk) {
        const part = toEmit.slice(i, i + chunk);
        if (ctx && typeof ctx.log === "function") ctx.log(part.join("\n"), "info");
      }
      if (total > toEmit.length && ctx && typeof ctx.log === "function") {
        ctx.log(`... ${total - toEmit.length} more tile lines not shown (raise town_tile_trace_max).`, "warn");
      }
    } catch (_) {}
  }

  

  // Helpers for biome-based outdoor ground tint
  function ensureTownBiome(ctx) {
    try {
      const world = ctx.world || {};
      const WMOD = (typeof window !== "undefined" ? window.World : null);
      const WT = WMOD && WMOD.TILES ? WMOD.TILES : null;
      const WT_GEN = (world && world.gen && world.gen.TILES) ? world.gen.TILES : null; // fallback when window.World is missing
      const TT = WT || WT_GEN;

      // Prefer existing biome if generation or load already set it
      let chosen = ctx.townBiome ? String(ctx.townBiome) : "";

      // Determine absolute world coords if available
      let wx = null, wy = null;
      if (ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number" && typeof ctx.worldReturnPos.y === "number") {
        wx = ctx.worldReturnPos.x | 0;
        wy = ctx.worldReturnPos.y | 0;
      }

      // If no biome yet, try persisted world.towns record
      let persisted = null;
      try {
        if (wx != null && wy != null) {
          const rec = (ctx.world && Array.isArray(ctx.world.towns)) ? ctx.world.towns.find(t => t && t.x === wx && t.y === wy) : null;
          if (rec && rec.biome) persisted = String(rec.biome);
        } else if (ctx.world && Array.isArray(ctx.world.towns)) {
          if (ctx.world.towns.length === 1 && ctx.world.towns[0] && ctx.world.towns[0].biome) {
            persisted = String(ctx.world.towns[0].biome);
          }
        }
      } catch (_) {}

      if (!chosen && persisted) chosen = persisted;

      // If still no biome and we can sample, do it now
      let counts = { DESERT:0, SNOW:0, BEACH:0, SWAMP:0, FOREST:0, GRASS:0 };
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
      function bump(tile) {
        if (!TT) return;
        if (tile === TT.DESERT) counts.DESERT++;
        else if (tile === TT.SNOW) counts.SNOW++;
        else if (tile === TT.BEACH) counts.BEACH++;
        else if (tile === TT.SWAMP) counts.SWAMP++;
        else if (tile === TT.FOREST) counts.FOREST++;
        else if (tile === TT.GRASS) counts.GRASS++;
      }

      let sampledAt = null;
      const MAX_R = 6;
      if (!chosen && wx != null && wy != null && TT) {
        for (let r = 1; r <= MAX_R; r++) {
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
              const t = worldTileAtAbs(wx + dx, wy + dy);
              if (t == null) continue;
              if (t === TT.TOWN || t === TT.DUNGEON || t === TT.RUINS) continue;
              bump(t);
            }
          }
        }
        const order = ["FOREST","GRASS","DESERT","BEACH","SNOW","SWAMP"];
        let best = "GRASS", bestV = -1;
        for (const k of order) { const v = counts[k] | 0; if (v > bestV) { bestV = v; best = k; } }
        chosen = best || "GRASS";
        sampledAt = { x: wx, y: wy };
      }

      // Apply final choice to context
      if (chosen) ctx.townBiome = chosen;

      // Publish counts and sampling metadata
      try {
        ctx.townBiomeCounts = {
          GRASS: counts.GRASS | 0,
          FOREST: counts.FOREST | 0,
          DESERT: counts.DESERT | 0,
          BEACH: counts.BEACH | 0,
          SNOW: counts.SNOW | 0,
          SWAMP: counts.SWAMP | 0
        };
        ctx.townBiomeSampleAt = sampledAt || (wx != null && wy != null ? { x: wx, y: wy } : { x: 0, y: 0 });
        ctx.townBiomeMaxR = MAX_R | 0;
      } catch (_) {}

      // Persist chosen biome on world.towns record if possible
      try {
        if (wx != null && wy != null) {
          const rec = (ctx.world && Array.isArray(ctx.world.towns)) ? ctx.world.towns.find(t => t && t.x === wx && t.y === wy) : null;
          if (rec && typeof rec === "object" && !rec.biome && ctx.townBiome) rec.biome = ctx.townBiome;
        }
      } catch (_) {}

      // Final fallback
      if (!TT && !ctx.townBiome) {
        ctx.townBiome = "GRASS";
      }
    } catch (_) {
      // leave ctx.townBiome as-is
    }
  }
  function townBiomeFill(ctx) {
    try {
      const kRaw = String(ctx.townBiome || "");
      const kUp = kRaw.toUpperCase();
      const kTitle = kRaw ? (kRaw.charAt(0).toUpperCase() + kRaw.slice(1).toLowerCase()) : "";

      const GD = (typeof window !== "undefined" ? window.GameData : null);
      const pal = GD && GD.palette && GD.palette.townBiome ? GD.palette.townBiome : null;

      // Fallback defaults mirror data/world/palette.json townBiome block
      const defaults = {
        FOREST: "#1a2e1d",
        GRASS:  "#1b3a21",
        DESERT: "#c8b37a",
        BEACH:  "#d7c08e",
        SNOW:   "#93a7b6",
        SWAMP:  "#1d3624"
      };

      // Prefer live palette; then town_gen-published fill; then hard defaults by biome key.
      if (pal) {
        return pal[kUp] || pal[kRaw] || pal[kTitle] || ctx.townGroundFill || defaults[kUp] || null;
      }
      return ctx.townGroundFill || defaults[kUp] || null;
    } catch (_) {
      try {
        const k = String(ctx.townBiome || "").toUpperCase();
        const defaults = {
          FOREST: "#1a2e1d",
          GRASS:  "#1b3a21",
          DESERT: "#c8b37a",
          BEACH:  "#d7c08e",
          SNOW:   "#93a7b6",
          SWAMP:  "#1d3624"
        };
        return ctx.townGroundFill || defaults[k] || null;
      } catch (_2) { return null; }
    }
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
      if (__forceGrass) { try { ctx.townBiome = "GRASS"; } catch (_) {} }
      const biomeKey = String(ctx.townBiome || "");
      const townKey = (ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number" && typeof ctx.worldReturnPos.y === "number")
        ? `${ctx.worldReturnPos.x|0},${ctx.worldReturnPos.y|0}` : null;

      const wpx = mapCols * TILE;
      const hpx = mapRows * TILE;
      // If biome fill color changes (e.g., palette loads after first frame), rebuild the offscreen base.
      const currentBiomeFill = (function(){ try { return townBiomeFill(ctx); } catch (_) { return null; } })();
      const reasons = [];
      if (!TOWN.canvas) reasons.push("no-canvas");
      if (TOWN.mapRef !== map) reasons.push("mapRef");
      if (TOWN.wpx !== wpx) reasons.push("wpx");
      if (TOWN.hpx !== hpx) reasons.push("hpx");
      if (TOWN.TILE !== TILE) reasons.push("TILE");
      if (TOWN._tilesRef !== tilesRef()) reasons.push("tilesRef");
      if (TOWN._biomeKey !== biomeKey) reasons.push("biomeKey");
      if (TOWN._townKey !== townKey) reasons.push("townKey");
      if (TOWN._maskRef !== ctx.townOutdoorMask) reasons.push("maskRef");
      if (TOWN._biomeFill !== currentBiomeFill) reasons.push("biomeFill");
      const needsRebuild = reasons.length > 0;
      if (needsRebuild && __groundLog) {
        L(`Rebuild base offscreen. Reasons=[${reasons.join(", ")}] biome=${String(ctx.townBiome || "")} fill=${String(currentBiomeFill || "(null)")}`);
      }

      if (needsRebuild) {
        // Optional deferral: wait until we actually have a palette-derived fill before building the base cache.
        if (__waitForPalette && biomeKey && !currentBiomeFill) {
          // Keep references up to date so a subsequent pass can build immediately.
          TOWN.mapRef = map;
          TOWN.wpx = wpx;
          TOWN.hpx = hpx;
          TOWN.TILE = TILE;
          TOWN._tilesRef = tilesRef();
          TOWN._biomeKey = biomeKey;
          TOWN._townKey = townKey;
          TOWN._maskRef = ctx.townOutdoorMask;
          TOWN._biomeFill = null;
          if (__groundLog) L(`Deferring base build: waiting for palette fill; biome=${biomeKey}`);
        } else {
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
        let biomeFill = townBiomeFill(ctx);
        if (__groundOverrideHex) {
          biomeFill = __groundOverrideHex;
          if (__groundLog) L(`Ground override active: ${biomeFill}`);
        }
        if (__biomeDebug) {
          try {
            const m = `RenderTown: biome=${String(ctx.townBiome || "")} roadsAsFloor=${__roadsAsFloor ? 1 : 0}`;
            if (ctx.log) ctx.log(m, "info"); else if (typeof console !== "undefined") console.log("[RenderTown] " + m);
          } catch (_) {}
        }
        // Track mask reference to trigger rebuild when it changes externally
        TOWN._maskRef = ctx.townOutdoorMask;
        // Track the actual fill being used for floors; if this changes later (palette late-load), we will trigger another rebuild.
        TOWN._biomeFill = biomeFill;

          let floorsTotal = 0, floorsTinted = 0;
          let roadsTotal = 0, roadsTinted = 0;
          const sampleTinted = [];
          const tileLines = __tileTrace ? [] : null;
          const colorCounts = Object.create(null);
          const floorsByColor = Object.create(null);
          const roadsByColor = Object.create(null);
          const posByColor = Object.create(null);
          for (let yy = 0; yy < mapRows; yy++) {
            const rowMap = map[yy];
            for (let xx = 0; xx < mapCols; xx++) {
              const type = rowMap[xx];
              const sx = xx * TILE, sy = yy * TILE;
              // Treat roads as floor when toggle is active
              let renderType = type;
              if ((__roadsAsFloor || __noRoads) && type === TILES.ROAD) renderType = TILES.FLOOR;

              // Cached fill color: prefer town JSON, then dungeon JSON; else robust fallback
              const baseFill = fillTownFor(TILES, renderType, COLORS);
              let fill = baseFill;
              // Apply biome tint to all FLOOR tiles unconditionally; also tint explicit ROAD tiles with biome color.
              // This avoids any brown fallback dominating the appearance.
              let tinted = false;
              try {
                if (renderType === TILES.FLOOR) {
                  floorsTotal++;
                  if (biomeFill) {
                    fill = biomeFill;
                    tinted = true;
                    floorsTinted++;
                    if (sampleTinted.lengt << 8) sampleTinted.push(`${xx},${yy}`);
                  }
                } else if (type === TILES.ROAD) {
                  roadsTotal++;
                  if (biomeFill) {
                    fill = biomeFill;
                    tinted = true;
                    roadsTinted++;
                  }
                } else if (type === TILES.DOOR || type === TILES.STAIRS) {
                  // Eliminate brown fallback on DOOR/STAIRS by tinting with biome as well
                  if (biomeFill) {
                    fill = biomeFill;
                    tinted = true;
                  }
                }
              } catch (_) new{</}

              if (__tileTrace && (renderType === TILES.FLOOR || type === TILES.ROAD)) {
                tileLines.push(`TILE x=${xx} y=${yy} kind=${toName(type)} render=${toName(renderType)} baseFill=${baseFill} biomeFill=${String(biomeFill||"(null)")} final=${fill} tinted=${tinted ? 1 : 0}`);
              }
              // Color counts
              try {
                const key = String(fill);
                colorCounts[key] = (colorCounts[key] | 0) + 1;
                if (renderType === TILES.FLOOR) floorsByColor[key] = (floorsByColor[key] | 0) + 1;
                if (type === TILES.ROAD) roadsByColor[key] = (roadsByColor[key] | 0) + 1;
                if (key !== String(biomeFill)) {
                  posByColor[key] = posByColor[key] || [];
                  if (posByColor[key].length < __auditMaxPos) posByColor[key].push(`${xx},${yy}`);
                }
              } catch (_) {}
              oc.fillStyle = fill;
              oc.fillRect(sx, sy, TILE, TILE);
            }
          }
          if (__groundLog) {
            L(`Base build: floors=${floorsTotal} tinted=${floorsTinted} roads=${roadsTotal} roadsTinted=${roadsTinted} fill=${String(biomeFill || "(null)")} samples=[${sampleTinted.join(" ")}]`);
          }
          if (__colorAudit) {
            try {
              const entries = Object.keys(colorCounts).map(k => ({ color: k, n: colorCounts[k]|0, floors: floorsByColor[k]|0, roads: roadsByColor[k]|0 }));
              entries.sort((a,b) => b.n - a.n);
              const tops = entries.slice(0, 8).map(e => `${e.color}: total=${e.n} floors=${e.floors} roads=${e.roads}`).join(" | ");
              L(`Color audit (base): unique=${entries.length} top=[${tops}]`);
              // Show first few positions for any non-biome colors
              let shown = 0;
              for (let i = 0; i < entries.length && shown < 3; i++) {
                const e = entries[i];
                if (String(e.color) === String(biomeFill)) continue;
                const pts = (posByColor[e.color] || []).slice(0, 20).join(" ");
                if (pts) L(`Color '${e.color}' sample tiles: ${pts}`, "info");
                shown++;
              }
            } catch (_) {}
          }
          if (__tileTrace) {
            commitTileTrace(tileLines, "Base build tile trace");
          }
          TOWN.canvas = off;
        }
      }
    }
  } catch (_) {}

  // Blit base layer if available
  if (TOWN.canvas) {
    try {
      RenderCore.blitViewport(ctx2d, TOWN.canvas, cam, TOWN.wpx, TOWN.hpx);
      if (__groundLog && !TOWN._blitLogged) { L(`Blit base: cached offscreen used. biome=${String(ctx.townBiome||"")} fill=${String(TOWN._biomeFill||"(null)")}`); TOWN._blitLogged = true; }
    } catch (_) {}
  } else {
    // Fallback: draw base tiles in viewport using JSON colors or robust fallback
    ensureTownBiome(ctx);
    if (__forceGrass) { try { ctx.townBiome = "GRASS"; } catch (_) {} }
    ensureOutdoorMask(ctx);
    let biomeFill = townBiomeFill(ctx);
    if (__groundOverrideHex) {
      biomeFill = __groundOverrideHex;
      if (__groundLog) L(`Ground override active: ${biomeFill}`);
    }
    let floorsTotalView = 0, floorsTintedView = 0;
    let roadsTotalView = 0, roadsTintedView = 0;
    const sampleView = [];
    const tileLines = __tileTrace ? [] : null;
    const colorCountsV = Object.create(null);
    const floorsByColorV = Object.create(null);
    const roadsByColorV = Object.create(null);
    const posByColorV = Object.create(null);
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
        let renderType = type;
        if ((__roadsAsFloor || __noRoads) && type === TILES.ROAD) renderType = TILES.FLOOR;
        const td = getTileDef("town", renderType) || getTileDef("dungeon", renderType) || null;
        const baseFill = (td && td.colors && td.colors.fill) ? td.colors.fill : fallbackFillTown(TILES, renderType, COLORS);
        let fill = baseFill;
        // Apply biome tint to all FLOOR tiles; also tint explicit ROAD tiles.
        let tinted = false;
        try {
          if (renderType === TILES.FLOOR) {
            floorsTotalView++;
            if (biomeFill) {
              fill = biomeFill;
              tinted = true;
              floorsTintedView++;
              if (sampleView.length < 6) sampleView.push(`${x},${y}`);
            }
          } else if (type === TILES.ROAD) {
            roadsTotalView++;
            if (biomeFill) {
              fill = biomeFill;
              tinted = true;
              roadsTintedView++;
            }
          } else if (type === TILES.DOOR || type === TILES.STAIRS) {
            // Eliminate brown fallback on DOOR/STAIRS by tinting with biome as well
            if (biomeFill) {
              fill = biomeFill;
              tinted = true;
            }
          }
        } catch (_) {}
        if (__tileTrace && (renderType === TILES.FLOOR || type === TILES.ROAD)) {
          tileLines.push(`TILE x=${x} y=${y} kind=${toName(type)} render=${toName(renderType)} baseFill=${baseFill} biomeFill=${String(biomeFill||"(null)")} final=${fill} tinted=${tinted ? 1 : 0}`);
        }
        try {
          const key = String(fill);
          colorCountsV[key] = (colorCountsV[key] | 0) + 1;
          if (renderType === TILES.FLOOR) floorsByColorV[key] = (floorsByColorV[key] | 0) + 1;
          if (type === TILES.ROAD) roadsByColorV[key] = (roadsByColorV[key] | 0) + 1;
          if (key !== String(biomeFill)) {
            posByColorV[key] = posByColorV[key] || [];
            if (posByColorV[key].length < __auditMaxPos) posByColorV[key].push(`${x},${y}`);
          }
        } catch (_) {}
        ctx2d.fillStyle = fill;
        ctx2d.fillRect(screenX, screenY, TILE, TILE);
      }
    }
    if (__groundLog) {
      L(`Fallback draw: floors=${floorsTotalView} tinted=${floorsTintedView} roads=${roadsTotalView} roadsTinted=${roadsTintedView} fill=${String(biomeFill || "(null)")} samples=[${sampleView.join(" ")}]`);
    }
    if (__colorAudit) {
      try {
        const entries = Object.keys(colorCountsV).map(k => ({ color: k, n: colorCountsV[k]|0, floors: floorsByColorV[k]|0, roads: roadsByColorV[k]|0 }));
        entries.sort((a,b) => b.n - a.n);
        const tops = entries.slice(0, 8).map(e => `${e.color}: total=${e.n} floors=${e.floors} roads=${e.roads}`).join(" | ");
        L(`Color audit (fallback): unique=${entries.length} top=[${tops}]`);
        let shown = 0;
        for (let i = 0; i < entries.length && shown < 3; i++) {
          const e = entries[i];
          if (String(e.color) === String(biomeFill)) continue;
          const pts = (posByColorV[e.color] || []).slice(0, 20).join(" ");
          if (pts) L(`Color '${e.color}' sample tiles: ${pts}`, "info");
          shown++;
        }
      } catch (_) {}
    }
    if (__tileTrace) {
      commitTileTrace(tileLines, "Fallback draw tile trace");
    }
  }

  // Road overlay pass:
  // 1) Prefer explicit ROAD tiles (authoritative).
  // 2) If no ROAD tiles are present in view (e.g., older saved towns), fall back to townRoads mask over FLOOR tiles.
  (function drawRoadOverlay() {
    try {
      // Developer toggle: render roads as floor; or explicitly disable overlay to isolate base colors
      if (__roadsAsFloor || __noRoadOverlay || __noRoads) {
        if (__groundLog) L("Road overlay: disabled (roadsAsFloor/noRoadOverlay/noRoads active)");
        return;
      }

      // Use biome fill for roads so town ground color matches chosen biome.
      // If palette/fill not ready yet, skip road overlay entirely to avoid brown fallback dominating visuals.
      const fillNow = (function () { try { return townBiomeFill(ctx); } catch (_) { return null; } })();
      if (!fillNow) {
        if (__groundLog) L("Road overlay: skipped (no biome fill yet)");
        return;
      }
      const roadOverlayColor = fillNow;

      let anyRoad = false;
      for (let y = startY; y <= endY && !anyRoad; y++) {
        const yIn = y >= 0 && y < mapRows;
        if (!yIn) continue;
        for (let x = startX; x <= endX; x++) {
          if (x < 0 || x >= mapCols) continue;
          if (map[y][x] === TILES.ROAD) { anyRoad = true; break; }
        }
      }

      let overlayCount = 0;
      if (anyRoad) {
        for (let y = startY; y <= endY; y++) {
          const yIn = y >= 0 && y < mapRows;
          if (!yIn) continue;
          for (let x = startX; x <= endX; x++) {
            if (x < 0 || x >= mapCols) continue;
            if (map[y][x] !== TILES.ROAD) continue;
            const screenX = (x - startX) * TILE - tileOffsetX;
            const screenY = (y - startY) * TILE - tileOffsetY;
            ctx2d.fillStyle = roadOverlayColor;
            ctx2d.fillRect(screenX, screenY, TILE, TILE);
            overlayCount++;
          }
        }
      } else if (ctx.townRoads) {
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
            ctx2d.fillStyle = roadOverlayColor;
            ctx2d.fillRect(screenX, screenY, TILE, TILE);
            overlayCount++;
          }
        }
      }
      if (__groundLog) L(`Road overlay: applied tiles=${overlayCount} color=${roadOverlayColor}`);
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
          // Upstairs stairs glyph
          if (type === TILES.STAIRS) {
            RenderCore.drawGlyph(ctx2d, screenX, screenY, ">", "#d7ba7d", TILE);
          }
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

      // Stairs: explicit fallback glyph/color to ensure visibility
      if (type === TILES.STAIRS) {
        const g = ">";
        const c = "#d7ba7d";
        RenderCore.drawGlyph(ctx2d, screenX, screenY, g, c, TILE);
        continue;
      }

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
  (function drawStairsGlyphTop() {
    try {
      for (let y = startY; y <= endY; y++) {
        const yIn = y >= 0 && y < mapRows;
        if (!yIn) continue;
        for (let x = startX; x <= endX; x++) {
          if (x < 0 || x >= mapCols) continue;
          const type = map[y][x];
          if (type !== TILES.STAIRS) continue;
          const everSeen = !!(seen[y] && seen[y][x]);
          if (!everSeen) continue;
          const screenX = (x - startX) * TILE - tileOffsetX;
          const screenY = (y - startY) * TILE - tileOffsetY;
          RenderCore.drawGlyph(ctx2d, screenX, screenY, ">", "#d7ba7d", TILE);
        }
      }
    } catch (_) {}
  })();

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

  // Biome debug panel (top-left) when enabled
  (function drawBiomeDebugPanel() {
    if (!__biomeDebug) return;
    try {
      const counts = ctx.townBiomeCounts || {};
      const at = ctx.townBiomeSampleAt || {};
      const lines = [];
      lines.push(`Town Biome: ${String(ctx.townBiome || "(unknown)")}`);
      try {
        const fill = townBiomeFill(ctx);
        if (fill) lines.push(`Fill color: ${fill}`);
      } catch (_) {}
      lines.push(`Counts: GRASS=${counts.GRASS|0}, FOREST=${counts.FOREST|0}`);
      lines.push(`        DESERT=${counts.DESERT|0}, BEACH=${counts.BEACH|0}`);
      lines.push(`        SNOW=${counts.SNOW|0}, SWAMP=${counts.SWAMP|0}`);
      if (typeof at.x === "number" && typeof at.y === "number") {
        lines.push(`Sample@ ${at.x},${at.y}  R=${(ctx.townBiomeMaxR|0)}`);
      }
      if (__roadsAsFloor || __forceGrass) {
        lines.push(`Flags: roadsAsFloor=${__roadsAsFloor ? "1" : "0"} forceGrass=${__forceGrass ? "1" : "0"}`);
      }

      const padX = 10, padY = 8, lineH = Math.max(14, Math.floor(TILE * 0.65));
      const width = Math.min(360, Math.max(180, Math.floor(TILE * 8)));
      const height = padY * 2 + lineH * lines.length;
      const x0 = 8, y0 = 8;

      ctx2d.save();
      // Panel background
      ctx2d.fillStyle = "rgba(10, 12, 18, 0.80)";
      ctx2d.fillRect(x0, y0, width, height);
      // Border
      ctx2d.strokeStyle = "#94a3b8";
      ctx2d.lineWidth = 1;
      ctx2d.strokeRect(x0 + 0.5, y0 + 0.5, width - 1, height - 1);
      // Text
      const prevFont = ctx2d.font;
      ctx2d.font = "bold 13px JetBrains Mono, monospace";
      ctx2d.textAlign = "left";
      ctx2d.textBaseline = "middle";
      let yy = y0 + padY + lineH / 2;
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i];
        ctx2d.fillStyle = i === 0 ? "#e2e8f0" : "#cbd5e1";
        ctx2d.fillText(text, x0 + padX, yy);
        yy += lineH;
      }
      ctx2d.font = prevFont;
      ctx2d.restore();
    } catch (_) {}
  })();

  // Ground diagnostics log overlay (top-right). Shows last N ground-color logs on screen.
  (function drawGroundLogPanel() {
    if (!__groundLog) return;
    try {
      const logs = Array.isArray(ctx.__groundMsgs) ? ctx.__groundMsgs : [];
      if (!logs.length) return;
      const maxLines = Math.min(12, logs.length);
      const lines = logs.slice(logs.length - maxLines);

      const padX = 10, padY = 8, lineH = Math.max(14, Math.floor(TILE * 0.60));
      const width = Math.min(560, Math.max(260, Math.floor(TILE * 10)));
      const height = padY * 2 + lineH * (lines.length + 1);
      const x0 = Math.max(8, (cam.width - width - 8));
      const y0 = 8;

      ctx2d.save();
      // Panel background
      ctx2d.fillStyle = "rgba(10,12,18,0.80)";
      ctx2d.fillRect(x0, y0, width, height);
      // Border
      ctx2d.strokeStyle = "#64748b";
      ctx2d.lineWidth = 1;
      ctx2d.strokeRect(x0 + 0.5, y0 + 0.5, width - 1, height - 1);
      // Title + lines
      const prevFont = ctx2d.font;
      ctx2d.font = "bold 13px JetBrains Mono, monospace";
      ctx2d.textAlign = "left";
      ctx2d.textBaseline = "middle";
      let yy = y0 + padY + lineH / 2;
      ctx2d.fillStyle = "#e2e8f0";
      ctx2d.fillText("Town Ground Diagnostics", x0 + padX, yy);
      yy += lineH;
      for (let i = 0; i < lines.length; i++) {
        ctx2d.fillStyle = "#cbd5e1";
        ctx2d.fillText(lines[i], x0 + padX, yy);
        yy += lineH;
      }
      ctx2d.font = prevFont;
      ctx2d.restore();
    } catch (_) {}
  })();
}

// Back-compat: attach to window via helper
attachGlobal("RenderTown", { draw });