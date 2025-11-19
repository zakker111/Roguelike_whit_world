/**
 * Lamp glow overlay for towns at night/dusk/dawn.
 */
import { rgba as _rgba } from "../color_utils.js";

export function drawLampGlow(ctx, view) {
  try {
    const time = ctx.time;
    if (!(time && (time.phase === "night" || time.phase === "dusk" || time.phase === "dawn"))) return;
    if (!Array.isArray(ctx.townProps)) return;

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

    const lights = [];
    for (const p of ctx.townProps) {
      const def = propDefFor(p.type);
      const emits = !!(def && def.properties && def.properties.emitsLight);
      if (!emits) continue;
      const visNow = !!(ctx.visible[p.y] && ctx.visible[p.y][p.x]);
      if (!visNow) continue;
      const baseColor = (def && def.light && typeof def.light.color === "string")
        ? def.light.color
        : (def && def.colors && def.colors.fg) ? def.colors.fg : "#ffd166";
      const glowTiles = (def && def.light && typeof def.light.glowTiles === "number") ? def.light.glowTiles : 2.2;
      lights.push({ x: p.x, y: p.y, color: baseColor, rTiles: glowTiles });
    }

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

    const cam = view.cam;
    if (layer && layer.canvas && cam && cam.width && cam.height) {
      ctx2d.save();
      ctx2d.globalCompositeOperation = "lighter";
      ctx2d.drawImage(layer.canvas, cam.x, cam.y, cam.width, cam.height, 0, 0, cam.width, cam.height);
      ctx2d.restore();
    }
  } catch (_) {}
}