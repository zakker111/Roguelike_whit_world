/**
 * Overworld fog-of-war overlay.
 */
import { fogGet } from "../../core/engine/fog.js";

export function drawFog(ctx, view) {
  const { ctx2d, TILE, COLORS, map, startX, startY, endX, endY, tileOffsetX, tileOffsetY } = Object.assign({}, view, ctx);
  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;

  // Defensive guard: if fog-of-war grids are missing or clearly out of sync with the
  // current overworld window (e.g., after heavy infinite-world expansion or a bad
  // restore from another mode), skip drawing the fog overlay entirely so we never
  // end up with a fully black overworld.
  const seen = ctx.seen;
  const visible = ctx.visible;
  const fogLooksValid =
    Array.isArray(seen) &&
    Array.isArray(visible) &&
    seen.length === mapRows &&
    visible.length === mapRows &&
    // spot-check first row shapes to avoid obviously truncated grids
    (!seen[0] || (typeof seen[0].length === "number" && seen[0].length >= mapCols)) &&
    (!visible[0] || (typeof visible[0].length === "number" && visible[0].length >= mapCols));

  if (!fogLooksValid) return;

  try {
    for (let y = startY; y <= endY; y++) {
      if (y < 0 || y >= mapRows) continue;
      for (let x = startX; x <= endX; x++) {
        if (x < 0 || x >= mapCols) continue;
        const sx = (x - startX) * TILE - tileOffsetX;
        const sy = (y - startY) * TILE - tileOffsetY;
        const seenHere = fogGet(seen, x, y);
        const visHere = fogGet(visible, x, y);
        if (!seenHere) {
          ctx2d.fillStyle = "#0b0c10";
          ctx2d.fillRect(sx, sy, TILE, TILE);
        } else if (!visHere) {
          ctx2d.fillStyle = COLORS.dim || "rgba(0,0,0,0.35)";
          ctx2d.fillRect(sx, sy, TILE, TILE);
        }
      }
    }
  } catch (_) {}
}