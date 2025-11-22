/**
 * World tick (Phase 3 extraction): optional per-turn hook for overworld mode.
 * Currently:
 * - Advances travelling caravans on the overworld map (with town dwell times).
 */
export function tick(ctx) {
  if (!ctx || ctx.mode !== "world" || !ctx.world) return true;

  try {
    spawnCaravansIfNeeded(ctx);
  } catch (_) {}

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
 * Get current global turn counter (for dwell timers). Falls back to 0 if unavailable.
 */
function getTurn(ctx) {
  try {
    if (ctx && ctx.time && typeof ctx.time.turnCounter === "number") {
      return ctx.time.turnCounter | 0;
    }
  } catch (_) {}
  return 0;
}

/**
 * Returns how many turns make up one in-game day. Defaults to 360 if not configured.
 */
function turnsPerDay(ctx) {
  try {
    if (ctx && ctx.time && typeof ctx.time.cycleTurns === "number") {
      return Math.max(1, ctx.time.cycleTurns | 0);
    }
  } catch (_) {}
  return 360;
}

/**
 * Get a RNG function suitable for world-level ambient systems (caravans etc.).
 * Prefers RNGUtils.getRng so behavior is deterministic per seed.
 */
function worldRng(ctx) {
  try {
    if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function") {
      const base = (typeof ctx.rng === "function") ? ctx.rng : undefined;
      return window.RNGUtils.getRng(base);
    }
  } catch (_) {}
  if (ctx && typeof ctx.rng === "function") return ctx.rng;
  return function () { return Math.random(); };
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
 * Returns true if the given world coordinate is exactly on a town (or castle) tile.
 */
function isOnTownTile(world, wx, wy) {
  const towns = Array.isArray(world.towns) ? world.towns : [];
  for (const t of towns) {
    if (!t) continue;
    if ((t.x | 0) === (wx | 0) && (t.y | 0) === (wy | 0)) return true;
  }
  return false;
}

/**
 * Dynamically spawn caravans over time as the player reveals more of the world.
 * Keeps at least a baseline number of caravans relative to discovered towns.
 */
function spawnCaravansIfNeeded(ctx) {
  const world = ctx.world;
  ensureCaravanState(world);
  const caravans = world.caravans;
  const towns = Array.isArray(world.towns) ? world.towns : [];
  if (!towns.length) return;

  const r = worldRng(ctx);
  const townCount = towns.length;
  const existing = Array.isArray(caravans) ? caravans.length : 0;

  // Desired caravans grows slowly with town count (e.g. 1 at start, up to ~6–8 in large worlds)
  const desired = Math.min(8, Math.max(2, Math.floor(townCount / 4)));

  // Soft cap: if we already have enough caravans, only rarely add new ones.
  if (existing >= desired) {
    // Small chance to top up if player has revealed many towns but caravans were lost somehow.
    if (existing >= desired + 2) return;
    if (r() > 0.01) return;
  } else {
    // When under capacity, higher chance to spawn as time goes on.
    if (r() > 0.05) return;
  }

  // Pick a random town as origin
  const fromIdx = (r() * towns.length) | 0;
  const from = towns[fromIdx];
  if (!from) return;

  // Find nearest other town as destination
  let best = null;
  let bestDist = Infinity;
  for (let i = 0; i < towns.length; i++) {
    if (i === fromIdx) continue;
    const t = towns[i];
    if (!t) continue;
    const dx = (t.x | 0) - (from.x | 0);
    const dy = (t.y | 0) - (from.y | 0);
    const dist = Math.abs(dx) + Math.abs(dy);
    if (dist === 0) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = t;
    }
  }
  if (!best) return;

  let idCounter = caravans.length ? caravans.length : 0;
  caravans.push({
    id: ++idCounter,
    x: from.x | 0,
    y: from.y | 0,
    from: { x: from.x | 0, y: from.y | 0 },
    dest: { x: best.x | 0, y: best.y | 0 },
    atTown: true,
    dwellUntil: getTurn(ctx) + 2 * turnsPerDay(ctx) // start as parked for 2 days at origin
  });
}

/**
 * Advance all caravans one step toward their current destination town.
 * Caravans are stored in world.caravans with world-space coordinates.
 * When they reach a town, they stay parked for a few in-game days (dwell) before moving on.
 */
function advanceCaravans(ctx) {
  const world = ctx.world;
  ensureCaravanState(world);
  const caravans = world.caravans;
  if (!Array.isArray(caravans) || !caravans.length) return;

  const nowTurn = getTurn(ctx);
  const dayTurns = turnsPerDay(ctx);
  const minDwellDays = 2;
  const maxDwellDays = 4;

  for (const cv of caravans) {
    if (!cv) continue;

    // Initialize dwell metadata if missing
    if (typeof cv.dwellUntil !== "number") cv.dwellUntil = 0;
    if (typeof cv.atTown !== "boolean") cv.atTown = false;

    // If currently dwelling in a town, stay parked until the timer expires
    if (cv.atTown && nowTurn < (cv.dwellUntil | 0)) {
      continue;
    }

    // If dwell timer has expired or never set, clear atTown and choose next leg when at a town tile
    if (cv.atTown && nowTurn >= (cv.dwellUntil | 0)) {
      cv.atTown = false;
      // Force picking a new destination from this town
      cv.dest = pickNearestTown(world, cv.x | 0, cv.y | 0) || cv.dest;
    }

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

    // Arrived at destination town: start a dwell period here
    if (cx === tx && cy === ty && isOnTownTile(world, cx, cy)) {
      cv.atTown = true;
      // Dwell for 2–4 in-game days.
      const dwellDays = Math.max(minDwellDays, Math.min(maxDwellDays, (2 + (cx + cy) % 3) | 0));
      cv.dwellUntil = nowTurn + dwellDays * dayTurns;
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