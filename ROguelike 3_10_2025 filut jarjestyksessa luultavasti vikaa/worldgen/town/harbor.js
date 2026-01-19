import { getGameData } from "../../utils/access.js";

/**
 * Harbor prefabs placement for port towns.
 *
 * Responsibilities:
 * - Use ctx.townHarborMask / ctx.townHarborDir / ctx.townKind to locate harbor band.
 * - Stamp simple dock-like props along the open harbor edge (floor + crates/barrels/etc.).
 * - Place 1–2 small \"warehouse\" style buildings just inside the harbor band using existing house prefabs.
 *
 * This module deliberately avoids adding new tiles; docks are visualized via props on FLOOR
 * tiles so pathfinding remains simple.
 */

/**
 * Place harbor visuals and buildings for port towns.
 * @param {Object} ctx
 * @param {Array} buildings - existing building rects (mutated when warehouses are added)
 * @param {number} W - map width
 * @param {number} H - map height
 * @param {{x:number,y:number}} gate
 * @param {{x:number,y:number}} plaza
 * @param {function} rng
 * @param {function} stampPrefab - function(ctx, prefab, bx, by) -> boolean
 * @param {function} trySlipStamp - function(ctx, prefab, bx, by, maxSlip) -> boolean
 */
export function placeHarborPrefabs(ctx, buildings, W, H, gate, plaza, rng, stampPrefab, trySlipStamp) {
  try {
    if (!ctx || ctx.townKind !== "port") return;
    if (!Array.isArray(ctx.townHarborMask) || !ctx.townHarborMask.length) return;
    if (!Array.isArray(buildings)) return;

    const harborMask = ctx.townHarborMask;
    const harborDir = typeof ctx.townHarborDir === "string" ? ctx.townHarborDir : "";
    if (!harborDir) return;

    const GD = getGameData(ctx);
    const PFB = GD && GD.prefabs ? GD.prefabs : null;

    // Simple dock props: reuse existing props (CRATE/BARREL/LAMP) along the harbor edge.
    function placeDockProps() {
      const bandCoords = [];
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          if (harborMask[y][x] && ctx.map[y][x] === ctx.TILES.FLOOR) {
            bandCoords.push({ x, y });
          }
        }
      }
      if (!bandCoords.length) return;

      // Rough heuristic: choose a handful of tiles along outermost band row/col to decorate.
      const edgeCoords = [];
      if (harborDir === "N") {
        let minY = H;
        for (const c of bandCoords) if (c.y < minY) minY = c.y;
        for (const c of bandCoords) if (c.y === minY) edgeCoords.push(c);
      } else if (harborDir === "S") {
        let maxY = 0;
        for (const c of bandCoords) if (c.y > maxY) maxY = c.y;
        for (const c of bandCoords) if (c.y === maxY) edgeCoords.push(c);
      } else if (harborDir === "W") {
        let minX = W;
        for (const c of bandCoords) if (c.x < minX) minX = c.x;
        for (const c of bandCoords) if (c.x === minX) edgeCoords.push(c);
      } else if (harborDir === "E") {
        let maxX = 0;
        for (const c of bandCoords) if (c.x > maxX) maxX = c.x;
        for (const c of bandCoords) if (c.x === maxX) edgeCoords.push(c);
      }

      if (!edgeCoords.length) return;

      // Thin sampling of edge tiles for simple dock accents
      for (let i = 0; i < edgeCoords.length; i++) {
        const c = edgeCoords[i];
        const r = rng ? rng() : Math.random();
        if (r < 0.15) {
          _safeAddProp(ctx, W, H, c.x, c.y, "CRATE");
        } else if (r < 0.30) {
          _safeAddProp(ctx, W, H, c.x, c.y, "BARREL");
        } else if (r < 0.36) {
          // occasional lamp near docks
          _safeAddProp(ctx, W, H, c.x, c.y, "LAMP");
        }
      }
    }

    // Harbor warehouses: pick small house prefabs and place them just inside the harbor band,
    // away from the outermost row/column but still clearly \"at the harbor\".
    function placeHarborWarehouses() {
      if (!PFB || !Array.isArray(PFB.houses) || !PFB.houses.length) return;

      // Filter for small-ish houses; we reuse them as generic warehouses visually.
      const candidates = PFB.houses.filter(p => {
        if (!p || !p.size) return false;
        const w = p.size.w | 0;
        const h = p.size.h | 0;
        return w <= 9 && h <= 7;
      });
      if (!candidates.length) return;

      // Build a simple list of candidate anchor positions inside the harbor band,
      // but inset by 1 tile from the very edge so buildings don't overlap docks.
      const bandCells = [];
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          if (!harborMask[y][x]) continue;
          // Inset: require at least one tile from outer map border
          if (x <= 1 || y <= 1 || x >= W - 2 || y >= H - 2) continue;
          bandCells.push({ x, y });
        }
      }
      if (!bandCells.length) return;

      // Try to place up to two warehouses.
      const maxWarehouses = 2;
      let placed = 0;
      let attempts = 0;

      while (placed < maxWarehouses && attempts++ < 40) {
        const center = bandCells[Math.floor((rng ? rng() : Math.random()) * bandCells.length)];
        if (!center) break;

        const pref = candidates[Math.floor((rng ? rng() : Math.random()) * candidates.length)];
        if (!pref || !pref.size) continue;
        const bw = pref.size.w | 0;
        const bh = pref.size.h | 0;

        const bx = Math.max(1, Math.min(W - bw - 1, center.x - ((bw / 2) | 0)));
        const by = Math.max(1, Math.min(H - bh - 1, center.y - ((bh / 2) | 0)));

        // Ensure footprint stays mostly inside harbor band
        if (!_rectMostlyInHarborMask(harborMask, bx, by, bw, bh, W, H)) continue;
        // Do not collide with existing buildings
        if (_rectOverlapsAny(buildings, bx, by, bw, bh)) continue;

        const ok = stampPrefab(ctx, pref, bx, by) || trySlipStamp(ctx, pref, bx, by, 2);
        if (!ok) continue;

        placed++;
      }
    }

    placeDockProps();
    placeHarborWarehouses();
  } catch (_) {}
}

function _safeAddProp(ctx, W, H, x, y, code) {
  try {
    if (!ctx || !ctx.townProps || !ctx.map) return false;
    if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return false;
    const t = ctx.map[y][x];
    if (t !== ctx.TILES.FLOOR && t !== ctx.TILES.ROAD) return false;
    if (Array.isArray(ctx.townProps) && ctx.townProps.some(p => p.x === x && p.y === y)) return false;
    ctx.townProps.push({ x, y, type: _propTypeFromCode(code), name: null });
    return true;
  } catch (_) {}
  return false;
}

function _propTypeFromCode(code) {
  // Map embedded prop codes to prop types used in townProps; current town_props
  // pipeline treats type as id key in GameData.props. Codes used here (CRATE/BARREL/LAMP)
  // already exist there.
  if (!code) return "crate";
  const s = String(code).toUpperCase();
  if (s === "CRATE") return "crate";
  if (s === "BARREL") return "barrel";
  if (s === "LAMP") return "lamp";
  return "crate";
}

function _rectMostlyInHarborMask(mask, bx, by, bw, bh, W, H) {
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
  // Require majority of rect to lie inside harbor band
  return inside >= Math.floor(total * 0.6);
}

function _rectOverlapsAny(buildings, bx, by, bw, bh) {
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