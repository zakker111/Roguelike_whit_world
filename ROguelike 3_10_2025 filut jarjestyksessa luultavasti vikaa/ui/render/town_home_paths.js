/**
 * Town home paths overlay (routes to NPC homes with arrows and H markers).
 */
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