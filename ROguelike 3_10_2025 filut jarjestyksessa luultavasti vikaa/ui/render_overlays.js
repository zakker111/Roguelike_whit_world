/**
 * RenderOverlays: optional overlays for town debugging and effects.
 *
 * Exports (ESM + window.RenderOverlays):
 * - drawTownDebugOverlay(ctx, view)
 * - drawTownPaths(ctx, view)
 * - drawTownHomePaths(ctx, view)
 * - drawTownRoutePaths(ctx, view)
 * - drawLampGlow(ctx, view)
 */
import { attachGlobal } from "../utils/global.js";
import { rgba as _rgba } from "./color_utils.js";

export function drawTownDebugOverlay(ctx, view) {
  const { ctx2d, TILE, cam, shops, townBuildings } = Object.assign({}, view, ctx);
  if (!(typeof window !== "undefined" && window.DEBUG_TOWN_OVERLAY)) return;

  try {
    if (Array.isArray(townBuildings) && Array.isArray(ctx.npcs)) {
      // precompute occupancy set of building ids (by reference)
      const occ = new Set();
      for (const n of ctx.npcs) {
        if (n._home && n._home.building) occ.add(n._home.building);
      }
      ctx2d.save();
      // Palette-driven debug overlay colors
      let overlayFill = "rgba(255, 215, 0, 0.22)";
      let overlayStroke = "rgba(255, 215, 0, 0.9)";
      try {
        const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
        if (pal) {
          overlayFill = pal.debugOverlayFill || overlayFill;
          overlayStroke = pal.debugOverlayStroke || overlayStroke;
        }
      } catch (_) {}
      ctx2d.globalAlpha = 1.0;
      ctx2d.fillStyle = overlayFill;
      ctx2d.strokeStyle = overlayStroke;
      ctx2d.lineWidth = 2;

      function labelForBuilding(b) {
        // Tavern?
        if (ctx.tavern && ctx.tavern.building && b === ctx.tavern.building) {
          return "Tavern";
        }
        // Shop name if any shop maps to this building
        if (Array.isArray(shops)) {
          const shop = shops.find(s => s.building && s.building.x === b.x && s.building.y === b.y && s.building.w === b.w && s.building.h === b.h);
          if (shop && shop.name) return shop.name;
        }
        // Fallback
        return "House";
      }

      for (const b of townBuildings) {
        if (!occ.has(b)) continue;
        const bx0 = (b.x - view.startX) * TILE - view.tileOffsetX;
        const by0 = (b.y - view.startY) * TILE - view.tileOffsetY;
        const bw = b.w * TILE;
        const bh = b.h * TILE;
        if (bx0 + bw < 0 || by0 + bh < 0 || bx0 > cam.width || by0 > cam.height) continue;
        ctx2d.fillRect(bx0, by0, bw, bh);
        ctx2d.strokeRect(bx0 + 1, by0 + 1, bw - 2, bh - 2);

        try {
          const cx = bx0 + bw / 2;
          const cy = by0 + bh / 2;
          const label = labelForBuilding(b);
          ctx2d.save();
          ctx2d.globalAlpha = 0.95;
          // Palette-driven label box + text colors
          let labelBg = "rgba(13,16,24,0.65)";
          let labelStroke = "rgba(255, 215, 0, 0.85)";
          let labelText = "#ffd166";
          try {
            const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
            if (pal) {
              labelBg = pal.debugLabelBg || labelBg;
              labelStroke = pal.debugLabelStroke || labelStroke;
              labelText = pal.debugLabelText || labelText;
            }
          } catch (_) {}
          ctx2d.fillStyle = labelBg;
          const padX = Math.max(6, Math.floor(TILE * 0.25));
          const padY = Math.max(4, Math.floor(TILE * 0.20));
          const textW = Math.max(32, label.length * (TILE * 0.35));
          const boxW = Math.min(bw - 8, textW + padX * 2);
          const boxH = Math.min(bh - 8, TILE * 0.8 + padY * 2);
          ctx2d.fillRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);
          ctx2d.strokeStyle = labelStroke;
          ctx2d.lineWidth = 1;
          ctx2d.strokeRect(cx - boxW / 2 + 0.5, cy - boxH / 2 + 0.5, boxW - 1, boxH - 1);
          ctx2d.fillStyle = labelText;
          const prevFont = ctx2d.font;
          ctx2d.font = "bold 16px JetBrains Mono, monospace";
          ctx2d.textAlign = "center";
          ctx2d.textBaseline = "middle";
          ctx2d.fillText(label, cx, cy);
          ctx2d.font = prevFont;
          ctx2d.restore();
        } catch (_) {}
      }
      ctx2d.restore();
    }
  } catch (_) {}
}

export function drawTownPaths(ctx, view) {
  if (!(typeof window !== "undefined" && window.DEBUG_TOWN_PATHS && Array.isArray(ctx.npcs))) return;
  const { ctx2d, TILE } = Object.assign({}, view);

  try {
    ctx2d.save();
    let routeAlt = "rgba(0, 200, 255, 0.85)";
    try {
      const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
      if (pal && pal.routeAlt) routeAlt = pal.routeAlt || routeAlt;
    } catch (_) {}
    ctx2d.strokeStyle = routeAlt;
    ctx2d.lineWidth = 2;
    for (const n of ctx.npcs) {
      const path = n._debugPath || n._fullPlan;
      if (!path || path.length < 2) continue;
      ctx2d.beginPath();
      for (let i = 0; i < path.length; i++) {
        const p = path[i];
        const px = (p.x - view.startX) * TILE - view.tileOffsetX + TILE / 2;
        const py = (p.y - view.startY) * TILE - view.tileOffsetY + TILE / 2;
        if (i === 0) ctx2d.moveTo(px, py); else ctx2d.lineTo(px, py);
      }
      ctx2d.stroke();
      ctx2d.fillStyle = routeAlt;
      for (const p of path) {
        const px = (p.x - view.startX) * TILE - view.tileOffsetX + TILE / 2;
        const py = (p.y - view.startY) * TILE - view.tileOffsetY + TILE / 2;
        ctx2d.beginPath();
        ctx2d.arc(px, py, Math.max(2, Math.floor(TILE * 0.12)), 0, Math.PI * 2);
        ctx2d.fill();
      }
    }
    ctx2d.restore();
  } catch (_) {}
}

export function drawTownHomePaths(ctx, view) {
  if (!(typeof window !== "undefined" && window.DEBUG_TOWN_HOME_PATHS && Array.isArray(ctx.npcs))) return;
  const { ctx2d, TILE } = Object.assign({}, view);

  try {
    ctx2d.save();
    ctx2d.lineWidth = 2;
    let routeClr = "rgba(60, 120, 255, 0.95)";
    let alertClr = "rgba(255, 80, 80, 0.95)";
    try {
      const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
      if (pal && pal.route) routeClr = pal.route || routeClr;
      if (pal && pal.alert) alertClr = pal.alert || alertClr;
    } catch (_) {}
    for (let i = 0; i < ctx.npcs.length; i++) {
      const n = ctx.npcs[i];
      // Consider a 1-node plan/debug path as "already at home"
      const pathPlan = (n._homePlan && n._homePlan.length >= 1) ? n._homePlan : null;
      const path = pathPlan || n._homeDebugPath;
      ctx2d.strokeStyle = routeClr;
      if (path && path.length >= 2) {
        const start = path[0];
        const sx = (start.x - view.startX) * TILE - view.tileOffsetX + TILE / 2;
        const sy = (start.y - view.startY) * TILE - view.tileOffsetY + TILE / 2;
        ctx2d.fillStyle = routeClr;
        if (typeof n.name === "string" && n.name) {
          ctx2d.fillText(n.name, sx + 12, sy + 4);
        }
        ctx2d.beginPath();
        for (let j = 0; j < path.length; j++) {
          const p = path[j];
          const px = (p.x - view.startX) * TILE - view.tileOffsetX + TILE / 2;
          const py = (p.y - view.startY) * TILE - view.tileOffsetY + TILE / 2;
          if (j === 0) ctx2d.moveTo(px, py); else ctx2d.lineTo(px, py);
        }
        ctx2d.stroke();
        ctx2d.fillStyle = routeClr;
        for (const p of path) {
          const px = (p.x - view.startX) * TILE - view.tileOffsetX + TILE / 2;
          const py = (p.y - view.startY) * TILE - view.tileOffsetY + TILE / 2;
          ctx2d.beginPath();
          ctx2d.arc(px, py, Math.max(2, Math.floor(TILE * 0.12)), 0, Math.PI * 2);
          ctx2d.fill();
        }
        const end = path[path.length - 1];
        const prev = path[path.length - 2];
        const ex = (end.x - view.startX) * TILE - view.tileOffsetX + TILE / 2;
        const ey = (end.y - view.startY) * TILE - view.tileOffsetY + TILE / 2;
        const px2 = (prev.x - view.startX) * TILE - view.tileOffsetX + TILE / 2;
        const py2 = (prev.y - view.startY) * TILE - view.tileOffsetY + TILE / 2;
        const angle = Math.atan2(ey - py2, ex - px2);
        const ah = Math.max(6, Math.floor(TILE * 0.25));
        ctx2d.beginPath();
        ctx2d.moveTo(ex, ey);
        ctx2d.lineTo(ex - Math.cos(angle - Math.PI / 6) * ah, ey - Math.sin(angle - Math.PI / 6) * ah);
        ctx2d.moveTo(ex, ey);
        ctx2d.lineTo(ex - Math.cos(angle + Math.PI / 6) * ah, ey - Math.sin(angle + Math.PI / 6) * ah);
        ctx2d.stroke();
        ctx2d.fillStyle = routeClr;
        ctx2d.fillText("H", ex + 10, ey - 10);
      } else if (path && path.length === 1) {
        // Already at home: draw H marker at the single node
        const p0 = path[0];
        const sx2 = (p0.x - view.startX) * TILE - view.tileOffsetX + TILE / 2;
        const sy2 = (p0.y - view.startY) * TILE - view.tileOffsetY + TILE / 2;
        ctx2d.fillStyle = routeClr;
        ctx2d.fillText("H", sx2 + 10, sy2 - 10);
        if (typeof n.name === "string" && n.name) {
          ctx2d.fillText(n.name, sx2 + 12, sy2 + 4);
        }
      } else {
        const sx2 = (n.x - view.startX) * TILE - view.tileOffsetX + TILE / 2;
        const sy2 = (n.y - view.startY) * TILE - view.tileOffsetY + TILE / 2;
        ctx2d.fillStyle = alertClr;
        ctx2d.fillText("!", sx2 + 10, sy2 - 10);
        if (typeof n.name === "string" && n.name) {
          ctx2d.fillText(n.name, sx2 + 12, sy2 + 4);
        }
      }
    }
    ctx2d.restore();
  } catch (_) {}
}

export function drawTownRoutePaths(ctx, view) {
  if (!(typeof window !== "undefined" && window.DEBUG_TOWN_ROUTE_PATHS && Array.isArray(ctx.npcs))) return;
  const { ctx2d, TILE } = Object.assign({}, view);

  try {
    ctx2d.save();
    ctx2d.lineWidth = 2;
    let routeClr = "rgba(80, 140, 255, 0.9)";
    try {
      const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
      if (pal && pal.route) routeClr = pal.route || routeClr;
    } catch (_) {}
    ctx2d.strokeStyle = routeClr;
    for (const n of ctx.npcs) {
      const path = n._routeDebugPath;
      if (!path || path.length < 2) continue;
      ctx2d.beginPath();
      for (let j = 0; j < path.length; j++) {
        const p = path[j];
        const px = (p.x - view.startX) * TILE - view.tileOffsetX + TILE / 2;
        const py = (p.y - view.startY) * TILE - view.tileOffsetY + TILE / 2;
        if (j === 0) ctx2d.moveTo(px, py); else ctx2d.lineTo(px, py);
      }
      ctx2d.stroke();
      ctx2d.fillStyle = routeClr;
      for (const p of path) {
        const px = (p.x - view.startX) * TILE - view.tileOffsetX + TILE / 2;
        const py = (p.y - view.startY) * TILE - view.tileOffsetY + TILE / 2;
        ctx2d.beginPath();
        ctx2d.arc(px, py, Math.max(2, Math.floor(TILE * 0.12)), 0, Math.PI * 2);
        ctx2d.fill();
      }
    }
    ctx2d.restore();
  } catch (_) {}
}

export function drawLampGlow(ctx, view) {
  try {
    const time = ctx.time;
    if (!(time && (time.phase === "night" || time.phase === "dusk" || time.phase === "dawn"))) return;
    if (!Array.isArray(ctx.townProps)) return;

    // Helper: lookup prop def by id or key and return colors
    function propDefFor(type) {
      try {
        const GD = (typeof window !== "undefined" ? window.GameData : null);
        const arr = GD && GD.props && Array.isArray(GD.props.props) ? GD.props.props : null;
        if (!arr) return null;
        const key = String(type || "").toLowerCase();
        for (let i = 0; i < arr.length; i++) {
          const e = arr[i];
          if (String(e.id || "").toLowerCase() === key || String(e.key || "").toLowerCase() === key) return e;
        }
      } catch (_) {}
      return null;
    }

    // Color conversion moved to color_utils (imported as _rgba)

    const { ctx2d, TILE } = Object.assign({}, view);

    // Collect visible light emitters for this turn
    const lights = [];
    for (const p of ctx.townProps) {
      const def = propDefFor(p.type);
      const emits = !!(def && def.properties && def.properties.emitsLight);
      if (!emits) continue;
      // Only draw when the lamp tile is currently visible
      const visNow = !!(ctx.visible[p.y] && ctx.visible[p.y][p.x]);
      if (!visNow) continue;
      // Record minimal draw info
      const baseColor = (def && def.light && typeof def.light.color === "string")
        ? def.light.color
        : (def && def.colors && def.colors.fg) ? def.colors.fg : "#ffd166";
      const glowTiles = (def && def.light && typeof def.light.glowTiles === "number") ? def.light.glowTiles : 2.2;
      lights.push({ x: p.x, y: p.y, color: baseColor, rTiles: glowTiles });
    }

    // Offscreen cache keyed by map/TILE/phase/turn to avoid rebuilding within the same turn
    const mapRows = ctx.map.length;
    const mapCols = ctx.map[0] ? ctx.map[0].length : 0;
    const wpx = mapCols * TILE, hpx = mapRows * TILE;
    const turn = (ctx.time && typeof ctx.time.turnCounter === "number") ? (ctx.time.turnCounter | 0) : 0;
    const phase = ctx.time && ctx.time.phase ? String(ctx.time.phase) : "";

    let layer = ctx._lampGlowLayer || null;
    const needsRebuild =
      !layer ||
      layer.mapRef !== ctx.map ||
      layer.TILE !== TILE ||
      layer.wpx !== wpx ||
      layer.hpx !== hpx ||
      layer.phase !== phase ||
      layer.turn !== turn ||
      layer.count !== lights.length;

    if (needsRebuild) {
      const off = document.createElement("canvas");
      off.width = wpx;
      off.height = hpx;
      const oc = off.getContext("2d");
      oc.globalCompositeOperation = "lighter";

      // Alpha configuration (palette-driven) and phase multiplier
      let a0 = 0.60, a1 = 0.25, a2 = 0.0;
      try {
        const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
        if (pal) {
          const v0 = Number(pal.glowStartA), v1 = Number(pal.glowMidA), v2 = Number(pal.glowEndA);
          if (Number.isFinite(v0)) a0 = Math.max(0, Math.min(1, v0));
          if (Number.isFinite(v1)) a1 = Math.max(0, Math.min(1, v1));
          if (Number.isFinite(v2)) a2 = Math.max(0, Math.min(1, v2));
        }
      } catch (_) {}
      const phaseMult = (function () {
        const ph = (ctx.time && ctx.time.phase) || "";
        if (ph === "night") return 1.0;
        if (ph === "dusk" || ph === "dawn") return 0.8;
        return 0.6;
      })();

      for (let i = 0; i < lights.length; i++) {
        const L = lights[i];
        const cx = L.x * TILE + TILE / 2;
        const cy = L.y * TILE + TILE / 2;
        const r = TILE * L.rTiles;
        const grad = oc.createRadialGradient(cx, cy, 4, cx, cy, r);
        grad.addColorStop(0, _rgba(L.color, a0 * phaseMult));
        grad.addColorStop(0.4, _rgba(L.color, a1 * phaseMult));
        grad.addColorStop(1, _rgba(L.color, a2 * phaseMult));
        oc.fillStyle = grad;
        oc.beginPath();
        oc.arc(cx, cy, r, 0, Math.PI * 2);
        oc.fill();
      }

      layer = {
        canvas: off,
        mapRef: ctx.map,
        TILE,
        wpx,
        hpx,
        phase,
        turn,
        count: lights.length
      };
      ctx._lampGlowLayer = layer;
    }

    // Blit only the visible viewport region additively
    const cam = view.cam;
    if (layer && layer.canvas && cam && cam.width && cam.height) {
      ctx2d.save();
      ctx2d.globalCompositeOperation = "lighter";
      ctx2d.drawImage(layer.canvas, cam.x, cam.y, cam.width, cam.height, 0, 0, cam.width, cam.height);
      ctx2d.restore();
    }
  } catch (_) {}
}

export function drawDungeonGlow(ctx, view) {
  try {
    const props = Array.isArray(ctx.dungeonProps) ? ctx.dungeonProps : [];
    if (!props.length) return;

    function propDefFor(type) {
      try {
        const GD = (typeof window !== "undefined" ? window.GameData : null);
        const arr = GD && GD.props && Array.isArray(GD.props.props) ? GD.props.props : null;
        if (!arr) return null;
        const key = String(type || "").toLowerCase();
        for (let i = 0; i < arr.length; i++) {
          const e = arr[i];
          if (String(e.id || "").toLowerCase() === key || String(e.key || "").toLowerCase() === key) return e;
        }
      } catch (_) {}
      return null;
    }
    // Color conversion moved to color_utils (imported as _rgba)

    const { ctx2d, TILE } = Object.assign({}, view);
    ctx2d.save();
    ctx2d.globalCompositeOperation = "lighter";
    for (const p of props) {
      let def = propDefFor(p.type);
      // Fallback for common dungeon light props when registry isn't available
      if (!def && String(p.type || "").toLowerCase() === "wall_torch") {
        def = {
          properties: { emitsLight: true },
          colors: { fg: "#ffb84d" },
          light: { glowTiles: 2.2, color: "#ffb84d" }
        };
      }
      const emits = !!(def && def.properties && def.properties.emitsLight);
      if (!emits) continue;

      const px = p.x, py = p.y;
      if (px < view.startX || px > view.endX || py < view.startY || py > view.endY) continue;

      // Match town behavior: draw glow only when tile is currently visible
      const visNow = !!(ctx.visible[py] && ctx.visible[py][px]);
      if (!visNow) continue;

      const cx = (px - view.startX) * TILE - view.tileOffsetX + TILE / 2;
      const cy = (py - view.startY) * TILE - view.tileOffsetY + TILE / 2;

      // Prefer prop.light.glowTiles; align default with town lamps for parity
      const glowTiles = (def && def.light && typeof def.light.glowTiles === "number") ? def.light.glowTiles : 2.2;
      const r = TILE * glowTiles;

      const base = (def && def.light && typeof def.light.color === "string")
        ? def.light.color
        : (def && def.colors && def.colors.fg) ? def.colors.fg : "#ffb84d";

      // Alpha configuration (palette-driven) and phase multiplier (use same as town lamps)
      let a0 = 0.60, a1 = 0.25, a2 = 0.0;
      try {
        const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
        if (pal) {
          const v0 = Number(pal.glowStartA), v1 = Number(pal.glowMidA), v2 = Number(pal.glowEndA);
          if (Number.isFinite(v0)) a0 = Math.max(0, Math.min(1, v0));
          if (Number.isFinite(v1)) a1 = Math.max(0, Math.min(1, v1));
          if (Number.isFinite(v2)) a2 = Math.max(0, Math.min(1, v2));
        }
      } catch (_) {}
      const phaseMult = (function () {
        const ph = (ctx.time && ctx.time.phase) || "";
        if (ph === "night") return 1.0;
        if (ph === "dusk" || ph === "dawn") return 0.8;
        return 0.6;
      })();
      const grad = ctx2d.createRadialGradient(cx, cy, 3, cx, cy, r);
      grad.addColorStop(0, _rgba(base, a0 * phaseMult));
      grad.addColorStop(0.5, _rgba(base, a1 * phaseMult));
      grad.addColorStop(1, _rgba(base, a2 * phaseMult));
      ctx2d.fillStyle = grad;
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, r, 0, Math.PI * 2);
      ctx2d.fill();
    }
    ctx2d.restore();
  } catch (_) {}
}

// Back-compat: attach to window via helper
attachGlobal("RenderOverlays", {
  drawTownDebugOverlay,
  drawTownPaths,
  drawTownHomePaths,
  drawTownRoutePaths,
  drawLampGlow,
  drawDungeonGlow
});