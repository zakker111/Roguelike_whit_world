/**
 * Town diagnostics/helpers.
 * Exports:
 *  - buildOutdoorMask(ctx, buildings): marks ctx.townOutdoorMask = boolean[][] for outdoor FLOOR tiles.
 */
import { attachGlobal } from "../utils/global.js";

export function buildOutdoorMask(ctx, buildings) {
  try {
    const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
    const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
    const mask = Array.from({ length: rows }, () => Array(cols).fill(false));
    function insideAnyBuilding(x, y) {
      for (let i = 0; i < buildings.length; i++) {
        const B = buildings[i];
        if (x > B.x && x < B.x + B.w - 1 && y > B.y && y < B.y + B.h - 1) return true;
      }
      return false;
    }
    for (let yy = 0; yy < rows; yy++) {
      for (let xx = 0; xx < cols; xx++) {
        const t = ctx.map[yy][xx];
        if (t === ctx.TILES.FLOOR && !insideAnyBuilding(xx, yy)) {
          mask[yy][xx] = true;
        }
      }
    }
    ctx.townOutdoorMask = mask;
    return true;
  } catch (_) { return false; }
}

attachGlobal("TownDiagnostics", { buildOutdoorMask });