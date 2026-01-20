/**
 * Town sign & prop cleanup helpers
 * --------------------------------
 * Extracted from worldgen/town_gen.js with behaviour kept identical:
 * - dedupeShopSigns: per-shop signWanted handling, canonical naming, nearest-to-door selection.
 * - dedupeWelcomeSign: single welcome sign per town, closest to gate.
 * - cleanupDanglingProps: drops props on invalid tiles or outside buildings where not allowed.
 * - addSignNear / addShopSignInside: low-level helpers reused across town generation.
 */

/**
 * Low-level prop placement helper: add a prop if tile is in-bounds, walkable and unused.
 * Note: width/height are passed in so we do not need ctx.map[0].length checks here.
 */
export function addProp(ctx, W, H, x, y, type, name) {
  if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return false;
  if (ctx.map[y][x] !== ctx.TILES.FLOOR && ctx.map[y][x] !== ctx.TILES.ROAD) return false;
  if (Array.isArray(ctx.townProps) && ctx.townProps.some(p => p.x === x && p.y === y)) return false;
  ctx.townProps.push({ x, y, type, name });
  return true;
}

/**
 * Place a sign on any adjacent floor/road tile around (x,y) if free.
 */
export function addSignNear(ctx, W, H, x, y, text) {
  const dirs = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];
  for (const d of dirs) {
    const sx = x + d.dx;
    const sy = y + d.dy;
    if (sx <= 0 || sy <= 0 || sx >= W - 1 || sy >= H - 1) continue;
    if (ctx.map[sy][sx] !== ctx.TILES.FLOOR && ctx.map[sy][sx] !== ctx.TILES.ROAD) continue;
    if (ctx.townProps.some(p => p.x === sx && p.y === sy)) continue;
    addProp(ctx, W, H, sx, sy, "sign", text);
    return true;
  }
  return false;
}

/**
 * Place one shop sign inside the building, near the door if possible.
 * This is a direct extraction of the original addShopSignInside from town_gen.js.
 */
export function addShopSignInside(ctx, W, H, b, door, text) {
  function isInside(bld, x, y) {
    return x > bld.x && x < bld.x + bld.w - 1 && y > bld.y && y < bld.y + bld.h - 1;
  }
  // Candidate inside tiles: directly inward from the door, then a small interior search
  const candidates = [];
  const inward = [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
  for (let i = 0; i < inward.length; i++) {
    const ix = door.x + inward[i].dx;
    const iy = door.y + inward[i].dy;
    if (isInside(b, ix, iy)) candidates.push({ x: ix, y: iy });
  }
  // Interior search within radius 3 from the door but only inside the building
  for (let r = 1; r <= 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const ix = door.x + dx;
        const iy = door.y + dy;
        if (!isInside(b, ix, iy)) continue;
        candidates.push({ x: ix, y: iy });
      }
    }
  }
  // Fallback: building center if nothing else works
  candidates.push({
    x: Math.max(b.x + 1, Math.min(b.x + b.w - 2, (b.x + ((b.w / 2) | 0)))),
    y: Math.max(b.y + 1, Math.min(b.y + b.h - 2, (b.y + ((b.h / 2) | 0))))
  });

  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (c.x <= 0 || c.y <= 0 || c.x >= W - 1 || c.y >= H - 1) continue;
    if (!isInside(b, c.x, c.y)) continue;
    const t = ctx.map[c.y][c.x];
    if (t !== ctx.TILES.FLOOR) continue;
    if (ctx.player && ctx.player.x === c.x && ctx.player.y === c.y) continue;
    if (Array.isArray(ctx.npcs) && ctx.npcs.some(n => n.x === c.x && n.y === c.y)) continue;
    if (Array.isArray(ctx.townProps) && ctx.townProps.some(p => p.x === c.x && p.y === c.y)) continue;
    const d = Math.abs(c.x - door.x) + Math.abs(c.y - door.y);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  if (best) {
    addProp(ctx, W, H, best.x, best.y, "sign", text);
    return true;
  }
  return false;
}

/**
 * Dedupe shop signs: respect per-shop signWanted flag; keep only one sign (nearest to door)
 * and prefer placing it inside near the door.
 */
export function dedupeShopSigns(ctx, W, H) {
  try {
    if (!Array.isArray(ctx.shops) || !Array.isArray(ctx.townProps) || !ctx.townProps.length) return;
    const props = ctx.townProps;
    const removeIdx = new Set();
    function isInside(bld, x, y) {
      return bld && x > bld.x && x < bld.x + bld.w - 1 && y > bld.y && y < bld.y + bld.h - 1;
    }
    for (let si = 0; si < ctx.shops.length; si++) {
      const s = ctx.shops[si];
      if (!s) continue;
      const text = String(s.name || s.type || "Shop");
      const door = (s.building && s.building.door) ? s.building.door : { x: s.x, y: s.y };
      const namesToMatch = [text];
      // Inn synonyms: dedupe across common variants
      if (String(s.type || "").toLowerCase() === "inn") {
        if (!namesToMatch.includes("Inn")) namesToMatch.push("Inn");
        if (!namesToMatch.includes("Inn & Tavern")) namesToMatch.push("Inn & Tavern");
        if (!namesToMatch.includes("Tavern")) namesToMatch.push("Tavern");
      }
      // Collect indices of sign props that either match canonical name/synonyms
      // or are inside the shop building (unnamed embedded signs count as duplicates).
      const indices = [];
      for (let i = 0; i < props.length; i++) {
        const p = props[i];
        if (!p || String(p.type || "").toLowerCase() !== "sign") continue;
        const name = String(p.name || "");
        const insideThisShop = s.building ? isInside(s.building, p.x, p.y) : false;
        if (namesToMatch.includes(name) || insideThisShop) {
          indices.push(i);
        }
      }
      const wants = (s && Object.prototype.hasOwnProperty.call(s, "signWanted")) ? !!s.signWanted : true;

      if (!wants) {
        // Remove all signs for this shop (including synonyms)
        for (const idx of indices) removeIdx.add(idx);
        continue;
      }

      // If multiple signs exist, keep the one closest to the door
      if (indices.length > 1) {
        let keepI = indices[0];
        let bestD = Infinity;
        for (const idx of indices) {
          const p = props[idx];
          const d = Math.abs(p.x - door.x) + Math.abs(p.y - door.y);
          if (d < bestD) {
            bestD = d;
            keepI = idx;
          }
        }
        for (const idx of indices) {
          if (idx !== keepI) removeIdx.add(idx);
        }
      }

      // Ensure kept sign (if any) is outside; otherwise re-place inside near the door.
      // Also canonicalize its text to the shop's name.
      let keptIdx = -1;
      for (let i = 0; i < props.length; i++) {
        if (removeIdx.has(i)) continue;
        const p = props[i];
        if (!p || String(p.type || "").toLowerCase() !== "sign") continue;
        const name = String(p.name || "");
        const insideThisShop = s.building ? isInside(s.building, p.x, p.y) : false;
        if (namesToMatch.includes(name) || insideThisShop) {
          keptIdx = i;
          break;
        }
      }
      if (keptIdx !== -1) {
        const p = props[keptIdx];
        if (s.building && isInside(s.building, p.x, p.y)) {
          // Already inside: canonicalize name
          try { if (String(p.name || "") !== text) p.name = text; } catch (_) {}
        } else {
          // Move outside sign to inside near door
          removeIdx.add(keptIdx);
          try { addShopSignInside(ctx, W, H, s.building, door, text); } catch (_) {}
        }
      } else {
        // No sign exists; place one inside near the door
        try { if (s.building) addShopSignInside(ctx, W, H, s.building, door, text); } catch (_) {}
      }
    }

    if (removeIdx.size) {
      ctx.townProps = props.filter((_, i) => !removeIdx.has(i));
    }
  } catch (_) {}
}

/**
 * Dedupe welcome sign globally: keep only the one closest to the gate and ensure one exists.
 */
export function dedupeWelcomeSign(ctx, W, H) {
  try {
    if (!Array.isArray(ctx.townProps)) return;
    const isHarborTown = ctx && ctx.townKind === "port";
    const text = isHarborTown
      ? `Welcome to the harbor town of ${ctx.townName}`
      : `Welcome to ${ctx.townName}`;
    const props = ctx.townProps;
    let keepIdx = -1;
    let bestD = Infinity;
    const removeIdx = new Set();
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      if (p && String(p.type || "").toLowerCase() === "sign" && String(p.name || "") === text) {
        const d = Math.abs(p.x - ctx.townExitAt.x) + Math.abs(p.y - ctx.townExitAt.y);
        if (d < bestD) {
          bestD = d;
          keepIdx = i;
        }
        removeIdx.add(i);
      }
    }
    if (keepIdx !== -1) removeIdx.delete(keepIdx);
    if (removeIdx.size) {
      ctx.townProps = props.filter((_, i) => !removeIdx.has(i));
    }
    const hasWelcome = Array.isArray(ctx.townProps) &&
      ctx.townProps.some(p => p && String(p.type || "").toLowerCase() === "sign" && String(p.name || "") === text);
    if (!hasWelcome && ctx.townExitAt) {
      try { addSignNear(ctx, W, H, ctx.townExitAt.x, ctx.townExitAt.y, text); } catch (_) {}
    }
  } catch (_) {}
}

/**
 * Cleanup dangling props from removed buildings: ensure interior-only props are only inside valid buildings.
 */
export function cleanupDanglingProps(ctx, buildings) {
  try {
    if (!Array.isArray(ctx.townProps) || !ctx.townProps.length) return;
    function insideAnyBuilding(x, y) {
      for (let i = 0; i < buildings.length; i++) {
        const B = buildings[i];
        if (x > B.x && x < B.x + B.w - 1 && y > B.y && y < B.y + B.h - 1) return true;
      }
      return false;
    }
    // Props that should never exist outside a building interior
    const interiorOnly = new Set(["bed", "table", "chair", "shelf", "rug", "fireplace", "quest_board", "chest", "counter"]);
    ctx.townProps = ctx.townProps.filter(p => {
      const t = ctx.map[p.y][p.x];
      // Drop props that sit on non-walkable tiles
      if (t !== ctx.TILES.FLOOR && t !== ctx.TILES.STAIRS && t !== ctx.TILES.ROAD) return false;
      const inside = insideAnyBuilding(p.x, p.y);
      // Interior-only items: keep only if inside some building
      if (interiorOnly.has(String(p.type || "").toLowerCase())) return inside;
      // Signs: allow inside or outside; will be deduped per-shop elsewhere
      if (String(p.type || "").toLowerCase() === "sign") return true;
      // Other props (crates/barrels/plants/stall) are allowed anywhere if tile is walkable
      return true;
    });
  } catch (_) {}
}