/**
 * Town windows & outdoor mask helpers
 * -----------------------------------
 * Extracted from worldgen/town_gen.js. Behaviour is kept identical:
 * - buildOutdoorMask: marks outdoor FLOOR tiles (not inside buildings).
 * - repairBuildingPerimeters: enforces solid WALL borders around buildings.
 * - placeWindowsOnAll: auto-places WINDOW tiles on building perimeters,
 *   skipping prefab-stamped buildings and keeping spacing away from doors.
 */

function inBoundsLocal(ctx, x, y) {
  try {
    if (typeof window !== "undefined" && window.Bounds && typeof window.Bounds.inBounds === "function") {
      return window.Bounds.inBounds(ctx, x, y);
    }
    if (ctx && ctx.Utils && typeof ctx.Utils.inBounds === "function") return ctx.Utils.inBounds(ctx, x, y);
    if (typeof window !== "undefined" && window.Utils && typeof window.Utils.inBounds === "function") return window.Utils.inBounds(ctx, x, y);
  } catch (_) {}
  const rows = ctx.map.length;
  const cols = ctx.map[0] ? ctx.map[0].length : 0;
  return x >= 0 && y >= 0 && x < cols && y < rows;
}

/**
 * Compute outdoor ground mask (true for outdoor FLOOR tiles; false for building interiors).
 * Separated from generate() for clarity.
 */
export function buildOutdoorMask(ctx, buildings, width, height) {
  try {
    const rows = height;
    const cols = width;
    const mask = Array.from({ length: rows }, () => Array(cols).fill(false));
    function insideAnyBuilding(x, y) {
      for (let i = 0; i < buildings.length; i++) {
        const B = buildings[i];
        if (x > B.x && x < B.x + B.w - 1 && y > B.y && y < B.y + B.h - 1) return true;
      }
      return false;
    }
    const harborMask = Array.isArray(ctx.townHarborMask) ? ctx.townHarborMask : null;
    const isPortTown = ctx.townKind === "port";
    for (let yy = 0; yy < rows; yy++) {
      for (let xx = 0; xx < cols; xx++) {
        const t = ctx.map[yy][xx];
        // For port towns, treat harbor band FLOOR tiles as non-outdoor so they render more like paved/boardwalk surfaces.
        if (isPortTown && harborMask && harborMask[yy] && harborMask[yy][xx]) continue;
        if (t === ctx.TILES.FLOOR && !insideAnyBuilding(xx, yy)) {
          mask[yy][xx] = true;
        }
      }
    }
    ctx.townOutdoorMask = mask;
  } catch (_) {}
}

/**
 * Repair pass: enforce solid building perimeters (convert any non-door/window on borders to WALL).
 */
export function repairBuildingPerimeters(ctx, buildings) {
  try {
    for (const b of buildings) {
      const x0 = b.x;
      const y0 = b.y;
      const x1 = b.x + b.w - 1;
      const y1 = b.y + b.h - 1;
      // Top and bottom edges
      for (let xx = x0; xx <= x1; xx++) {
        if (inBoundsLocal(ctx, xx, y0)) {
          const t = ctx.map[y0][xx];
          if (t !== ctx.TILES.DOOR && t !== ctx.TILES.WINDOW) ctx.map[y0][xx] = ctx.TILES.WALL;
        }
        if (inBoundsLocal(ctx, xx, y1)) {
          const t = ctx.map[y1][xx];
          if (t !== ctx.TILES.DOOR && t !== ctx.TILES.WINDOW) ctx.map[y1][xx] = ctx.TILES.WALL;
        }
      }
      // Left and right edges
      for (let yy = y0; yy <= y1; yy++) {
        if (inBoundsLocal(ctx, x0, yy)) {
          const t = ctx.map[yy][x0];
          if (t !== ctx.TILES.DOOR && t !== ctx.TILES.WINDOW) ctx.map[yy][x0] = ctx.TILES.WALL;
        }
        if (inBoundsLocal(ctx, x1, yy)) {
          const t = ctx.map[yy][x1];
          if (t !== ctx.TILES.DOOR && t !== ctx.TILES.WINDOW) ctx.map[yy][x1] = ctx.TILES.WALL;
        }
      }
    }
  } catch (_) {}
}

/**
 * Auto-place windows along building walls (spaced, not near doors).
 * Direct extraction of the IIFE from town_gen.js.
 */
export function placeWindowsOnAll(ctx, buildings) {
  function sidePoints(b) {
    // Exclude corners for aesthetics; only true perimeter segments
    return [
      Array.from({ length: Math.max(0, b.w - 2) }, (_, i) => ({ x: b.x + 1 + i, y: b.y })),              // top
      Array.from({ length: Math.max(0, b.w - 2) }, (_, i) => ({ x: b.x + 1 + i, y: b.y + b.h - 1 })),    // bottom
      Array.from({ length: Math.max(0, b.h - 2) }, (_, i) => ({ x: b.x, y: b.y + 1 + i })),              // left
      Array.from({ length: Math.max(0, b.h - 2) }, (_, i) => ({ x: b.x + b.w - 1, y: b.y + 1 + i })),    // right
    ];
  }
  function isAdjacent(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1;
  }
  function nearDoor(x, y) {
    const dirs = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];
    for (let i = 0; i < dirs.length; i++) {
      const nx = x + dirs[i].dx;
      const ny = y + dirs[i].dy;
      if (!inBoundsLocal(ctx, nx, ny)) continue;
      if (ctx.map[ny][nx] === ctx.TILES.DOOR) return true;
    }
    return false;
  }
  for (let bi = 0; bi < buildings.length; bi++) {
    const b = buildings[bi];
    // Skip window auto-placement for prefab-stamped buildings; rely on prefab WINDOW tiles
    if (b && b.prefabId) continue;
    const tavB = (ctx.tavern && ctx.tavern.building) ? ctx.tavern.building : null;
    const isTavernBld = !!(tavB && b.x === tavB.x && b.y === tavB.y && b.w === tavB.w && b.h === tavB.h);
    let candidates = [];
    const sides = sidePoints(b);
    for (let si = 0; si < sides.length; si++) {
      const pts = sides[si];
      for (let pi = 0; pi < pts.length; pi++) {
        const p = pts[pi];
        if (!inBoundsLocal(ctx, p.x, p.y)) continue;
        const t = ctx.map[p.y][p.x];
        // Only convert solid wall tiles, avoid doors and already-placed windows
        if (t !== ctx.TILES.WALL) continue;
        if (nearDoor(p.x, p.y)) continue;
        candidates.push(p);
      }
    }
    if (!candidates.length) continue;
    // Limit by perimeter size so larger buildings get a few more windows but not too many
    let limit = Math.min(3, Math.max(1, Math.floor((b.w + b.h) / 12)));
    if (isTavernBld) {
      limit = Math.max(1, Math.floor(limit * 0.7));
    }
    limit = Math.max(1, Math.min(limit, 4));
    const placed = [];
    let attempts = 0;
    const RAND = (typeof ctx.rng === "function") ? ctx.rng : Math.random;
    while (placed.length < limit && candidates.length > 0 && attempts++ < candidates.length * 2) {
      const idx = Math.floor(RAND() * candidates.length);
      const p = candidates[idx];
      // Keep spacing: avoid placing next to already placed windows
      let adjacent = false;
      for (let j = 0; j < placed.length; j++) {
        if (isAdjacent(p, placed[j])) { adjacent = true; break; }
      }
      if (adjacent) {
        candidates.splice(idx, 1);
        continue;
      }
      ctx.map[p.y][p.x] = ctx.TILES.WINDOW;
      placed.push(p);
      // Remove adjacent candidates to maintain spacing
      candidates = candidates.filter(c => !isAdjacent(c, p));
    }
  }
}