/**
 * Town shop door markers.
 */
import * as RenderCore from "../render_core.js";
import { getTileDefByKey } from "../../data/tile_lookup.js";
import { propColor as _propColor } from "../prop_palette.js";

export function drawShopMarkers(ctx, view) {
  const { ctx2d, TILE, seen, startX, startY, endX, endY, tileOffsetX, tileOffsetY } = Object.assign({}, view, ctx);
  try {
    if (!Array.isArray(ctx.shops) || !ctx.shops.length) return;

    // Helper: decide whether a door tile is within the plaza area; shop markers
    // inside the town square are visually noisy and not very helpful, so we
    // suppress them.
    function isInPlaza(x, y) {
      try {
        const pr = ctx.townPlazaRect;
        if (pr && typeof pr.x0 === "number" && typeof pr.y0 === "number" &&
            typeof pr.x1 === "number" && typeof pr.y1 === "number") {
          if (x >= pr.x0 && x <= pr.x1 && y >= pr.y0 && y <= pr.y1) return true;
        } else if (ctx.townPlaza && typeof ctx.townPlaza.x === "number" && typeof ctx.townPlaza.y === "number") {
          const px = ctx.townPlaza.x | 0;
          const py = ctx.townPlaza.y | 0;
          const dx = Math.abs(x - px);
          const dy = Math.abs(y - py);
          if (dx <= 2 && dy <= 2) return true;
        }
      } catch (_) {}
      return false;
    }

    for (const s of ctx.shops) {
      const dx = (s.building && s.building.door && typeof s.building.door.x === "number") ? s.building.door.x : s.x;
      const dy = (s.building && s.building.door && typeof s.building.door.y === "number") ? s.building.door.y : s.y;
      if (dx < startX || dx > endX || dy < startY || dy > endY) continue;
      const everSeen = !!(seen[dy] && seen[dy][dx]);
      if (!everSeen) continue;

      // Skip shop markers whose doors are in or immediately around the plaza.
      if (isInPlaza(dx, dy)) continue;

      let hasSignInside = false;
      try {
        if (Array.isArray(ctx.townProps) && s.building) {
          hasSignInside = ctx.townProps.some(p =>
            p && String(p.type || "").toLowerCase() === "sign" &&
            p.x > s.building.x && p.x < s.building.x + s.building.w - 1 &&
            p.y > s.building.y && p.y < s.building.y + s.building.h - 1
          );
        }
      } catch (_) {}

      if (hasSignInside) continue;

      const screenX = (dx - startX) * TILE - tileOffsetX;
      const screenY = (dy - startY) * TILE - tileOffsetY;
      let signColor = "#d7ba7d";
      try {
        const tdSign = getTileDefByKey("town", "SIGN") || getTileDefByKey("dungeon", "SIGN");
        if (tdSign && tdSign.colors && tdSign.colors.fg) signColor = tdSign.colors.fg || signColor;
      } catch (_) {}
      try { signColor = _propColor("sign", signColor) || signColor; } catch (_) {}
      RenderCore.drawGlyph(ctx2d, screenX, screenY, "⚑", signColor, TILE);
    }
  } catch (_) {}
}