/**
 * Town blood decals overlay.
 */
export function drawTownBloodDecals(ctx, view) {
  const {
    ctx2d,
    TILE,
    map,
    seen,
    startX,
    startY,
    endX,
    endY,
    tileOffsetX,
    tileOffsetY,
  } = Object.assign({}, view, ctx);

  if (!ctx.decals || !ctx.decals.length) return;

  const rows = Array.isArray(map) ? map.length : 0;
  const cols = rows && Array.isArray(map[0]) ? map[0].length : 0;

  ctx2d.save();
  for (let i = 0; i < ctx.decals.length; i++) {
    const d = ctx.decals[i];
    if (!d) continue;
    const x = d.x | 0;
    const y = d.y | 0;
    if (x < startX || x > endX || y < startY || y > endY) continue;
    if (y < 0 || y >= rows || x < 0 || x >= cols) continue;
    const everSeen = seen[y] && seen[y][x];
    if (!everSeen) continue;

    const alpha = Math.max(0, Math.min(1, d.a || 0.2));
    if (alpha <= 0) continue;

    const sx = (x - startX) * TILE - tileOffsetX;
    const sy = (y - startY) * TILE - tileOffsetY;

    const prevAlpha = ctx2d.globalAlpha;
    ctx2d.globalAlpha = alpha;
    let blood = "#7a1717";
    try {
      const pal =
        typeof window !== "undefined" &&
        window.GameData &&
        window.GameData.palette &&
        window.GameData.palette.overlays
          ? window.GameData.palette.overlays
          : null;
      if (pal && typeof pal.blood === "string" && pal.blood.trim().length) {
        blood = pal.blood;
      }
    } catch (_) {}
    ctx2d.fillStyle = blood;

    const r = Math.max(
      4,
      Math.min(TILE - 2, d.r || Math.floor(TILE * 0.4))
    );
    const cx = sx + TILE / 2;
    const cy = sy + TILE / 2;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, r, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.globalAlpha = prevAlpha;
  }
  ctx2d.restore();
}