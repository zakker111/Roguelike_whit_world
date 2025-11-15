/**
 * RenderDungeon: draws dungeon tiles, decals, corpses/chests, enemies, player.
 *
 * Notes:
 * - Base layer is cached offscreen; encounter maps use palette/theme-derived colors when tileset entries are missing.
 * - In encounter mode, exits render as tinted squares (no '>' glyph); consistent with Region Map exits.
 * - Draw order: base → glyph overlay → visibility tints → encounter exit overlay → decals → corpses/chests → props → enemies → player → glow → grid overlay.
 *
 * Exports (ESM + window.RenderDungeon):
 * - draw(ctx, view)
 */
import * as RenderCore from "./render_core.js";
import * as RenderOverlays from "./render_overlays.js";
import { getTileDef, getTileDefByKey } from "../data/tile_lookup.js";
import { drawBiomeDecor, drawEncounterExitOverlay, drawDungeonExitOverlay } from "./decor_overlays.js";
import { attachGlobal } from "../utils/global.js";
import { shade as _shade } from "./color_utils.js";

// Base layer offscreen cache for dungeon (tiles only; overlays drawn per frame)
let DUN = { mapRef: null, canvas: null, wpx: 0, hpx: 0, TILE: 0, _tilesRef: null };

// getTileDef moved to centralized helper in ../data/tile_lookup.js

// Helper: robust fallback fill for dungeon tiles when tiles.json is missing/incomplete
function fallbackFillDungeon(TILES, type, COLORS) {
  try {
    if (type === TILES.WALL) return (COLORS && COLORS.wall) || "#1b1f2a";
    if (type === TILES.FLOOR) return (COLORS && COLORS.floorLit) || (COLORS && COLORS.floor) || "#0f1628";
    if (type === TILES.DOOR) return "#3a2f1b";
    if (type === TILES.STAIRS) return "#3a2f1b";
    if (type === TILES.WINDOW) return "#295b6e";
  } catch (_) {}
  return "#0b0c10";
}

// Tile cache to avoid repeated JSON lookups inside hot loops (depends on tiles.json ref and encounter biome)
const TILE_CACHE = { ref: null, biome: null, fill: Object.create(null), glyph: Object.create(null), fg: Object.create(null) };
function cacheResetIfNeeded(encounterBiomeRef) {
  const ref = (typeof window !== "undefined" && window.GameData) ? window.GameData.tiles : null;
  const bKey = String(encounterBiomeRef || "");
  if (TILE_CACHE.ref !== ref || TILE_CACHE.biome !== bKey) {
    TILE_CACHE.ref = ref;
    TILE_CACHE.biome = bKey;
    TILE_CACHE.fill = Object.create(null);
    TILE_CACHE.glyph = Object.create(null);
    TILE_CACHE.fg = Object.create(null);
  }
}
function fillDungeonFor(TILES, type, COLORS, themeFn) {
  cacheResetIfNeeded(typeof themeFn === "function" ? themeFn.__biomeKey : null);
  const k = type | 0;
  let v = TILE_CACHE.fill[k];
  if (v) return v;
  const td = getTileDef("dungeon", type);
  const theme = typeof themeFn === "function" ? themeFn(type) : null;
  v = theme || (td && td.colors && td.colors.fill) || fallbackFillDungeon(TILES, type, COLORS);
  TILE_CACHE.fill[k] = v;
  return v;
}
function glyphDungeonFor(type) {
  cacheResetIfNeeded(null);
  const k = type | 0;
  let g = TILE_CACHE.glyph[k];
  let c = TILE_CACHE.fg[k];
  if (typeof g !== "undefined" && typeof c !== "undefined") return { glyph: g, fg: c };
  const td = getTileDef("dungeon", type);
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

// getTileDefByKey moved to centralized helper in ../data/tile_lookup.js

export function draw(ctx, view) {
  const {
    ctx2d, TILE, COLORS, TILES, TS, tilesetReady,
    map, seen, visible, player, enemies, corpses,
    cam, tileOffsetX, tileOffsetY, startX, startY, endX, endY
  } = Object.assign({}, view, ctx);

  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;

  // Hoist tileset capability check outside hot loops
  const canTileset = !!(tilesetReady && TS && typeof TS.draw === "function" && ctx.mode !== "encounter");

  // Color helpers moved to ./color_utils.js
  function biomeBaseFill() {
    const b = String(ctx.encounterBiome || "").toUpperCase();
    if (!b) return null;
    const key = (b === "FOREST") ? "FOREST"
              : (b === "GRASS") ? "GRASS"
              : (b === "DESERT") ? "DESERT"
              : (b === "SNOW") ? "SNOW"
              : (b === "BEACH") ? "BEACH"
              : (b === "SWAMP") ? "SWAMP"
              : null;
    // Prefer palette.json encounterBiome table
    try {
      const GD = (typeof window !== "undefined" ? window.GameData : null);
      const pal = GD && GD.palette && GD.palette.encounterBiome ? GD.palette.encounterBiome : null;
      const hexFromPalette = pal && b ? pal[b] : null;
      if (hexFromPalette) return hexFromPalette;
    } catch (_) {}
    // Next, try tiles.json (overworld/region entries)
    try {
      const td = key ? (getTileDefByKey("overworld", key) || getTileDefByKey("region", key)) : null;
      const hex = (td && td.colors && td.colors.fill) ? td.colors.fill : null;
      if (hex) return hex;
    } catch (_) {}
    // Fallback palette for encounters when data is missing
    const fallback = {
      FOREST: "#163a22",
      GRASS:  "#1c522b",
      DESERT: "#cdaa70",
      BEACH:  "#dbc398",
      SNOW:   "#dfe5eb",
      SWAMP:  "#1e3c27"
    };
    return fallback[b] || "#1f2937"; // neutral dark slate fallback
  }
  function encounterFillFor(type) {
    if (!ctx.encounterBiome) return null;
    const base = biomeBaseFill();
    if (!base) return null;
    // Use lighter, biome-driven colors to avoid overly dark maps
    if (type === TILES.WALL) return _shade(base, 0.88);            // slightly darker than floor, not murky
    if (type === TILES.DOOR) return _shade(base, 1.06);            // slight highlight
    if (type === TILES.FLOOR || type === TILES.STAIRS) return base;
    return null;
  }
  // Tag with current biome key for cache invalidation
  try { encounterFillFor.__biomeKey = String(ctx.encounterBiome || ""); } catch (_) {}
  // Build base offscreen once per map/TILE change
  try {
    if (mapRows && mapCols) {
      const wpx = mapCols * TILE;
      const hpx = mapRows * TILE;
      const needsRebuild = (!DUN.canvas) || DUN.mapRef !== map || DUN.wpx !== wpx || DUN.hpx !== hpx || DUN.TILE !== TILE || DUN._tilesRef !== (typeof window !== "undefined" && window.GameData ? window.GameData.tiles : null);
      if (needsRebuild) {
        DUN.mapRef = map;
        DUN.wpx = wpx;
        DUN.hpx = hpx;
        DUN.TILE = TILE;
        DUN._tilesRef = (typeof window !== "undefined" && window.GameData ? window.GameData.tiles : null);
        const off = RenderCore.createOffscreen(wpx, hpx);
        const oc = off.getContext("2d");
        // Set font/align once for glyphs
        try {
          oc.font = "bold 20px JetBrains Mono, monospace";
          oc.textAlign = "center";
          oc.textBaseline = "middle";
        } catch (_) {}
        const baseHex = biomeBaseFill();
        const tintFloorA = 0.14, tintWallA = 0.20;
        for (let yy = 0; yy < mapRows; yy++) {
          const rowMap = map[yy];
          for (let xx = 0; xx < mapCols; xx++) {
            const type = rowMap[xx];
            const sx = xx * TILE, sy = yy * TILE;
            let key = "floor";
            if (type === TILES.WALL) key = "wall";
            else if (type === TILES.STAIRS) key = "stairs";
            else if (type === TILES.DOOR) key = "door";
            let drawn = false;
            if (canTileset) {
              drawn = TS.draw(oc, key, sx, sy, TILE);
            }
            if (!drawn) {
              // Cached fill (biome-aware theme -> dungeon JSON -> robust fallback)
              const fill = fillDungeonFor(TILES, type, COLORS, encounterFillFor);
              oc.fillStyle = fill;
              oc.fillRect(sx, sy, TILE, TILE);
              if (type === TILES.STAIRS && !canTileset) {
                // In encounter mode, exits are shown as tinted squares (not '>')
                if (ctx.mode !== "encounter") {
                  const tdStairs = getTileDef("dungeon", type) || getTileDef("dungeon", TILES.STAIRS);
                  const glyph = (tdStairs && Object.prototype.hasOwnProperty.call(tdStairs, "glyph")) ? tdStairs.glyph : ">";
                  const fg = (tdStairs && tdStairs.colors && tdStairs.colors.fg) || "#d7ba7d";
                  RenderCore.drawGlyph(oc, sx, sy, glyph, fg, TILE);
                }
              }
            }
            
          }
        }
        DUN.canvas = off;
        // Record tiles usage for diagnostics (dungeon mode)
        try {
          if (typeof window !== "undefined" && window.TilesValidation && typeof window.TilesValidation.recordMap === "function") {
            window.TilesValidation.recordMap({ mode: "dungeon", map });
          }
        } catch (_) {}
      }
    }
  } catch (_) {}

  // Blit base layer if available, otherwise draw base tiles within viewport
  if (DUN.canvas) {
    try {
      RenderCore.blitViewport(ctx2d, DUN.canvas, cam, DUN.wpx, DUN.hpx);
    } catch (_) {}
  } else {
    const baseHex = biomeBaseFill();
    const tintFloorA = 0.12, tintWallA = 0.18;
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
        let key = "floor";
        if (type === TILES.WALL) key = "wall";
        else if (type === TILES.STAIRS) key = "stairs";
        else if (type === TILES.DOOR) key = "door";
        let drawn = false;
        if (canTileset) {
          drawn = TS.draw(ctx2d, key, screenX, screenY, TILE);
        }
        if (!drawn) {
          // Cached fill color (biome-aware -> dungeon JSON -> robust fallback)
          const fill = fillDungeonFor(TILES, type, COLORS, encounterFillFor);
          ctx2d.fillStyle = fill;
          ctx2d.fillRect(screenX, screenY, TILE, TILE);
        }
              }
    }
  }

  // Per-frame glyph overlay for any dungeon tile with a non-blank JSON glyph (drawn before visibility overlays)
  for (let y = startY; y <= endY; y++) {
    const yIn = y >= 0 && y < mapRows;
    const rowMap = yIn ? map[y] : null;
    for (let x = startX; x <= endX; x++) {
      if (!yIn || x < 0 || x >= mapCols) continue;
      const type = rowMap[x];
      // In encounter mode, draw exits as tinted squares only (skip STAIRS glyph)
      if (ctx.mode === "encounter" && type === TILES.STAIRS) continue;
      const tg = glyphDungeonFor(type);
      const glyph = tg.glyph;
      const fg = tg.fg;
      if (glyph && String(glyph).trim().length > 0 && fg) {
        const screenX = (x - startX) * TILE - tileOffsetX;
        const screenY = (y - startY) * TILE - tileOffsetY;
        RenderCore.drawGlyph(ctx2d, screenX, screenY, glyph, fg, TILE);
      }
    }
  }

  // Biome-driven visual overlays (icons/textures) drawn before visibility overlays
  try { drawBiomeDecor(ctx, { ctx2d, TILE, TILES, map, startX, startY, endX, endY, tileOffsetX, tileOffsetY }); } catch (_) {}

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

  // Encounter exit overlay: tinted squares on STAIRS tiles (like Region Map edges)
  try { drawEncounterExitOverlay(ctx, { ctx2d, TILE, TILES, map, startX, startY, endX, endY, tileOffsetX, tileOffsetY }); } catch (_) {}
  // Dungeon exit overlay: subtle highlight under STAIRS glyph using tiles.json color
  try { drawDungeonExitOverlay(ctx, { ctx2d, TILE, TILES, map, startX, startY, endX, endY, tileOffsetX, tileOffsetY }); } catch (_) {}

  // decals (e.g., blood stains)
  if (ctx.decals && ctx.decals.length) {
    ctx2d.save();
    for (let i = 0; i < ctx.decals.length; i++) {
      const d = ctx.decals[i];
      const inView = (x, y) => x >= startX && x <= endX && y >= startY && y <= endY;
      if (!inView(d.x, d.y)) continue;
      const sx = (d.x - startX) * TILE - tileOffsetX;
      const sy = (d.y - startY) * TILE - tileOffsetY;
      const everSeen = seen[d.y] && seen[d.y][d.x];
      if (!everSeen) continue;
      const alpha = Math.max(0, Math.min(1, d.a || 0.2));
      if (alpha <= 0) continue;

      let usedTile = false;
      if (tilesetReady && TS) {
        const variant = ((d.x + d.y) % 3) + 1;
        const key = `decal.blood${variant}`;
        if (typeof TS.drawAlpha === "function") {
          usedTile = TS.drawAlpha(ctx2d, key, sx, sy, TILE, alpha);
        } else if (typeof TS.draw === "function") {
          const prev = ctx2d.globalAlpha;
          ctx2d.globalAlpha = alpha;
          usedTile = TS.draw(ctx2d, key, sx, sy, TILE);
          ctx2d.globalAlpha = prev;
        }
      }
      if (!usedTile) {
        const prev = ctx2d.globalAlpha;
        ctx2d.globalAlpha = alpha;
        ctx2d.fillStyle = "#7a1717";
        const r = Math.max(4, Math.min(TILE - 2, d.r || Math.floor(TILE * 0.4)));
        const cx = sx + TILE / 2;
        const cy = sy + TILE / 2;
        ctx2d.beginPath();
        ctx2d.arc(cx, cy, r, 0, Math.PI * 2);
        ctx2d.fill();
        ctx2d.globalAlpha = prev;
      }
    }
    ctx2d.restore();
  }

  // corpses and chests
  for (const c of corpses) {
    if (c.x < startX || c.x > endX || c.y < startY || c.y > endY) continue;
    const everSeen = !!(seen[c.y] && seen[c.y][c.x]);
    const visNow = !!(visible[c.y] && visible[c.y][c.x]);
    if (!everSeen) continue;
    const screenX = (c.x - startX) * TILE - tileOffsetX;
    const screenY = (c.y - startY) * TILE - tileOffsetY;

    const drawCorpseOrChest = () => {
      if (tilesetReady && TS) {
        const isChest = (c.kind === "chest");
        // For corpses: draw darker if looted by lowering alpha
        if (!isChest && c.looted && typeof TS.drawAlpha === "function") {
          if (TS.drawAlpha(ctx2d, "corpse", screenX, screenY, TILE, 0.55)) return;
        }
        // Normal tileset draw (chest or non-looted corpse)
        if (TS.draw(ctx2d, isChest ? "chest" : "corpse", screenX, screenY, TILE)) {
          return;
        }
      }
      // JSON-only: look up by key in tiles.json (prefer dungeon, then town/overworld); robust fallback glyph/color
      let glyph = "";
      // Palette-driven corpse colors (fallback to palette defaults if COLORS missing)
      let color = c.looted ? (COLORS.corpseEmpty || "#6b7280") : (COLORS.corpse || "#c3cad9");
      try {
        const key = String(c.kind || (c.kind === "chest" ? "chest" : "corpse")).toUpperCase();
        const td = getTileDefByKey("dungeon", key) || getTileDefByKey("town", key) || getTileDefByKey("overworld", key);
        if (td) {
          if (Object.prototype.hasOwnProperty.call(td, "glyph")) glyph = td.glyph || glyph;
          if (td.colors && td.colors.fg) color = td.colors.fg || color;
        }
      } catch (_) {}
      // Fallback glyphs if JSON missed
      if (!glyph) {
        if ((c.kind || "").toLowerCase() === "chest") glyph = "□";
        else glyph = "%";
      }
      // Shade glyph if looted
      if (c.looted) {
        ctx2d.save();
        ctx2d.globalAlpha = 0.6;
        RenderCore.drawGlyph(ctx2d, screenX, screenY, glyph, color, TILE);
        ctx2d.restore();
      } else {
        RenderCore.drawGlyph(ctx2d, screenX, screenY, glyph, color, TILE);
      }
    };

    if (visNow) {
      drawCorpseOrChest();
    } else {
      ctx2d.save();
      ctx2d.globalAlpha = 0.55;
      drawCorpseOrChest();
      ctx2d.restore();
    }
  }

  // Decorative encounter props (e.g., campfires)
  try {
    const props = Array.isArray(ctx.encounterProps) ? ctx.encounterProps : [];
    if (props.length) {
      for (const p of props) {
        const px = p.x | 0, py = p.y | 0;
        if (px < startX || px > endX || py < startY || py > endY) continue;
        const everSeen = !!(seen[py] && seen[py][px]);
        if (!everSeen) continue;
        const visNow = !!(visible[py] && visible[py][px]);
        const sx = (px - startX) * TILE - tileOffsetX;
        const sy = (py - startY) * TILE - tileOffsetY;

        if (p.type === "campfire") {
          // Prefer tileset mapping if available (custom key), else JSON glyph from town FIREPLACE
          let glyph = "♨";
          let color = "#ff6d00";
          try {
            const td = getTileDefByKey("town", "FIREPLACE");
            if (td) {
              if (Object.prototype.hasOwnProperty.call(td, "glyph")) glyph = td.glyph || glyph;
              if (td.colors && td.colors.fg) color = td.colors.fg || color;
            }
          } catch (_) {}

          // Subtle glow: draw a radial gradient under the glyph; stronger at night/dusk/dawn.
          try {
            const phase = (ctx.time && ctx.time.phase) || "day";
            const phaseMult = (phase === "night") ? 1.0 : (phase === "dusk" || phase === "dawn") ? 0.7 : 0.45;
            const cx = sx + TILE / 2;
            const cy = sy + TILE / 2;
            const r = TILE * (2.0 * phaseMult + 1.2); // ~2.2T at night, ~1.6T at day
            const grad = ctx2d.createRadialGradient(cx, cy, Math.max(2, TILE * 0.10), cx, cy, r);
            grad.addColorStop(0, "rgba(255, 200, 120, " + (0.55 * phaseMult).toFixed(3) + ")");
            grad.addColorStop(0.4, "rgba(255, 170, 80, " + (0.30 * phaseMult).toFixed(3) + ")");
            grad.addColorStop(1, "rgba(255, 140, 40, 0.0)");
            ctx2d.save();
            ctx2d.globalCompositeOperation = "lighter";
            ctx2d.fillStyle = grad;
            ctx2d.beginPath();
            ctx2d.arc(cx, cy, r, 0, Math.PI * 2);
            ctx2d.fill();
            ctx2d.restore();
          } catch (_) {}

          // Draw the fire glyph (dim if not currently visible)
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
          // Draw simple decor props: prefer props registry (unified schema), then tileset, then tile JSON, then robust fallback
          let key = p.type;
          let drawn = false;
          if (tilesetReady && TS && typeof TS.draw === "function") {
            drawn = TS.draw(ctx2d, key, sx, sy, TILE);
          }
          if (!drawn) {
            let glyph = "";
            let color = COLORS.corpse || "#c3cad9";
            // Prefer GameData.props for glyph/color
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
            // Next, consult tile JSON by key as backup
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
            // Robust fallback glyphs/colors
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
          // Traveling merchant (Seppo): draw a golden 'S' or tileset 'shopkeeper' if available
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
        } else if (p.type === "captive") {
          // Rescue target marker
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
  } catch (_) {}

  // Dungeon props (e.g., wall torches): draw when the tile has been seen; dim if not currently visible
  try {
    const props = Array.isArray(ctx.dungeonProps) ? ctx.dungeonProps : [];
    if (props.length) {
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
        // Prefer GameData.props for glyph/color
        try {
          const GD = (typeof window !== "undefined" ? window.GameData : null);
          const arr = GD && GD.props && Array.isArray(GD.props.props) ? GD.props.props : null;
          if (arr) {
            const tId = String(p.type || "").toLowerCase();
            const entry = arr.find(pp => String(pp.id || "").toLowerCase() === tId || String(pp.key || "").toLowerCase() === tId);
            if (entry) {
              if (typeof entry.glyph === "string") glyph = entry.glyph;
              if (entry.colors && typeof entry.colors.fg === "string") color = entry.colors.fg || color;
            }
          }
        } catch (_) {}
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
  } catch (_) {}

  // enemies
  for (const e of enemies) {
    if (!visible[e.y] || !visible[e.y][e.x]) continue;
    if (e.x < startX || e.x > endX || e.y < startY || e.y > endY) continue;
    const screenX = (e.x - startX) * TILE - tileOffsetX;
    const screenY = (e.y - startY) * TILE - tileOffsetY;
    const enemyKey = e.type ? `enemy.${e.type}` : null;
    if (enemyKey && tilesetReady && TS.draw(ctx2d, enemyKey, screenX, screenY, TILE)) {
      // drawn via tileset
    } else {
      RenderCore.drawGlyph(ctx2d, screenX, screenY, e.glyph || "e", RenderCore.enemyColor(ctx, e.type, COLORS), TILE);
    }
  }

  // player
  if (player.x >= startX && player.x <= endX && player.y >= startY && player.y <= endY) {
    const screenX = (player.x - startX) * TILE - tileOffsetX;
    const screenY = (player.y - startY) * TILE - tileOffsetY;
    if (!(tilesetReady && TS.draw(ctx2d, "player", screenX, screenY, TILE))) {
      RenderCore.drawGlyph(ctx2d, screenX, screenY, "@", COLORS.player, TILE);
    }
  }

  // Dungeon glow overlays (e.g., wall torches)
  RenderOverlays.drawDungeonGlow(ctx, view);

  // Grid overlay (if enabled)
  RenderCore.drawGridOverlay(view);
}

// Back-compat: attach to window via helper
attachGlobal("RenderDungeon", { draw });