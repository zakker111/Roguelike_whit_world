import { propTypeFromCode, rectMostlyInHarborMask, rectOverlapsAny } from "./harbor_util.js";

/**
 * Add simple dock props (CRATE/BARREL/LAMP) along the harbor edge on floor tiles.
 * Avoids the gate bridge corridor so the 4-wide approach stays visually clear.
 */
export function placeDockPropsForHarbor(ctx, W, H, harborMask, harborDir, gateBridgeMask, rng) {
  if (!ctx || !Array.isArray(ctx.map) || !harborMask) return;

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

  // Thin sampling of edge tiles for simple dock accents.
  for (let i = 0; i < edgeCoords.length; i++) {
    const c = edgeCoords[i];
    const r = rng ? rng() : Math.random();
    if (r < 0.15) {
      safeAddProp(ctx, W, H, c.x, c.y, "CRATE");
    } else if (r < 0.30) {
      safeAddProp(ctx, W, H, c.x, c.y, "BARREL");
    } else if (r < 0.36) {
      // Occasional lamp near docks.
      safeAddProp(ctx, W, H, c.x, c.y, "LAMP");
    }
  }
}

/**
 * Harbor warehouses: pick small house prefabs and place them just inside the harbor band,
 * away from the outermost row/column but still clearly "at the harbor".
 *
 * Mutates buildings and stamps prefabs via the provided stamp functions.
 */
export function placeHarborWarehousesForHarbor(ctx, buildings, W, H, harborMask, gateBridgeMask, rng, PFB, stampPrefab, trySlipStamp) {
  if (!ctx || !Array.isArray(buildings) || !harborMask) return;
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
      // Inset: require at least one tile from outer map border.
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

    // Ensure footprint stays mostly inside harbor band.
    if (!rectMostlyInHarborMask(harborMask, bx, by, bw, bh, W, H)) continue;
    // Do not collide with existing buildings.
    if (rectOverlapsAny(buildings, bx, by, bw, bh)) continue;

    // Ensure we are not stamping on water or other non-floor tiles.
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

    // Mark this building rect as harbor-tagged for AI and metadata.
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

/**
 * Internal helper: add a dock/harbor prop on a walkable ground tile.
 */
function safeAddProp(ctx, W, H, x, y, code) {
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
    ctx.townProps.push({ x, y, type: propTypeFromCode(code), name: null });
    return true;
  } catch (_) {}
  return false;
}