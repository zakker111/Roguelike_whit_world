import { getGameData } from "../../utils/access.js";
import { getTileDefByKey } from "../../data/tile_lookup.js";
import { prepareHarborZone } from "./harbor_zone.js";
import { placeHarborBoatsAndEnsureAccess } from "./harbor_boats.js";
import { placeDockPropsForHarbor, placeHarborWarehousesForHarbor } from "./harbor_props.js";

// Re-export prepareHarborZone so callers can continue to import it from this module.
export { prepareHarborZone };

/**
 * Harbor helpers for port towns.
 *
 * This module is being refactored into two stages for ports:
 *   1) prepareHarborZone(ctx, W, H, gate)    -> ground, shoreline, water masks
 *   2) placeHarborPrefabs(...)               -> piers, boats, props, warehouses
 *
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

    // Gate-aligned bridge corridor: reuse precomputed mask when available,
    // otherwise compute a local one for backward-compatibility.
    let gateBridgeMask = ctx.townGateBridgeMask || null;
    try {
      if (!gateBridgeMask) {
        const gx = gate && typeof gate.x === "number" ? (gate.x | 0) : null;
        const gy = gate && typeof gate.y === "number" ? (gate.y | 0) : null;
        if (gx != null && gy != null) {
          let gateSide = "";
          if (gy === 1) gateSide = "N";
          else if (gy === H - 2) gateSide = "S";
          else if (gx === 1) gateSide = "W";
          else if (gx === W - 2) gateSide = "E";

          if (gateSide && gateSide === harborDir) {
            const rows = H, cols = W;
            const mask = Array.from({ length: rows }, () => Array(cols).fill(false));
            const depthMax = Math.max(4, Math.min(8, Math.floor(Math.min(W, H) / 3)));

            if (gateSide === "S") {
              let x0 = gx - 1;
              let x1 = gx + 2;
              if (x0 < 1) x0 = 1;
              if (x1 > W - 2) x1 = W - 2;
              const yEnd = gy;
              const depth = Math.min(depthMax, Math.max(1, yEnd - 1));
              const yStart = Math.max(1, yEnd - depth + 1);
              for (let y = yStart; y <= yEnd; y++) {
                for (let x = x0; x <= x1; x++) {
                  mask[y][x] = true;
                }
              }
            } else if (gateSide === "N") {
              let x0 = gx - 1;
              let x1 = gx + 2;
              if (x0 < 1) x0 = 1;
              if (x1 > W - 2) x1 = W - 2;
              const yStart = gy;
              const depth = Math.min(depthMax, Math.max(1, (H - 2) - yStart));
              const yEnd = Math.min(H - 2, yStart + depth - 1);
              for (let y = yStart; y <= yEnd; y++) {
                for (let x = x0; x <= x1; x++) {
                  mask[y][x] = true;
                }
              }
            } else if (gateSide === "E") {
              let y0 = gy - 1;
              let y1 = gy + 2;
              if (y0 < 1) y0 = 1;
              if (y1 > H - 2) y1 = H - 2;
              const xEnd = gx;
              const depth = Math.min(depthMax, Math.max(1, xEnd - 1));
              const xStart = Math.max(1, xEnd - depth + 1);
              for (let y = y0; y <= y1; y++) {
                for (let x = xStart; x <= xEnd; x++) {
                  mask[y][x] = true;
                }
              }
            } else if (gateSide === "W") {
              let y0 = gy - 1;
              let y1 = gy + 2;
              if (y0 < 1) y0 = 1;
              if (y1 > H - 2) y1 = H - 2;
              const xStart = gx;
              const depth = Math.min(depthMax, Math.max(1, (W - 2) - xStart));
              const xEnd = Math.min(W - 2, xStart + depth - 1);
              for (let y = y0; y <= y1; y++) {
                for (let x = xStart; x <= xEnd; x++) {
                  mask[y][x] = true;
                }
              }
            }

            gateBridgeMask = mask;
            try { ctx.townGateBridgeMask = mask; } catch (_) {}
          }
        }
      }
    } catch (_) {
      gateBridgeMask = gateBridgeMask || null;
    }

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

    // Carve piers and boats into existing harbor water band. When prepareHarborZone()
    // has already run, harbor water has been carved up-front and ctx.townHarborWaterMask
    // tracks it. If not, this function falls back to carving a shallow water strip
    // for backward-compatibility (e.g., tests or tools that still call placeHarborPrefabs
    // without the newer pre-pass).
    function carveHarborWaterAndPiers() {
      let WATER = null;
      let PIER = ctx.TILES.FLOOR;
      try {
        const td = getTileDefByKey("town", "HARBOR_WATER") || null;
        if (td && typeof td.id === "number") WATER = td.id | 0;
      } catch (_) {}
      if (WATER == null) return;
      try {
        const tdPier = getTileDefByKey("town", "PIER") || null;
        if (tdPier && typeof tdPier.id === "number") PIER = tdPier.id | 0;
      } catch (_) {}

      // Water depth: derive from config for fallback water carving if needed.
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

      const dimCap = Math.min(60, Math.max(4, Math.min(W, H) - 4)) || 16;
      let maxDepth = dimCap;
      if (bandDepthCfg && bandDepthCfg > 4) {
        maxDepth = Math.min(maxDepth, bandDepthCfg - 3);
      }
      maxDepth = Math.max(2, maxDepth);
      waterDepth = Math.max(2, Math.min(waterDepth, maxDepth));

      // Prepare a pier mask so renderers can tint pier floor differently.
      const pierMask = Array.from({ length: H }, () => Array(W).fill(false));
      ctx.townPierMask = pierMask;

      const harborWaterMask = Array.isArray(ctx.townHarborWaterMask) ? ctx.townHarborWaterMask : null;
      const hasPrecarvedWater = !!(harborWaterMask && harborWaterMask.length === H);

      // If prepareHarborZone() has already carved water, we skip the old water strip
      // carving here and only look for existing harbor water. Otherwise, fall back
      // to carving a shallow strip as before.
      if (!hasPrecarvedWater) {
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
              if (gateBridgeMask && gateBridgeMask[y] && gateBridgeMask[y][xx]) continue;
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
              if (gateBridgeMask && gateBridgeMask[yy] && gateBridgeMask[yy][x]) continue;
              if (touchesAnyBuildingLocal(x, yy)) break;
              const t = ctx.map[yy][x];
              if (t === ctx.TILES.FLOOR || t === ctx.TILES.ROAD) {
                ctx.map[yy][x] = WATER;
              }
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
            // Do not treat gate-bridge tiles as pier roots; keep the 4-wide gate
            // corridor free of piers so the approach stays visually clean.
            if (gateBridgeMask && gateBridgeMask[ry] && gateBridgeMask[ry][rx]) continue;
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

        // Convert the root tile to pier deck so the shoreline section of the pier
        // is visually consistent and clearly brown.
        if (ctx.map[root.y][root.x] === ctx.TILES.FLOOR || ctx.map[root.y][root.x] === ctx.TILES.ROAD) {
          ctx.map[root.y][root.x] = PIER;
        }
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

          // Carve current water tile into pier deck.
          ctx.map[yy][xx] = PIER;
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
            ctx.map[sy][sx] = PIER;
            pierMask[sy][sx] = true;
          }
        }

        // Require that the pier actually extends into water.
        if (length === 0) continue;

        // Previously we sometimes placed a tiny one-glyph BOAT prop at the pier tip.
        // The harbor now uses proper multi-tile boat prefabs instead, so we skip
        // those decorative glyph boats entirely to avoid confusion and blocking.
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
            // Preserve the gate bridge corridor even if it looks like a wall-hugging
            // floor tile along the water edge.
            if (gateBridgeMask && gateBridgeMask[y] && gateBridgeMask[y][x]) continue;

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
          // Preserve the gate bridge corridor tiles even if they are surrounded by water.
          if (gateBridgeMask && gateBridgeMask[y] && gateBridgeMask[y][x]) continue;
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

      // Boat placement and access: attempt to place at least one wooden boat in
      // every harbor that has enough water area to fit a prefab, then carve a
      // minimal pier corridor from the gate to the nearest boat if needed.
      placeHarborBoatsAndEnsureAccess(ctx, buildings, harborMask, harborDir, pierMask, W, H, WATER, gate, rng, PFB);
    }

    carveHarborWaterAndPiers();
    placeDockPropsForHarbor(ctx, W, H, harborMask, harborDir, gateBridgeMask, rng);
    placeHarborWarehousesForHarbor(ctx, buildings, W, H, harborMask, gateBridgeMask, rng, PFB, stampPrefab, trySlipStamp);

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



