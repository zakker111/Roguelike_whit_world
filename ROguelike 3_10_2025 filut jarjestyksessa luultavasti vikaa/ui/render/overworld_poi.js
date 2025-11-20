/**
 * Overworld POI markers: towns, dungeons, and quest markers.
 */
import * as RenderCore from "../render_core.js";
import { rgba as _rgba, parseHex as _parseHex } from "../color_utils.js";

export function drawPOIs(ctx, view) {
  const { ctx2d, TILE, map, startX, startY, endX, endY, tileOffsetX, tileOffsetY } = Object.assign({}, view, ctx);
  try {
    const towns = (ctx.world && Array.isArray(ctx.world.towns)) ? ctx.world.towns : [];
    const dungeons = (ctx.world && Array.isArray(ctx.world.dungeons)) ? ctx.world.dungeons : [];
    const ox = (ctx.world && typeof ctx.world.originX === "number") ? ctx.world.originX : 0;
    const oy = (ctx.world && typeof ctx.world.originY === "number") ? ctx.world.originY : 0;

    for (const t of towns) {
      const lx = (t.x | 0) - ox;
      const ly = (t.y | 0) - oy;
      if (lx < startX || lx > endX || ly < startY || ly > endY) continue;
      const sx = (lx - startX) * TILE - tileOffsetX;
      const sy = (ly - startY) * TILE - tileOffsetY;
      const glyph = (t.size === "city") ? "T" : "t";
      let townColor = "#ffd166";
      try {
        const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
        if (pal && pal.poiTown) townColor = pal.poiTown || townColor;
      } catch (_) {}
      RenderCore.drawGlyph(ctx2d, sx, sy, glyph, townColor, TILE);
    }

    ctx2d.save();
    for (const d of dungeons) {
      const lx = (d.x | 0) - ox;
      const ly = (d.y | 0) - oy;
      if (lx &lt; startX || lx &gt; endX || ly &lt; startY || ly &gt; endY) continue;
      const sx = (lx - startX) * TILE - tileOffsetX;
      const sy = (ly - startY) * TILE - tileOffsetY;
      const s = Math.max(4, Math.floor(TILE * 0.48));
      const lvl = Math.max(1, (d.level | 0) || 1);

      // Detect mountain-adjacent dungeon entrances so we can color them differently (mountain passes).
      let isMountainDungeon = false;
      try {
        const WT = ctx.World && ctx.World.TILES;
        const mapRef = Array.isArray(map) ? map : null;
        if (WT &amp;&amp; mapRef &amp;&amp; mapRef.length) {
          const rows = mapRef.length;
          const cols = mapRef[0] ? mapRef[0].length : 0;
          if (ly &gt;= 0 &amp;&amp; ly &lt; rows &amp;&amp; lx &gt;= 0 &amp;&amp; lx &lt; cols) {
            for (let dy = -1; dy &lt;= 1 &amp;&amp; !isMountainDungeon; dy++) {
              for (let dx = -1; dx &lt;= 1 &amp;&amp; !isMountainDungeon; dx++) {
                if (!dx &amp;&amp; !dy) continue;
                const ny = ly + dy;
                const nx = lx + dx;
                if (ny &lt; 0 || nx &lt; 0 || ny &gt;= rows || nx &gt;= cols) continue;
                if (mapRef[ny][nx] === WT.MOUNTAIN) {
                  isMountainDungeon = true;
                }
              }
            }
          }
        }
      } catch (_) {}

      let fill = "#ef4444";
      let stroke = "rgba(239, 68, 68, 0.7)";
      if (lvl &lt;= 2) { fill = "#9ece6a"; stroke = "rgba(158, 206, 106, 0.7)"; }
      else if (lvl === 3) { fill = "#f4bf75"; stroke = "rgba(244, 191, 117, 0.7)"; }

      try {
        const pal = (typeof window !== "undefined" &amp;&amp; window.GameData &amp;&amp; window.GameData.palette &amp;&amp; window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
        if (pal) {
          if (isMountainDungeon &amp;&amp; pal.poiDungeonMountain) {
            // Mountain-pass dungeons: override with dedicated palette color
            fill = pal.poiDungeonMountain || fill;
            stroke = (_parseHex(fill) ? _rgba(fill, 0.8) : stroke);
          } else {
            if (lvl &lt;= 2 &amp;&amp; pal.poiDungeonEasy) {
              fill = pal.poiDungeonEasy || fill;
              stroke = (_parseHex(fill) ? _rgba(fill, 0.7) : stroke);
            } else if (lvl === 3 &amp;&amp; pal.poiDungeonMed) {
              fill = pal.poiDungeonMed || fill;
              stroke = (_parseHex(fill) ? _rgba(fill, 0.7) : stroke);
            } else if (lvl &gt;= 4 &amp;&amp; pal.poiDungeonHard) {
              fill = pal.poiDungeonHard || fill;
              stroke = (_parseHex(fill) ? _rgba(fill, 0.7) : stroke);
            }
          }
        }
      } catch (_) {}

      // Fallback hard-coded style for mountain dungeons when palette is missing a dedicated color.
      if (isMountainDungeon &amp;&amp; (!_parseHex(fill) || fill === "#ef4444")) {
        fill = "#38bdf8"; // bright cyan-blue to stand out against terrain
        stroke = "rgba(56, 189, 248, 0.9)";
      }

      ctx2d.globalAlpha = 0.85;
      ctx2d.fillStyle = fill;
      ctx2d.fillRect(sx + (TILE - s) / 2, sy + (TILE - s) / 2, s, s);
      ctx2d.globalAlpha = 0.95;
      ctx2d.strokeStyle = stroke;
      ctx2d.lineWidth = 1;
      ctx2d.strokeRect(sx + (TILE - s) / 2 + 0.5, sy + (TILE - s) / 2 + 0.5, s - 1, s - 1);
    }
    ctx2d.restore();

    const qms = (ctx.world && Array.isArray(ctx.world.questMarkers)) ? ctx.world.questMarkers : [];
    if (qms.length) {
      let questColor = "#fbbf24";
      try {
        const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
        if (pal && pal.questMarker) questColor = pal.questMarker || questColor;
      } catch (_) {}
      for (const m of qms) {
        if (!m) continue;
        const lx = (m.x | 0) - ox;
        const ly = (m.y | 0) - oy;
        if (lx < startX || lx > endX || ly < startY || ly > endY) continue;
        const sx = (lx - startX) * TILE - tileOffsetX;
        const sy = (ly - startY) * TILE - tileOffsetY;
        RenderCore.drawGlyph(ctx2d, sx, sy, "E", questColor, TILE);
      }
    }
  } catch (_) {}
}