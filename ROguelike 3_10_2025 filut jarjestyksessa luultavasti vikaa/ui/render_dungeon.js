/**
 * RenderDungeon: draws dungeon tiles, decals, corpses/chests, enemies, player.
 *
 * Exports (ESM + window.RenderDungeon):
 * - draw(ctx, view)
 */
import * as RenderCore from "./render_core.js";

// Base layer offscreen cache for dungeon (tiles only; overlays drawn per frame)
let DUN = { mapRef: null, canvas: null, wpx: 0, hpx: 0, TILE: 0, _tilesRef: null };

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

// Helper: get tile def by key for a given mode
function getTileDefByKey(mode, key) {
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const arr = GD && GD.tiles && Array.isArray(GD.tiles.tiles) ? GD.tiles.tiles : null;
    if (!arr) return null;
    const m = String(mode || "").toLowerCase();
    const k = String(key || "").toUpperCase();
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      if (String(t.key || "").toUpperCase() === k && Array.isArray(t.appearsIn) && t.appearsIn.some(s => String(s).toLowerCase() === m)) {
        return t;
      }
    }
  } catch (_) {}
  return null;
}

export function draw(ctx, view) {
  const {
    ctx2d, TILE, COLORS, TILES, TS, tilesetReady,
    map, seen, visible, player, enemies, corpses,
    cam, tileOffsetX, tileOffsetY, startX, startY, endX, endY
  } = Object.assign({}, view, ctx);

  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;

  // Helpers: biome-aware fill colors for encounter maps (fallback when no tileset)
  function parseHex(c) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(c || ""));
    if (!m) return null;
    const v = parseInt(m[1], 16);
    return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
  }
  function toHex(rgb) {
    const clamp = (x) => Math.max(0, Math.min(255, Math.round(x)));
    const v = (clamp(rgb.r) << 16) | (clamp(rgb.g) << 8) | clamp(rgb.b);
    return "#" + v.toString(16).padStart(6, "0");
  }
  function shade(hex, factor) {
    const rgb = parseHex(hex);
    if (!rgb) return hex;
    return toHex({ r: rgb.r * factor, g: rgb.g * factor, b: rgb.b * factor });
  }
  function biomeBaseFill() {
    const b = (ctx.encounterBiome || "").toUpperCase();
    if (!b) return null;
    // Map biome -> tile key whose fill to borrow
    const key = (b === "FOREST") ? "FOREST"
              : (b === "GRASS") ? "GRASS"
              : (b === "DESERT") ? "DESERT"
              : (b === "SNOW") ? "SNOW"
              : (b === "BEACH") ? "BEACH"
              : (b === "SWAMP") ? "SWAMP"
              : null;
    if (!key) return null;
    const td = getTileDefByKey("overworld", key) || getTileDefByKey("region", key);
    return (td && td.colors && td.colors.fill) ? td.colors.fill : null;
  }
  function encounterFillFor(type) {
    if (!ctx.encounterBiome) return null;
    const base = biomeBaseFill();
    if (!base) return null;
    if (type === TILES.WALL) return shade(base, 0.65);
    if (type === TILES.DOOR) return base;
    if (type === TILES.FLOOR || type === TILES.STAIRS) return base;
    return null;
  }

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
        const tintFloorA = 0.28, tintWallA = 0.36;
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
            if (tilesetReady && TS && typeof TS.draw === "function") {
              drawn = TS.draw(oc, key, sx, sy, TILE);
            }
            if (!drawn) {
              // Biome-aware fill (fallback), otherwise tiles.json dungeon fill
              const td = getTileDef("dungeon", type);
              const theme = encounterFillFor(type);
              const fill = theme || (td && td.colors && td.colors.fill);
              if (fill) {
                oc.fillStyle = fill;
                oc.fillRect(sx, sy, TILE, TILE);
              }
              if (type === TILES.STAIRS && !tilesetReady) {
                const tdStairs = td || getTileDef("dungeon", TILES.STAIRS);
                const glyph = (tdStairs && Object.prototype.hasOwnProperty.call(tdStairs, "glyph")) ? tdStairs.glyph : "";
                const fg = (tdStairs && tdStairs.colors && tdStairs.colors.fg) || "#d7ba7d";
                RenderCore.drawGlyph(oc, sx, sy, glyph, fg, TILE);
              }
            }
            // Biome tint overlay even when tileset is used
            if (baseHex) {
              try {
                oc.save();
                oc.globalCompositeOperation = "multiply";
                oc.globalAlpha = (type === TILES.WALL ? tintWallA : tintFloorA);
                oc.fillStyle = baseHex;
                oc.fillRect(sx, sy, TILE, TILE);
                oc.restore();
              } catch (_) {}
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
    const tintFloorA = 0.28, tintWallA = 0.24;
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
        if (tilesetReady && typeof TS.draw === "function") {
          drawn = TS.draw(ctx2d, key, screenX, screenY, TILE);
        }
        if (!drawn) {
          // JSON-only fill color (biome-aware fallback -> dungeon fallback)
          const td = getTileDef("dungeon", type);
          const theme = encounterFillFor(type);
          const fill = theme || (td && td.colors && td.colors.fill);
          if (fill) {
            ctx2d.fillStyle = fill;
            ctx2d.fillRect(screenX, screenY, TILE, TILE);
          }
        }
        // Tint overlay for biome when tileset is used
        if (baseHex) {
          try {
            ctx2d.save();
            ctx2d.globalCompositeOperation = "multiply";
            ctx2d.globalAlpha = (type === TILES.WALL ? tintWallA : tintFloorA);
            ctx2d.fillStyle = baseHex;
            ctx2d.fillRect(screenX, screenY, TILE, TILE);
            ctx2d.restore();
          } catch (_) {}
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
      const td = getTileDef("dungeon", type);
      const glyph = (td && Object.prototype.hasOwnProperty.call(td, "glyph")) ? td.glyph : "";
      const fg = (td && td.colors && td.colors.fg) || null;
      if (glyph && String(glyph).trim().length > 0 && fg) {
        const screenX = (x - startX) * TILE - tileOffsetX;
        const screenY = (y - startY) * TILE - tileOffsetY;
        RenderCore.drawGlyph(ctx2d, screenX, screenY, glyph, fg, TILE);
      }
    }
  }

  // Biome-driven visual overlays (icons/textures) drawn before visibility overlays
  if (ctx.encounterBiome) {
    const biome = String(ctx.encounterBiome).toUpperCase();
    const fgFor = (key, fallback) => {
      try {
        const td = getTileDefByKey("overworld", key) || getTileDefByKey("region", key);
        if (td && td.colors && td.colors.fg) return td.colors.fg;
      } catch (_) {}
      return fallback;
    };
    const fgForest = fgFor("FOREST", "#3fa650");
    const fgGrass  = fgFor("GRASS",  "#84cc16");
    const fgDesert = fgFor("DESERT", "#d7ba7d");
    const fgBeach  = fgFor("BEACH",  "#d7ba7d");
    const fgSnow   = fgFor("SNOW",   "#e5e7eb");
    const fgSwamp  = fgFor("SWAMP",  "#6fbf73");

    for (let y = startY; y <= endY; y++) {
      const yIn = y >= 0 && y < mapRows;
      const rowMap = yIn ? map[y] : null;
      for (let x = startX; x <= endX; x++) {
        if (!yIn || x < 0 || x >= mapCols) continue;
        const type = rowMap[x];
        const sx = (x - startX) * TILE - tileOffsetX;
        const sy = (y - startY) * TILE - tileOffsetY;

        // Deterministic scatter using hashed tile coordinate
        const hash = ((x * 73856093) ^ (y * 19349663)) >>> 0;

        // Forest: decorate walls as tree-tops; floors get sparse leaf speckles
        if (biome === "FOREST") {
          if (type === TILES.WALL) {
            let treeGlyph = "♣";
            let treeColor = fgForest;
            try {
              const t = getTileDefByKey("region", "TREE") || getTileDefByKey("town", "TREE");
              if (t) {
                if (Object.prototype.hasOwnProperty.call(t, "glyph")) treeGlyph = t.glyph || treeGlyph;
                if (t.colors && t.colors.fg) treeColor = t.colors.fg || treeColor;
              }
            } catch (_) {}
            RenderCore.drawGlyph(ctx2d, sx, sy, treeGlyph, treeColor, TILE);
          } else if (type === TILES.FLOOR && (hash & 7) === 0) {
            RenderCore.drawGlyph(ctx2d, sx, sy, "·", fgForest, TILE);
          }
        }

        // Grass plains: light green speckles on floors
        if (biome === "GRASS" && type === TILES.FLOOR && (hash % 9) === 0) {
          RenderCore.drawGlyph(ctx2d, sx, sy, "·", fgGrass, TILE);
        }

        // Desert: sand dots
        if (biome === "DESERT" && type === TILES.FLOOR && (hash % 11) === 0) {
          RenderCore.drawGlyph(ctx2d, sx, sy, "·", fgDesert, TILE);
        }

        // Beach: lighter sand dots, a bit denser
        if (biome === "BEACH" && type === TILES.FLOOR && (hash % 8) === 0) {
          RenderCore.drawGlyph(ctx2d, sx, sy, "·", fgBeach, TILE);
        }

        // Snow: sparse snow speckles (existing behavior), slightly denser to be visible
        if (biome === "SNOW" && type === TILES.FLOOR && (hash & 7) <= 1) {
          RenderCore.drawGlyph(ctx2d, sx, sy, "·", fgSnow, TILE);
        }

        // Swamp: occasional ripples
        if (biome === "SWAMP" && type === TILES.FLOOR && (hash % 13) === 0) {
          RenderCore.drawGlyph(ctx2d, sx, sy, "≈", fgSwamp, TILE);
        }
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
      // JSON-only: look up by key in tiles.json (prefer dungeon, then town/overworld)
      let glyph = "";
      let color = c.looted ? (COLORS.corpseEmpty || "#808080") : (COLORS.corpse || "#b22222");
      try {
        const key = String(c.kind || (c.kind === "chest" ? "chest" : "corpse")).toUpperCase();
        const td = getTileDefByKey("dungeon", key) || getTileDefByKey("town", key) || getTileDefByKey("overworld", key);
        if (td) {
          if (Object.prototype.hasOwnProperty.call(td, "glyph")) glyph = td.glyph;
          if (td.colors && td.colors.fg) color = td.colors.fg;
        }
      } catch (_) {}
      if (glyph && String(glyph).trim().length > 0) {
        // Shade glyph if looted
        if (c.looted) {
          ctx2d.save();
          ctx2d.globalAlpha = 0.6;
          RenderCore.drawGlyph(ctx2d, screenX, screenY, glyph, color, TILE);
          ctx2d.restore();
        } else {
          RenderCore.drawGlyph(ctx2d, screenX, screenY, glyph, color, TILE);
        }
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
          // Draw simple decor props with tileset fallback to JSON keys
          let key = p.type;
          let drawn = false;
          if (tilesetReady && TS && typeof TS.draw === "function") {
            drawn = TS.draw(ctx2d, key, sx, sy, TILE);
          }
          if (!drawn) {
            let jsonKey = (p.type === "crate") ? "CRATE" : (p.type === "barrel") ? "BARREL" : "BENCH";
            let glyph = "";
            let color = COLORS.corpse || "#cbd5e1";
            // Prefer dungeon tile if exists, fall back to town definitions
            try {
              const td = getTileDefByKey("dungeon", jsonKey) || getTileDefByKey("town", jsonKey);
              if (td) {
                if (Object.prototype.hasOwnProperty.call(td, "glyph")) glyph = td.glyph || glyph;
                if (td.colors && td.colors.fg) color = td.colors.fg || color;
              }
            } catch (_) {}
            if (glyph) {
              if (!visNow) {
                ctx2d.save();
                ctx2d.globalAlpha = 0.65;
                RenderCore.drawGlyph(ctx2d, sx, sy, glyph, color, TILE);
                ctx2d.restore();
              } else {
                RenderCore.drawGlyph(ctx2d, sx, sy, glyph, color, TILE);
              }
            }
          }
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

  // Grid overlay (if enabled)
  RenderCore.drawGridOverlay(view);
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.RenderDungeon = { draw };
}