import { getGameData } from "../../utils/access.js";
import * as Prefabs from "../prefabs.js";
import { findBuildingsOverlappingRect } from "./layout_core.js";

/**
 * Place shop prefabs near the plaza with conflict resolution.
 * Extracted from the placeShopPrefabsStrict IIFE in town_gen.js.
 *
 * - Uses GameData.prefabs.shops
 * - Places a few unique shop types around the plaza edges
 * - Resolves conflicts with existing buildings, never removing the tavern/inn building
 */
export function placeShopPrefabsStrict(ctx, buildings, plazaRect, W, H, rng, removeBuildingAndProps) {
  try {
    const GD6 = getGameData(ctx);
    const PFB = (GD6 && GD6.prefabs) ? GD6.prefabs : null;
    if (!PFB || !Array.isArray(PFB.shops) || !PFB.shops.length) return;
    const pr = plazaRect;
    if (!pr) return;
    const px0 = pr.x0, px1 = pr.x1, py0 = pr.y0, py1 = pr.y1;
    const sideCenterX = ((px0 + px1) / 2) | 0;
    const sideCenterY = ((py0 + py1) / 2) | 0;

    function stampWithResolution(pref, bx, by) {
      if (Prefabs.stampPrefab(ctx, pref, bx, by, buildings)) return true;
      // Try slip first
      if (Prefabs.trySlipStamp(ctx, pref, bx, by, 2, buildings)) return true;
      // If still blocked, remove an overlapping building and try once more,
      // but never remove the tavern/inn building.
      const overlaps = findBuildingsOverlappingRect(buildings, bx, by, pref.size.w, pref.size.h, 0);
      let toRemove = overlaps;
      try {
        if (ctx.tavern && ctx.tavern.building) {
          const tb = ctx.tavern.building;
          toRemove = overlaps.filter(b => !(b.x === tb.x && b.y === tb.y && b.w === tb.w && b.h === tb.h));
        }
      } catch (_) {}
      if (toRemove.length) {
        removeBuildingAndProps(toRemove[0]);
        if (Prefabs.stampPrefab(ctx, pref, bx, by, buildings)) return true;
        if (Prefabs.trySlipStamp(ctx, pref, bx, by, 2, buildings)) return true;
      }
      return false;
    }

    // Choose a few unique shop types based on town size
    const sizeKey = ctx.townSize || "big";
    let limit = sizeKey === "city" ? 6 : (sizeKey === "small" ? 3 : 4);
    const usedTypes = new Set();
    let sideIdx = 0;
    const sides = ["west", "east", "north", "south"];
    let attempts = 0;
    while (limit > 0 && attempts++ < 20) {
      // pick a prefab with a new type
      const candidates = PFB.shops.filter(p => {
        const t = (p.shop && p.shop.type) ? String(p.shop.type) : null;
        return !t || !usedTypes.has(t.toLowerCase());
      });
      if (!candidates.length) break;
      const pref = Prefabs.pickPrefab(candidates, ctx.rng || rng || Math.random);
      if (!pref || !pref.size) break;
      const tKey = (pref.shop && pref.shop.type) ? String(pref.shop.type).toLowerCase() : `shop_${attempts}`;
      // compute anchor by side
      const side = sides[sideIdx % sides.length]; sideIdx++;
      let bx = 1, by = 1;
      if (side === "west") {
        bx = Math.max(1, px0 - 3 - pref.size.w);
        by = Math.max(1, Math.min((H - pref.size.h - 2), sideCenterY - ((pref.size.h / 2) | 0)));
      } else if (side === "east") {
        bx = Math.min(W - pref.size.w - 2, px1 + 3);
        by = Math.max(1, Math.min((H - pref.size.h - 2), sideCenterY - ((pref.size.h / 2) | 0)));
      } else if (side === "north") {
        bx = Math.max(1, Math.min(W - pref.size.w - 2, sideCenterX - ((pref.size.w / 2) | 0)));
        by = Math.max(1, py0 - 3 - pref.size.h);
      } else {
        bx = Math.max(1, Math.min(W - pref.size.w - 2, sideCenterX - ((pref.size.w / 2) | 0)));
        by = Math.min(H - pref.size.h - 2, py1 + 3);
      }
      if (stampWithResolution(pref, bx, by)) {
        usedTypes.add(tKey);
        limit--;
      } else {
        try { if (ctx && typeof ctx.log === "function") ctx.log(`Strict prefabs: failed to stamp shop '${(pref.name ? pref.name : ((pref.shop && pref.shop.type) ? pref.shop.type : "shop"))}' at ${bx},${by}.`, "error"); } catch (_) {}
      }
    }
  } catch (_) {}
}