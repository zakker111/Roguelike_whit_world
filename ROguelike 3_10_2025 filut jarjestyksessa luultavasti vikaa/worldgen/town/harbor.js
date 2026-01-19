import { getGameData } from "../../utils/access.js";
import { getTileDefByKey } from "../../data/tile_lookup.js";

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
  if (!ctx || ctx.townKind !== "port") return;
    if (!Array.isArray(ctx.townHarborMask) || !ctx.townHarborMask.length) return;
    if (!Array.isArray(buildings)) return;

    const harborMask = ctx.townHarborMask;
    const harborDir = typeof ctx.townHarborDir === "string" ? ctx.townHarborDir : "";
    if (!harborDir) return;

    const GD = getGameData(ctx);
    const PFB = GD && GD.prefabs ? GD.prefabs : null;

    function insideAnyBuildingLocal(x, y) {
      for (let i = 0; i < buildings.length; i++) {
        const B = buildings[i];
        if (!B) continue;
        if (x > B.x && x < B.x + B.w - 1 && y > B.y && y < B.y + B.h - 1) return true;
      }
      return false;
    }

    // Treat building rectangles (including a one-tile halo) as solid barriers for harbor
    // water so we never end up with shops/houses visually sitting \"in\" water.
    function touchesAnyBuildingLocal(x, y) {
      for (let i = 0; i < buildings.length; i++) {
        const B = buildings[i];
        if (!B) continue;
        const bx0 = B.x - 1;
        const by0 = B.y - 1;
        const bx1 = B.x + B.w;
        const by1 = B.y + B.h;
        if (x >= bx0 && x <= bx1 && y >= by0 && y <= by1) return true;
      }
      return false;
    }

    // Carve a shallow water strip along the harbor edge, then carve piers into that water.
    function carveHarborWaterAndPiers() {
      let WATER = null;
      try {
        const td = getTileDefByKey("town", "HARBOR_WATER") || null;
        if (td && typeof td.id === "number") WATER = td.id | 0;
      } catch (_) {}
      if (WATER == null) return;

      // Water depth: derive from config and harbor band depth to keep a wide water strip
      // while leaving some dry harbor band tiles inside the town.
      let waterDepth = 8;
      let bandDepthCfg = null;
      try {
        const TOWNCFG = GD && GD.town;
        const harborCfg = TOWNCFG && TOWNCFG.kinds && TOWNCFG.kinds.port && TOWNCFG.kinds.port.harbor;
        if (harborCfg) {
          if (typeof harborCfg.waterDepth === "number") {
            waterDepth = harborCfg.waterDepth | 0;
          }
          if (typeof harborCfg.bandDepth === "number") {
            bandDepthCfg = harborCfg.bandDepth | 0;
          }
        }
      } catch (_) {}

      const dimCap = Math.floor(Math.min(W, H) / 2) || 16;
      let maxDepth = dimCap;
      if (bandDepthCfg && bandDepthCfg > 4) {
        // Keep at least a few tiles of dry harbor band inside town.
        maxDepth = Math.min(maxDepth, bandDepthCfg - 3);
      }
      maxDepth = Math.max(2, Math.min(maxDepth, 24));
      waterDepth = Math.max(2, Math.min(waterDepth, maxDepth));

      // Prepare a pier mask so renderers can tint pier floor differently.
      const pierMask = Array.from({ length: H }, () => Array(W).fill(false));
      ctx.townPierMask = pierMask;

      // First, carve water strip along harbor edge within the harbor band.
      if (harborDir === "W" || harborDir === "E") {
        for (let y = 1; y < H - 1; y++) {
          let edgeX = null;
          for (let x = 1; x < W - 1; x++) {
            if (!harborMask[y][x]) continue;
            if (edgeX == null || (harborDir === "W" ? x < edgeX : x > edgeX)) {
              edgeX = x;
            }
          }
          if (edgeX == null) continue;
          const dirStep = harborDir === "W" ? +1 : -1;
          for (let d = 0; d < waterDepth; d++) {
            const xx = edgeX + dirStep * d;
            if (xx <= 0 || xx >= W - 1) break;
            if (!harborMask[y][xx]) break;
            if (touchesAnyBuildingLocal(xx, y)) break;
            const t = ctx.map[y][xx];
            if (t === ctx.TILES.FLOOR || t === ctx.TILES.ROAD) {
              ctx.map[y][xx] = WATER;
            }
          }
        }
      } else if (harborDir === "N" || harborDir === "S") {
        for (let x = 1; x < W - 1; x++) {
          let edgeY = null;
          for (let y = 1; y < H - 1; y++) {
            if (!harborMask[y][x]) continue;
            if (edgeY == null || (harborDir === "N" ? y < edgeY : y > edgeY)) {
              edgeY = y;
            }
          }
          if (edgeY == null) continue;
          const dirStep = harborDir === "N" ? +1 : -1;
          for (let d = 0; d < waterDepth; d++) {
            const yy = edgeY + dirStep * d;
            if (yy <= 0 || yy >= H - 1) break;
            if (!harborMask[yy][x]) break;
            if (touchesAnyBuildingLocal(x, yy)) break;
            const t = ctx.map[yy][x];
            if (t === ctx.TILES.FLOOR || t === ctx.TILES.ROAD) {
              ctx.map[yy][x] = WATER;
            }
          }
        }
      }

      // Next, carve piers: starting from harbor-band floor/road tiles adjacent to water,
      // extend wooden walkways straight out from the shore into the harbor water.
      // Piers should always be perpendicular to the shoreline, not running along it,
      // so we restrict directions based on harborDir, and we only allow piers that go
      // from town-side land out toward open water (never back toward the city).
      const roots = [];
      let dirs;
      if (harborDir === "W") {
        // Town is to the east, water opens to the west: piers go west only.
        dirs = [{ dx: -1, dy: 0 }];
      } else if (harborDir === "E") {
        // Town is to the west, water opens to the east: piers go east only.
        dirs = [{ dx: 1, dy: 0 }];
      } else if (harborDir === "N") {
        // Town is to the south, water opens to the north: piers go north only.
        dirs = [{ dx: 0, dy: -1 }];
      } else {
        // harborDir === "S": Town is to the north, water opens to the south: piers go south only.
        dirs = [{ dx: 0, dy: 1 }];
      }

      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          if (!harborMask[y][x]) continue;
          if (ctx.map[y][x] !== WATER) continue;
          // Find an adjacent land tile in the harbor band that could anchor a pier.
          for (let i = 0; i < dirs.length; i++) {
            const dx = dirs[i].dx;
            const dy = dirs[i].dy;
            const rx = x - dx;
            const ry = y - dy;
            if (rx <= 0 || ry <= 0 || rx >= W - 1 || ry >= H - 1) continue;
            if (!harborMask[ry][rx]) continue;
            const t = ctx.map[ry][rx];
            if (t !== ctx.TILES.FLOOR && t !== ctx.TILES.ROAD) continue;
            if (insideAnyBuildingLocal(rx, ry)) continue;
            roots.push({ x: rx, y: ry, dx, dy });
            break;
          }
        }
      }

      if (!roots.length) return;

      // Limit to 1–2 piers depending on how many roots we have.
      let maxPiers = Math.min(2, Math.max(1, roots.length));
      if (maxPiers === 2 && roots.length > 1) {
        const rv = rng ? rng() : Math.random();
        if (rv < 0.5) maxPiers = 1;
      }

      // Target pier length: prefer 5–8 tiles where waterDepth allows it.
      const pierMaxLen = Math.max(1, Math.min(8, Math.max(5, waterDepth - 3)));

      let piersPlaced = 0;
      let boatsPlaced = 0;

      while (piersPlaced < maxPiers && roots.length) {
        const idx = Math.floor((rng ? rng() : Math.random()) * roots.length);
        const root = roots.splice(idx, 1)[0];
        if (!root) continue;

        let tipX = root.x;
        let tipY = root.y;

        pierMask[root.y][root.x] = true;

        let length = 0;
        for (let d = 1; d <= waterDepth; d++) {
          const xx = root.x + root.dx * d;
          const yy = root.y + root.dy * d;
          if (xx <= 0 || yy <= 0 || xx >= W - 1 || yy >= H - 1) break;
          if (!harborMask[yy][xx]) break;
          if (insideAnyBuildingLocal(xx, yy)) break;
          if (ctx.map[yy][xx] !== WATER) break;

          // Do not grow beyond our target maximum pier length.
          if (length >= pierMaxLen) break;

          // Look one step ahead: the next tile in this direction must still be
          // harbor water, otherwise we would be about to \"bridge\" to land or
          // leave no water beyond the pier tip.
          const nx = xx + root.dx;
          const ny = yy + root.dy;
          const nextInBounds = nx > 0 && ny > 0 && nx < W - 1 && ny < H - 1;
          const nextIsWaterBand = nextInBounds && harborMask[ny][nx] && ctx.map[ny][nx] === WATER;

          if (!nextIsWaterBand) break;

          // Carve current water tile into pier floor.
          ctx.map[yy][xx] = ctx.TILES.FLOOR;
          pierMask[yy][xx] = true;
          tipX = xx;
          tipY = yy;
          length++;
        }

        // Require that the pier actually extends into water.
        if (length === 0) continue;

        // Optionally place a small boat just beyond the pier tip on water.
        if (boatsPlaced < 2) {
          const rv = rng ? rng() : Math.random();
          if (rv < 0.85 || boatsPlaced === 0) {
            const bx = tipX + root.dx;
            const by = tipY + root.dy;
            if (bx > 0 && bx < W - 1 && by > 0 && by < H - 1 && harborMask[by][bx]) {
              _safeAddBoatProp(ctx, W, H, bx, by, WATER);
              boatsPlaced++;
            }
          }
        }

        piersPlaced++;
      }

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
        // Ensure we are not stamping on water or other non-floor tiles
        let anyBad = false;
        for (let yy = by; yy < by + bh && !anyBad; yy++) {
          for (let xx = bx; xx < bx + bw; xx++) {
            if (yy <= 0 || yy >= H - 1 || xx <= 0 || xx >= W - 1) { anyBad = true; break; }
            const t = ctx.map[yy][xx];
            if (t !== ctx.TILES.FLOOR && t !== ctx.TILES.ROAD) { anyBad = true; break; }
          }
        }
        if (anyBad) continue;

        const ok = stampPrefab(ctx, pref, bx, by) || trySlipStamp(ctx, pref, bx, by, 2);
        if (!ok) continue;

        // Mark this building rect as harbor-tagged for AI and metadata
        try {
          const bRect = buildings.find(b => b && b.x === bx && b.y === by && b.w === bw && b.h === bh);
          if (bRect) {
            bRect.prefabCategory = bRect.prefabCategory || "harbor";
            const existingTags = Array.isArray(bRect.prefabTags) ? bRect.prefabTags : [];
            if (!existingTags.includes("harbor")) {
              bRect.prefabTags = existingTags.concat(["harbor"]);
            }
          }
        } catch (_) {}

        placed++;
      }
    }

    carveHarborWaterAndPiers();
    placeDockProps();
    placeHarborWarehouses();

    // Recompute harbor building list now that warehouses may have been stamped.
    try {
      const harborBuildings = [];
      if (Array.isArray(buildings)) {
        for (const b of buildings) {
          if (!b) continue;
          const id = b.prefabId ? String(b.prefabId).toLowerCase() : "";
          const cat = b.prefabCategory ? String(b.prefabCategory).toLowerCase() : "";
          const tags = Array.isArray(b.prefabTags) ? b.prefabTags.map(t => String(t).toLowerCase()) : [];
          const isHarborLike =
            id.includes("harbor") ||
            cat === "harbor" ||
            tags.includes("harbor");
          if (isHarborLike) harborBuildings.push(b);
        }
      }
      ctx.townHarborBuildings = harborBuildings;
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

function _safeAddBoatProp(ctx, W, H, x, y, waterTile) {
  try {
    if (!ctx || !ctx.townProps || !ctx.map) return false;
    if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return false;
    const t = ctx.map[y][x];
    if (t !== waterTile) return false;
    if (Array.isArray(ctx.townProps) && ctx.townProps.some(p => p.x === x && p.y === y)) return false;
    ctx.townProps.push({ x, y, type: "boat", name: null });
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