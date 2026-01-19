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

      // Allow very deep harbors (up to ~40 tiles of water where map size permits).
      // We cap by map dimensions and harbor band depth so we still leave some town
      // interior behind the water.
      const dimCap = Math.min(60, Math.max(4, Math.min(W, H) - 4)) || 16;
      let maxDepth = dimCap;
      if (bandDepthCfg && bandDepthCfg > 4) {
        // Keep at least a few tiles of dry harbor band inside town.
        maxDepth = Math.min(maxDepth, bandDepthCfg - 3);
      }
      maxDepth = Math.max(2, maxDepth);
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

      // Limit to 2–3 piers where we have enough good roots; fall back gracefully
      // to fewer if the harbor geometry is tight.
      let maxPiers;
      if (roots.length >= 3) {
        // 50/50 chance between 2 and 3 piers when there are plenty of roots.
        const rv = rng ? rng() : Math.random();
        maxPiers = rv < 0.5 ? 2 : 3;
      } else if (roots.length === 2) {
        maxPiers = 2;
      } else {
        maxPiers = 1;
      }

      // Target pier length: make piers visibly longer than before. Previously they
      // were roughly 5–8 tiles; now we prefer ~9–14 tiles where waterDepth allows it,
      // but still keep them much shorter than the full harbor width.
      const pierMaxLen = Math.max(
        5,
        Math.min(
          15,
          Math.max(9, Math.floor(waterDepth * 0.5))
        )
      );

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
          // harbor water, otherwise we would be about to "bridge" to land or
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

          // Widen the pier to at least 2 tiles: carve one tile to each side
          // perpendicular to the pier direction, as long as those tiles are
          // harbor water and not inside buildings.
          const sideOffsets =
            (root.dx !== 0)
              ? [{ sx: 0, sy: -1 }, { sx: 0, sy: 1 }]
              : [{ sx: -1, sy: 0 }, { sx: 1, sy: 0 }];
          for (let si = 0; si < sideOffsets.length; si++) {
            const sx = xx + sideOffsets[si].sx;
            const sy = yy + sideOffsets[si].sy;
            if (sx <= 0 || sy <= 0 || sx >= W - 1 || sy >= H - 1) continue;
            if (!harborMask[sy][sx]) continue;
            if (insideAnyBuildingLocal(sx, sy)) continue;
            if (ctx.map[sy][sx] !== WATER) continue;
            ctx.map[sy][sx] = ctx.TILES.FLOOR;
            pierMask[sy][sx] = true;
          }
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

      // Cleanup: remove non-pier floor tiles that cling to the water on the sea-side
      // edge of the harbor. These tend to look like continuous quay walls or bridges
      // along the water; we want open water there and reserve solid ground only for
      // piers and inland harbor band.
      const seaDX = harborDir === "E" ? 1 : (harborDir === "W" ? -1 : 0);
      const seaDY = harborDir === "S" ? 1 : (harborDir === "N" ? -1 : 0);
      const landDX = -seaDX;
      const landDY = -seaDY;

      if (seaDX !== 0 || seaDY !== 0) {
        for (let y = 1; y < H - 1; y++) {
          for (let x = 1; x < W - 1; x++) {
            if (!harborMask[y][x]) continue;
            if (pierMask[y][x]) continue;
            if (insideAnyBuildingLocal(x, y)) continue;

            const tHere = ctx.map[y][x];
            if (tHere !== ctx.TILES.FLOOR && tHere !== ctx.TILES.ROAD) continue;

            const sx = x + seaDX;
            const sy = y + seaDY;
            const lx = x + landDX;
            const ly = y + landDY;
            if (sx <= 0 || sy <= 0 || sx >= W - 1 || sy >= H - 1) continue;
            if (lx <= 0 || ly <= 0 || lx >= W - 1 || ly >= H - 1) continue;

            const seaTile = ctx.map[sy][sx];
            const landTile = ctx.map[ly][lx];

            // Only convert if this floor tile has water on the sea side and solid land
            // on the land side; that means it's a \"wall\" hugging the water, not a pier.
            if (seaTile === WATER && landTile !== WATER) {
              ctx.map[y][x] = WATER;
            }
          }
        }
      }

      // Second cleanup: remove stray non-pier floor tiles that are almost surrounded
      // by water inside the harbor band (3+ cardinal water neighbours). These tend to
      // form thin causeways or pillars in the middle of the harbor.
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          if (!harborMask[y][x]) continue;
          if (pierMask[y][x]) continue;
          if (insideAnyBuildingLocal(x, y)) continue;
          const tHere = ctx.map[y][x];
          if (tHere !== ctx.TILES.FLOOR && tHere !== ctx.TILES.ROAD) continue;

          let waterNeighbors = 0;
          if (ctx.map[y - 1][x] === WATER) waterNeighbors++;
          if (ctx.map[y + 1][x] === WATER) waterNeighbors++;
          if (ctx.map[y][x - 1] === WATER) waterNeighbors++;
          if (ctx.map[y][x + 1] === WATER) waterNeighbors++;

          if (waterNeighbors >= 3) {
            ctx.map[y][x] = WATER;
          }
        }
      }
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

/**
 * Stamp a boat prefab on top of harbor water, converting selected water tiles
 * into bright ship deck and placing ship props (rails/masts/hatch).
 *
 * This is intentionally separate from the generic building prefab stamper:
 * - It allows stamping directly on water instead of FLOOR/ROAD.
 * - It uses SHIP_DECK tiles and ship_* props instead of WALL/FLOOR/etc.
 *
 * Preconditions:
 * - prefab.tiles is a size.w × size.h grid using codes:
 *   - "WATER"      -> leave underlying tile as-is (typically HARBOR_WATER)
 *   - "SHIP_DECK"  -> convert to deck tile
 *   - "SHIP_RAIL"  -> deck tile + ship_rail prop
 *   - "MAST"       -> deck tile + mast prop
 *   - "SHIP_HATCH" -> deck tile + ship_hatch prop
 */
function _stampBoatPrefabOnWater(ctx, prefab, bx, by, W, H, harborMask, waterTile) {
  if (!ctx || !prefab || !prefab.size || !Array.isArray(prefab.tiles)) return false;
  const w = prefab.size.w | 0;
  const h = prefab.size.h | 0;
  if (!w || !h) return false;

  const x0 = bx | 0;
  const y0 = by | 0;
  const x1 = x0 + w - 1;
  const y1 = y0 + h - 1;
  if (x0 <= 0 || y0 <= 0 || x1 >= W - 1 || y1 >= H - 1) return false;

  // Validate row shapes
  for (let yy = 0; yy < h; yy++) {
    const row = prefab.tiles[yy];
    if (!row || row.length !== w) return false;
  }

  // Resolve ship deck tile id (fallback to FLOOR if lookup fails).
  let DECK = ctx.TILES.FLOOR;
  try {
    const td = getTileDefByKey("town", "SHIP_DECK") || null;
    if (td && typeof td.id === "number") {
      DECK = td.id | 0;
    }
  } catch (_) {}

  // Ensure boat mask exists and matches map dims.
  try {
    const ok =
      Array.isArray(ctx.townBoatMask) &&
      ctx.townBoatMask.length === H &&
      H > 0 &&
      Array.isArray(ctx.townBoatMask[0]) &&
      ctx.townBoatMask[0].length === W;
    if (!ok) {
      ctx.townBoatMask = Array.from({ length: H }, () => Array(W).fill(false));
    }
  } catch (_) {
    ctx.townBoatMask = Array.from({ length: H }, () => Array(W).fill(false));
  }
  const boatMask = ctx.townBoatMask;

  // Ensure props container.
  try {
    if (!Array.isArray(ctx.townProps)) ctx.townProps = [];
  } catch (_) {}

  // First pass: validate that all non-WATER codes sit on harbor water inside the mask.
  for (let yy = 0; yy < h; yy++) {
    const row = prefab.tiles[yy];
    for (let xx = 0; xx < w; xx++) {
      const codeRaw = row[xx];
      const code = codeRaw ? String(codeRaw).toUpperCase() : "";
      if (!code || code === "WATER") continue;
      const tx = x0 + xx;
      const ty = y0 + yy;
      if (tx <= 0 || ty <= 0 || tx >= W - 1 || ty >= H - 1) return false;
      if (harborMask && (!harborMask[ty] || !harborMask[ty][tx])) return false;
      const t = ctx.map[ty][tx];
      if (t !== waterTile) return false;
    }
  }

  // Second pass: apply deck tiles and props.
  for (let yy = 0; yy < h; yy++) {
    const row = prefab.tiles[yy];
    for (let xx = 0; xx < w; xx++) {
      const codeRaw = row[xx];
      const code = codeRaw ? String(codeRaw).toUpperCase() : "";
      const tx = x0 + xx;
      const ty = y0 + yy;

      if (!code || code === "WATER") {
        continue; // leave underlying water
      }

      // All ship cells get deck tile + boat mask.
      ctx.map[ty][tx] = DECK;
      boatMask[ty][tx] = true;

      // Only one prop per cell; skip if something already exists here.
      let hasProp = false;
      if (Array.isArray(ctx.townProps)) {
        for (let i = 0; i < ctx.townProps.length; i++) {
          const p = ctx.townProps[i];
          if (p && p.x === tx && p.y === ty) {
            hasProp = true;
            break;
          }
        }
      }
      if (hasProp) continue;

      if (code === "SHIP_RAIL") {
        ctx.townProps.push({ x: tx, y: ty, type: "ship_rail", name: null });
      } else if (code === "MAST") {
        ctx.townProps.push({ x: tx, y: ty, type: "mast", name: null });
      } else if (code === "SHIP_HATCH") {
        ctx.townProps.push({ x: tx, y: ty, type: "ship_hatch", name: null });
      }
    }
  }

  // Record boat metadata for potential AI/interior use.
  try {
    const id = prefab && prefab.id ? String(prefab.id) : null;
    if (id) {
      if (!Array.isArray(ctx.townBoats)) ctx.townBoats = [];
      ctx.townBoats.push({
        id,
        x: x0,
        y: y0,
        w,
        h,
        orientation: prefab.orientation || null
      });
    }
  } catch (_) {}

  return true;
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