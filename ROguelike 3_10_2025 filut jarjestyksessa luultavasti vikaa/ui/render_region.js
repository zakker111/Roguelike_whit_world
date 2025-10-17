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

// Fallback fill palette when tiles.json is missing/unavailable
function fallbackFillFor(id) {
  switch (id | 0) {
    case 0:  return "#0a1b2a"; // WATER
    case 1:  return "#10331a"; // GRASS
    case 2:  return "#0d2615"; // FOREST
    case 3:  return "#2f2f34"; // MOUNTAIN
    case 4:  return "#3a2f1b"; // TOWN
    case 5:  return "#2a1b2a"; // DUNGEON
    case 6:  return "#1b2a1e"; // SWAMP
    case 7:  return "#0e2f4a"; // RIVER
    case 8:  return "#b59b6a"; // BEACH
    case 9:  return "#c2a36b"; // DESERT
    case 10: return "#b9c7d3"; // SNOW
    case 11: return "#0f3b1e"; // TREE (region)
    default: return "#0b0c10"; // void/dark
  }
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

  // Record tiles usage for diagnostics (region mode) once per map reference
  try {
    if (typeof window !== "undefined" && window.TilesValidation && typeof window.TilesValidation.recordMap === "function") {
      window.TilesValidation.recordMap({ mode: "region", map });
    }
  } catch (_) {}

  // Tiles are driven entirely by data/tiles.json in region mode.

  // Draw the entire world map scaled to fit the viewport (distinct from overworld zoom)
  const camW = cam.width, camH = cam.height;
  const margin = 8;
  const availW = camW - margin * 2;
  const availH = camH - margin * 2;
  const tilePx = Math.max(4, Math.floor(Math.min(availW / mapCols, availH / mapRows)));
  const drawW = tilePx * mapCols;
  const drawH = tilePx * mapRows;
  const ox = Math.floor((camW - drawW) / 2);
  const oy = Math.floor((camH - drawH) / 2);

  // Base tiles (use tiles.json colors when available; fallback palette otherwise)
  for (let y = 0; y < mapRows; y++) {
    const row = map[y];
    for (let x = 0; x < mapCols; x++) {
      const screenX = ox + x * tilePx;
      const screenY = oy + y * tilePx;
      const t = row[x];
      const td = getTileDef("region", t);
      let fill = td && td.colors && td.colors.fill;
      if (!fill) fill = fallbackFillFor(t);
      ctx2d.fillStyle = fill || "#0b0c10";
      ctx2d.fillRect(screenX, screenY, tilePx, tilePx);
    }
  }

  // Orange exit markers (center tiles on each side)
  try {
    ctx2d.save();
    ctx2d.fillStyle = "rgba(241,153,40,0.28)";
    ctx2d.strokeStyle = "rgba(241,153,40,0.80)";
    ctx2d.lineWidth = 1;
    for (const e of (ctx.region.exitTiles || [])) {
      const sx = ox + (e.x | 0) * tilePx;
      const sy = oy + (e.y | 0) * tilePx;
      ctx2d.fillRect(sx, sy, tilePx, tilePx);
      ctx2d.strokeRect(sx + 0.5, sy + 0.5, tilePx - 1, tilePx - 1);
    }
    ctx2d.restore();
  } catch (_) {}

  // Player marker (@) scaled to tilePx
  try {
    const px = ctx.player.x | 0, py = ctx.player.y | 0;
    const sx = ox + px * tilePx;
    const sy = oy + py * tilePx;
    ctx2d.save();
    // backdrop
    ctx2d.fillStyle = "rgba(255,255,255,0.16)";
    ctx2d.fillRect(sx + Math.max(1, Math.floor(tilePx * 0.12)), sy + Math.max(1, Math.floor(tilePx * 0.12)),
                   tilePx - Math.max(2, Math.floor(tilePx * 0.24)), tilePx - Math.max(2, Math.floor(tilePx * 0.24)));
    // glyph
    const size = Math.max(8, tilePx - 2);
    const prevFont = ctx2d.font, prevAlign = ctx2d.textAlign, prevBase = ctx2d.textBaseline;
    ctx2d.font = `bold ${size}px JetBrains Mono, monospace`;
    ctx2d.textAlign = "center";
    ctx2d.textBaseline = "middle";
    ctx2d.lineWidth = 2;
    ctx2d.strokeStyle = "#0b0f16";
    ctx2d.strokeText("@", sx + tilePx / 2, sy + tilePx / 2 + 1);
    ctx2d.fillStyle = COLORS.player || "#9ece6a";
    ctx2d.fillText("@", sx + tilePx / 2, sy + tilePx / 2 + 1);
    ctx2d.font = prevFont; ctx2d.textAlign = prevAlign; ctx2d.textBaseline = prevBase;
    ctx2d.restore();
  } catch (_) {}

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

  // No grid overlay in region mode (scaled view)
}

if (typeof window !== "undefined") {
  window.RenderRegion = { draw };
}