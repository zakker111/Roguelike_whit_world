/**
 * World tick (Phase 3 extraction): optional per-turn hook for overworld mode.
 * Currently:
 * - Advances travelling caravans on the overworld map.
 */
export function tick(ctx) {
  if (!ctx || ctx.mode !== "world" || !ctx.world) return true;

  try {
    advanceCaravans(ctx);
  } catch (_) {}

  // Future: day/night effects or ambient overlays in world mode
  return true;
}

/**
 * Ensure caravans array exists on world.
 */
function ensureCaravanState(world) {
  if (!world.caravans) world.caravans = [];
}

/**
 * Pick the nearest town (or castle) to the given world position that is not the same location.
 */
function pickNearestTown(world, wx, wy) {
  const towns = Array.isArray(world.towns) ? world.towns : [];
  if (!towns.length) return null;
  let best = null;
  let bestDist = Infinity;
  for (const t of towns) {
    if (!t) continue;
    const dx = (t.x | 0) - (wx | 0);
    const dy = (t.y | 0) - (wy | 0);
    const dist = Math.abs(dx) + Math.abs(dy);
    if (dist === 0) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = { x: t.x | 0, y: t.y | 0 };
    }
  }
  return best;
}

/**
 * Test walkability at world coordinates. When outside the current window, assume walkable so
 * caravans can keep moving even if the player is elsewhere.
 */
function isWalkableWorld(ctx, wx, wy) {
  try {
    const world = ctx.world;
    const map = ctx.map;
    if (!world || !Array.isArray(map) || !map.length) return true;
    const ox = (world.originX | 0) || 0;
    const oy = (world.originY | 0) || 0;
    const lx = wx - ox;
    const ly = wy - oy;
    const rows = map.length;
    const cols = rows ? (map[0] ? map[0].length : 0) : 0;
    if (ly < 0 || ly >= rows || lx < 0 || lx >= cols) {
      // Outside current window: treat as walkable; InfiniteGen already avoids extreme blockers.
      return true;
    }
    const tile = map[ly][lx];
    const W = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
    if (W && typeof W.isWalkable === "function") {
      return !!W.isWalkable(tile);
    }
  } catch (_) {}
  return true;
}

/**
 * Advance all caravans one step toward their current destination town.
 * Caravans are stored in world.caravans with world-space coordinates.
 */
function advanceCaravans(ctx) {
  const world = ctx.world;
  ensureCaravanState(world);
  const caravans = world.caravans;
  if (!Array.isArray(caravans) || !caravans.length) return;

  for (const cv of caravans) {
    if (!cv) continue;

    // If destination missing or invalid, retarget to nearest town
    if (!cv.dest || typeof cv.dest.x !== "number" || typeof cv.dest.y !== "number") {
      const target = pickNearestTown(world, cv.x | 0, cv.y | 0);
      if (target) {
        cv.dest = target;
      } else {
        continue;
      }
    }

    const cx = cv.x | 0;
    const cy = cv.y | 0;
    const tx = cv.dest.x | 0;
    const ty = cv.dest.y | 0;

    // Arrived: pick a new destination (nearest town from here)
    if (cx === tx && cy === ty) {
      const next = pickNearestTown(world, cx, cy);
      if (next) {
        cv.dest = next;
      }
      continue;
    }

    const dx = tx - cx;
    const dy = ty - cy;
    const stepX = dx === 0 ? 0 : (dx > 0 ? 1 : -1);
    const stepY = dy === 0 ? 0 : (dy > 0 ? 1 : -1);

    // Prefer axis with greater remaining distance, but fall back to the other if blocked.
    let nx = cx;
    let ny = cy;

    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    function tryStep(px, py) {
      if (px === cx && py === cy) return false;
      if (!isWalkableWorld(ctx, px, py)) return false;
      nx = px;
      ny = py;
      return true;
    }

    let moved = false;
    if (absDx >= absDy) {
      if (stepX && tryStep(cx + stepX, cy)) {
        moved = true;
      } else if (stepY && tryStep(cx, cy + stepY)) {
        moved = true;
      }
    } else {
      if (stepY && tryStep(cx, cy + stepY)) {
        moved = true;
      } else if (stepX && tryStep(cx + stepX, cy)) {
        moved = true;
      }
    }

    // As a last resort, try a simple sidestep to avoid getting stuck forever.
    if (!moved && (stepX || stepY)) {
      if (stepX && tryStep(cx + stepX, cy + (stepY || 0))) {
        moved = true;
      } else if (stepY && tryStep(cx + (stepX || 0), cy + stepY)) {
        moved = true;
      }
    }

    if (moved) {
      cv.x = nx;
      cv.y = ny;
    }
  }
}