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
import { drawBiomeDecor, drawEncounterExitOverlay, drawDungeonExitOverlay } from "./decor_overlays.js";
import { attachGlobal } from "../utils/global.js";
import { getTileDefByKey } from "../data/tile_lookup.js";

// New modular imports
import { drawBaseLayer } from "./render/dungeon_base_layer.js";
import { glyphDungeonFor } from "./render/dungeon_tile_cache.js";
import { drawEncounterProps, drawDungeonProps } from "./render/dungeon_props_draw.js";
import { drawEnemies, drawPlayer } from "./render/dungeon_entities_draw.js";

export function draw(ctx, view) {
  const {
    ctx2d, TILE, COLORS, TILES, TS, tilesetReady,
    map, seen, visible, player, enemies, corpses,
    cam, tileOffsetX, tileOffsetY, startX, startY, endX, endY
  } = Object.assign({}, view, ctx);

  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;

  // Base layer (offscreen cache + fallback)
  try { drawBaseLayer(ctx, view); } catch (_) {}

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
        (function () {
          let blood = "#7a1717";
          try {
            const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
            if (pal && typeof pal.blood === "string" && pal.blood.trim().length) blood = pal.blood;
          } catch (_) {}
          ctx2d.fillStyle = blood;
        })();
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
        if (!isChest && c.looted && typeof TS.drawAlpha === "function") {
          if (TS.drawAlpha(ctx2d, "corpse", screenX, screenY, TILE, 0.55)) return;
        }
        if (TS.draw(ctx2d, isChest ? "chest" : "corpse", screenX, screenY, TILE)) {
          return;
        }
      }
      let glyph = "";
      let color = c.looted ? (COLORS.corpseEmpty || "#6b7280") : (COLORS.corpse || "#c3cad9");
      try {
        const key = String(c.kind || (c.kind === "chest" ? "chest" : "corpse")).toUpperCase();
        const td = getTileDefByKey("dungeon", key) || getTileDefByKey("town", key) || getTileDefByKey("overworld", key);
        if (td) {
          if (Object.prototype.hasOwnProperty.call(td, "glyph")) glyph = td.glyph || glyph;
          if (td.colors && td.colors.fg) color = td.colors.fg || color;
        }
      } catch (_) {}
      if (!glyph) {
        if ((c.kind || "").toLowerCase() === "chest") glyph = "□";
        else glyph = "%";
      }
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

  // Encounter and dungeon props
  try { drawEncounterProps(ctx, view); } catch (_) {}
  try { drawDungeonProps(ctx, view); } catch (_) {}

  // Entities
  try { drawEnemies(ctx, view); } catch (_) {}
  try { drawPlayer(ctx, view); } catch (_) {}

  // Dungeon glow overlays (e.g., wall torches)
  RenderOverlays.drawDungeonGlow(ctx, view);

  // Grid overlay (if enabled)
  RenderCore.drawGridOverlay(view);
}

// Back-compat: attach to window via helper
attachGlobal("RenderDungeon", { draw });