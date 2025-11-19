/**
 * Dungeon glow overlay around wall torches or light props.
 */
import { rgba as _rgba } from "../color_utils.js";

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

    const { ctx2d, TILE } = Object.assign({}, view);
    ctx2d.save();
    ctx2d.globalCompositeOperation = "lighter";
    for (const p of props) {
      let def = propDefFor(p.type);
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

      const visNow = !!(ctx.visible[py] && ctx.visible[py][px]);
      if (!visNow) continue;

      const cx = (px - view.startX) * TILE - view.tileOffsetX + TILE / 2;
      const cy = (py - view.startY) * TILE - view.tileOffsetY + TILE / 2;

      const glowTiles = (def && def.light && typeof def.light.glowTiles === "number") ? def.light.glowTiles : 2.2;
      const r = TILE * glowTiles;

      const base = (def && def.light && typeof def.light.color === "string")
        ? def.light.color
        : (def && def.colors && def.colors.fg) ? def.colors.fg : "#ffb84d";

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