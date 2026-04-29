import { getGameData } from "../../utils/access.js";
import { getTileDefByKey } from "../../data/tile_lookup.js";

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