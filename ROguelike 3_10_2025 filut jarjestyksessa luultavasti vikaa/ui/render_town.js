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
    if (type === TILES.DOOR) return "#3a2f1b";
    if (type === TILES.WINDOW) return "#295b6e";
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
let TOWN = { mapRef: null, canvas: null, wpx: 0, hpx: 0, TILE: 0, _tilesRef: null };


export function draw(ctx, view) {
  const {
    ctx2d, TILE, COLORS, TILES, map, seen, visible, player, shops,
    cam, tileOffsetX, tileOffsetY, startX, startY, endX, endY
  } = Object.assign({}, view, ctx);

  
  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;

  

  // Build base offscreen once per map/TILE change
  try {
    if (mapRows && mapCols) {
      const wpx = mapCols * TILE;
      const hpx = mapRows * TILE;
      const needsRebuild = (!TOWN.canvas) || TOWN.mapRef !== map || TOWN.wpx !== wpx || TOWN.hpx !== hpx || TOWN.TILE !== TILE || TOWN._tilesRef !== tilesRef();
      if (needsRebuild) {
        TOWN.mapRef = map;
        TOWN.wpx = wpx;
        TOWN.hpx = hpx;
        TOWN.TILE = TILE;
        TOWN._tilesRef = tilesRef();
        const off = RenderCore.createOffscreen(wpx, hpx);
        const oc = off.getContext("2d");
        try {
          oc.font = "bold 20px JetBrains Mono, monospace";
          oc.textAlign = "center";
          oc.textBaseline = "middle";
        } catch (_) {}
        for (let yy = 0; yy < mapRows; yy++) {
          const rowMap = map[yy];
          for (let xx = 0; xx < mapCols; xx++) {
            const type = rowMap[xx];
            const sx = xx * TILE, sy = yy * TILE;
            // Cached fill color: prefer town JSON, then dungeon JSON; else robust fallback
            const fill = fillTownFor(TILES, type, COLORS);
            oc.fillStyle = fill;
            oc.fillRect(sx, sy, TILE, TILE);
          }
        }
        TOWN.canvas = off;
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
        const fill = (td && td.colors && td.colors.fill) ? td.colors.fill : fallbackFillTown(TILES, type, COLORS);
        ctx2d.fillStyle = fill;
        ctx2d.fillRect(screenX, screenY, TILE, TILE);
      }
    }
  }

  // Per-frame glyph overlay (drawn before visibility overlays)
  // Keep town clean: suppress noisy door ('+'), stairs ('>'), and window glyphs; use tile fill colors for these.
  for (let y = startY; y <= endY; y++) {
    const yIn = y >= 0 && y < mapRows;
    const rowMap = yIn ? map[y] : null;
    for (let x = startX; x <= endX; x++) {
      if (!yIn || x < 0 || x >= mapCols) continue;
      const type = rowMap[x];

      // Skip glyphs for DOOR/STAIRS/WINDOW in town to avoid cluttery dash visuals
      if (type === TILES.DOOR || type === TILES.STAIRS || type === TILES.WINDOW) continue;

      const tg = glyphTownFor(type);
      if (!tg) continue;
      const glyph = tg.glyph;
      const fg = tg.fg;
      if (glyph && String(glyph).trim().length > 0 && fg) {
        const screenX = (x - startX) * TILE - tileOffsetX;
        const screenY = (y - startY) * TILE - tileOffsetY;
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

  // Props: draw remembered (seen) props dimmed; draw fully only when currently visible with direct LOS.
  if (Array.isArray(ctx.townProps)) {
    for (const p of ctx.townProps) {
      if (p.x < startX || p.x > endX || p.y < startY || p.y > endY) continue;

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

  // NPCs: draw when the tile has been seen; dim if not currently visible or no LOS.
  // This avoids \"disappearing\" when visibility is affected by lamp-light or corners.
  if (Array.isArray(ctx.npcs)) {
    for (const n of ctx.npcs) {
      if (n.x < startX || n.x > endX || n.y < startY || n.y > endY) continue;

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

      // Sleeping indicator: only when fully visible with LOS to avoid floating Z's through walls
      if (!drawDim && n._sleeping) {
        const t = Date.now();
        const phase = Math.floor(t / 600) % 2; // toggle every ~0.6s
        const zChar = phase ? "Z" : "z";
        const bob = Math.sin(t / 500) * 3;
        const zx = screenX + TILE / 2 + 8;          // slight right offset
        const zy = screenY + TILE / 2 - TILE * 0.6 + bob; // above head
        ctx2d.save();
        ctx2d.globalAlpha = 0.9;
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