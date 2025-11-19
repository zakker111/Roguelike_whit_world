/**
 * Overworld minimap offscreen cache and drawing.
 */
import * as RenderCore from "../render_core.js";
import { fillOverworldFor, tilesRef } from "./overworld_tile_cache.js";

const MINI = { mapRef: null, canvas: null, wpx: 0, hpx: 0, scale: 0, _tilesRef: null, px: -1, py: -1 };

export function drawMinimap(ctx, view) {
  const { ctx2d, TILE, map, player, cam } = Object.assign({}, view, ctx);
  try {
    const showMini = (typeof window !== "undefined" && typeof window.SHOW_MINIMAP === "boolean") ? window.SHOW_MINIMAP : false;
    if (!showMini) return;

    const mw = ctx.world && ctx.world.width ? ctx.world.width : (map[0] ? map[0].length : 0);
    const mh = ctx.world && ctx.world.height ? ctx.world.height : map.length;
    if (!mw || !mh) return;

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
      for (let yy = 0; yy < mh; yy++) {
        const rowM = map[yy];
        const seenRow = (ctx.seen && ctx.seen[yy]) ? ctx.seen[yy] : null;
        for (let xx = 0; xx < mw; xx++) {
          const seenHere = seenRow ? !!seenRow[xx] : false;
          if (seenHere) {
            const t = rowM[xx];
            const c = fillOverworldFor((typeof window !== "undefined" ? window.World.TILES : {}), t);
            oc.fillStyle = c || "#0b0c10";
          } else {
            oc.fillStyle = "#0b0c10";
          }
          oc.fillRect(xx * scale, yy * scale, scale, scale);
        }
      }
      MINI.canvas = off;
    }

    ctx2d.save();
    try {
      const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
      ctx2d.fillStyle = pal && pal.minimapBg ? pal.minimapBg : "rgba(13,16,24,0.70)";
      ctx2d.fillRect(bx - 6, by - 6, wpx + 12, hpx + 12);
      ctx2d.strokeStyle = pal && pal.minimapBorder ? pal.minimapBorder : "rgba(122,162,247,0.35)";
    } catch (_) {
      ctx2d.fillStyle = "rgba(13,16,24,0.70)";
      ctx2d.fillRect(bx - 6, by - 6, wpx + 12, hpx + 12);
      ctx2d.strokeStyle = "rgba(122,162,247,0.35)";
    }
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

    if (MINI.canvas) {
      ctx2d.drawImage(MINI.canvas, bx, by);
    }

    try {
      const towns = Array.isArray(ctx.world?.towns) ? ctx.world.towns : [];
      const dungeons = Array.isArray(ctx.world?.dungeons) ? ctx.world.dungeons : [];
      const qms = Array.isArray(ctx.world?.questMarkers) ? ctx.world.questMarkers : [];
      const ox = (ctx.world && typeof ctx.world.originX === "number") ? ctx.world.originX : 0;
      const oy = (ctx.world && typeof ctx.world.originY === "number") ? ctx.world.originY : 0;
      ctx2d.save();
      for (const t of towns) {
        const lx = (t.x | 0) - ox;
        const ly = (t.y | 0) - oy;
        if (lx < 0 || ly < 0 || lx >= mw || ly >= mh) continue;
        let townColor = "#f6c177";
        try {
          const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
          if (pal && pal.poiTown) townColor = pal.poiTown || townColor;
        } catch (_) {}
        ctx2d.fillStyle = townColor;
        ctx2d.fillRect(bx + lx * scale, by + ly * scale, Math.max(1, scale), Math.max(1, scale));
      }
      for (const d of dungeons) {
        const lx = (d.x | 0) - ox;
        const ly = (d.y | 0) - oy;
        if (lx < 0 || ly < 0 || lx >= mw || ly >= mh) continue;
        const lvl = Math.max(1, (d.level | 0) || 1);
        let fill = "#f7768e";
        if (lvl <= 2) fill = "#9ece6a";
        else if (lvl === 3) fill = "#f4bf75";
        else fill = "#f7768e";
        try {
          const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
          if (pal) {
            if (lvl <= 2 && pal.poiDungeonEasy) fill = pal.poiDungeonEasy || fill;
            else if (lvl === 3 && pal.poiDungeonMed) fill = pal.poiDungeonMed || fill;
            else if (lvl >= 4 && pal.poiDungeonHard) fill = pal.poiDungeonHard || fill;
          }
        } catch (_) {}
        ctx2d.fillStyle = fill;
        ctx2d.fillRect(bx + lx * scale, by + ly * scale, Math.max(1, scale), Math.max(1, scale));
      }
      if (qms && qms.length) {
        let questColor = "#fbbf24";
        try {
          const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
          if (pal && pal.questMarker) questColor = pal.questMarker || questColor;
        } catch (_) {}
        ctx2d.fillStyle = questColor;
        for (const m of qms) {
          const lx = (m.x | 0) - ox;
          const ly = (m.y | 0) - oy;
          if (lx < 0 || ly < 0 || lx >= mw || ly >= mh) continue;
          ctx2d.fillRect(bx + lx * scale, by + ly * scale, Math.max(1, scale), Math.max(1, scale));
        }
      }
      ctx2d.restore();
    } catch (_) {}

    ctx2d.fillStyle = "#ffffff";
    ctx2d.fillRect(bx + player.x * scale, by + player.y * scale, Math.max(1, scale), Math.max(1, scale));
    ctx2d.restore();
  } catch (_) {}
}