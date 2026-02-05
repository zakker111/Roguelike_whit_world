/**
 * Overworld roads and bridges overlays.
 */
import { getTileDefByKey } from "../../data/tile_lookup.js";



export function drawBridges(ctx, view) {
  const { ctx2d, TILE, map, startX, startY, endX, endY, tileOffsetX, tileOffsetY } = Object.assign({}, view, ctx);
  try {
    const bridges = (ctx.world && Array.isArray(ctx.world.bridges)) ? ctx.world.bridges : [];
    if (bridges.length) {
      let bridgeColor = "#c3a37a";
      try {
        const tdBridge = getTileDefByKey("overworld", "BRIDGE");
        if (tdBridge && tdBridge.colors && tdBridge.colors.fill) bridgeColor = tdBridge.colors.fill || bridgeColor;
      } catch (_) {}
      ctx2d.save();
      ctx2d.globalAlpha = 0.6;
      ctx2d.fillStyle = bridgeColor;
      for (const p of bridges) {
        const x = p.x, y = p.y;
        if (x < startX || x > endX || y < startY || y > endY) continue;
        const sx = (x - startX) * TILE - tileOffsetX;
        const sy = (y - startY) * TILE - tileOffsetY;
        const w = Math.max(4, Math.floor(TILE * 0.55));
        const h = Math.max(3, Math.floor(TILE * 0.20));
        ctx2d.fillRect(sx + (TILE - w) / 2, sy + (TILE - h) / 2, w, h);
      }
      ctx2d.restore();
    }
  } catch (_) {}
}