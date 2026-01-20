import { getTileDefByKey } from "../../data/tile_lookup.js";
import { rectOverlapsAny, propTypeFromCode } from "./harbor_util.js";

/**
 * Stamp a boat prefab on top of harbor water, converting selected water tiles
 * into ship deck tiles and placing ship props (rails/masts/hatch/cargo).
 *
 * Preconditions:
 * - prefab.tiles is a size.w × size.h grid using codes:
 *   - "WATER"      -> leave underlying tile as-is (typically HARBOR_WATER)
 *   - "SHIP_DECK"  -> convert to deck tile
 *   - "SHIP_EDGE"  -> convert to deck-edge tile (hull belt)
 *   - "SHIP_RAIL"  -> edge tile + ship_rail prop
 *   - "MAST"       -> deck tile + mast prop
 *   - "SHIP_HATCH" -> deck tile + ship_hatch prop
 *   - "CRATE"/"BARREL"/"LAMP" -> deck/edge tile + cargo/light prop
 */
export function stampBoatPrefabOnWater(ctx, prefab, bx, by, W, H, harborMask, waterTile) {
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

      // Decide which underlying tile to use for this ship cell.
      // Default to deck; rails sit on edge tiles so the hull has a darker belt.
      let tileId = DECK;
      try {
        if (code === "SHIP_EDGE") {
          tileId = (ctx.TILES && ctx.TILES.SHIP_EDGE) || DECK;
        } else if (code === "SHIP_RAIL") {
          tileId = (ctx.TILES && ctx.TILES.SHIP_EDGE) || DECK;
        }
      } catch (_) {}

      ctx.map[ty][tx] = tileId;
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
      } else if (code === "CRATE" || code === "BARREL" || code === "LAMP") {
        // Generic cargo/light props on deck/edge tiles.
        ctx.townProps.push({ x: tx, y: ty, type: propTypeFromCode(code), name: null });
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

/**
 * Place harbor boats and ensure at least one has walkable access from the gate.
 *
 * This encapsulates the previous inline IIFEs from harbor.js:
 * - boat slot search + placement
 * - ensureHarborBoatAccess BFS pier carving
 */
export function placeHarborBoatsAndEnsureAccess(ctx, buildings, harborMask, harborDir, pierMask, W, H, WATER, gate, rng, PFB) {
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
      if (rectOverlapsAny(buildings, x0, y0, w, h)) return false;

      // Validate that all non-WATER codes sit on harbor water inside the mask.
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
    stampBoatPrefabOnWater(ctx, slot.prefab, slot.x, slot.y, W, H, harborMask, WATER);

    // Ensure that at least one boat (if present) is reachable from the town gate
    // by carving a minimal pier corridor through harbor water (never through
    // buildings). This avoids cases where boats are visually present but blocked
    // behind water and walls.
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
            tile === ctx.TILES.PIER ||
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
          ctx.map[cy][cx] = ctx.TILES.PIER;
          pierMask[cy][cx] = true;
        }
        cx = p.x;
        cy = p.y;
      }
    } catch (_) {
      // Access fix is best-effort; never break harbor generation.
    }
  } catch (_) {
    // Harbor generation should never fail if boat placement has issues.
  }
}