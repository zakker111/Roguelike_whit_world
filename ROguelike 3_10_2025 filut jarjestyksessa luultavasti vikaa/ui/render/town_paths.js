/**
 * Town paths debug overlay (route and path dots).
 */
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