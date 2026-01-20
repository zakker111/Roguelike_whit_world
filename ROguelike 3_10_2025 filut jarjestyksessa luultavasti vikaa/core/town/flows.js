/**
 * Town flow fields: precomputed distance maps used by TownAI for common targets
 * such as the plaza, town gate, and inn door.
 *
 * API (ESM + window.TownFlows):
 *  - computeFlowField(ctx, targets)
 *  - computeTownFlowFields(ctx)
 */

function isWalkTownBasic(ctx, x, y) {
  const map = Array.isArray(ctx.map) ? ctx.map : null;
  const T = ctx && ctx.TILES;
  if (!map || !map.length || !T) return false;
  const rows = map.length;
  const cols = map[0] ? map[0].length : 0;
  if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
  const t = map[y][x];
  return t === T.FLOOR || t === T.DOOR || t === T.ROAD;
}

/**
 * Compute a flow field (distance map) from one or more target tiles.
 * Returns a HxW array of Int16Array rows, with -1 indicating unreachable.
 */
export function computeFlowField(ctx, targets) {
  try {
    const map = Array.isArray(ctx.map) ? ctx.map : null;
    if (!map || !map.length || !Array.isArray(targets) || !targets.length) return null;
    const H = map.length;
    const W = map[0] ? map[0].length : 0;
    if (!W) return null;

    const dist = Array.from({ length: H }, () => {
      const row = new Int16Array(W);
      row.fill(-1);
      return row;
    });

    const q = [];
    for (const t of targets) {
      if (!t) continue;
      const x = t.x | 0;
      const y = t.y | 0;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      if (!isWalkTownBasic(ctx, x, y)) continue;
      if (dist[y][x] !== -1) continue;
      dist[y][x] = 0;
      q.push(x, y);
    }
    if (!q.length) return null;

    const dirs = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 }
    ];

    let qi = 0;
    while (qi < q.length) {
      const x = q[qi++] | 0;
      const y = q[qi++] | 0;
      const d = dist[y][x];
      if (d >= 0x7fff) continue;
      const nd = d + 1;
      for (let i = 0; i < dirs.length; i++) {
        const nx = x + dirs[i].dx;
        const ny = y + dirs[i].dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (dist[ny][nx] !== -1) continue;
        if (!isWalkTownBasic(ctx, nx, ny)) continue;
        dist[ny][nx] = nd;
        q.push(nx, ny);
      }
    }

    return dist;
  } catch (_) {
    return null;
  }
}

/**
 * Compute and attach common town flow fields to ctx:
 *  - ctx.flowToPlaza
 *  - ctx.flowToGate
 *  - ctx.flowToInnDoor
 *  - ctx.flowToHarborBand (only when harbor mask exists)
 */
export function computeTownFlowFields(ctx) {
  try {
    if (!ctx || !Array.isArray(ctx.map) || !ctx.map.length) return;

    try {
      ctx.flowToPlaza = null;
      ctx.flowToGate = null;
      ctx.flowToInnDoor = null;
      ctx.flowToHarborBand = null;
    } catch (_) {}

    const map = ctx.map;
    const H = map.length;
    const W = map[0] ? map[0].length : 0;
    if (!W) return;

    // Plaza
    try {
      const pl = ctx.townPlaza;
      if (pl && typeof pl.x === "number" && typeof pl.y === "number") {
        const field = computeFlowField(ctx, [pl]);
        if (field) ctx.flowToPlaza = field;
      }
    } catch (_) {}

    // Gate
    try {
      const gate = ctx.townExitAt;
      if (gate && typeof gate.x === "number" && typeof gate.y === "number") {
        const field = computeFlowField(ctx, [gate]);
        if (field) ctx.flowToGate = field;
      }
    } catch (_) {}

    // Inn door(s)
    try {
      const innTargets = [];
      const shops = Array.isArray(ctx.shops) ? ctx.shops : [];
      for (let i = 0; i < shops.length; i++) {
        const s = shops[i];
        if (!s) continue;
        const t = String(s.type || "").toLowerCase();
        if (t !== "inn") continue;
        if (!s.x && s.x !== 0) continue;
        if (!s.y && s.y !== 0) continue;
        innTargets.push({ x: s.x | 0, y: s.y | 0 });
      }
      if (!innTargets.length && ctx.tavern && ctx.tavern.door && typeof ctx.tavern.door.x === "number" && typeof ctx.tavern.door.y === "number") {
        innTargets.push({ x: ctx.tavern.door.x | 0, y: ctx.tavern.door.y | 0 });
      }
      if (innTargets.length) {
        const field = computeFlowField(ctx, innTargets);
        if (field) ctx.flowToInnDoor = field;
      }
    } catch (_) {}

    // Harbor band (only if harbor mask present; primarily for fresh port towns)
    try {
      const mask = Array.isArray(ctx.townHarborMask) ? ctx.townHarborMask : null;
      if (mask && ctx.townKind === "port") {
        const targets = [];
        const rows = mask.length;
        const cols = mask[0] ? mask[0].length : 0;
        for (let y = 0; y < rows; y++) {
          const row = mask[y];
          if (!Array.isArray(row)) continue;
          for (let x = 0; x < cols; x++) {
            if (row[x]) targets.push({ x, y });
          }
        }
        if (targets.length) {
          const field = computeFlowField(ctx, targets);
          if (field) ctx.flowToHarborBand = field;
        }
      }
    } catch (_) {}
  } catch (_) {}
}

// Back-compat/debug: attach to window
if (typeof window !== "undefined") {
  try {
    window.TownFlows = { computeFlowField, computeTownFlowFields };
  } catch (_) {}
}