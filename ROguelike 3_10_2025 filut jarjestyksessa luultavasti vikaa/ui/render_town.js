/**
 * RenderTown: draws town map tiles, shops, props, NPCs, player, and overlays.
 *
 * Exports (ESM + window.RenderTown):
 * - draw(ctx, view)
 */
import * as RenderCore from "./render_core.js";
import * as RenderOverlays from "./render_overlays.js";

// Helper: get tile def from GameData.tiles for a given mode and numeric id
function getTileDef(mode, id) {
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const arr = GD && GD.tiles && Array.isArray(GD.tiles.tiles) ? GD.tiles.tiles : null;
    if (!arr) return null;
    const m = String(mode || "").toLowerCase();
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      if ((t.id | 0) === (id | 0) && Array.isArray(t.appearsIn) && t.appearsIn.some(s => String(s).toLowerCase() === m)) {
        return t;
      }
    }
  } catch (_) {}
  return null;
}

// Helper: current tiles.json reference (for cache invalidation)
function tilesRef() {
  try {
    return (typeof window !== "undefined" && window.GameData && window.GameData.tiles) ? window.GameData.tiles : null;
  } catch (_) { return null; }
}

// Base layer offscreen cache for town (tiles only; overlays drawn per frame)
let TOWN = { mapRef: null, canvas: null, wpx: 0, hpx: 0, TILE: 0, _tilesRef: null };
// Shop glyphs cache keyed by shops array reference
let SHOP_GLYPHS_CACHE = { ref: null, map: {} };

function rebuildShopGlyphs(shops) {
  const out = {};
  try {
    if (Array.isArray(shops)) {
      for (const s of shops) {
        const nm = (s.name || "").toLowerCase();
        const glyph = nm.includes("tavern") ? "T" : (nm.includes("inn") ? "I" : "S");
        out[`${
          s.x
        },${
          s.y
        }`] = glyph;
      }
    }
  } catch (_) {}
  SHOP_GLYPHS_CACHE = { ref: shops, map: out };
}

export function draw(ctx, view) {
  const {
    ctx2d, TILE, COLORS, TILES, map, seen, visible, player, shops,
    cam, tileOffsetX, tileOffsetY, startX, startY, endX, endY
  } = Object.assign({}, view, ctx);

  const TCOL = {
    wall: "#2f2b26",       // building
    window: "#295b6e",     // windows
    floor: "#0f1620",      // street/plaza
    door: "#6f5b3e",
    shop: "#d7ba7d",
  };

  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;

  // Ensure shop glyphs cache is up to date
  if (shops !== SHOP_GLYPHS_CACHE.ref) {
    rebuildShopGlyphs(shops);
  }
  const SHOP_GLYPHS = SHOP_GLYPHS_CACHE.map;

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
            // Prefer tiles.json fill colors if present
            let fill = TCOL.floor;
            if (type === TILES.WALL) {
              const td = getTileDef("dungeon", TILES.WALL);
              fill = (td && td.colors && td.colors.fill) || TCOL.wall;
            } else if (type === TILES.WINDOW) {
              const td = getTileDef("town", TILES.WINDOW) || getTileDef("dungeon", TILES.WINDOW);
              fill = (td && td.colors && td.colors.fill) || TCOL.window;
            } else if (type === TILES.DOOR) {
              const td = getTileDef("dungeon", TILES.DOOR);
              fill = (td && td.colors && td.colors.fill) || TCOL.door;
            }
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
    // Fallback: draw base tiles in viewport
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
        let fill = TCOL.floor;
        if (type === TILES.WALL) fill = TCOL.wall;
        else if (type === TILES.WINDOW) fill = TCOL.window;
        else if (type === TILES.DOOR) fill = TCOL.door;
        ctx2d.fillStyle = fill;
        ctx2d.fillRect(screenX, screenY, TILE, TILE);
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

  // If shop door, overlay glyph (T for Tavern, I for Inn, otherwise S) when visible
  for (let y = startY; y <= endY; y++) {
    const yIn = y >= 0 && y < mapRows;
    const rowVis = yIn ? (visible[y] || []) : [];
    for (let x = startX; x <= endX; x++) {
      if (!yIn || x < 0 || x >= mapCols) continue;
      const vis = !!rowVis[x];
      if (!vis) continue;
      const glyph = SHOP_GLYPHS[`${x},${y}`];
      if (glyph) {
        const screenX = (x - startX) * TILE - tileOffsetX;
        const screenY = (y - startY) * TILE - tileOffsetY;
        RenderCore.drawGlyph(ctx2d, screenX, screenY, glyph, TCOL.shop, TILE);
      }
    }
  }

  // Props (only if visible)
  if (Array.isArray(ctx.townProps)) {
    for (const p of ctx.townProps) {
      if (p.x < startX || p.x > endX || p.y < startY || p.y > endY) continue;
      if (!visible[p.y] || !visible[p.y][p.x]) continue;
      const screenX = (p.x - startX) * TILE - tileOffsetX;
      const screenY = (p.y - startY) * TILE - tileOffsetY;
      let glyph = "?";
      let color = "#e5e7eb";
      if (p.type === "well") { glyph = "O"; color = "#7aa2f7"; }
      else if (p.type === "fountain") { glyph = "◌"; color = "#89ddff"; }
      else if (p.type === "bench") { glyph = "≡"; color = "#d7ba7d"; }
      else if (p.type === "lamp") { glyph = "†"; color = "#ffd166"; }
      else if (p.type === "stall") { glyph = "s"; color = "#b4f9f8"; }
      else if (p.type === "tree") { glyph = "♣"; color = "#84cc16"; }
      else if (p.type === "fireplace") { glyph = "∩"; color = "#ff9966"; }
      else if (p.type === "table") { glyph = "┼"; color = "#d7ba7d"; }
      else if (p.type === "chair") { glyph = "π"; color = "#d7ba7d"; }
      else if (p.type === "bed") { glyph = "b"; color = "#a3be8c"; }
      else if (p.type === "chest") { glyph = "▯"; color = "#d7ba7d"; }
      else if (p.type === "crate") { glyph = "▢"; color = "#b59b6a"; }
      else if (p.type === "barrel") { glyph = "◍"; color = "#a07c4b"; }
      else if (p.type === "shelf") { glyph = "≋"; color = "#b4f9f8"; }
      else if (p.type === "plant") { glyph = "❀"; color = "#84cc16"; }
      else if (p.type === "rug") { glyph = "≈"; color = "#a3be8c"; }
      else if (p.type === "sign") { glyph = "∎"; color = "#ffd166"; }
      RenderCore.drawGlyph(ctx2d, screenX, screenY, glyph, color, TILE);
    }
  }

  // NPCs (only if visible)
  if (Array.isArray(ctx.npcs)) {
    for (const n of ctx.npcs) {
      if (n.x < startX || n.x > endX || n.y < startY || n.y > endY) continue;
      if (!visible[n.y] || !visible[n.y][n.x]) continue;
      const screenX = (n.x - startX) * TILE - tileOffsetX;
      const screenY = (n.y - startY) * TILE - tileOffsetY;
      // Pets: cat 'c', dog 'd'; others 'n'
      let glyph = "n";
      if (n.isPet) {
        if (n.kind === "cat") glyph = "c";
        else if (n.kind === "dog") glyph = "d";
      }
      RenderCore.drawGlyph(ctx2d, screenX, screenY, glyph, "#b4f9f8", TILE);

      // Sleeping indicator: animated z/Z above sleeping NPCs
      if (n._sleeping) {
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

  // draw gate 'G' at townExitAt (only if visible)
  if (ctx.townExitAt) {
    const gx = ctx.townExitAt.x, gy = ctx.townExitAt.y;
    if (gx >= startX && gx <= endX && gy >= startY && gy <= endY) {
      if (visible[gy] && visible[gy][gx]) {
        const screenX = (gx - startX) * TILE - tileOffsetX;
        const screenY = (gy - startY) * TILE - tileOffsetY;
        RenderCore.drawGlyph(ctx2d, screenX, screenY, "G", "#9ece6a", TILE);
      }
    }
  }

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

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.RenderTown = { draw };
}