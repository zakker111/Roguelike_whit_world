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
  const handle = getCanvas();
  if (!handle) return false;
  const { canvas, ctx2d } = handle;

  // Background
  ctx2d.clearRect(0, 0, canvas.width, canvas.height);
  ctx2d.fillStyle = "rgba(13,16,24,0.95)";
  ctx2d.fillRect(0, 0, canvas.width, canvas.height);

  const isWorld = !!(ctx && ctx.world && ctx.world.map && ctx.mode === "world");

  if (!isWorld) {
    // Generic map renderer for non-world contexts (encounters, dungeons, region mode, etc.)
    const grid = (ctx && ctx.map) ? ctx.map : null;
    if (!grid || !Array.isArray(grid) || !grid.length || !Array.isArray(grid[0])) return false;

    const mh = grid.length;
    const mw = grid[0].length;
    const pad = 12;
    const usableW = Math.max(1, canvas.width - pad * 2);
    const usableH = Math.max(1, canvas.height - pad * 2);
    const scale = Math.max(2, Math.floor(Math.min(usableW / mw, usableH / mh)));
    const wpx = mw * scale;
    const hpx = mh * scale;
    const offsetX = Math.floor((canvas.width - wpx) / 2);
    const offsetY = Math.floor((canvas.height - hpx) / 2);

    // Tile palette approximating dungeon visuals
    const COL = {
      floor: "#0f1628",
      wall: "#2b3444",
      door: "#8b7355",
      stairs: "#b9975b",
      player: "#9ece6a",
      enemy: "#f7768e",
      corpse: "#6b7280",
      grid: "rgba(255,255,255,0.03)",
      text: "#cbd5e1",
      chrome: "rgba(13,16,24,0.80)",
    };
    const T = (ctx && ctx.TILES) ? ctx.TILES : null;

    // Draw tiles
    for (let y = 0; y < mh; y++) {
      const row = grid[y];
      for (let x = 0; x < mw; x++) {
        const t = row[x];
        let c = COL.floor;
        if (T) {
          if (t === T.WALL) c = COL.wall;
          else if (t === T.DOOR) c = COL.door;
          else if (t === T.STAIRS) c = COL.stairs;
          else c = COL.floor;
        }
        ctx2d.fillStyle = c;
        ctx2d.fillRect(offsetX + x * scale, offsetY + y * scale, scale, scale);
      }
    }

    // Optional subtle grid
    try {
      ctx2d.strokeStyle = COL.grid;
      ctx2d.lineWidth = 1;
      for (let gx = 0; gx <= mw; gx++) {
        const x = offsetX + gx * scale + 0.5;
        ctx2d.beginPath(); ctx2d.moveTo(x, offsetY); ctx2d.lineTo(x, offsetY + hpx); ctx2d.stroke();
      }
      for (let gy = 0; gy <= mh; gy++) {
        const y = offsetY + gy * scale + 0.5;
        ctx2d.beginPath(); ctx2d.moveTo(offsetX, y); ctx2d.lineTo(offsetX + wpx, y); ctx2d.stroke();
      }
    } catch (_) {}

    // Corpses (if present)
    try {
      if (Array.isArray(ctx.corpses)) {
        ctx2d.fillStyle = COL.corpse;
        for (const c of ctx.corpses) {
          if (!c) continue;
          const cx = offsetX + (c.x | 0) * scale;
          const cy = offsetY + (c.y | 0) * scale;
          ctx2d.fillRect(cx, cy, Math.max(1, scale - 1), Math.max(1, scale - 1));
        }
      }
    } catch (_) {}

    // Enemies
    try {
      if (Array.isArray(ctx.enemies)) {
        for (const e of ctx.enemies) {
          if (!e) continue;
          const ex = offsetX + (e.x | 0) * scale;
          const ey = offsetY + (e.y | 0) * scale;
          ctx2d.fillStyle = COL.enemy;
          ctx2d.fillRect(ex, ey, Math.max(1, scale - 1), Math.max(1, scale - 1));
        }
      }
    } catch (_) {}

    // Player
    try {
      if (ctx.player) {
        const px = offsetX + (ctx.player.x | 0) * scale;
        const py = offsetY + (ctx.player.y | 0) * scale;
        ctx2d.fillStyle = COL.player;
        ctx2d.fillRect(px, py, Math.max(1, scale - 1), Math.max(1, scale - 1));
      }
    } catch (_) {}

    // Title and legend
    try {
      const prevFont = ctx2d.font;
      const prevAlign = ctx2d.textAlign;
      const prevBaseline = ctx2d.textBaseline;
      ctx2d.font = "bold 14px JetBrains Mono, monospace";
      ctx2d.textAlign = "left";
      ctx2d.textBaseline = "top";

      const title = (ctx.mode === "encounter") ? "Encounter Map" : "Local Map";
      ctx2d.fillStyle = COL.chrome;
      ctx2d.fillRect(10, 10, 200, 24);
      ctx2d.fillStyle = COL.text;
      ctx2d.fillText(title, 16, 14);

      const legend = [
        [COL.player, "You"],
        [COL.enemy, "Enemies"],
        [COL.wall, "Wall"],
        [COL.stairs, "Stairs"],
      ];
      let lx = canvas.width - 170;
      let ly = 12;
      ctx2d.fillStyle = COL.chrome;
      ctx2d.fillRect(lx - 8, ly - 6, 166, legend.length * 22 + 12);
      for (let i = 0; i < legend.length; i++) {
        const [color, label] = legend[i];
        ctx2d.fillStyle = color;
        ctx2d.fillRect(lx, ly + i * 22, 12, 12);
        ctx2d.fillStyle = COL.text;
        ctx2d.fillText(label, lx + 18, ly + i * 22 - 2);
      }

      const footer = `Press Esc to close • ${Array.isArray(ctx.enemies) ? ctx.enemies.length : 0} enemy${(Array.isArray(ctx.enemies) && ctx.enemies.length === 1) ? "" : "ies"}`;
      ctx2d.fillStyle = COL.chrome;
      ctx2d.fillRect(10, canvas.height - 30, Math.max(220, footer.length * 7), 22);
      ctx2d.fillStyle = COL.text;
      ctx2d.fillText(footer, 16, canvas.height - 28);

      // Restore
      ctx2d.font = prevFont;
      ctx2d.textAlign = prevAlign;
      ctx2d.textBaseline = prevBaseline;
    } catch (_) {}

    return true;
  }

  // WORLD MAP RENDERING (original path)
  if (!ctx || !ctx.world || !ctx.world.map) return false;

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

  // Overlay POIs: towns/dungeons + title/legend/footer
  try {
    const prevFont = ctx2d.font;
    const prevAlign = ctx2d.textAlign;
    const prevBaseline = ctx2d.textBaseline;
    ctx2d.font = "bold 14px JetBrains Mono, monospace";
    ctx2d.textAlign = "left";
    ctx2d.textBaseline = "top";

    if (Array.isArray(ctx.world.towns)) {
      for (const t of ctx.world.towns) {
        const gx = offsetX + t.x * scale;
        const gy = offsetY + t.y * scale;
        ctx2d.fillStyle = "#ffcc66";
        ctx2d.fillRect(gx, gy, Math.max(1, scale), Math.max(1, scale));
        const sz = (t.size || "").toLowerCase();
        const glyph = sz === "city" ? "C" : (sz === "small" ? "t" : "T");
        ctx2d.fillStyle = "#e5e7eb";
        ctx2d.fillText(`${glyph} ${t.name || ""}`, gx + 6, gy + 2);
      }
    }
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
    if (ctx.player) {
      const px = offsetX + ctx.player.x * scale;
      const py = offsetY + ctx.player.y * scale;
      ctx2d.fillStyle = "#ffffff";
      ctx2d.fillRect(px, py, Math.max(1, scale), Math.max(1, scale));
      ctx2d.fillStyle = "#9ece6a";
      ctx2d.fillText("@ You", px + 6, py - 16);
    }

    const title = "Region Map";
    ctx2d.fillStyle = "rgba(13,16,24,0.80)";
    ctx2d.fillRect(10, 10, 160, 24);
    ctx2d.fillStyle = "#e5e7eb";
    ctx2d.fillText(title, 16, 14);

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