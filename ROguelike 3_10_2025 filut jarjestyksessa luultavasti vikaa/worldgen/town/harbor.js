import { getGameData } from "../../utils/access.js";
import { getTileDefByKey } from "../../data/tile_lookup.js";

/**
 * Harbor helpers for port towns.
 *
 * This module is being refactored into two stages for ports:
 *   1) prepareHarborZone(ctx, W, H, gate)    -> ground, shoreline, water masks
 *   2) placeHarborPrefabs(...)               -> piers, boats, props, warehouses
 *
 * Non-port towns do not use these helpers and retain the existing town pipeline.
 */

/**
 * Pre-calc harbor ground/water layout for a port town.
 *
 * Responsibilities:
 * - Respect ctx.townHarborMask / ctx.townHarborDir.
 * - Build a 4-tile gate bridge corridor when harbor side == gate side.
 * - Carve harbor water inside the harbor band before buildings are stamped.
 * - Derive:
 *   - ctx.townGateBridgeMask    : 4-wide bridge from gate into town (optional).
 *   - ctx.townHarborZoneMask    : alias for harbor band.
 *   - ctx.townHarborWaterMask   : where harbor water actually lives inside band.
 *   - ctx.townShoreMask         : shoreline band (harbor band minus water).
 */
export function prepareHarborZone(ctx, W, H, gate) {
  if (!ctx || ctx.townKind !== "port") return;
  const harborMask = Array.isArray(ctx.townHarborMask) ? ctx.townHarborMask : null;
  const harborDir = typeof ctx.townHarborDir === "string" ? ctx.townHarborDir : "";
  if (!harborMask || !harborDir) return;

  const GD = getGameData(ctx);

  // 1) Compute a gate-side bridge mask if harbor side == gate side.
  let gateBridgeMask = null;
  try {
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
  } catch (_) {
    gateBridgeMask = null;
  }

  // 2) Carve harbor water inside harbor band, respecting gate bridge.
  let WATER = null;
  try {
    const td = getTileDefByKey("town", "HARBOR_WATER") || null;
    if (td && typeof td.id === "number") WATER = td.id | 0;
  } catch (_) {}
  if (WATER == null) return;

  let waterDepth = 8;
  let bandDepthCfg = null;
  try {
    const TOWNCFG = GD && GD.town;
    const harborCfg = TOWNCFG && TOWNCFG.kinds && TOWNCFG.kinds.port && TOWNCFG.kinds.port.harbor;
    if (harborCfg) {
      if (typeof harborCfg.waterDepth === "number") waterDepth = harborCfg.waterDepth | 0;
      if (typeof harborCfg.bandDepth === "number") bandDepthCfg = harborCfg.bandDepth | 0;
    }
  } catch (_) {}

  const dimCap = Math.min(60, Math.max(4, Math.min(W, H) - 4)) || 16;
  let maxDepth = dimCap;
  if (bandDepthCfg && bandDepthCfg > 4) {
    maxDepth = Math.min(maxDepth, bandDepthCfg - 3);
  }
  maxDepth = Math.max(2, maxDepth);
  waterDepth = Math.max(2, Math.min(waterDepth, maxDepth));

  // Carve water strip along harbor edge within harbor band. We ignore buildings here
  // because this runs before the main house layout.
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
        const t = ctx.map[yy][x];
        if (t === ctx.TILES.FLOOR || t === ctx.TILES.ROAD) {
          ctx.map[yy][x] = WATER;
        }
      }
    }
  }

  // 3) Derive masks: harbor zone, harbor water, shoreline.
  const harborZoneMask = Array.from({ length: H }, () => Array(W).fill(false));
  const harborWaterMask = Array.from({ length: H }, () => Array(W).fill(false));
  const shoreMask = Array.from({ length: H }, () => Array(W).fill(false));

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!harborMask[y][x]) continue;
      harborZoneMask[y][x] = true;
      const isBridge = gateBridgeMask && gateBridgeMask[y] && gateBridgeMask[y][x];
      const isWater = ctx.map[y][x] === WATER;
      if (isBridge) {
        // Gate bridge is always shore/ground.
        shoreMask[y][x] = true;
        harborWaterMask[y][x] = false;
      } else if (isWater) {
        harborWaterMask[y][x] = true;
      } else {
        shoreMask[y][x] = true;
      }
    }
  }

  ctx.townHarborZoneMask = harborZoneMask;
  ctx.townHarborWaterMask = harborWaterMask;
  ctx.townShoreMask = shoreMask;
}

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

      // Boat placement: attempt to place at least one wooden boat in every harbor
      // that has enough water area to fit a prefab. Boats are aligned parallel to
      // piers: horizontal hulls for W/E harbors, vertical hulls for N/S harbors.
      (function placeHarborBoats() {
        try {
          if (!PFB || !Array.isArray(PFB.boats) || !PFB.boats.length) return;

          // Select boats compatible with harbor orientation:
          // - W/E harbors: "parallel" (horizontal) boats.
          // - N/S harbors: "vertical" boats.
          const boats = PFB.boats.filter(b => {
            if (!b || !b.size || !Array.isArray(b.tiles)) return false;
            if (String(b.category || "").toLowerCase() !== "boat") return false;
            const ori = String(b.orientation || "parallel").toLowerCase();
            if (harborDir === "W" || harborDir === "E") {
              // Accept generic/parallel boats.
              return ori === "parallel" || ori === "" || ori === "horizontal";
            }
            if (harborDir === "N" || harborDir === "S") {
              return ori === "vertical";
            }
            return false;
          });
          if (!boats.length) return;

          const slots = [];
          const relaxedSlots = [];

          function boatFitsAtCore(pref, bx, by, requirePierAdjacency) {
            const w = pref.size.w | 0;
            const h = pref.size.h | 0;
            if (!w || !h) return false;

            const x0 = bx | 0;
            const y0 = by | 0;
            const x1 = x0 + w - 1;
            const y1 = y0 + h - 1;
            if (x0 <= 0 || y0 <= 0 || x1 >= W - 1 || y1 >= H - 1) return false;

            // Avoid overlapping existing buildings.
            if (_rectOverlapsAny(buildings, x0, y0, w, h)) return false;

            // Validate that all non-WATER codes sit on harbor water inside the harbor band.
            for (let yy = 0; yy < h; yy++) {
              const row = pref.tiles[yy];
              if (!row || row.length !== w) return false;
              for (let xx = 0; xx < w; xx++) {
                const raw = row[xx];
                const code = raw ? String(raw).toUpperCase() : "";
                if (!code || code === "WATER") continue;
                const tx = x0 + xx;
                const ty = y0 + yy;
                if (!harborMask[ty] || !harborMask[ty][tx]) return false;
                if (ctx.map[ty][tx] !== WATER) return false;
              }
            }

            if (!requirePierAdjacency) return true;

            // Require adjacency to a pier along the side parallel to the hull.
            let touchesPier = false;
            if (harborDir === "W" || harborDir === "E") {
              // Horizontal hull: pier must touch along top or bottom edge.
              const yTop = y0 - 1;
              const yBottom = y1 + 1;
              for (let tx = x0; tx <= x1; tx++) {
                if (yTop > 0 && pierMask[yTop] && pierMask[yTop][tx]) { touchesPier = true; break; }
                if (yBottom < H - 1 && pierMask[yBottom] && pierMask[yBottom][tx]) { touchesPier = true; break; }
              }
            } else if (harborDir === "N" || harborDir === "S") {
              // Vertical hull: pier must touch along left or right edge.
              const xLeft = x0 - 1;
              const xRight = x1 + 1;
              for (let ty = y0; ty <= y1; ty++) {
                if (xLeft > 0 && pierMask[ty] && pierMask[ty][xLeft]) { touchesPier = true; break; }
                if (xRight < W - 1 && pierMask[ty] && pierMask[ty][xRight]) { touchesPier = true; break; }
              }
            }

            if (!touchesPier) return false;
            return true;
          }

          function boatFitsAt(pref, bx, by) {
            return boatFitsAtCore(pref, bx, by, true);
          }
          function boatFitsAtRelaxed(pref, bx, by) {
            return boatFitsAtCore(pref, bx, by, false);
          }

          for (let i = 0; i < boats.length; i++) {
            const pref = boats[i];
            const w = pref.size.w | 0;
            const h = pref.size.h | 0;
            if (!w || !h) continue;
            for (let by = 1; by <= H - 1 - h; by++) {
              for (let bx = 1; bx <= W - 1 - w; bx++) {
                if (boatFitsAt(pref, bx, by)) {
                  slots.push({ x: bx, y: by, prefab: pref });
                } else if (boatFitsAtRelaxed(pref, bx, by)) {
                  // Keep as a fallback: boat fits water+band, but not directly against a pier.
                  relaxedSlots.push({ x: bx, y: by, prefab: pref });
                }
              }
            }
          }

          // Prefer boats moored directly against piers; if none fit, fall back to any
          // valid water rectangle inside the harbor band so that at least one boat
          // spawns when geometry allows it.
          let candidates = slots.length ? slots : relaxedSlots;
          if (!candidates.length) return;

          // Always place exactly one boat per harbor when there is a valid slot.
          const pickIdx = Math.floor((rng ? rng() : Math.random()) * candidates.length) % candidates.length;
          const slot = candidates[pickIdx];
          _stampBoatPrefabOnWater(ctx, slot.prefab, slot.x, slot.y, W, H, harborMask, WATER);
        } catch (_) {
          // Harbor generation should never fail if boat placement has issues.
        }
      })();

      // Ensure that at least one boat (if present) is reachable from the town gate
      // by carving a minimal pier corridor through harbor water (never through
      // buildings). This avoids cases where boats are visually present but blocked
      // behind water and walls.
      (function ensureHarborBoatAccess() {
        try {
          const boatMask = ctx.townBoatMask;
          if (!boatMask) return;
          const gx = gate && typeof gate.x === "number" ? (gate.x | 0) : null;
          const gy = gate && typeof gate.y === "number" ? (gate.y | 0) : null;
          if (gx == null || gy == null) return;

          const rows = H, cols = W;
          const inBoundsLocal = (x, y) => x > 0 && y > 0 && x < cols - 1 && y < rows - 1;
          const dirs4 = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];

          const visited = Array.from({ length: rows }, () => Array(cols).fill(false));
          const prev = Array.from({ length: rows }, () => Array(cols).fill(null));
          const q = [];
          q.push({ x: gx, y: gy });
          visited[gy][gx] = true;

          let target = null;

          while (q.length) {
            const cur = q.shift();
            if (boatMask[cur.y] && boatMask[cur.y][cur.x]) {
              target = cur;
              break;
            }
            for (let i = 0; i < dirs4.length; i++) {
              const nx = cur.x + dirs4[i].dx;
              const ny = cur.y + dirs4[i].dy;
              if (!inBoundsLocal(nx, ny)) continue;
              if (visited[ny][nx]) continue;
              const tile = ctx.map[ny][nx];
              // Block hard walls and windows; we do not carve through buildings.
              if (tile === ctx.TILES.WALL || tile === ctx.TILES.WINDOW) continue;

              const inHarborBand = harborMask[ny] && harborMask[ny][nx];
              const isWaterHere = tile === WATER && inHarborBand;
              const isBoatDeck = boatMask[ny] && boatMask[ny][nx];

              const isWalkableStatic =
                tile === ctx.TILES.FLOOR ||
                tile === ctx.TILES.ROAD ||
                tile === ctx.TILES.DOOR ||
                tile === PIER ||
                isBoatDeck;

              if (!isWalkableStatic && !isWaterHere) continue;

              visited[ny][nx] = true;
              prev[ny][nx] = { x: cur.x, y: cur.y };
              q.push({ x: nx, y: ny });
            }
          }

          if (!target) return;

          // Reconstruct path and convert any harbor water along it into pier tiles.
          let cx = target.x;
          let cy = target.y;
          while (!(cx === gx && cy === gy)) {
            const p = prev[cy][cx];
            if (!p) break;
            const t = ctx.map[cy][cx];
            if (t === WATER && harborMask[cy] && harborMask[cy][cx]) {
              ctx.map[cy][cx] = PIER;
              pierMask[cy][cx] = true;
            }
            cx = p.x;
            cy = p.y;
          }
        } catch (_) {
          // Access fix is best-effort; never break harbor generation.
        }
      })();
    }

    // Simple dock props: reuse existing props (CRATE/BARREL/LAMP) along the harbor edge.
      function placeDockProps() {
        const bandCoords = [];
        for (let y = 1; y < H - 1; y++) {
          for (let x = 1; x < W - 1; x++) {
            if (!harborMask[y][x]) continue;
            if (ctx.map[y][x] !== ctx.TILES.FLOOR) continue;
            // Avoid cluttering the gate bridge corridor with crates/barrels/lamps.
            if (gateBridgeMask && gateBridgeMask[y] && gateBridgeMask[y][x]) continue;
            bandCoords.push({ x, y });
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
      // Avoid using the gate bridge corridor as a warehouse anchor so the 4-wide
      // approach from the gate remains visually open.
      const bandCells = [];
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          if (!harborMask[y][x]) continue;
          // Inset: require at least one tile from outer map border
          if (x <= 1 || y <= 1 || x >= W - 2 || y >= H - 2) continue;
          if (gateBridgeMask && gateBridgeMask[y] && gateBridgeMask[y][x]) continue;
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
    // Allow dock props on generic outdoor ground, roads, and harbor piers/ship decks.
    if (
      t !== ctx.TILES.FLOOR &&
      t !== ctx.TILES.ROAD &&
      t !== ctx.TILES.PIER &&
      t !== ctx.TILES.SHIP_DECK
    ) {
      return false;
    }
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