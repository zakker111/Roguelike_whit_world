/**
 * RenderOverworld: draws overworld tiles, glyphs from tiles.json, minimap, NPCs, player, and time tint.
 *
 * Exports (ESM + window.RenderOverworld):
 * - draw(ctx, view)
 */
import * as RenderCore from "./render_core.js";
import * as World from "../world/world.js";

// Minimap offscreen cache to avoid redrawing every frame
let MINI = { mapRef: null, canvas: null, wpx: 0, hpx: 0, scale: 0, _tilesRef: null };
// World base layer offscreen cache (full map at TILE resolution)
let WORLD = { mapRef: null, canvas: null, wpx: 0, hpx: 0, TILE: 0, _tilesRef: null };

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
        for (let yy = 0; yy < mh; yy++) {
          const rowM = map[yy];
          for (let xx = 0; xx < mw; xx++) {
            const t = rowM[xx];
            // JSON-only fill color for overworld
            const td = getTileDef("overworld", t);
            const c = (td && td.colors && td.colors.fill) ? td.colors.fill : "#0b0c10";
            oc.fillStyle = c;
            oc.fillRect(xx * TILE, yy * TILE, TILE, TILE);
            // Note: glyph overlays are drawn per-frame below, not baked into base.
          }
        }
        WORLD.canvas = off;
      }
    }
  } catch (_) {}

  // Draw world base: offscreen blit if available, otherwise fallback per-tile loop
  if (WORLD.canvas) {
    try {
      RenderCore.blitViewport(ctx2d, WORLD.canvas, cam, WORLD.wpx, WORLD.hpx);
    } catch (_) {}
  } else {
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
        const fill = (td && td.colors && td.colors.fill) ? td.colors.fill : "#0b0c10";
        ctx2d.fillStyle = fill;
        ctx2d.fillRect(screenX, screenY, TILE, TILE);
      }
    }
  }

  // Coastline/shoreline outlines for water/river adjacency (visual polish)
  try {
    for (let y = startY; y <= endY; y++) {
      const yIn = y >= 0 && y < mapRows;
      if (!yIn) continue;
      for (let x = startX; x <= endX; x++) {
        if (x < 0 || x >= mapCols) continue;
        const t = map[y][x];
        if (t !== TILES.WATER && t !== TILES.RIVER) continue;
        // If adjacent to land (grass, forest, beach, swamp, desert, snow, town, dungeon), draw a light border on the land side
        const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
        for (const d of dirs) {
          const nx = x + d.dx, ny = y + d.dy;
          if (nx < 0 || ny < 0 || nx >= mapCols || ny >= mapRows) continue;
          const nt = map[ny][nx];
          if (nt === TILES.WATER || nt === TILES.RIVER) continue;
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

  // Draw roads as overlays with style variations:
  // - dashed pattern via parity of (x+y)
  // - thicker segments near cities
  try {
    const roads = (ctx.world && Array.isArray(ctx.world.roads)) ? ctx.world.roads : [];
    const towns = (ctx.world && Array.isArray(ctx.world.towns)) ? ctx.world.towns : [];
    if (roads.length) {
      ctx2d.save();
      ctx2d.globalAlpha = 0.38;
      ctx2d.fillStyle = "#9aa5b1"; // light slate for road

      // Helper: check if near a city to thicken segment
      function nearCity(x, y) {
        const R = 4;
        for (const t of towns) {
          if (!t || t.size !== "city") continue;
          const d = Math.abs(t.x - x) + Math.abs(t.y - y);
          if (d <= R) return true;
        }
        return false;
      }

      for (const p of roads) {
        const x = p.x, y = p.y;
        if (x < startX || x > endX || y < startY || y > endY) continue;

        // Dashed: skip every other tile based on parity; keep continuous look when near cities
        const dashedSkip = ((x + y) % 2) !== 0 && !nearCity(x, y);
        if (dashedSkip) continue;

        const sx = (x - startX) * TILE - tileOffsetX;
        const sy = (y - startY) * TILE - tileOffsetY;

        // Thickness scales with proximity to cities
        const thick = nearCity(x, y);
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

  // Main-map POI icons: towns and dungeons
  try {
    const towns = (ctx.world && Array.isArray(ctx.world.towns)) ? ctx.world.towns : [];
    const dungeons = (ctx.world && Array.isArray(ctx.world.dungeons)) ? ctx.world.dungeons : [];
    // Towns: gold squares, size scaled by town size
    ctx2d.save();
    for (const t of towns) {
      const x = t.x, y = t.y;
      if (x < startX || x > endX || y < startY || y > endY) continue;
      const sx = (x - startX) * TILE - tileOffsetX;
      const sy = (y - startY) * TILE - tileOffsetY;
      let sizeMul = 0.40; // small
      if (t.size === "big") sizeMul = 0.52;
      else if (t.size === "city") sizeMul = 0.68;
      const s = Math.max(4, Math.floor(TILE * sizeMul));
      ctx2d.fillStyle = "#ffd166";
      ctx2d.globalAlpha = 0.85;
      ctx2d.fillRect(sx + (TILE - s) / 2, sy + (TILE - s) / 2, s, s);
      // subtle border
      ctx2d.globalAlpha = 0.95;
      ctx2d.strokeStyle = "rgba(255, 209, 102, 0.7)";
      ctx2d.lineWidth = 1;
      ctx2d.strokeRect(sx + (TILE - s) / 2 + 0.5, sy + (TILE - s) / 2 + 0.5, s - 1, s - 1);
    }
    ctx2d.restore();

    // Dungeons: red squares
    ctx2d.save();
    for (const d of dungeons) {
      const x = d.x, y = d.y;
      if (x < startX || x > endX || y < startY || y > endY) continue;
      const sx = (x - startX) * TILE - tileOffsetX;
      const sy = (y - startY) * TILE - tileOffsetY;
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
        // Responsive clamp for small screens
        let maxW = 200, maxH = 150;
        try {
          if (typeof window !== "undefined" && window.innerWidth && window.innerWidth < 700) {
            maxW = 120; maxH = 90;
          }
        } catch (_) {}
        const scale = Math.max(1, Math.floor(Math.min(maxW / mw, maxH / mh)));
        const wpx = mw * scale, hpx = mh * scale;
        const pad = 8;
        const bx = cam.width - wpx - pad;
        const by = pad;

        // Build offscreen once per world map reference or dimension change
        const mapRef = map;
        const needsRebuild = (!MINI.canvas) || MINI.mapRef !== mapRef || MINI.wpx !== wpx || MINI.hpx !== hpx || MINI.scale !== scale || MINI._tilesRef !== tilesRef();
        if (needsRebuild) {
          MINI.mapRef = mapRef;
          MINI.wpx = wpx;
          MINI.hpx = hpx;
          MINI.scale = scale;
          MINI._tilesRef = tilesRef();
          const off = RenderCore.createOffscreen(wpx, hpx);
          const oc = off.getContext("2d");
          // tiles from JSON only
          for (let yy = 0; yy < mh; yy++) {
            const rowM = map[yy];
            for (let xx = 0; xx < mw; xx++) {
              const t = rowM[xx];
              const td = getTileDef("overworld", t);
              const c = (td && td.colors && td.colors.fill) ? td.colors.fill : "#0b0c10";
              oc.fillStyle = c;
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

        // POI markers: towns (gold), dungeons (red)
        try {
          const towns = Array.isArray(ctx.world?.towns) ? ctx.world.towns : [];
          const dungeons = Array.isArray(ctx.world?.dungeons) ? ctx.world.dungeons : [];
          ctx2d.save();
          for (const t of towns) {
            ctx2d.fillStyle = "#f6c177";
            ctx2d.fillRect(bx + t.x * scale, by + t.y * scale, Math.max(1, scale), Math.max(1, scale));
          }
          for (const d of dungeons) {
            ctx2d.fillStyle = "#f7768e";
            ctx2d.fillRect(bx + d.x * scale, by + d.y * scale, Math.max(1, scale), Math.max(1, scale));
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

  // NPCs
  if (Array.isArray(ctx.npcs)) {
    for (const n of ctx.npcs) {
      if (n.x < startX || n.x > endX || n.y < startY || n.y > endY) continue;
      const screenX = (n.x - startX) * TILE - tileOffsetX;
      const screenY = (n.y - startY) * TILE - tileOffsetY;
      RenderCore.drawGlyph(ctx2d, screenX, screenY, "n", "#b4f9f8", TILE);
    }
  }

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

  // Grid overlay (if enabled)
  RenderCore.drawGridOverlay(view);
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.RenderOverworld = { draw };
}