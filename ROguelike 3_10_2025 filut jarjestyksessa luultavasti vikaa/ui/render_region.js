/**
 * RenderRegion: draws the Region Map using the standard tile viewport (camera-centred on player).
 *
 * Exports (ESM + window.RenderRegion):
 * - draw(ctx, view)
 */
import * as RenderCore from "./render_core.js";
import * as World from "../world/world.js";

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

// Robust fallback fill color mapping when tiles.json is missing/incomplete
function fallbackFillRegion(WT, id) {
  try {
    if (id === WT.WATER) return "#0a1b2a";
    if (id === WT.RIVER) return "#0e2f4a";
    if (id === WT.BEACH) return "#b59b6a";
    if (id === WT.SWAMP) return "#1b2a1e";
    if (id === WT.FOREST) return "#0d2615";
    if (id === WT.GRASS) return "#10331a";
    if (id === WT.MOUNTAIN) return "#2f2f34";
    if (id === WT.DESERT) return "#c2a36b";
    if (id === WT.SNOW) return "#b9c7d3";
    if (id === WT.TOWN) return "#3a2f1b";
    if (id === WT.DUNGEON) return "#2a1b2a";
    if (id === WT.TREE) return "#0f3b1e";
  } catch (_) {}
  return "#0b0c10";
}

export function draw(ctx, view) {
  if (!ctx || ctx.mode !== "region" || !ctx.region) return;
  const {
    ctx2d, TILE, COLORS, map, seen, visible,
    startX, startY, endX, endY,
    tileOffsetX, tileOffsetY,
    cam
  } = Object.assign({}, view, ctx);

  const WT = World.TILES;
  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;

  

  // Base tiles within viewport
  for (let y = startY; y <= endY; y++) {
    const yIn = y >= 0 && y < mapRows;
    const row = yIn ? map[y] : null;
    for (let x = startX; x <= endX; x++) {
      const screenX = (x - startX) * TILE - tileOffsetX;
      const screenY = (y - startY) * TILE - tileOffsetY;

      if (!yIn || x < 0 || x >= mapCols) {
        ctx2d.fillStyle = "#0b0c10";
        ctx2d.fillRect(screenX, screenY, TILE, TILE);
        continue;
      }

      const t = row[x];
      // JSON fill color for region mode with robust fallback
      const td = getTileDef("region", t);
      const fill = (td && td.colors && td.colors.fill) ? td.colors.fill : fallbackFillRegion(WT, t);
      ctx2d.fillStyle = fill;
      ctx2d.fillRect(screenX, screenY, TILE, TILE);
    }
  }

  // Per-frame glyph overlay for any tile with a non-blank JSON glyph (drawn before visibility overlays)
  for (let y = startY; y <= endY; y++) {
    const yIn = y >= 0 && y < mapRows;
    const row = yIn ? map[y] : null;
    for (let x = startX; x <= endX; x++) {
      if (!yIn || x < 0 || x >= mapCols) continue;
      const t = row[x];
      const td = getTileDef("region", t);
      let glyph = td && Object.prototype.hasOwnProperty.call(td, "glyph") ? td.glyph : "";
      let fg = td && td.colors && td.colors.fg ? td.colors.fg : null;

      // Fallback glyph/color for trees when region tiles.json lacks glyphs
      if ((!glyph || !fg) && t === WT.TREE) {
        if (!glyph || !String(glyph).trim().length) glyph = "♣";
        if (!fg) fg = "#3fa650";
      }

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

  // Orange edge tiles (center tiles on each side)
  try {
    ctx2d.save();
    ctx2d.fillStyle = "rgba(241,153,40,0.28)";
    ctx2d.strokeStyle = "rgba(241,153,40,0.80)";
    ctx2d.lineWidth = 2;
    for (const e of (ctx.region.exitTiles || [])) {
      const ex = (e.x | 0), ey = (e.y | 0);
      if (ex >= startX && ex <= endX && ey >= startY && ey <= endY) {
        const sx = (ex - startX) * TILE - tileOffsetX;
        const sy = (ey - startY) * TILE - tileOffsetY;
        ctx2d.fillRect(sx, sy, TILE, TILE);
        ctx2d.strokeRect(sx + 0.5, sy + 0.5, TILE - 1, TILE - 1);
      }
    }
    ctx2d.restore();
  } catch (_) {}

  // Enemies overlay (draw simple markers for active region-encounter)
  try {
    if (ctx.region && ctx.region._isEncounter && Array.isArray(ctx.enemies)) {
      for (const e of ctx.enemies) {
        if (!e) continue;
        const ex = e.x | 0, ey = e.y | 0;
        if (ex < startX || ex > endX || ey < startY || ey > endY) continue;
        if (!visible[ey] || !visible[ey][ex]) continue;
        const sx = (ex - startX) * TILE - tileOffsetX;
        const sy = (ey - startY) * TILE - tileOffsetY;
        const c = (typeof ctx.enemyColor === "function") ? ctx.enemyColor(e.type || "enemy") : "#f7768e";
        ctx2d.save();
        ctx2d.fillStyle = c;
        ctx2d.fillRect(sx + 6, sy + 6, TILE - 12, TILE - 12);
        ctx2d.restore();
      }
    }
  } catch (_) {}

  // Player marker (cursor) with backdrop (only if visible)
  const px = ctx.player.x, py = ctx.player.y;
  if (px >= startX && px <= endX && py >= startY && py <= endY && visible[py] && visible[py][px]) {
    const screenX = (px - startX) * TILE - tileOffsetX;
    const screenY = (py - startY) * TILE - tileOffsetY;

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

  // Label + clock + hint
  try {
    const prevAlign = ctx2d.textAlign;
    const prevBaseline = ctx2d.textBaseline;
    ctx2d.textAlign = "left";
    ctx2d.textBaseline = "top";
    ctx2d.fillStyle = "#cbd5e1";
    const clock = ctx.time && ctx.time.hhmm ? `   |   Time: ${ctx.time.hhmm}` : "";
    ctx2d.fillText(`Region Map${clock}`, 8, 8);
    ctx2d.fillStyle = "#a1a1aa";
    ctx2d.fillText("Move with arrows. Press G on orange edge to return.", 8, 26);
    ctx2d.textAlign = prevAlign;
    ctx2d.textBaseline = prevBaseline;
  } catch (_) {}

  // Day/night tint overlay (same palette as town/overworld)
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

  RenderCore.drawGridOverlay(view);
}

if (typeof window !== "undefined") {
  window.RenderRegion = { draw };
}