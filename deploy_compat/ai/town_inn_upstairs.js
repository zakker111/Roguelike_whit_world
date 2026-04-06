/**
 * Inn upstairs helpers (overlay-aware pathing/seating).
 *
 * This module contains the overlay geometry, walkability, and A* pathfinding
 * for the upstairs Inn layer, plus helpers to choose beds/seats.
 *
 * It deliberately does NOT depend on town_ai.js to avoid circular imports.
 * Callers pass in stepTowards (or wrap this module) when they need to
 * combine ground-floor routing with upstairs movement.
 */

import { getRNGUtils } from "../utils/access.js";

// Local RNG helper (mirrors rngFor in town_ai.js)
function rngFor(ctx) {
  try {
    const RU = getRNGUtils(ctx);
    if (RU && typeof RU.getRng === "function") {
      return RU.getRng(typeof ctx.rng === "function" ? ctx.rng : undefined);
    }
  } catch (_) {}
  if (typeof ctx.rng === "function") return ctx.rng;
  // Deterministic fallback
  return () => 0.5;
}

function manhattan(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

// Only these props block movement upstairs: table, shelf, counter.
function propBlocks(type) {
  const t = String(type || "").toLowerCase();
  return t === "table" || t === "shelf" || t === "counter";
}

// ---- Overlay geometry / walkability ----

function innUpstairsRect(ctx) {
  const tav = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
  const up = ctx.innUpstairs;
  if (!tav || !up) return null;
  const ox = up.offset ? up.offset.x : tav.x + 1;
  const oy = up.offset ? up.offset.y : tav.y + 1;
  return {
    x0: ox,
    y0: oy,
    x1: ox + (up.w | 0) - 1,
    y1: oy + (up.h | 0) - 1,
    w: up.w | 0,
    h: up.h | 0,
  };
}

function inUpstairsInterior(ctx, x, y) {
  const r = innUpstairsRect(ctx);
  if (!r) return false;
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

function upstairsTileAt(ctx, x, y) {
  const up = ctx.innUpstairs;
  const r = innUpstairsRect(ctx);
  if (!up || !r) return null;
  const lx = x - r.x0;
  const ly = y - r.y0;
  if (lx < 0 || ly < 0 || lx >= r.w || ly >= r.h) return null;
  const row = up.tiles && up.tiles[ly] ? up.tiles[ly] : null;
  if (!row) return null;
  return row[lx];
}

function isWalkInnUpstairs(ctx, x, y, occUp) {
  if (!inUpstairsInterior(ctx, x, y)) return false;
  const t = upstairsTileAt(ctx, x, y);
  if (t == null) return false;
  const T = ctx.TILES;
  const walk = t === T.FLOOR || t === T.STAIRS;
  if (!walk) return false;
  if (occUp && occUp.has(`${x},${y}`)) return false;
  return true;
}

function buildOccUpstairs(ctx) {
  const s = new Set();
  const up = ctx.innUpstairs;
  const tav = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
  if (!up || !tav) return s;
  // Block upstairs props except signs/rugs
  try {
    const props = Array.isArray(up.props) ? up.props : [];
    for (const p of props) {
      if (!p) continue;
      if (propBlocks(p.type)) s.add(`${p.x},${p.y}`);
    }
  } catch (_) {}
  // Block upstairs NPCs (those with _floor === "upstairs") at their coordinates
  try {
    const npcs = Array.isArray(ctx.npcs) ? ctx.npcs : [];
    for (const n of npcs) {
      if (!n) continue;
      if (n._floor === "upstairs") s.add(`${n.x},${n.y}`);
    }
  } catch (_) {}
  return s;
}

function nearestFreeAdjacentUpstairs(ctx, x, y, occUp) {
  const dirs = [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
    { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
    { dx: 1, dy: 1 }, { dx: 1, dy: -1 },
    { dx: -1, dy: 1 }, { dx: -1, dy: -1 },
  ];
  for (const d of dirs) {
    const nx = x + d.dx;
    const ny = y + d.dy;
    if (isWalkInnUpstairs(ctx, nx, ny, occUp)) return { x: nx, y: ny };
  }
  return null;
}

// Raw upstairs bed tiles (props positions), used for proximity checks to decide sleeping
function innUpstairsBeds(ctx) {
  const up = ctx.innUpstairs;
  if (!up || !Array.isArray(up.props)) return [];
  const out = [];
  for (const p of up.props) {
    if (!p) continue;
    if (String(p.type || "").toLowerCase() === "bed") out.push({ x: p.x, y: p.y });
  }
  return out;
}

function innUpstairsSeatAdj(ctx) {
  const up = ctx.innUpstairs;
  if (!up) return [];
  const occUp = buildOccUpstairs(ctx);
  const out = [];
  const props = Array.isArray(up.props) ? up.props : [];
  for (const p of props) {
    const t = String(p.type || "").toLowerCase();
    if (t !== "chair" && t !== "table") continue;
    const adj = nearestFreeAdjacentUpstairs(ctx, p.x, p.y, occUp);
    if (adj) out.push(adj);
  }
  return out;
}

function chooseInnUpstairsBed(ctx) {
  const beds = innUpstairsBeds(ctx);
  if (!beds.length) return null;
  const rnd = rngFor(ctx);
  return beds[Math.floor(rnd() * beds.length)];
}

function chooseInnUpstairsSeat(ctx) {
  const seats = innUpstairsSeatAdj(ctx);
  if (!seats.length) return null;
  const rnd = rngFor(ctx);
  return seats[Math.floor(rnd() * seats.length)];
}

// A* restricted to upstairs interior using overlay tiles
function computePathUpstairs(ctx, occUp, sx, sy, tx, ty) {
  const r = innUpstairsRect(ctx);
  if (!r) return null;
  const inB = (x, y) => x >= r.x0 && y >= r.y0 && x <= r.x1 && y <= r.y1;
  const dirs4 = [
    { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
    { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
  ];
  const key = (x, y) => `${x},${y}`;
  const h = (x, y) => Math.abs(x - tx) + Math.abs(y - ty);

  const open = [];
  const gScore = new Map();
  const fScore = new Map();
  const cameFrom = new Map();
  const startK = key(sx, sy);
  gScore.set(startK, 0);
  fScore.set(startK, h(sx, sy));
  open.push({ x: sx, y: sy, f: fScore.get(startK) });

  const MAX_VISITS = 4000;
  const visited = new Set();

  function pushOpen(x, y, f) {
    open.push({ x, y, f });
  }
  function popOpen() {
    if (open.length > 24) open.sort((a, b) => a.f - b.f || h(a.x, a.y) - h(b.x, b.y));
    return open.shift();
  }

  let found = null;
  while (open.length && visited.size < MAX_VISITS) {
    const cur = popOpen();
    const ck = key(cur.x, cur.y);
    if (visited.has(ck)) continue;
    visited.add(ck);
    if (cur.x === tx && cur.y === ty) {
      found = cur;
      break;
    }

    for (const d of dirs4) {
      const nx = cur.x + d.dx;
      const ny = cur.y + d.dy;
      if (!inB(nx, ny)) continue;
      if (!isWalkInnUpstairs(ctx, nx, ny, occUp)) continue;

      const nk = key(nx, ny);
      const tentativeG = (gScore.get(ck) ?? Infinity) + 1;
      if (tentativeG < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, { x: cur.x, y: cur.y });
        gScore.set(nk, tentativeG);
        const f = tentativeG + h(nx, ny);
        fScore.set(nk, f);
        pushOpen(nx, ny, f);
      }
    }
  }

  if (!found) return null;

  const path = [];
  let cur = { x: found.x, y: found.y };
  while (cur) {
    path.push({ x: cur.x, y: cur.y });
    const prev = cameFrom.get(key(cur.x, cur.y));
    cur = prev ? { x: prev.x, y: prev.y } : null;
  }
  path.reverse();
  return path;
}

/**
 * Route into Inn upstairs: go to ground stairs, then upstairs path to target.
 *
 * stepTowardsFn is injected by the caller (typically from town_ai.js) to avoid
 * a circular dependency on the town runtime module.
 */
function routeIntoInnUpstairs(ctx, occGround, n, targetUp, stepTowardsFn) {
  const tav = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
  const up = ctx.innUpstairs;
  const stairs = Array.isArray(ctx.innStairsGround) ? ctx.innStairsGround.slice(0) : [];
  if (!tav || !up || !stairs.length || !targetUp) return false;

  // Default floor if missing
  if (!n._floor) n._floor = "ground";

  // If not upstairs yet: aim for nearest ground stairs tile
  if (n._floor !== "upstairs") {
    // Pick nearest stairs by manhattan
    let sPick = stairs[0];
    let bd = Math.abs(stairs[0].x - n.x) + Math.abs(stairs[0].y - n.y);
    for (let i = 1; i < stairs.length; i++) {
      const s = stairs[i];
      const d = Math.abs(s.x - n.x) + Math.abs(s.y - n.y);
      if (d < bd) {
        bd = d;
        sPick = s;
      }
    }
    // Step toward stairs using ground pathing
    if (typeof stepTowardsFn === "function") {
      stepTowardsFn(ctx, occGround, n, sPick.x, sPick.y, { urgent: true });
    }

    // Exact stairs landing: toggle immediately
    if (n.x === sPick.x && n.y === sPick.y && n._floor !== "upstairs" && inUpstairsInterior(ctx, n.x, n.y)) {
      n._floor = "upstairs";
      n._nearStairsCount = 0;
      return true;
    }

    // Proximity-based toggle: if inside inn and within 1 tile of any stairs for consecutive ticks, toggle upstairs
    if (inUpstairsInterior(ctx, n.x, n.y)) {
      let near = false;
      for (let i = 0; i < stairs.length; i++) {
        const s = stairs[i];
        const md = manhattan(s.x, s.y, n.x, n.y);
        if (md <= 1) {
          near = true;
          break;
        }
      }
      if (near) {
        n._nearStairsCount = typeof n._nearStairsCount === "number" ? n._nearStairsCount + 1 : 1;
        // Small threshold (2) to avoid accidental toggles during crowd jitter
        if (n._nearStairsCount >= 2) {
          n._floor = "upstairs";
          n._nearStairsCount = 0;
          return true;
        }
      } else {
        n._nearStairsCount = 0;
      }
    }
    return true;
  }

  // Upstairs movement: overlay-aware A*
  const occUp = buildOccUpstairs(ctx);
  const path = computePathUpstairs(ctx, occUp, n.x, n.y, targetUp.x, targetUp.y);
  if (path && path.length >= 2) {
    const next = path[1];
    if (isWalkInnUpstairs(ctx, next.x, next.y, occUp)) {
      // Move upstairs; separate occupancy from ground
      const pxPrev = n.x;
      const pyPrev = n.y;
      n.x = next.x;
      n.y = next.y;
      n._lastX = pxPrev;
      n._lastY = pyPrev;
      // If we step onto upstairs stairs tile, we could toggle down — leave for future flows
      return true;
    }
  }
  // Small jitter upstairs if blocked
  if (typeof ctx.rng === "function" && ctx.rng() < 0.15) {
    const dirs = [
      { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
      { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
    ];
    for (const d of dirs) {
      const nx = n.x + d.dx;
      const ny = n.y + d.dy;
      if (isWalkInnUpstairs(ctx, nx, ny, buildOccUpstairs(ctx))) {
        n.x = nx;
        n.y = ny;
        return true;
      }
    }
  }
  return false;
}

export {
  inUpstairsInterior,
  innUpstairsBeds,
  chooseInnUpstairsBed,
  chooseInnUpstairsSeat,
  routeIntoInnUpstairs,
};