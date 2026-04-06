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
    for (const s of ctx.shops) {
      const dx = (s.building && s.building.door && typeof s.building.door.x === "number") ? s.building.door.x : s.x;
      const dy = (s.building && s.building.door && typeof s.building.door.y === "number") ? s.building.door.y : s.y;
      if (dx < startX || dx > endX || dy < startY || dy > endY) continue;
      const everSeen = !!(seen[dy] && seen[dy][dx]);
      if (!everSeen) continue;

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