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
      ctx2d.globalAlpha = 0.22;
      ctx2d.fillStyle = "rgba(255, 215, 0, 0.22)";
      ctx2d.strokeStyle = "rgba(255, 215, 0, 0.9)";
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
          ctx2d.fillStyle = "rgba(13,16,24,0.65)";
          const padX = Math.max(6, Math.floor(TILE * 0.25));
          const padY = Math.max(4, Math.floor(TILE * 0.20));
          const textW = Math.max(32, label.length * (TILE * 0.35));
          const boxW = Math.min(bw - 8, textW + padX * 2);
          const boxH = Math.min(bh - 8, TILE * 0.8 + padY * 2);
          ctx2d.fillRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);
          ctx2d.strokeStyle = "rgba(255, 215, 0, 0.85)";
          ctx2d.lineWidth = 1;
          ctx2d.strokeRect(cx - boxW / 2 + 0.5, cy - boxH / 2 + 0.5, boxW - 1, boxH - 1);
          ctx2d.fillStyle = "#ffd166";
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
    ctx2d.strokeStyle = "rgba(0, 200, 255, 0.85)";
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
      ctx2d.fillStyle = "rgba(0, 200, 255, 0.85)";
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
    for (let i = 0; i < ctx.npcs.length; i++) {
      const n = ctx.npcs[i];
      const path = (n._homePlan && n._homePlan.length >= 2) ? n._homePlan : n._homeDebugPath;
      ctx2d.strokeStyle = "rgba(60, 120, 255, 0.95)";
      if (path && path.length >= 2) {
        const start = path[0];
        const sx = (start.x - view.startX) * TILE - view.tileOffsetX + TILE / 2;
        const sy = (start.y - view.startY) * TILE - view.tileOffsetY + TILE / 2;
        ctx2d.fillStyle = "rgba(60, 120, 255, 0.95)";
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
        ctx2d.fillStyle = "rgba(60, 120, 255, 0.95)";
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
        ctx2d.fillStyle = "rgba(60, 120, 255, 0.95)";
        ctx2d.fillText("H", ex + 10, ey - 10);
      } else {
        const sx2 = (n.x - view.startX) * TILE - view.tileOffsetX + TILE / 2;
        const sy2 = (n.y - view.startY) * TILE - view.tileOffsetY + TILE / 2;
        ctx2d.fillStyle = "rgba(255, 80, 80, 0.95)";
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
    ctx2d.strokeStyle = "rgba(80, 140, 255, 0.9)";
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
      ctx2d.fillStyle = "rgba(80, 140, 255, 0.9)";
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

    // Helper: convert hex "#rrggbb" to rgba string with given alpha
    function rgba(hex, a) {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
      if (!m) return `rgba(255, 220, 120, ${a})`;
      const v = parseInt(m[1], 16);
      const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }

    const { ctx2d, TILE } = Object.assign({}, view);
    ctx2d.save();
    ctx2d.globalCompositeOperation = "lighter";
    for (const p of ctx.townProps) {
      const def = propDefFor(p.type);
      const emits = !!(def && def.properties && def.properties.emitsLight);
      if (!emits) continue;

      const px = p.x, py = p.y;
      if (px < view.startX || px > view.endX || py < view.startY || py > view.endY) continue;
      if (!ctx.visible[py] || !ctx.visible[py][px]) continue;

      const cx = (px - view.startX) * TILE - view.tileOffsetX + TILE / 2;
      const cy = (py - view.startY) * TILE - view.tileOffsetY + TILE / 2;

      const glowTiles = (def && def.light && typeof def.light.glowTiles === "number") ? def.light.glowTiles : 2.2;
      const r = TILE * glowTiles;

      const base = (def && def.light && typeof def.light.color === "string")
        ? def.light.color
        : (def && def.colors && def.colors.fg) ? def.colors.fg : "#ffd166";

      const grad = ctx2d.createRadialGradient(cx, cy, 4, cx, cy, r);
      grad.addColorStop(0, rgba(base, 0.60));
      grad.addColorStop(0.4, rgba(base, 0.25));
      grad.addColorStop(1, rgba(base, 0.0));
      ctx2d.fillStyle = grad;
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, r, 0, Math.PI * 2);
      ctx2d.fill();
    }
    ctx2d.restore();
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
    function rgba(hex, a) {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
      if (!m) return `rgba(255, 200, 100, ${a})`;
      const v = parseInt(m[1], 16);
      const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }

    const { ctx2d, TILE } = Object.assign({}, view);
    ctx2d.save();
    ctx2d.globalCompositeOperation = "lighter";
    for (const p of props) {
      const def = propDefFor(p.type);
      const emits = !!(def && def.properties && def.properties.emitsLight);
      if (!emits) continue;

      const px = p.x, py = p.y;
      if (px < view.startX || px > view.endX || py < view.startY || py > view.endY) continue;
      if (!ctx.visible[py] || !ctx.visible[py][px]) continue;

      const cx = (px - view.startX) * TILE - view.tileOffsetX + TILE / 2;
      const cy = (py - view.startY) * TILE - view.tileOffsetY + TILE / 2;

      // Small glow by default; prefer prop.light.glowTiles if present
      const glowTiles = (def && def.light && typeof def.light.glowTiles === "number") ? def.light.glowTiles : 1.6;
      const r = TILE * glowTiles;

      const base = (def && def.light && typeof def.light.color === "string")
        ? def.light.color
        : (def && def.colors && def.colors.fg) ? def.colors.fg : "#ffb84d";

      const grad = ctx2d.createRadialGradient(cx, cy, 3, cx, cy, r);
      grad.addColorStop(0, rgba(base, 0.55));
      grad.addColorStop(0.5, rgba(base, 0.22));
      grad.addColorStop(1, rgba(base, 0.0));
      ctx2d.fillStyle = grad;
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, r, 0, Math.PI * 2);
      ctx2d.fill();
    }
    ctx2d.restore();
  } catch (_) {}
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.RenderOverlays = {
    drawTownDebugOverlay,
    drawTownPaths,
    drawTownHomePaths,
    drawTownRoutePaths,
    drawLampGlow,
    drawDungeonGlow
  };
}