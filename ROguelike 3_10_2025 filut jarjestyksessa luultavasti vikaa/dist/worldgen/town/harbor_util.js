/**
 * Harbor utilities shared between harbor generation modules.
 */

/**
 * Map embedded prop codes used in harbor/boat prefabs to town prop types.
 * These ids correspond to GameData.props keys.
 *
 * Supported codes:
 * - CRATE  -> crate
 * - BARREL -> barrel
 * - LAMP   -> lamp
 *
 * Fallback: crate.
 */
export function propTypeFromCode(code) {
  if (!code) return "crate";
  const s = String(code).toUpperCase();
  if (s === "CRATE") return "crate";
  if (s === "BARREL") return "barrel";
  if (s === "LAMP") return "lamp";
  return "crate";
}

/**
 * Test whether a rectangle lies mostly inside the harbor band mask.
 * Used to keep buildings/warehouses anchored in the harbor zone.
 */
export function rectMostlyInHarborMask(mask, bx, by, bw, bh, W, H) {
  let total = 0;
  let inside = 0;
  for (let y = by; y < by + bh; y++) {
    if (y < 0 || y >= H) continue;
    for (let x = bx; x < bx + bw; x++) {
      if (x < 0 || x >= W) continue;
      total++;
      if (mask[y][x]) inside++;
    }
  }
  if (!total) return false;
  // Require majority of rect to lie inside harbor band.
  return inside >= Math.floor(total * 0.6);
}

/**
 * Detect whether a rectangle overlaps any existing building rect.
 */
export function rectOverlapsAny(buildings, bx, by, bw, bh) {
  const ax0 = bx, ay0 = by, ax1 = bx + bw - 1, ay1 = by + bh - 1;
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (!b) continue;
    const bx0 = b.x, by0 = b.y, bx1 = b.x + b.w - 1, by1 = b.y + b.h - 1;
    const sepX = (ax1 < bx0) || (bx1 < ax0);
    const sepY = (ay1 < by0) || (by1 < ay0);
    if (!(sepX || sepY)) return true;
  }
  return false;
}