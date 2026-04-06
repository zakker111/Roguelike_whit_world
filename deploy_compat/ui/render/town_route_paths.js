/**
 * Town route paths overlay (debug routes).
 */
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