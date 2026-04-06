/**
 * Region blood decals overlay.
 */
export function drawRegionBloodDecals(ctx, view) {
  const { ctx2d, TILE, map, seen, startX, startY, endX, endY, tileOffsetX, tileOffsetY } = Object.assign({}, view, ctx);

  if (!ctx.decals || !ctx.decals.length) return;

  ctx2d.save();
  for (let i = 0; i < ctx.decals.length; i++) {
    const d = ctx.decals[i];
    const inView = (x, y) => x >= startX && x <= endX && y >= startY && y <= endY;
    if (!inView(d.x, d.y)) continue;
    const sx = (d.x - startX) * TILE - tileOffsetX;
    const sy = (d.y - startY) * TILE - tileOffsetY;
    const everSeen = seen[d.y] && seen[d.y][d.x];
    if (!everSeen) continue;
    const alpha = Math.max(0, Math.min(1, d.a || 0.2));
    if (alpha <= 0) continue;

    const prev = ctx2d.globalAlpha;
    ctx2d.globalAlpha = alpha;
    let blood = "#7a1717";
    try {
      const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
      if (pal && typeof pal.blood === "string" && pal.blood.trim().length) blood = pal.blood;
    } catch (_) {}
    ctx2d.fillStyle = blood;

    const r = Math.max(4, Math.min(TILE - 2, d.r || Math.floor(TILE * 0.4)));
    const cx = sx + TILE / 2;
    const cy = sy + TILE / 2;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, r, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.globalAlpha = prev;
  }
  ctx2d.restore();
}