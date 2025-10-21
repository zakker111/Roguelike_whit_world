/**
 * RenderOverworld: draws overworld tiles, glyphs from tiles.json, minimap, NPCs, player, and time tint.
 *
 * Exports (ESM + window.RenderOverworld):
 * - draw(ctx, view)
 */
import * as RenderCore from "./render_core.js";
import * as World from "../world/world.js";
import { getTileDef } from "../data/tile_lookup.js";
import { attachGlobal } from "../utils/global.js";

// Minimap offscreen cache to avoid redrawing every frame
let MINI = { mapRef: null, canvas: null, wpx: 0, hpx: 0, scale: 0, _tilesRef: null };
// World base layer offscreen cache (full map at TILE resolution)
let WORLD = { mapRef: null, canvas: null, wpx: 0, hpx: 0, TILE: 0, _tilesRef: null };

// getTileDef moved to centralized helper in ../data/tile_lookup.js

// Robust fallback fill color mapping when tiles.json is missing/incomplete
function fallbackFillOverworld(WT, id) {
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
  } catch (_) {}
  return "#0b0c10";
}

// Helper: current tiles.json reference (for cache invalidation)
function tilesRef() {
  try {
    return (typeof window !== "undefined" && window.GameData && window.GameData.tiles) ? window.GameData.tiles : null;
  } catch (_) { return null; }
}

export function draw(ctx, view) {
  const {
    ctx2d, TILE, COLORS, map, player, camera: camMaybe, TS, tilesetReady,
    cam, tileOffsetX, tileOffsetY, startX, startY, endX, endY
  } = Object.assign({}, view, ctx);

  const WT = World.TILES;
  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;

  // Build world base offscreen once per map/TILE change
  try {
    const mw = mapCols;
    const mh = mapRows;
    if (mw && mh) {
      const wpx = mw * TILE;
      const hpx = mh * TILE;
      const needsWorldRebuild = (!WORLD.canvas) || WORLD.mapRef !== map || WORLD.wpx !== wpx || WORLD.hpx !== hpx || WORLD.TILE !== TILE || WORLD._tilesRef !== tilesRef();
      if (needsWorldRebuild) {
        WORLD.mapRef = map;
        WORLD.wpx = wpx;
        WORLD.hpx = hpx;
        WORLD.TILE = TILE;
        WORLD._tilesRef = tilesRef();
        const off = RenderCore.createOffscreen(wpx, hpx);
        const oc = off.getContext("2d");
        // Set font/align once for glyphs
        try {
          oc.font = "bold 20px JetBrains Mono, monospace";
          oc.textAlign = "center";
          oc.textBaseline = "middle";
        } catch (_) {}
        let missingDefsCount = 0;
        const missingSet = new Set();
        for (let yy = 0; yy < mh; yy++) {
          const rowM = map[yy];
          for (let xx = 0; xx < mw; xx++) {
            const t = rowM[xx];
            // JSON fill color for overworld with robust fallback
            const td = getTileDef("overworld", t);
            if (!td) { missingDefsCount++; missingSet.add(t); }
            const c = (td && td.colors && td.colors.fill) ? td.colors.fill : fallbackFillOverworld(WT, t);
            oc.fillStyle = c;
            oc.fillRect(xx * TILE, yy * TILE, TILE, TILE);
            // Note: glyph overlays are drawn per-frame below, not baked into base.
          }
        }
        // DEV-only: log a single summary if tile defs were missing
        try {
          if (missingDefsCount > 0 && typeof window !== "undefined" && (window.DEV || (typeof localStorage !== "undefined" && localStorage.getItem("DEV") === "1"))) {
            const LG = (typeof window !== "undefined" ? window.Logger : null);
            const msg = `[RenderOverworld] Missing ${missingDefsCount} tile def lookups; ids without defs: ${Array.from(missingSet).join(", ")}. Using fallback colors.`;
            if (LG && typeof LG.log === "function") LG.log(msg, "warn");
            else console.warn(msg);
          }
        } catch (_) {}
        WORLD.canvas = off;
      }
    }
  } catch (_) {}

  // Draw world base: offscreen blit if available; if blit fails, fall back to per-tile loop
  let blitted = false;
  if (WORLD.canvas) {
    try {
      blitted = !!RenderCore.blitViewport(ctx2d, WORLD.canvas, cam, WORLD.wpx, WORLD.hpx);
    } catch (_) { blitted = false; }
  }
  if (!blitted) {
    for (let y = startY; y <= endY; y++) {
      const yIn = y >= 0 && y < mapRows;
      const row = yIn ? map[y] : null;
      for (let x = startX; x <= endX; x++) {
        const screenX = (x - startX) * TILE - tileOffsetX;
        const screenY = (y - startY) * TILE - tileOffsetY;

        // Off-map: draw canvas background color tile
        if (!yIn || x < 0 || x >= mapCols) {
          ctx2d.fillStyle = "#0b0c10";
          ctx2d.fillRect(screenX, screenY, TILE, TILE);
          continue;
        }

        const t = row[x];
        const td = getTileDef("overworld", t);
        const fill = (td && td.colors && td.colors.fill) ? td.colors.fill : fallbackFillOverworld(WT, t);
        ctx2d.fillStyle = fill;
        ctx2d.fillRect(screenX, screenY, TILE, TILE);
      }
    }
  }

  // Top-edge boundary: render an organic shoreline + water to disguise the hard boundary.
  // Visual only; world data isn't changed. Movement into y < 0 is blocked in world_runtime.
  try {
    if (startY < 0) {
      // Stable 1D hash for column variation
      function h1(n) {
        let x = (n | 0) * 374761393;
        x = (x ^ (x >>> 13)) | 0;
        x = Math.imul(x, 1274126177) | 0;
        x = (x ^ (x >>> 16)) >>> 0;
        return (x % 1000003) / 1000003;
      }
      // Colors
      const waterDef = getTileDef("overworld", WT.WATER);
      const beachDef = getTileDef("overworld", WT.BEACH);
      const waterFill = (waterDef && waterDef.colors && waterDef.colors.fill) ? waterDef.colors.fill : fallbackFillOverworld(WT, WT.WATER);
      const beachFill = (beachDef && beachDef.colors && beachDef.colors.fill) ? beachDef.colors.fill : "#b59b6a";

      // Per-column variable band height + subtle wave stripes and foam at the lip
      const minBand = 2, maxBand = 6;
      for (let x = startX; x <= endX; x++) {
        const r = h1(x * 9176 + 13);
        const bandH = minBand + ((r * (maxBand - minBand + 1)) | 0); // 2..6 tiles
        // Draw water tiles for rows [-bandH .. -1]
        for (let y = -bandH; y < 0; y++) {
          if (y < startY) continue; // above viewport
          const sx = (x - startX) * TILE - tileOffsetX;
          const sy = (y - startY) * TILE - tileOffsetY;
          // base water
          ctx2d.fillStyle = waterFill;
          ctx2d.fillRect(sx, sy, TILE, TILE);

          // wave banding (very subtle)
          const wave = ((x + y) & 1) === 0;
          if (wave) {
            ctx2d.save();
            ctx2d.globalAlpha = 0.10;
            ctx2d.fillStyle = "#103a57";
            ctx2d.fillRect(sx, sy + (Math.max(2, TILE * 0.4) | 0), TILE, 2);
            ctx2d.restore();
          }
        }

        // Foam along the lip at y = -1 (if visible), and a thin beach tint on the first on-map row (y=0)
        if (-1 >= startY) {
          const sx = (x - startX) * TILE - tileOffsetX;
          const sy = (-1 - startY) * TILE - tileOffsetY;
          // foam jitter
          const fr = h1( (x*31) ^ 0x9e3779 );
          const fo = 2 + ((fr * (TILE - 6)) | 0);
          ctx2d.save();
          ctx2d.globalAlpha = 0.22;
          ctx2d.fillStyle = "rgba(255,255,255,0.85)";
          ctx2d.fillRect(sx + 2, sy + (TILE - 3), TILE - 4, 2);
          ctx2d.globalAlpha = 0.15;
          ctx2d.fillRect(sx + fo, sy + (TILE - 5), Math.max(2, (TILE * 0.25) | 0), 2);
          ctx2d.restore();
        }

        // Beach tint into the first visible on-map row to simulate shore transition
        if (0 >= startY && 0 < mapRows) {
          const sx0 = (x - startX) * TILE - tileOffsetX;
          const sy0 = (0 - startY) * TILE - tileOffsetY;
          ctx2d.save();
          ctx2d.globalAlpha = 0.10; // subtle
          ctx2d.fillStyle = beachFill;
          ctx2d.fillRect(sx0, sy0, TILE, Math.max(2, (TILE * 0.35) | 0));
          ctx2d.restore();
        }
      }

      // Gentle vignette fade above shoreline to suggest distance/haze instead of void
      ctx2d.save();
      const fadeRows = 2;
      for (let yy = Math.max(startY, -maxBand - fadeRows); yy < -maxBand + 1; yy++) {
        const alpha = Math.max(0, Math.min(0.25, 0.15 + (yy + maxBand) * 0.06));
        if (alpha <= 0) continue;
        for (let xx = startX; xx <= endX; xx++) {
          const sx = (xx - startX) * TILE - tileOffsetX;
          const sy = (yy - startY) * TILE - tileOffsetY;
          ctx2d.fillStyle = `rgba(10, 27, 42, ${alpha.toFixed(3)})`;
          ctx2d.fillRect(sx, sy, TILE, TILE);
        }
      }
      ctx2d.restore();
    }
  } catch (_) {}

  // Coastline/shoreline outlines for water/river adjacency (visual polish)
  try {
    for (let y = startY; y <= endY; y++) {
      const yIn = y >= 0 && y < mapRows;
      if (!yIn) continue;
      for (let x = startX; x <= endX; x++) {
        if (x < 0 || x >= mapCols) continue;
        const t = map[y][x];
        if (t !== WT.WATER && t !== WT.RIVER) continue;
        // If adjacent to land (grass, forest, beach, swamp, desert, snow, town, dungeon), draw a light border on the land side
        const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
        for (const d of dirs) {
          const nx = x + d.dx, ny = y + d.dy;
          if (nx < 0 || ny < 0 || nx >= mapCols || ny >= mapRows) continue;
          const nt = map[ny][nx];
          if (nt === WT.WATER || nt === WT.RIVER) continue;
          const sx = (nx - startX) * TILE - tileOffsetX;
          const sy = (ny - startY) * TILE - tileOffsetY;
          ctx2d.save();
          ctx2d.globalAlpha = 0.16;
          ctx2d.fillStyle = "#a8dadc";
          ctx2d.fillRect(sx, sy, TILE, TILE);
          ctx2d.restore();
        }
      }
    }
  } catch (_) {}

  // Fog of war overlay: hide undiscovered tiles, dim seen-but-not-visible
  try {
    for (let y = startY; y <= endY; y++) {
      if (y < 0 || y >= mapRows) continue;
      const seenRow = ctx.seen && ctx.seen[y];
      const visRow = ctx.visible && ctx.visible[y];
      for (let x = startX; x <= endX; x++) {
        if (x < 0 || x >= mapCols) continue;
        const sx = (x - startX) * TILE - tileOffsetX;
        const sy = (y - startY) * TILE - tileOffsetY;
        const seenHere = !!(seenRow && seenRow[x]);
        const visHere = !!(visRow && visRow[x]);
        if (!seenHere) {
          // Full fog
          ctx2d.fillStyle = "#0b0c10";
          ctx2d.fillRect(sx, sy, TILE, TILE);
        } else if (!visHere) {
          // Dim explored but not currently visible
          ctx2d.fillStyle = "rgba(0,0,0,0.35)";
          ctx2d.fillRect(sx, sy, TILE, TILE);
        }
      }
    }
  } catch (_) {}

  // Subtle biome embellishments to reduce flat look
  try {
    // Stable hash for x,y -> [0,1)
    function h2(x, y) {
      // large primes, clamp to 32-bit, normalize
      const n = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      return (n % 1000) / 1000;
    }
    for (let y = startY; y <= endY; y++) {
      if (y < 0 || y >= mapRows) continue;
      const row = map[y];
      for (let x = startX; x <= endX; x++) {
        if (x < 0 || x >= mapCols) continue;
        const t = row[x];
        const sx = (x - startX) * TILE - tileOffsetX;
        const sy = (y - startY) * TILE - tileOffsetY;

        // Forest canopy dots
        if (t === WT.FOREST) {
          const r = h2(x, y);
          if (r < 0.75) {
            const dots = 1 + ((r * 3) | 0);
            ctx2d.save();
            ctx2d.globalAlpha = 0.15;
            ctx2d.fillStyle = "#173d2b";
            for (let i = 0; i < dots; i++) {
              const ox = ((h2(x + i, y + i) * (TILE - 6)) | 0) + 3;
              const oy = ((h2(x - i, y - i) * (TILE - 6)) | 0) + 3;
              ctx2d.fillRect(sx + ox, sy + oy, 2, 2);
            }
            ctx2d.restore();
          }
        }

        // Mountain ridge highlight (top-left light)
        if (t === WT.MOUNTAIN) {
          ctx2d.save();
          ctx2d.globalAlpha = 0.20;
          ctx2d.fillStyle = "#2a3342";
          ctx2d.fillRect(sx + 1, sy + 1, TILE - 2, 3);
          ctx2d.fillRect(sx + 1, sy + 1, 3, TILE - 2);
          ctx2d.restore();
        }

        // Desert specks
        if (t === WT.DESERT) {
          const r = h2(x, y);
          if (r > 0.25) {
            ctx2d.save();
            ctx2d.globalAlpha = 0.18;
            ctx2d.fillStyle = "#b69d78";
            const ox = ((h2(x + 7, y + 3) * (TILE - 6)) | 0) + 3;
            const oy = ((h2(x + 11, y + 5) * (TILE - 6)) | 0) + 3;
            ctx2d.fillRect(sx + ox, sy + oy, 2, 2);
            const ox2 = ((h2(x + 13, y + 9) * (TILE - 6)) | 0) + 3;
            const oy2 = ((h2(x + 17, y + 1) * (TILE - 6)) | 0) + 3;
            ctx2d.fillRect(sx + ox2, sy + oy2, 1, 1);
            ctx2d.restore();
          }
        }

        // Snow subtle blue shade variation
        if (t === WT.SNOW) {
          ctx2d.save();
          ctx2d.globalAlpha = 0.08;
          ctx2d.fillStyle = "#94b7ff";
          const ox = ((h2(x + 19, y + 23) * (TILE - 6)) | 0) + 3;
          const oy = ((h2(x + 29, y + 31) * (TILE - 6)) | 0) + 3;
          ctx2d.fillRect(sx + ox, sy + oy, 3, 3);
          ctx2d.restore();
        }

        // River shimmer (thin highlight line)
        if (t === WT.RIVER) {
          const r = ((x + y) & 1) === 0;
          ctx2d.save();
          ctx2d.globalAlpha = 0.12;
          ctx2d.fillStyle = "#cfe9ff";
          if (r) {
            ctx2d.fillRect(sx + 4, sy + (TILE / 2) | 0, TILE - 8, 2);
          } else {
            ctx2d.fillRect(sx + (TILE / 2) | 0, sy + 4, 2, TILE - 8);
          }
          ctx2d.restore();
        }
      }
    }
  } catch (_) {}

  // Draw roads as overlays with style variations:
  // - dashed pattern via parity of (x+y)
  // - thicker segments near cities
  try {
    const roads = (ctx.world && Array.isArray(ctx.world.roads)) ? ctx.world.roads : [];
    const towns = (ctx.world && Array.isArray(ctx.world.towns)) ? ctx.world.towns : [];
    const ox = (ctx.world && typeof ctx.world.originX === "number") ? ctx.world.originX : 0;
    const oy = (ctx.world && typeof ctx.world.originY === "number") ? ctx.world.originY : 0;
    if (roads.length) {
      ctx2d.save();
      ctx2d.globalAlpha = 0.38;
      ctx2d.fillStyle = "#9aa5b1"; // light slate for road

      // Helper: check if near a city to thicken segment
      function nearCityAbs(ax, ay) {
        const R = 4;
        for (const t of towns) {
          if (!t || t.size !== "city") continue;
          const d = Math.abs(t.x - ax) + Math.abs(t.y - ay);
          if (d <= R) return true;
        }
        return false;
      }

      for (const p of roads) {
        const ax = p.x | 0, ay = p.y | 0;      // absolute world coords
        const x = ax - ox, y = ay - oy;        // local indices
        if (x < startX || x > endX || y < startY || y > endY) continue;

        // Dashed: skip every other tile based on parity; keep continuous look when near cities
        const dashedSkip = ((x + y) % 2) !== 0 && !nearCityAbs(ax, ay);
        if (dashedSkip) continue;

        const sx = (x - startX) * TILE - tileOffsetX;
        const sy = (y - startY) * TILE - tileOffsetY;

        // Thickness scales with proximity to cities (based on absolute coords)
        const thick = nearCityAbs(ax, ay);
        const w = thick ? Math.max(3, Math.floor(TILE * 0.55)) : Math.max(2, Math.floor(TILE * 0.30));
        const h = thick ? Math.max(2, Math.floor(TILE * 0.40)) : Math.max(2, Math.floor(TILE * 0.30));

        ctx2d.fillRect(sx + (TILE - w) / 2, sy + (TILE - h) / 2, w, h);
      }
      ctx2d.restore();
    }
  } catch (_) {}

  // Draw bridges as stronger markers across rivers
  try {
    const bridges = (ctx.world && Array.isArray(ctx.world.bridges)) ? ctx.world.bridges : [];
    if (bridges.length) {
      ctx2d.save();
      ctx2d.globalAlpha = 0.6;
      ctx2d.fillStyle = "#c3a37a"; // wood-like color
      for (const p of bridges) {
        const x = p.x, y = p.y;
        if (x < startX || x > endX || y < startY || y > endY) continue;
        const sx = (x - startX) * TILE - tileOffsetX;
        const sy = (y - startY) * TILE - tileOffsetY;
        // small plank-like rectangle
        const w = Math.max(4, Math.floor(TILE * 0.55));
        const h = Math.max(3, Math.floor(TILE * 0.20));
        ctx2d.fillRect(sx + (TILE - w) / 2, sy + (TILE - h) / 2, w, h);
      }
      ctx2d.restore();
    }
  } catch (_) {}

  // Main-map POI icons: towns and dungeons (convert absolute world coords -> local indices using world.origin)
  try {
    const towns = (ctx.world && Array.isArray(ctx.world.towns)) ? ctx.world.towns : [];
    const dungeons = (ctx.world && Array.isArray(ctx.world.dungeons)) ? ctx.world.dungeons : [];
    const ox = (ctx.world && typeof ctx.world.originX === "number") ? ctx.world.originX : 0;
    const oy = (ctx.world && typeof ctx.world.originY === "number") ? ctx.world.originY : 0;

    // Towns: gold glyphs — 't' for towns, 'T' for cities
    for (const t of towns) {
      const lx = (t.x | 0) - ox;
      const ly = (t.y | 0) - oy;
      if (lx < startX || lx > endX || ly < startY || ly > endY) continue;
      const sx = (lx - startX) * TILE - tileOffsetX;
      const sy = (ly - startY) * TILE - tileOffsetY;
      const glyph = (t.size === "city") ? "T" : "t";
      RenderCore.drawGlyph(ctx2d, sx, sy, glyph, "#ffd166", TILE);
    }

    // Dungeons: red squares
    ctx2d.save();
    for (const d of dungeons) {
      const lx = (d.x | 0) - ox;
      const ly = (d.y | 0) - oy;
      if (lx < startX || lx > endX || ly < startY || ly > endY) continue;
      const sx = (lx - startX) * TILE - tileOffsetX;
      const sy = (ly - startY) * TILE - tileOffsetY;
      const s = Math.max(4, Math.floor(TILE * 0.48));
      ctx2d.fillStyle = "#ef4444";
      ctx2d.globalAlpha = 0.85;
      ctx2d.fillRect(sx + (TILE - s) / 2, sy + (TILE - s) / 2, s, s);
      ctx2d.globalAlpha = 0.95;
      ctx2d.strokeStyle = "rgba(239, 68, 68, 0.7)";
      ctx2d.lineWidth = 1;
      ctx2d.strokeRect(sx + (TILE - s) / 2 + 0.5, sy + (TILE - s) / 2 + 0.5, s - 1, s - 1);
    }
    ctx2d.restore();
  } catch (_) {}

  // Draw bridges as stronger markers across rivers
  try {
    const bridges = (ctx.world && Array.isArray(ctx.world.bridges)) ? ctx.world.bridges : [];
    if (bridges.length) {
      ctx2d.save();
      ctx2d.globalAlpha = 0.6;
      ctx2d.fillStyle = "#c3a37a"; // wood-like color
      for (const p of bridges) {
        const x = p.x, y = p.y;
        if (x < startX || x > endX || y < startY || y > endY) continue;
        const sx = (x - startX) * TILE - tileOffsetX;
        const sy = (y - startY) * TILE - tileOffsetY;
        // small plank-like rectangle
        const w = Math.max(4, Math.floor(TILE * 0.55));
        const h = Math.max(3, Math.floor(TILE * 0.20));
        ctx2d.fillRect(sx + (TILE - w) / 2, sy + (TILE - h) / 2, w, h);
      }
      ctx2d.restore();
    }
  } catch (_) {}

  // Per-frame glyph overlay for any tile with a non-blank JSON glyph
  for (let y = startY; y <= endY; y++) {
    const yIn = y >= 0 && y < mapRows;
    const row = yIn ? map[y] : null;
    for (let x = startX; x <= endX; x++) {
      if (!yIn || x < 0 || x >= mapCols) continue;
      const t = row[x];
      const td = getTileDef("overworld", t);
      if (!td) continue;
      const glyph = Object.prototype.hasOwnProperty.call(td, "glyph") ? td.glyph : "";
      const fg = td.colors && td.colors.fg ? td.colors.fg : null;
      if (glyph && String(glyph).trim().length > 0 && fg) {
        const screenX = (x - startX) * TILE - tileOffsetX;
        const screenY = (y - startY) * TILE - tileOffsetY;
        RenderCore.drawGlyph(ctx2d, screenX, screenY, glyph, fg, TILE);
      }
    }
  }

  // Biome label + clock (rounded box + subtle border)
  try {
    let labelWidth = 260;
    let biomeName = "";
    if (WT && typeof World.biomeName === "function") {
      const tile = map[player.y] && map[player.y][player.x];
      biomeName = World.biomeName(tile);
    }
    const time = ctx.time || null;
    const clock = time ? time.hhmm : null;

    const text = `Biome: ${biomeName}${clock ? "   |   Time: " + clock : ""}`;
    labelWidth = Math.max(260, 16 * (text.length / 2));
    const bx = 8, by = 8, bh = 26, bw = labelWidth;
    ctx2d.save();
    ctx2d.fillStyle = "rgba(13,16,24,0.80)";
    // Rounded rect
    try {
      const r = 6;
      ctx2d.beginPath();
      ctx2d.moveTo(bx + r, by);
      ctx2d.lineTo(bx + bw - r, by);
      ctx2d.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
      ctx2d.lineTo(bx + bw, by + bh - r);
      ctx2d.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
      ctx2d.lineTo(bx + r, by + bh);
      ctx2d.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
      ctx2d.lineTo(bx, by + r);
      ctx2d.quadraticCurveTo(bx, by, bx + r, by);
      ctx2d.closePath();
      ctx2d.fill();
      ctx2d.strokeStyle = "rgba(122,162,247,0.35)";
      ctx2d.lineWidth = 1;
      ctx2d.stroke();
    } catch (_) {
      ctx2d.fillRect(bx, by, bw, bh);
      ctx2d.strokeStyle = "rgba(122,162,247,0.35)";
      ctx2d.lineWidth = 1;
      ctx2d.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    }
    ctx2d.fillStyle = "#e5e7eb";
    ctx2d.textAlign = "left";
    ctx2d.fillText(text, bx + 10, by + 13);
    ctx2d.restore();
  } catch (_) {}

  // Minimap (top-right) with offscreen cache (toggleable) + POI markers
  try {
    const showMini = (typeof window !== "undefined" && typeof window.SHOW_MINIMAP === "boolean") ? window.SHOW_MINIMAP : true;
    if (showMini) {
      const mw = ctx.world && ctx.world.width ? ctx.world.width : (map[0] ? map[0].length : 0);
      const mh = ctx.world && ctx.world.height ? ctx.world.height : map.length;
      if (mw && mh) {
        // Responsive clamp for small screens (larger minimap)
        let maxW = 280, maxH = 210;
        try {
          if (typeof window !== "undefined" && window.innerWidth && window.innerWidth < 700) {
            maxW = 180; maxH = 135;
          }
        } catch (_) {}
        const scale = Math.max(1, Math.floor(Math.min(maxW / mw, maxH / mh)));
        const wpx = mw * scale, hpx = mh * scale;
        const pad = 8;
        const bx = cam.width - wpx - pad;
        const by = pad;

        // Build offscreen once per world map reference or dimension change or player moved (to reflect new seen tiles)
        const mapRef = map;
        const needsRebuild = (!MINI.canvas) || MINI.mapRef !== mapRef || MINI.wpx !== wpx || MINI.hpx !== hpx || MINI.scale !== scale || MINI._tilesRef !== tilesRef() || MINI.px !== player.x || MINI.py !== player.y;
        if (needsRebuild) {
          MINI.mapRef = mapRef;
          MINI.wpx = wpx;
          MINI.hpx = hpx;
          MINI.scale = scale;
          MINI._tilesRef = tilesRef();
          MINI.px = player.x;
          MINI.py = player.y;
          const off = RenderCore.createOffscreen(wpx, hpx);
          const oc = off.getContext("2d");
          // Minimap: only draw tiles the player has discovered (ctx.seen)
          for (let yy = 0; yy < mh; yy++) {
            const rowM = map[yy];
            const seenRow = (ctx.seen && ctx.seen[yy]) ? ctx.seen[yy] : null;
            for (let xx = 0; xx < mw; xx++) {
              const seenHere = seenRow ? !!seenRow[xx] : false;
              if (seenHere) {
                const t = rowM[xx];
                const td = getTileDef("overworld", t);
                const c = (td && td.colors && td.colors.fill) ? td.colors.fill : "#0b0c10";
                oc.fillStyle = c;
              } else {
                oc.fillStyle = "#0b0c10"; // fog of war
              }
              oc.fillRect(xx * scale, yy * scale, scale, scale);
            }
          }
          MINI.canvas = off;
        }

        // background + border + label
        ctx2d.save();
        ctx2d.fillStyle = "rgba(13,16,24,0.70)";
        ctx2d.fillRect(bx - 6, by - 6, wpx + 12, hpx + 12);
        ctx2d.strokeStyle = "rgba(122,162,247,0.35)";
        ctx2d.lineWidth = 1;
        ctx2d.strokeRect(bx - 6.5, by - 6.5, wpx + 13, hpx + 13);
        try {
          const prevAlign = ctx2d.textAlign;
          const prevBaseline = ctx2d.textBaseline;
          ctx2d.textAlign = "left";
          ctx2d.textBaseline = "top";
          ctx2d.fillStyle = "#cbd5e1";
          ctx2d.fillText("Minimap", bx - 4, by - 22);
          ctx2d.textAlign = prevAlign;
          ctx2d.textBaseline = prevBaseline;
        } catch (_) {}

        // blit cached minimap
        if (MINI.canvas) {
          ctx2d.drawImage(MINI.canvas, bx, by);
        }

        // POI markers: towns (gold), dungeons (red) - convert absolute world coords to local indices
        try {
          const towns = Array.isArray(ctx.world?.towns) ? ctx.world.towns : [];
          const dungeons = Array.isArray(ctx.world?.dungeons) ? ctx.world.dungeons : [];
          const ox = (ctx.world && typeof ctx.world.originX === "number") ? ctx.world.originX : 0;
          const oy = (ctx.world && typeof ctx.world.originY === "number") ? ctx.world.originY : 0;
          ctx2d.save();
          for (const t of towns) {
            const lx = (t.x | 0) - ox;
            const ly = (t.y | 0) - oy;
            if (lx < 0 || ly < 0 || lx >= mw || ly >= mh) continue;
            ctx2d.fillStyle = "#f6c177";
            ctx2d.fillRect(bx + lx * scale, by + ly * scale, Math.max(1, scale), Math.max(1, scale));
          }
          for (const d of dungeons) {
            const lx = (d.x | 0) - ox;
            const ly = (d.y | 0) - oy;
            if (lx < 0 || ly < 0 || lx >= mw || ly >= mh) continue;
            ctx2d.fillStyle = "#f7768e";
            ctx2d.fillRect(bx + lx * scale, by + ly * scale, Math.max(1, scale), Math.max(1, scale));
          }
          ctx2d.restore();
        } catch (_) {}

        // player marker (white)
        ctx2d.fillStyle = "#ffffff";
        ctx2d.fillRect(bx + player.x * scale, by + player.y * scale, Math.max(1, scale), Math.max(1, scale));
        ctx2d.restore();
      }
    }
  } catch (_) {}

  // Do not draw town NPCs in overworld renderer; towns are drawn by render_town.js
  // (If we later add world-wandering NPCs, render a separate ctx.worldNpcs list instead.)

  // player - add backdrop marker + outlined glyph to improve visibility on overworld tiles
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

  // Subtle vignette around viewport edges
  try {
    ctx2d.save();
    const grad = ctx2d.createRadialGradient(
      cam.width / 2, cam.height / 2, Math.min(cam.width, cam.height) * 0.60,
      cam.width / 2, cam.height / 2, Math.max(cam.width, cam.height) * 0.70
    );
    grad.addColorStop(0, "rgba(0,0,0,0.00)");
    grad.addColorStop(1, "rgba(0,0,0,0.12)");
    ctx2d.fillStyle = grad;
    ctx2d.fillRect(0, 0, cam.width, cam.height);
    ctx2d.restore();
  } catch (_) {}

  // Grid overlay (if enabled)
  RenderCore.drawGridOverlay(view);

  // Topmost: ensure player marker is above grid/tints for maximum visibility
  try {
    if (player.x >= startX && player.x <= endX && player.y >= startY && player.y <= endY) {
      const screenX = (player.x - startX) * TILE - tileOffsetX;
      const screenY = (player.y - startY) * TILE - tileOffsetY;
      ctx2d.save();
      // Bright outline square around the tile
      ctx2d.globalAlpha = 0.9;
      ctx2d.strokeStyle = "#ffffff";
      ctx2d.lineWidth = 2;
      ctx2d.strokeRect(screenX + 3.5, screenY + 3.5, TILE - 7, TILE - 7);
      // Glyph on top
      const half = TILE / 2;
      ctx2d.lineWidth = 3;
      ctx2d.strokeStyle = "#0b0f16";
      ctx2d.strokeText("@", screenX + half, screenY + half + 1);
      ctx2d.fillStyle = COLORS.player || "#9ece6a";
      ctx2d.fillText("@", screenX + half, screenY + half + 1);
      ctx2d.restore();
    }
  } catch (_) {}

}

 // Back-compat: attach to window via helper
attachGlobal("RenderOverworld", { draw });