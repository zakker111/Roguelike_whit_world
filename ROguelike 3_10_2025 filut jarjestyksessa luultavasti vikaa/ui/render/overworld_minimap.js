/**
 * Overworld minimap offscreen cache and drawing.
 */
import * as RenderCore from "../render_core.js";
import { fillOverworldFor, tilesRef } from "./overworld_tile_cache.js";
import { fogGet } from "../../core/engine/fog.js";

const MINI = { mapRef: null, canvas: null, wpx: 0, hpx: 0, scale: 0, _tilesRef: null, startX: 0, startY: 0, px: -1, py: -1, full: false };

export function drawMinimap(ctx, view) {
  const { ctx2d, TILE, map, player, cam } = Object.assign({}, view, ctx);
  try {
    const showMini = (typeof window !== "undefined" && typeof window.SHOW_MINIMAP === "boolean") ? window.SHOW_MINIMAP : false;
    if (typeof window !== "undefined") {
      try { window.MINIMAP_TOGGLE_BOUNDS = null; } catch (_) {}
    }
    if (!showMini) return;

    const mw = ctx.world && ctx.world.width ? ctx.world.width : (map[0] ? map[0].length : 0);
    const mh = ctx.world && ctx.world.height ? ctx.world.height : map.length;
    if (!mw || !mh) return;

    const full = (typeof window !== "undefined" && typeof window.MINIMAP_FULL === "boolean") ? !!window.MINIMAP_FULL : false;

    let maxW = 280, maxH = 210;
    try {
      if (typeof window !== "undefined" && window.innerWidth && window.innerWidth < 700) {
        maxW = 180; maxH = 135;
      }
    } catch (_) {}

    // Visible tile window around the player by default; full mode shows the whole current world window.
    let tilesW = Math.min(mw, 64);
    let tilesH = Math.min(mh, 48);
    if (full) {
      tilesW = mw;
      tilesH = mh;
    }

    let scale;
    if (full) {
      scale = Math.min(maxW / tilesW, maxH / tilesH);
      if (!Number.isFinite(scale) || scale <= 0) scale = 1;
    } else {
      scale = Math.max(1, Math.floor(Math.min(maxW / tilesW, maxH / tilesH)));
    }
    const wpx = tilesW * scale;
    const hpx = tilesH * scale;
    const pad = 8;
    const bx = cam.width - wpx - pad;
    const by = pad;

    // Center view on player when possible by choosing a window within [0..mw/mh)
    const halfW = Math.floor(tilesW / 2);
    const halfH = Math.floor(tilesH / 2);
    let startX = player.x - halfW;
    let startY = player.y - halfH;
    const maxStartX = Math.max(0, mw - tilesW);
    const maxStartY = Math.max(0, mh - tilesH);
    if (startX < 0) startX = 0;
    else if (startX > maxStartX) startX = maxStartX;
    if (startY < 0) startY = 0;
    else if (startY > maxStartY) startY = maxStartY;

    const mapRef = map;
    const needsRebuild = (!MINI.canvas) || MINI.mapRef !== mapRef || MINI.wpx !== wpx || MINI.hpx !== hpx || MINI.scale !== scale || MINI._tilesRef !== tilesRef() || MINI.startX !== startX || MINI.startY !== startY || MINI.px !== player.x || MINI.py !== player.y || MINI.full !== full;
    if (needsRebuild) {
      MINI.mapRef = mapRef;
      MINI.wpx = wpx;
      MINI.hpx = hpx;
      MINI.scale = scale;
      MINI._tilesRef = tilesRef();
      MINI.startX = startX;
      MINI.startY = startY;
      MINI.px = player.x;
      MINI.py = player.y;
      MINI.full = full;
      const off = RenderCore.createOffscreen(wpx, hpx);
      const oc = off.getContext("2d");
      for (let yy = 0; yy < tilesH; yy++) {
        const srcY = startY + yy;
        const rowM = map[srcY];
        for (let xx = 0; xx < tilesW; xx++) {
          const srcX = startX + xx;
          const seenHere = fogGet(ctx.seen, srcX, srcY);
          if (seenHere) {
            const t = rowM[srcX];
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

    // Minimap toggle button in bottom-left of the panel: switches between local window and full map.
    try {
      const btnSize = 16;
      const btnX = bx - 6 + 4;
      const btnY = by + hpx + 6 - btnSize - 4;
      if (typeof window !== "undefined") {
        try { window.MINIMAP_TOGGLE_BOUNDS = { x: btnX, y: btnY, w: btnSize, h: btnSize }; } catch (_) {}
      }
      const prevAlign2 = ctx2d.textAlign;
      const prevBaseline2 = ctx2d.textBaseline;
      ctx2d.save();
      ctx2d.fillStyle = "rgba(15,23,42,0.9)";
      ctx2d.fillRect(btnX, btnY, btnSize, btnSize);
      ctx2d.strokeStyle = "rgba(148,163,184,0.85)";
      ctx2d.strokeRect(btnX + 0.5, btnY + 0.5, btnSize - 1, btnSize - 1);
      ctx2d.textAlign = "center";
      ctx2d.textBaseline = "middle";
      ctx2d.fillStyle = "#e5e7eb";
      const toggleLabel = full ? "-" : "+";
      ctx2d.fillText(toggleLabel, btnX + btnSize / 2, btnY + btnSize / 2 + 0.5);
      ctx2d.restore();
      ctx2d.textAlign = prevAlign2;
      ctx2d.textBaseline = prevBaseline2;
    } catch (_) {}

    if (MINI.canvas) {
      ctx2d.drawImage(MINI.canvas, bx, by);
    }

    try {
      const towns = Array.isArray(ctx.world?.towns) ? ctx.world.towns : [];
      const dungeons = Array.isArray(ctx.world?.dungeons) ? ctx.world.dungeons : [];
      const qms = Array.isArray(ctx.world?.questMarkers) ? ctx.world.questMarkers : [];
      const oxWorld = (ctx.world && typeof ctx.world.originX === "number") ? ctx.world.originX : 0;
      const oyWorld = (ctx.world && typeof ctx.world.originY === "number") ? ctx.world.originY : 0;
      ctx2d.save();
      for (const t of towns) {
        const wx = (t.x | 0) - oxWorld;
        const wy = (t.y | 0) - oyWorld;
        const lx = wx - startX;
        const ly = wy - startY;
        if (lx < 0 || ly < 0 || lx >= tilesW || ly >= tilesH) continue;
        const isCastle = String(t.kind || "").toLowerCase() === "castle";
        let townColor = isCastle ? "#fde68a" : "#f6c177";
        try {
          const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
          if (pal) {
            if (isCastle && pal.poiCastle) townColor = pal.poiCastle || townColor;
            else if (!isCastle && pal.poiTown) townColor = pal.poiTown || townColor;
          }
        } catch (_) {}
        ctx2d.fillStyle = townColor;
        ctx2d.fillRect(bx + lx * scale, by + ly * scale, Math.max(1, scale), Math.max(1, scale));
      }
      for (const d of dungeons) {
        const wx = (d.x | 0) - oxWorld;
        const wy = (d.y | 0) - oyWorld;
        const lx = wx - startX;
        const ly = wy - startY;
        if (lx < 0 || ly < 0 || lx >= tilesW || ly >= tilesH) continue;
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
          const wx = (m.x | 0) - oxWorld;
          const wy = (m.y | 0) - oyWorld;
          const lx = wx - startX;
          const ly = wy - startY;
          if (lx < 0 || ly < 0 || lx >= tilesW || ly >= tilesH) continue;
          ctx2d.fillRect(bx + lx * scale, by + ly * scale, Math.max(1, scale), Math.max(1, scale));
        }
      }
      ctx2d.restore();
    } catch (_) {}

    // Player marker at the center of the current minimap window
    const plLocalX = player.x - startX;
    const plLocalY = player.y - startY;
    if (plLocalX >= 0 && plLocalY >= 0 && plLocalX < tilesW && plLocalY < tilesH) {
      ctx2d.fillStyle = "#ffffff";
      ctx2d.fillRect(bx + plLocalX * scale, by + plLocalY * scale, Math.max(1, scale), Math.max(1, scale));
    }
    ctx2d.restore();
  } catch (_) {}
}