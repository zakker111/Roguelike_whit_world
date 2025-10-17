/**
 * RegionMap: full-world region map overlay renderer.
 *
 * Exports (ESM + window.RegionMap):
 * - draw(ctx): renders the current world into the Region Map canvas (created by UI)
 *
 * Usage:
 * - UI.showRegionMap() creates a modal with a canvas#region-canvas.
 * - UIBridge.showRegionMap(ctx) calls RegionMap.draw(ctx) to paint it.
 */
import * as RenderCore from "./render_core.js";
import * as World from "../world/world.js";

function getCanvas() {
  const el = document.getElementById("region-canvas");
  if (!el) return null;
  // Ensure crisp rendering
  const ctx2d = el.getContext("2d");
  try { if ("imageSmoothingEnabled" in ctx2d) ctx2d.imageSmoothingEnabled = false; } catch (_) {}
  return { canvas: el, ctx2d };
}

export function draw(ctx) {
  if (!ctx || !ctx.world || !ctx.world.map) return false;
  const handle = getCanvas();
  if (!handle) return false;
  const { canvas, ctx2d } = handle;

  // Fit the world map into the canvas while keeping aspect ratio
  const map = ctx.world.map;
  const mh = map.length;
  const mw = map[0] ? map[0].length : 0;
  if (!mw || !mh) return false;

  // Determine scale to fit within canvas with small padding
  const pad = 12;
  const usableW = Math.max(1, canvas.width - pad * 2);
  const usableH = Math.max(1, canvas.height - pad * 2);
  const scale = Math.max(1, Math.floor(Math.min(usableW / mw, usableH / mh)));
  const wpx = mw * scale;
  const hpx = mh * scale;
  const offsetX = Math.floor((canvas.width - wpx) / 2);
  const offsetY = Math.floor((canvas.height - hpx) / 2);

  // Background
  ctx2d.clearRect(0, 0, canvas.width, canvas.height);
  ctx2d.fillStyle = "rgba(13,16,24,0.95)";
  ctx2d.fillRect(0, 0, canvas.width, canvas.height);

  // Palette (match RenderOverworld)
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

  // Draw tiles
  for (let y = 0; y < mh; y++) {
    const row = map[y];
    for (let x = 0; x < mw; x++) {
      const t = row[x];
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
        else if (t === WT.TOWN) c = WCOL.town;
        else if (t === WT.DUNGEON) c = WCOL.dungeon;
      }
      ctx2d.fillStyle = c;
      ctx2d.fillRect(offsetX + x * scale, offsetY + y * scale, scale, scale);
    }
  }

  // Overlay POIs: towns and dungeons with small glyphs/labels
  try {
    // Prepare font
    const prevFont = ctx2d.font;
    const prevAlign = ctx2d.textAlign;
    const prevBaseline = ctx2d.textBaseline;
    ctx2d.font = "bold 14px JetBrains Mono, monospace";
    ctx2d.textAlign = "left";
    ctx2d.textBaseline = "top";

    // Towns
    if (Array.isArray(ctx.world.towns)) {
      for (const t of ctx.world.towns) {
        const gx = offsetX + t.x * scale;
        const gy = offsetY + t.y * scale;
        // marker
        ctx2d.fillStyle = "#ffcc66";
        ctx2d.fillRect(gx, gy, Math.max(1, scale), Math.max(1, scale));
        // label
        const sz = (t.size || "").toLowerCase();
        const glyph = sz === "city" ? "C" : (sz === "small" ? "t" : "T");
        ctx2d.fillStyle = "#e5e7eb";
        ctx2d.fillText(`${glyph} ${t.name || ""}`, gx + 6, gy + 2);
      }
    }
    // Dungeons
    if (Array.isArray(ctx.world.dungeons)) {
      for (const d of ctx.world.dungeons) {
        const gx = offsetX + d.x * scale;
        const gy = offsetY + d.y * scale;
        ctx2d.fillStyle = "#c586c0";
        ctx2d.fillRect(gx, gy, Math.max(1, scale), Math.max(1, scale));
        ctx2d.fillStyle = "#cbd5e1";
        const label = `D${typeof d.level === "number" ? d.level : ""}${d.size ? ` ${d.size}` : ""}`;
        ctx2d.fillText(label, gx + 6, gy + 2);
      }
    }

    // Player marker
    if (ctx.player) {
      const px = offsetX + ctx.player.x * scale;
      const py = offsetY + ctx.player.y * scale;
      ctx2d.fillStyle = "#ffffff";
      ctx2d.fillRect(px, py, Math.max(1, scale), Math.max(1, scale));
      ctx2d.fillStyle = "#9ece6a";
      ctx2d.fillText("@ You", px + 6, py - 16);
    }

    // Title bar
    const title = "Region Map";
    ctx2d.fillStyle = "rgba(13,16,24,0.80)";
    ctx2d.fillRect(10, 10, 160, 24);
    ctx2d.fillStyle = "#e5e7eb";
    ctx2d.fillText(title, 16, 14);

    // Legend
    const legend = [
      ["#ffcc66", "Town"],
      ["#c586c0", "Dungeon"],
      ["#ffffff", "You"],
    ];
    let lx = canvas.width - 160;
    let ly = 12;
    ctx2d.fillStyle = "rgba(13,16,24,0.80)";
    ctx2d.fillRect(lx - 8, ly - 6, 156, legend.length * 22 + 12);
    for (let i = 0; i < legend.length; i++) {
      const [color, label] = legend[i];
      ctx2d.fillStyle = color;
      ctx2d.fillRect(lx, ly + i * 22, 12, 12);
      ctx2d.fillStyle = "#cbd5e1";
      ctx2d.fillText(label, lx + 18, ly + i * 22 - 2);
    }

    // Footer hint
    const time = ctx.time && ctx.time.hhmm ? ctx.time.hhmm : "";
    const footer = `Press Esc to close • Time ${time}`;
    ctx2d.fillStyle = "rgba(13,16,24,0.75)";
    ctx2d.fillRect(10, canvas.height - 30, Math.max(220, footer.length * 7), 22);
    ctx2d.fillStyle = "#cbd5e1";
    ctx2d.fillText(footer, 16, canvas.height - 28);

    // Restore
    ctx2d.font = prevFont;
    ctx2d.textAlign = prevAlign;
    ctx2d.textBaseline = prevBaseline;
  } catch (_) {}

  return true;
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.RegionMap = { draw };
}