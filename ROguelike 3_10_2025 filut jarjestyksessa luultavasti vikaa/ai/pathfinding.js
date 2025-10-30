// ai/pathfinding.js
// Dedicated pathfinding helpers extracted from TownAI.
// Exports:
//  - computePath(ctx, occ, sx, sy, tx, ty, opts)
//  - computePathBudgeted(ctx, occ, sx, sy, tx, ty, opts)

function isWalkTown(ctx, x, y) {
  const { map, TILES } = ctx;
  const rows = Array.isArray(map) ? map.length : 0;
  const cols = rows && Array.isArray(map[0]) ? map[0].length : 0;
  if (y < 0 || y >= rows || x < 0 || x >= cols) return false;
  const t = map[y][x];
  return t === TILES.FLOOR || t === TILES.DOOR || t === TILES.ROAD;
}

// Pre-planning A* used for path debug and stable routing
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

// Pathfinding budget/throttling + LRU caching
export function computePathBudgeted(ctx, occ, sx, sy, tx, ty, opts = {}) {
  // Initialize per-tick budget lazily if missing
  if (typeof ctx._townPathBudgetRemaining !== "number") {
    ctx._townPathBudgetRemaining = 1;
  }
  if (ctx._townPathBudgetRemaining <= 0) return null;

  // Lightweight global path cache keyed by start->target.
  // Cache ignores dynamic NPC occupancy; callers still validate next step.
  try {
    if (!ctx._pathCache) {
      ctx._pathCache = { map: new Map(), order: [], limit: 200 };
    }
    const key = `${sx},${sy}->${tx},${ty}`;
    const m = ctx._pathCache.map;
    if (m.has(key)) {
      const cached = m.get(key);
      // Quick validation: shape and endpoints match; tiles walkable currently.
      if (Array.isArray(cached) && cached.length >= 2) {
        const first = cached[0], last = cached[cached.length - 1];
        const okEndpoints = (first && first.x === sx && first.y === sy && last && last.x === tx && last.y === ty);
        if (okEndpoints) {
          let valid = true;
          for (let i = 0; i < cached.length; i++) {
            const p = cached[i];
            if (!isWalkTown(ctx, p.x, p.y)) { valid = false; break; }
          }
          if (valid) {
            // Touch LRU order
            try {
              const idx = ctx._pathCache.order.indexOf(key);
              if (idx !== -1) { ctx._pathCache.order.splice(idx, 1); }
              ctx._pathCache.order.push(key);
            } catch (_) {}
            // Consume budget and return cached plan
            ctx._townPathBudgetRemaining--;
            return cached.slice(0);
          } else {
            // Invalidate stale entry
            m.delete(key);
          }
        } else {
          m.delete(key);
        }
      } else {
        m.delete(key);
      }
    }
  } catch (_) {}

  // No cache hit: compute and store if successful
  ctx._townPathBudgetRemaining--;
  const path = computePath(ctx, occ, sx, sy, tx, ty, opts);
  try {
    if (Array.isArray(path) && path.length >= 2) {
      const key = `${sx},${sy}->${tx},${ty}`;
      const m = ctx._pathCache && ctx._pathCache.map;
      if (m && typeof m.set === "function") {
        m.set(key, path.slice(0));
        // Maintain simple LRU eviction
        const ord = ctx._pathCache.order;
        ord.push(key);
        if (ord.length > ctx._pathCache.limit) {
          const evictKey = ord.shift();
          try { ctx._pathCache.map.delete(evictKey); } catch (_) {}
        }
      }
    }
  } catch (_) {}
  return path;
}

// Back-compat: attach for window consumers (optional)
if (typeof window !== "undefined") {
  window.Pathfinding = { computePath, computePathBudgeted };
}