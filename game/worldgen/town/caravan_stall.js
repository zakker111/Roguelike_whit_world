import { getGameData } from "../../utils/access.js";
import * as Prefabs from "../prefabs.js";

/**
 * Open-air caravan stall near the plaza when a caravan is parked at this town.
 * Extracted from the IIFE at the end of town_gen.generate; behaviour unchanged.
 *
 * ctx: town context
 * W,H: map dimensions
 * info: overworld town info (for world coords)
 */
export function placeCaravanStallIfCaravanPresent(ctx, W, H, info) {
  try {
    const world = ctx.world;
    if (!world || !Array.isArray(world.caravans) || !world.caravans.length) return;

    // Determine this town's world coordinates.
    let townWX = null, townWY = null;
    try {
      if (info && typeof info.x === "number" && typeof info.y === "number") {
        townWX = info.x | 0;
        townWY = info.y | 0;
      } else if (ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number" && typeof ctx.worldReturnPos.y === "number") {
        townWX = ctx.worldReturnPos.x | 0;
        townWY = ctx.worldReturnPos.y | 0;
      }
    } catch (_) {}
    if (townWX == null || townWY == null) return;

    const caravans = world.caravans;
    const parked = caravans.find(function (cv) {
      return cv && cv.atTown && (cv.x | 0) === townWX && (cv.y | 0) === townWY;
    });
    if (!parked) return;

    const GDp = getGameData(ctx);
    const PFB = (GDp && GDp.prefabs) ? GDp.prefabs : null;
    const caravanPrefabs = (PFB && Array.isArray(PFB.caravans)) ? PFB.caravans : null;
    if (!caravanPrefabs || !caravanPrefabs.length) return;

    // Use the first caravan prefab for now.
    const pref = caravanPrefabs[0];
    if (!pref || !pref.size || !Array.isArray(pref.tiles)) return;
    const pw = pref.size.w | 0;
    const ph = pref.size.h | 0;
    if (pw <= 0 || ph <= 0) return;

    // Need plaza rect to anchor around.
    const pr = ctx.townPlazaRect;
    if (!pr || typeof pr.x0 !== "number" || typeof pr.y0 !== "number" || typeof pr.x1 !== "number" || typeof pr.y1 !== "number") return;
    const px0 = pr.x0, px1 = pr.x1, py0 = pr.y0, py1 = pr.y1;
    const plazaCX = ctx.townPlaza ? ctx.townPlaza.x : (((px0 + px1) / 2) | 0);
    const plazaCY = ctx.townPlaza ? ctx.townPlaza.y : (((py0 + py1) / 2) | 0);

    // Helper: check if prefab could fit at (x0,y0) based on tiles and gate position.
    function canPlaceAt(x0, y0) {
      if (x0 <= 0 || y0 <= 0 || x0 + pw - 1 >= W - 1 || y0 + ph - 1 >= H - 1) return false;
      const gate = ctx.townExitAt || null;
      const gx = gate && typeof gate.x === "number" ? gate.x : null;
      const gy = gate && typeof gate.y === "number" ? gate.y : null;
      for (let yy = 0; yy < ph; yy++) {
        const wy = y0 + yy;
        for (let xx = 0; xx < pw; xx++) {
          const wx = x0 + xx;
          const t = ctx.map[wy][wx];
          if (t !== ctx.TILES.FLOOR && t !== ctx.TILES.ROAD) return false;
          if (gx != null && gy != null && wx === gx && wy === gy) return false;
        }
      }
      return true;
    }

    // Candidate top-left anchors just outside each side of plaza.
    const anchors = [];
    // Below plaza
    anchors.push({
      x: Math.max(1, Math.min(W - pw - 2, (plazaCX - ((pw / 2) | 0)))),
      y: Math.min(H - ph - 2, py1 + 2)
    });
    // Above plaza
    anchors.push({
      x: Math.max(1, Math.min(W - pw - 2, (plazaCX - ((pw / 2) | 0)))),
      y: Math.max(1, py0 - ph - 2)
    });
    // Left of plaza
    anchors.push({
      x: Math.max(1, px0 - pw - 2),
      y: Math.max(1, Math.min(H - ph - 2, (plazaCY - ((ph / 2) | 0))))
    });
    // Right of plaza
    anchors.push({
      x: Math.min(W - pw - 2, px1 + 2),
      y: Math.max(1, Math.min(H - ph - 2, (plazaCY - ((ph / 2) | 0))))
    });

    let rect = null;
    // First pass: try preferred anchors around the plaza.
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      if (!canPlaceAt(a.x, a.y)) continue;
      const res = Prefabs.stampPrefab(ctx, pref, a.x, a.y, null);
      if (res && res.ok && res.rect) {
        rect = res.rect;
        break;
      }
    }

    // Fallback: search the town for any suitable floor/road rectangle if anchors are blocked.
    if (!rect) {
      const candidates = [];
      const gate = ctx.townExitAt || null;
      const gx = gate && typeof gate.x === "number" ? gate.x : null;
      const gy = gate && typeof gate.y === "number" ? gate.y : null;

      for (let y0 = 1; y0 <= H - ph - 2; y0++) {
        for (let x0 = 1; x0 <= W - pw - 2; x0++) {
          if (!canPlaceAt(x0, y0)) continue;
          // Avoid placing stall directly on top of the gate even if canPlaceAt allowed it
          if (gx != null && gy != null &&
              gx >= x0 && gx <= x0 + pw - 1 &&
              gy >= y0 && gy <= y0 + ph - 1) {
            continue;
          }
          const cx = x0 + ((pw / 2) | 0);
          const cy = y0 + ((ph / 2) | 0);
          const score = Math.abs(cx - plazaCX) + Math.abs(cy - plazaCY);
          candidates.push({ x: x0, y: y0, score });
        }
      }

      if (candidates.length) {
        candidates.sort(function (a, b) {
          if (a.score !== b.score) return a.score - b.score;
          if (a.y !== b.y) return a.y - b.y;
          return a.x - b.x;
        });
        const best = candidates[0];
        const res = Prefabs.stampPrefab(ctx, pref, best.x, best.y, null);
        if (res && res.ok && res.rect) rect = res.rect;
      }
    }

    if (!rect) return;

    // Upgrade any sign inside the caravan prefab area to say "Caravan" and ensure only one remains.
    try {
      if (Array.isArray(ctx.townProps) && ctx.townProps.length) {
        const x0 = rect.x, y0 = rect.y, x1 = rect.x + rect.w - 1, y1 = rect.y + rect.h - 1;
        const signIdx = [];
        for (let i = 0; i < ctx.townProps.length; i++) {
          const p = ctx.townProps[i];
          if (!p) continue;
          if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && String(p.type || "").toLowerCase() === "sign") {
            signIdx.push(i);
          }
        }
        if (signIdx.length) {
          const keepIdx = signIdx[0];
          const keep = ctx.townProps[keepIdx];
          if (keep) keep.name = "Caravan";
          if (signIdx.length > 1) {
            const removeSet = new Set(signIdx.slice(1));
            ctx.townProps = ctx.townProps.filter(function (p, idx) {
              return !removeSet.has(idx);
            });
          }
        }
      }
    } catch (_) {}

    // Create a caravan shop at a reasonable tile inside the prefab.
    // Prefer a stall prop tile inside the rect; otherwise center of rect.
    let stallX = null, stallY = null;
    try {
      if (Array.isArray(ctx.townProps) && ctx.townProps.length) {
        const x0 = rect.x, y0 = rect.y, x1 = rect.x + rect.w - 1, y1 = rect.y + rect.h - 1;
        for (let i = 0; i < ctx.townProps.length; i++) {
          const p = ctx.townProps[i];
          if (!p) continue;
          if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && String(p.type || "").toLowerCase() === "stall") {
            stallX = p.x;
            stallY = p.y;
            break;
          }
        }
      }
    } catch (_) {}
    const sx = (stallX != null ? stallX : (rect.x + ((rect.w / 2) | 0)));
    const sy = (stallY != null ? stallY : (rect.y + ((rect.h / 2) | 0)));

    // Shop entry: open-air caravan shop, always open while you are in town.
    const shop = {
      x: sx,
      y: sy,
      type: "caravan",
      name: "Travelling Caravan",
      openMin: 0,
      closeMin: 0,
      alwaysOpen: true,
      signWanted: false,
      building: null,
      inside: { x: sx, y: sy }
    };
    ctx.shops.push(shop);
  } catch (_) {}
}