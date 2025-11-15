/**
 * RenderRegion: draws the Region Map using the standard tile viewport (camera-centred on player).
 *
 * Exports (ESM + window.RenderRegion):
 * - draw(ctx, view)
 */
import * as RenderCore from "./render_core.js";
import * as World from "../world/world.js";
import { getTileDef } from "../data/tile_lookup.js";
import { attachGlobal } from "../utils/global.js";

// getTileDef centralized in ../data/tile_lookup.js

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

  // Region edge tiles highlight (palette-driven)
  try {
    ctx2d.save();
    let fillCol = "rgba(241,153,40,0.28)";
    let strokeCol = "rgba(241,153,40,0.80)";
    try {
      const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
      if (pal) {
        fillCol = pal.exitRegionFill || fillCol;
        strokeCol = pal.exitRegionStroke || strokeCol;
      }
    } catch (_) {}
    ctx2d.fillStyle = fillCol;
    ctx2d.strokeStyle = strokeCol;
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

  // Blood decals overlay (region)
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
    ctx2d.restore();
  }

  // Entities overlay: draw markers for any enemies/animals in the region when visible
  try {
    if (Array.isArray(ctx.enemies)) {
      for (const e of ctx.enemies) {
        if (!e) continue;
        const ex = e.x | 0, ey = e.y | 0;
        if (ex < startX || ex > endX || ey < startY || ey > endY) continue;
        if (!visible[ey] || !visible[ey][ex]) continue;
        const sx = (ex - startX) * TILE - tileOffsetX;
        const sy = (ey - startY) * TILE - tileOffsetY;
        // Color scheme: neutral animals use palette; hostile use enemyColor fallback
        const faction = String(e.faction || "");
        let color = "#f7768e"; // hostile default
        if (faction === "animal") {
          try {
            const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
            color = (pal && pal.regionAnimal) ? pal.regionAnimal : "#e9d5a1"; // neutral animal (deer/fox/boar)
          } catch (_) {
            color = "#e9d5a1";
          }
        } else if (typeof ctx.enemyColor === "function") {
          try { color = ctx.enemyColor(e.type || "enemy"); } catch (_) {}
        }
        ctx2d.save();
        // Draw a circle for animals; square for hostiles
        if (faction === "animal") {
          ctx2d.beginPath();
          ctx2d.arc(sx + TILE / 2, sy + TILE / 2, Math.max(6, (TILE - 12) / 2), 0, Math.PI * 2);
          ctx2d.fillStyle = color;
          ctx2d.fill();
        } else {
          ctx2d.fillStyle = color;
          ctx2d.fillRect(sx + 6, sy + 6, TILE - 12, TILE - 12);
        }
        // Optional glyph letter inside marker for identification
        try {
          const half = TILE / 2;
          ctx2d.textAlign = "center";
          ctx2d.textBaseline = "middle";
          ctx2d.fillStyle = "#0b0f16";
          ctx2d.fillText(String((e.glyph && String(e.glyph).trim()) ? e.glyph : (e.type ? e.type.charAt(0) : "?")), sx + half, sy + half);
        } catch (_) {}
        ctx2d.restore();
      }
    }
  } catch (_) {}

  // Corpses overlay: show lootable bodies as a '%' glyph (neutral gray; darker when looted)
  try {
    if (Array.isArray(ctx.corpses)) {
      for (const c of ctx.corpses) {
        if (!c) continue;
        const cx = c.x | 0, cy = c.y | 0;
        if (cx < startX || cx > endX || cy < startY || cy > endY) continue;
        if (!visible[cy] || !visible[cy][cx]) continue;
        const sx = (cx - startX) * TILE - tileOffsetX;
        const sy = (cy - startY) * TILE - tileOffsetY;
        ctx2d.save();
        const fg = c.looted ? (COLORS.corpseEmpty || "#6b7280") : (COLORS.corpse || "#c3cad9");
        RenderCore.drawGlyph(ctx2d, sx, sy, "%", fg, TILE);
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

  // Label + clock + hint (+ animals memory badge) with palette-driven panel styling
  try {
    const prevAlign = ctx2d.textAlign;
    const prevBaseline = ctx2d.textBaseline;
    ctx2d.textAlign = "left";
    ctx2d.textBaseline = "top";

    const clock = ctx.time && ctx.time.hhmm ? `   |   Time: ${ctx.time.hhmm}` : "";
    const titleText = `Region Map${clock}`;
    const hintText = "Move with arrows. Press G on orange edge to return.";

    // Determine animals status text (optional third line)
    let animalsText = null;
    try {
      const pos = (ctx.region && ctx.region.enterWorldPos) ? ctx.region.enterWorldPos : null;
      let cleared = false;
      try {
        if (pos && typeof window !== "undefined" && window.RegionMapRuntime && typeof window.RegionMapRuntime.animalsClearedHere === "function") {
          cleared = !!window.RegionMapRuntime.animalsClearedHere(pos.x | 0, pos.y | 0);
        }
      } catch (_) {}
      if (cleared) animalsText = "Animals cleared here";
      else if (ctx.region && ctx.region._hasKnownAnimals) animalsText = "Animals known in this area";
    } catch (_) {}

    // Panel dimensions
    const bx = 8, by = 8;
    const titleLen = titleText.length | 0;
    const hintLen = hintText.length | 0;
    const baseW = Math.max(260, 16 * (Math.max(titleLen, hintLen) / 2));
    const bw = baseW | 0;
    const bh = animalsText ? 66 : 48;

    // Panel colors from palette overlays
    let panelBg = "rgba(13,16,24,0.80)";
    let panelBorder = "rgba(122,162,247,0.35)";
    try {
      const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
      if (pal) {
        panelBg = pal.panelBg || panelBg;
        panelBorder = pal.panelBorder || panelBorder;
      }
    } catch (_) {}

    // Draw region base: blit viewport; fall back to per-tile loop if offscreen missing
  let blitted = false;
  if (REG.canvas) {
    try {
      blitted = !!RenderCore.blitViewport(ctx2d, REG.canvas, cam, REG.wpx, REG.hpx);
    } catch (_) { blitted = false; }
  }
  // Record map for tiles coverage smoketest (optional)
  try {
    if (typeof window !== "undefined" && window.TilesValidation && typeof window.TilesValidation.recordMap === "function") {
      window.TilesValidation.recordMap({ mode: "region", map });
    }
  } catch (_) {} catch (_) {
      ctx2d.fillRect(bx, by, bw, bh);
      ctx2d.strokeStyle = panelBorder;
      ctx2d.lineWidth = 1;
      ctx2d.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    }
    // Draw texts
    ctx2d.fillStyle = "#cbd5e1";
    ctx2d.fillText(titleText, bx + 10, by + 8);
    ctx2d.fillStyle = "#a1a1aa";
    ctx2d.fillText(hintText, bx + 10, by + 26);
    if (animalsText) {
      let clearedClr = "#86efac";
      let knownClr = "#f0abfc";
      try {
        const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
        if (pal) {
          clearedClr = pal.regionAnimalsCleared || clearedClr;
          knownClr = pal.regionAnimalsKnown || knownClr;
        }
      } catch (_) {}
      ctx2d.fillStyle = animalsText.toLowerCase().includes("cleared") ? clearedClr : knownClr;
      ctx2d.fillText(animalsText, bx + 10, by + 44);
    }
    ctx2d.restore();

    ctx2d.textAlign = prevAlign;
    ctx2d.textBaseline = prevBaseline;
  } catch (_) {}

  // Day/night tint overlay (palette-driven for consistency)
  try {
    const time = ctx.time;
    if (time && time.phase) {
      let nightTint = "rgba(0,0,0,0.35)";
      let duskTint  = "rgba(255,120,40,0.12)";
      let dawnTint  = "rgba(120,180,255,0.10)";
      try {
        const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
        if (pal) {
          nightTint = pal.night || nightTint;
          duskTint  = pal.dusk  || duskTint;
          dawnTint  = pal.dawn  || dawnTint;
        }
      } catch (_) {}
      ctx2d.save();
      if (time.phase === "night") {
        ctx2d.fillStyle = nightTint;
        ctx2d.fillRect(0, 0, cam.width, cam.height);
      } else if (time.phase === "dusk") {
        ctx2d.fillStyle = duskTint;
        ctx2d.fillRect(0, 0, cam.width, cam.height);
      } else if (time.phase === "dawn") {
        ctx2d.fillStyle = dawnTint;
        ctx2d.fillRect(0, 0, cam.width, cam.height);
      }
      ctx2d.restore();
    }
  } catch (_) {}

  RenderCore.drawGridOverlay(view);
}

attachGlobal("RenderRegion", { draw });