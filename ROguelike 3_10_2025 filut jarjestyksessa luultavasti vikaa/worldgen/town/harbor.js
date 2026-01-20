import { getGameData } from "../../utils/access.js";
import { prepareHarborZone } from "./harbor_zone.js";
import { placeDockPropsForHarbor, placeHarborWarehousesForHarbor } from "./harbor_props.js";
import { carveHarborWaterAndPiersForPort } from "./harbor_piers.js";

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

    // Carve harbor water (fallback if needed) + piers, then place boats and
    // ensure at least one has access from the gate.
    carveHarborWaterAndPiersForPort(ctx, buildings, W, H, harborMask, harborDir, gateBridgeMask, gate, rng, PFB);
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



