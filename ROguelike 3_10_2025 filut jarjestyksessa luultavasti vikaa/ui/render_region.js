/**
 * RenderRegion: draws the fixed-size Region Map overlay.
 *
 * Exports (ESM + window.RenderRegion):
 * - draw(ctx, view)
 */
import * as RenderCore from "./render_core.js";
import * as World from "../world/world.js";

export function draw(ctx, view) {
  const { ctx2d, COLORS } = Object.assign({}, view, ctx);
  if (!ctx || ctx.mode !== "region" || !ctx.region) return;

  const cam = ctx.camera || { width: 960, height: 640 };
  const w = ctx.region.width | 0;
  const h = ctx.region.height | 0;
  const map = ctx.region.map || [];
  const cursor = ctx.region.cursor || { x: 0, y: 0 };
  const exits = ctx.region.exitTiles || [];

  // Compute tile size to fit in canvas with padding
  const pad = 24;
  const tile = Math.floor(Math.min((cam.width - pad * 2) / w, (cam.height - pad * 2) / h));
  const totalW = tile * w;
  const totalH = tile * h;
  const originX = Math.floor((cam.width - totalW) / 2);
  const originY = Math.floor((cam.height - totalH) / 2);

  // Background panel
  ctx2d.fillStyle = "rgba(13,16,24,0.85)";
  ctx2d.fillRect(originX - 12, originY - 12, totalW + 24, totalH + 24);
  ctx2d.strokeStyle = "rgba(255,166,0,0.35)";
  ctx2d.lineWidth = 1;
  ctx2d.strokeRect(originX - 12.5, originY - 12.5, totalW + 25, totalH + 25);

  // Draw tiles (downscaled world colors)
  for (let y = 0; y < h; y++) {
    const row = map[y] || [];
    for (let x = 0; x < w; x++) {
      const t = row[x];
      // Reuse overworld palette from RegionMapRuntime
      let c = "#10331a"; // default grass
      try {
        const WT = World.TILES;
        if (WT) {
          if (t === WT.WATER) c = "#0a1b2a";
          else if (t === WT.RIVER) c = "#0e2f4a";
          else if (t === WT.SWAMP) c = "#1b2a1e";
          else if (t === WT.BEACH) c = "#b59b6a";
          else if (t === WT.DESERT) c = "#c2a36b";
          else if (t === WT.SNOW) c = "#b9c7d3";
          else if (t === WT.FOREST) c = "#0d2615";
          else if (t === WT.MOUNTAIN) c = "#2f2f34";
          else if (t === WT.DUNGEON) c = "#2a1b2a";
          else if (t === WT.TOWN) c = "#3a2f1b";
        }
      } catch (_) {}
      const px = originX + x * tile;
      const py = originY + y * tile;
      ctx2d.fillStyle = c;
      ctx2d.fillRect(px, py, tile, tile);
    }
  }

  // Orange edge tiles
  ctx2d.save();
  ctx2d.fillStyle = "rgba(241,153,40,0.28)";
  ctx2d.strokeStyle = "rgba(241,153,40,0.80)";
  ctx2d.lineWidth = 2;
  for (const e of exits) {
    const ex = originX + (e.x | 0) * tile;
    const ey = originY + (e.y | 0) * tile;
    ctx2d.fillRect(ex, ey, tile, tile);
    ctx2d.strokeRect(ex + 0.5, ey + 0.5, tile - 1, tile - 1);
  }
  ctx2d.restore();

  // Cursor marker
  {
    const cx = originX + (cursor.x | 0) * tile;
    const cy = originY + (cursor.y | 0) * tile;
    ctx2d.save();
    ctx2d.fillStyle = "rgba(255,255,255,0.18)";
    ctx2d.fillRect(cx + 3, cy + 3, tile - 6, tile - 6);
    ctx2d.strokeStyle = "rgba(255,255,255,0.40)";
    ctx2d.lineWidth = 1;
    ctx2d.strokeRect(cx + 3.5, cy + 3.5, tile - 7, tile - 7);
    const half = tile / 2;
    ctx2d.lineWidth = 2;
    ctx2d.strokeStyle = "#0b0f16";
    ctx2d.strokeText("@", cx + half, cy + half + 1);
    ctx2d.fillStyle = COLORS.player || "#9ece6a";
    ctx2d.fillText("@", cx + half, cy + half + 1);
    ctx2d.restore();
  }

  // Label + hint
  try {
    const prevAlign = ctx2d.textAlign;
    const prevBaseline = ctx2d.textBaseline;
    ctx2d.textAlign = "left";
    ctx2d.textBaseline = "top";
    ctx2d.fillStyle = "#cbd5e1";
    ctx2d.fillText("Region Map", originX - 8, originY - 32);
    ctx2d.fillStyle = "#a1a1aa";
    ctx2d.fillText("Move with arrows. Press G on orange edge to return.", originX - 8, originY - 12);
    ctx2d.textAlign = prevAlign;
    ctx2d.textBaseline = prevBaseline;
  } catch (_) {}

  // Optional grid overlay inside panel
  try {
    ctx2d.save();
    ctx2d.strokeStyle = "rgba(122,162,247,0.08)";
    ctx2d.lineWidth = 1;
    for (let c = 0; c <= w; c++) {
      const x = originX + Math.floor(c * tile) + 0.5;
      ctx2d.beginPath();
      ctx2d.moveTo(x, originY);
      ctx2d.lineTo(x, originY + totalH);
      ctx2d.stroke();
    }
    for (let r = 0; r <= h; r++) {
      const y = originY + Math.floor(r * tile) + 0.5;
      ctx2d.beginPath();
      ctx2d.moveTo(originX, y);
      ctx2d.lineTo(originX + totalW, y);
      ctx2d.stroke();
    }
    ctx2d.restore();
  } catch (_) {}
}

if (typeof window !== "undefined") {
  window.RenderRegion = { draw };
}