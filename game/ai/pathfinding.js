// ai/pathfinding.js
// Dedicated pathfinding helpers extracted from TownAI.
// Exports:
//  - computePath(ctx, occ, sx, sy, tx, ty, opts)
//  - computePathBudgeted(ctx, occ, sx, sy, tx, ty, opts)
//
// Enhancements:
//  - Centralized per-tick pathfinding queue with prioritization (on-screen/near-player/urgent)
//  - Strict per-tick budget consumption
//  - Lightweight LRU caching by start->target
//
// Notes:
//  - Queue drains using the current occupancy Set (occ) captured at request time; since it is shared/mutated
//    during the tick, queued solves see the latest state when processed.

function isWalkTown(ctx, x, y) {
  const { map, TILES } = ctx;
  const rows = Array.isArray(map) ? map.length : 0;
  const cols = rows && Array.isArray(map[0]) ? map[0].length : 0;
  if (y < 0 || y >= rows || x < 0 || x >= cols) return false;
  const t = map[y][x];
  return t === TILES.FLOOR || t === TILES.DOOR || t === TILES.ROAD;
}

// --- Viewport helpers for prioritization ---
function getCamera(ctx) {
  try {
    if (typeof ctx.getCamera === 'function') return ctx.getCamera();
    return ctx.camera || null;
  } catch (_) {
    return null;
  }
}
function getViewportTiles(ctx) {
  try {
    const cam = getCamera(ctx);
    const TILE = (typeof ctx.TILE === 'number') ? ctx.TILE : 32;
    if (!cam || !TILE) return null;
    const x0 = Math.floor((cam.x || 0) / TILE);
    const y0 = Math.floor((cam.y || 0) / TILE);
    const w = Math.ceil((cam.width || 0) / TILE) + 1;
    const h = Math.ceil((cam.height || 0) / TILE) + 1;
    return { x0, y0, x1: x0 + w, y1: y0 + h };
  } catch (_) {
    return null;
  }
}
function isOnScreen(ctx, x, y, marginTiles = 2) {
  try {
    const vp = getViewportTiles(ctx);
    if (!vp) return false;
    return (x >= vp.x0 - marginTiles && x <= vp.x1 + marginTiles &&
            y >= vp.y0 - marginTiles && y <= vp.y1 + marginTiles);
  } catch (_) { return false; }
}
function manhattan(ax, ay, bx, by) { return Math.abs(ax - bx) + Math.abs(ay - by); }

// --- Core A* (single solve) ---
export function computePath(ctx, occ, sx, sy, tx, ty, opts = {}) {
  const { map } = ctx;
  const rows = map.length, cols = map[0] ? map[0].length : 0;
  const inB = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  const dirs4 = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
  const startKey = (x, y) => `${x},${y}`;
  const h = (x, y) => Math.abs(x - tx) + Math.abs(y - ty);

  const open = []; // min-heap substitute: small graphs, array+sort is fine
  const gScore = new Map();
  const fScore = new Map();
  const cameFrom = new Map();
  const startK = startKey(sx, sy);
  gScore.set(startK, 0);
  fScore.set(startK, h(sx, sy));
  open.push({ x: sx, y: sy, f: fScore.get(startK) });

  // Lower visit cap further to reduce worst-case CPU in dense towns
  const MAX_VISITS = 3500;
  const visited = new Set();

  function pushOpen(x, y, f) {
    open.push({ x, y, f });
  }

  function popOpen() {
    // Avoid heavy sorts by only partially ordering when queue grows large
    if (open.length > 16) {
      open.sort((a, b) => a.f - b.f || h(a.x, a.y) - h(b.x, b.y));
    }
    return open.shift();
  }

  let found = null;
  while (open.length && visited.size < MAX_VISITS) {
    const cur = popOpen();
    const ck = startKey(cur.x, cur.y);
    if (visited.has(ck)) continue;
    visited.add(ck);
    if (cur.x === tx && cur.y === ty) { found = cur; break; }

    for (const d of dirs4) {
      const nx = cur.x + d.dx, ny = cur.y + d.dy;
      if (!inB(nx, ny)) continue;
      if (!isWalkTown(ctx, nx, ny)) continue;

      const nk = startKey(nx, ny);
      // Allow goal even if currently occupied; otherwise avoid occupied nodes
      if (occ.has(nk) && !(nx === tx && ny === ty)) continue;

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

  // Reconstruct path
  const path = [];
  let cur = { x: found.x, y: found.y };
  while (cur) {
    path.push({ x: cur.x, y: cur.y });
    const prev = cameFrom.get(startKey(cur.x, cur.y));
    cur = prev ? { x: prev.x, y: prev.y } : null;
  }
  path.reverse();
  return path;
}

// --- Central queue + LRU cache ---
function ensureCache(ctx) {
  if (!ctx._pathCache) {
    ctx._pathCache = { map: new Map(), order: [], limit: 200 };
  }
  return ctx._pathCache;
}
function cacheGet(ctx, key) {
  const c = ensureCache(ctx);
  const m = c.map;
  if (!m.has(key)) return null;
  const v = m.get(key);
  if (!Array.isArray(v) || v.length < 2) { m.delete(key); return null; }
  // LRU touch
  try {
    const idx = c.order.indexOf(key);
    if (idx !== -1) c.order.splice(idx, 1);
    c.order.push(key);
  } catch (_) {}
  return v.slice(0);
}
function cacheSet(ctx, key, path) {
  const c = ensureCache(ctx);
  try {
    c.map.set(key, path.slice(0));
    c.order.push(key);
    if (c.order.length > c.limit) {
      const evictKey = c.order.shift();
      try { c.map.delete(evictKey); } catch (_) {}
    }
  } catch (_) {}
}
function maybeResetQueue(ctx) {
  try {
    const turn = (ctx.time && typeof ctx.time.turnCounter === 'number') ? (ctx.time.turnCounter | 0) : 0;
    const q = ctx._pathQueue;
    if (!q || q.lastTurn !== turn) {
      ctx._pathQueue = { q: [], seen: new Set(), results: new Map(), lastTurn: turn };
    }
  } catch (_) {
    ctx._pathQueue = { q: [], seen: new Set(), results: new Map(), lastTurn: 0 };
  }
}
function enqueue(ctx, req) {
  const Q = ctx._pathQueue;
  if (!Q) return;
  if (Q.seen.has(req.key)) {
    // Update priority of existing entry if higher
    for (let i = 0; i < Q.q.length; i++) {
      const r = Q.q[i];
      if (r.key === req.key) {
        if ((req.prio | 0) > (r.prio | 0)) r.prio = req.prio | 0;
        return;
      }
    }
    return;
  }
  Q.q.push(req);
  Q.seen.add(req.key);
}
function drain(ctx) {
  const Q = ctx._pathQueue;
  if (!Q) return;
  // Nothing to do or no budget
  let budget = (typeof ctx._townPathBudgetRemaining === 'number') ? ctx._townPathBudgetRemaining : 0;
  if (budget <= 0) return;

  // Sort by priority descending; stable by FIFO within equal priority
  if (Q.q.length > 1) {
    Q.q.sort((a, b) => (b.prio | 0) - (a.prio | 0));
  }

  while (Q.q.length && budget > 0) {
    const r = Q.q.shift();
    Q.seen.delete(r.key);
    // Skip if result already cached
    if (cacheGet(ctx, r.key)) { continue; }
    const path = computePath(ctx, r.occ, r.sx, r.sy, r.tx, r.ty, r.opts || {});
    if (Array.isArray(path) && path.length >= 2) {
      cacheSet(ctx, r.key, path);
      try { Q.results.set(r.key, path.slice(0)); } catch (_) {}
    }
    budget--;
  }
  ctx._townPathBudgetRemaining = budget;
}
function prioScore(ctx, sx, sy, tx, ty, opts) {
  let p = 0;
  try {
    if (opts && opts.urgent) p += 100; // urgent callers (usually shopkeepers/critical)
    if (isOnScreen(ctx, sx, sy)) p += 40;
    const player = ctx.player || null;
    if (player) {
      const d = manhattan(sx, sy, player.x | 0, player.y | 0);
      if (d <= 6) p += 20;
      else if (d <= 10) p += 8;
    }
    if (opts && typeof opts.prioBoost === 'number') p += opts.prioBoost;
  } catch (_) {}
  return p | 0;
}

// Pathfinding budget/throttling + centralized queue + LRU caching
export function computePathBudgeted(ctx, occ, sx, sy, tx, ty, opts = {}) {
  // Ensure queue for this tick
  maybeResetQueue(ctx);

  // Fast cache hit (does not consume budget)
  const key = `${sx},${sy}->${tx},${ty}`;
  const cached = cacheGet(ctx, key);
  if (cached) return cached;

  // If no budget available, just enqueue and return null
  if (typeof ctx._townPathBudgetRemaining !== 'number') ctx._townPathBudgetRemaining = 1;

  // Enqueue current request with computed priority
  try {
    const req = {
      key,
      sx, sy, tx, ty,
      occ, // shared Set reference; reflects latest occupancy when processed
      opts: opts || {},
      prio: prioScore(ctx, sx, sy, tx, ty, opts)
    };
    enqueue(ctx, req);
  } catch (_) {}

  // Drain queue according to remaining budget (process highest-priority first)
  drain(ctx);

  // Return if our request was solved during this drain
  const out = cacheGet(ctx, key);
  return out || null;
}

// Back-compat: attach for window consumers (optional)
if (typeof window !== "undefined") {
  window.Pathfinding = { computePath, computePathBudgeted };
}