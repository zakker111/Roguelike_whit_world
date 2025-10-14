/**
 * RenderOverworld: draws overworld tiles, towns/dungeons glyphs, minimap, NPCs, player, and time tint.
 *
 * Exports (ESM + window.RenderOverworld):
 * - draw(ctx, view)
 */
import * as RenderCore from "./render_core.js";
import * as World from "../world/world.js";

// Minimap offscreen cache to avoid redrawing every frame
let MINI = { mapRef: null, canvas: null, wpx: 0, hpx: 0, scale: 0 };
// World base layer offscreen cache (full map at TILE resolution)
let WORLD = { mapRef: null, canvas: null, wpx: 0, hpx: 0, TILE: 0 };

export function draw(ctx, view) {
  const {
    ctx2d, TILE, COLORS, map, player, camera: camMaybe, TS, tilesetReady,
    cam, tileOffsetX, tileOffsetY, startX, startY, endX, endY
  } = Object.assign({}, view, ctx);

  const enemyColor = (t) => RenderCore.enemyColor(ctx, t, COLORS);

  // lightweight palette for overworld
  const WCOL = {
    water: "#0a1b2a",
    river: "#0e2f4a",
    grass: "#10331a",
    forest: "#0d2615",
    swamp: "#1b2a1e",
    beach: "#b59b6a",
    desert: "#c2a36b",
    snow: "#b9c7d3",
    mountain: "#2f2f34",
    town: "#3a2f1b",
    dungeon: "#2a1b2a",
  };

  const WT = World.TILES;
  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;

  // Precompute town glyphs lookup to avoid per-tile array scans
  const TOWN_GLYPHS = {};
  try {
    if (ctx.world && Array.isArray(ctx.world.towns)) {
      for (const info of ctx.world.towns) {
        let glyph = "T";
        const sz = (info.size || "").toLowerCase();
        if (sz === "small") glyph = "t";
        else if (sz === "city") glyph = "C";
        TOWN_GLYPHS[`${info.x},${info.y}`] = glyph;
      }
    }
  } catch (_) {}

  // Build world base offscreen once per map/TILE change
  try {
    const mw = mapCols;
    const mh = mapRows;
    if (mw && mh) {
      const wpx = mw * TILE;
      const hpx = mh * TILE;
      const needsWorldRebuild = (!WORLD.canvas) || WORLD.mapRef !== map || WORLD.wpx !== wpx || WORLD.hpx !== hpx || WORLD.TILE !== TILE;
      if (needsWorldRebuild) {
        WORLD.mapRef = map;
        WORLD.wpx = wpx;
        WORLD.hpx = hpx;
        WORLD.TILE = TILE;
        const off = document.createElement("canvas");
        off.width = wpx;
        off.height = hpx;
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
            let c = WCOL.grass;
            if (WT) {
              if (t === WT.WATER) c = WCOL.water;
              else if (t === WT.RIVER) c = WCOL.river;
              else if (t === WT.SWAMP) c = WCOL.swamp;
              else if (t === WT.BEACH) c = WCOL.beach;
              else if (t === WT.DESERT) c = WCOL.desert;
              else if (t === WT.SNOW) c = WCOL.snow;
              else if (t === WT.FOREST) c = WCOL.forest;
              else if (t === WT.MOUNTAIN) c = WCOL.mountain;
              else if (t === WT.DUNGEON) c = WCOL.dungeon;
              else if (t === WT.TOWN) c = WCOL.town;
            }
            oc.fillStyle = c;
            oc.fillRect(xx * TILE, yy * TILE, TILE, TILE);
            // Overlay static glyphs directly onto the base
            if (WT && t === WT.TOWN) {
              const glyph = TOWN_GLYPHS[`${xx},${yy}`] || "T";
              RenderCore.drawGlyph(oc, xx * TILE, yy * TILE, glyph, "#d7ba7d", TILE);
            } else if (WT && t === WT.DUNGEON) {
              RenderCore.drawGlyph(oc, xx * TILE, yy * TILE, "D", "#c586c0", TILE);
            }
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
        let fill = WCOL.grass;
        if (WT) {
          if (t === WT.WATER) fill = WCOL.water;
          else if (t === WT.RIVER) fill = WCOL.river;
          else if (t === WT.SWAMP) fill = WCOL.swamp;
          else if (t === WT.BEACH) fill = WCOL.beach;
          else if (t === WT.DESERT) fill = WCOL.desert;
          else if (t === WT.SNOW) fill = WCOL.snow;
          else if (t === WT.GRASS) fill = WCOL.grass;
          else if (t === WT.FOREST) fill = WCOL.forest;
          else if (t === WT.MOUNTAIN) fill = WCOL.mountain;
          else if (t === WT.TOWN) fill = WCOL.town;
          else if (t === WT.DUNGEON) fill = WCOL.dungeon;
        }
        ctx2d.fillStyle = fill;
        ctx2d.fillRect(screenX, screenY, TILE, TILE);

        // Overlay glyphs for special overworld tiles
        if (WT && t === WT.TOWN) {
          const glyph = TOWN_GLYPHS[`${x},${y}`] || "T";
          RenderCore.drawGlyph(ctx2d, screenX, screenY, glyph, "#d7ba7d", TILE);
        } else if (WT && t === WT.DUNGEON) {
          RenderCore.drawGlyph(ctx2d, screenX, screenY, "D", "#c586c0", TILE);
        }
      }
    }
  }

  // Biome label + clock
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
    ctx2d.fillStyle = "rgba(13,16,24,0.8)";
    ctx2d.fillRect(8, 8, labelWidth, 26);
    ctx2d.fillStyle = "#e5e7eb";
    ctx2d.textAlign = "left";
    ctx2d.fillText(text, 18, 8 + 13);
    ctx2d.textAlign = "center";
  } catch (_) {}

  // Minimap (top-right) with offscreen cache (toggleable)
  try {
    const showMini = (typeof window !== "undefined" && typeof window.SHOW_MINIMAP === "boolean") ? window.SHOW_MINIMAP : true;
    if (showMini) {
      const mw = ctx.world && ctx.world.width ? ctx.world.width : (map[0] ? map[0].length : 0);
      const mh = ctx.world && ctx.world.height ? ctx.world.height : map.length;
      if (mw && mh) {
        const maxW = 200, maxH = 150;
        const scale = Math.max(1, Math.floor(Math.min(maxW / mw, maxH / mh)));
        const wpx = mw * scale, hpx = mh * scale;
        const pad = 8;
        const bx = cam.width - wpx - pad;
        const by = pad;

        // Build offscreen once per world map reference or dimension change
        const mapRef = map;
        const needsRebuild = (!MINI.canvas) || MINI.mapRef !== mapRef || MINI.wpx !== wpx || MINI.hpx !== hpx || MINI.scale !== scale;
        if (needsRebuild) {
          MINI.mapRef = mapRef;
          MINI.wpx = wpx;
          MINI.hpx = hpx;
          MINI.scale = scale;
          const off = document.createElement("canvas");
          off.width = wpx;
          off.height = hpx;
          const oc = off.getContext("2d");
          // tiles
          for (let yy = 0; yy < mh; yy++) {
            const rowM = map[yy];
            for (let xx = 0; xx < mw; xx++) {
              const t = rowM[xx];
              let c = WCOL.grass;
              if (WT) {
                if (t === WT.WATER) c = WCOL.water;
                else if (t === WT.RIVER) c = WCOL.river;
                else if (t === WT.SWAMP) c = WCOL.swamp;
                else if (t === WT.BEACH) c = WCOL.beach;
                else if (t === WT.DESERT) c = WCOL.desert;
                else if (t === WT.SNOW) c = WCOL.snow;
                else if (t === WT.FOREST) c = WCOL.forest;
                else if (t === WT.MOUNTAIN) c = WCOL.mountain;
                else if (t === WT.DUNGEON) c = WCOL.dungeon;
                else if (t === WT.TOWN) c = WCOL.town;
              }
              oc.fillStyle = c;
              oc.fillRect(xx * scale, yy * scale, scale, scale);
            }
          }
          // overlay towns and dungeons
          if (ctx.world && Array.isArray(ctx.world.towns)) {
            oc.fillStyle = "#ffcc66";
            for (const t of ctx.world.towns) {
              oc.fillRect(t.x * scale, t.y * scale, Math.max(1, scale), Math.max(1, scale));
            }
          }
          if (ctx.world && Array.isArray(ctx.world.dungeons)) {
            oc.fillStyle = "#c586c0";
            for (const d of ctx.world.dungeons) {
              oc.fillRect(d.x * scale, d.y * scale, Math.max(1, scale), Math.max(1, scale));
            }
          }
          MINI.canvas = off;
        }

        // background + border + label
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

        // player marker
        ctx2d.fillStyle = "#ffffff";
        ctx2d.fillRect(bx + player.x * scale, by + player.y * scale, Math.max(1, scale), Math.max(1, scale));
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