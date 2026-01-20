import { getTileDefByKey } from "../../data/tile_lookup.js";
import { layoutCandidateDoors } from "./layout_core.js";

/**
 * Simple harbor-focused accessibility helpers:
 * - Clean up doors that don't lead to reachable ground.
 * - Carve extra doors when a harbor building has none usable.
 * - Connect isolated harbor land "islands" that contain buildings via a pier/bridge.
 *
 * Only intended for port towns for now.
 */

function isTownWalkable(ctx, x, y) {
  const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
  const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
  if (!rows || !cols) return false;
  if (y <= 0 || y >= rows - 1) return false;
  if (x <= 0 || x >= cols - 1) return false;
  const t = ctx.map[y][x];
  if (
    t === ctx.TILES.FLOOR ||
    t === ctx.TILES.ROAD ||
    t === ctx.TILES.DOOR ||
    t === ctx.TILES.PIER
  ) {
    return true;
  }
  // Ship decks are also walkable surfaces in harbors.
  try {
    if (ctx.TILES && typeof ctx.TILES.SHIP_DECK === "number" && t === ctx.TILES.SHIP_DECK) {
      return true;
    }
  } catch (_) {}
  return false;
}

function buildReachableMask(ctx, W, H, gate) {
  const reachable = Array.from({ length: H }, () => Array(W).fill(false));
  if (!gate || typeof gate.x !== "number" || typeof gate.y !== "number") return reachable;
  const gx = gate.x | 0;
  const gy = gate.y | 0;
  if (!isTownWalkable(ctx, gx, gy)) return reachable;

  const q = [];
  reachable[gy][gx] = true;
  q.push({ x: gx, y: gy });
  const dirs4 = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  while (q.length) {
    const cur = q.shift();
    for (let i = 0; i < dirs4.length; i++) {
      const nx = cur.x + dirs4[i].dx;
      const ny = cur.y + dirs4[i].dy;
      if (ny <= 0 || ny >= H - 1 || nx <= 0 || nx >= W - 1) continue;
      if (reachable[ny][nx]) continue;
      if (!isTownWalkable(ctx, nx, ny)) continue;
      reachable[ny][nx] = true;
      q.push({ x: nx, y: ny });
    }
  }
  return reachable;
}

function buildingTouchesHarbor(b, harborMask, W, H) {
  if (!harborMask) return false;
  for (let y = b.y; y < b.y + b.h; y++) {
    if (y <= 0 || y >= H - 1) continue;
    const row = harborMask[y];
    if (!row) continue;
    for (let x = b.x; x < b.x + b.w; x++) {
      if (x <= 0 || x >= W - 1) continue;
      if (row[x]) return true;
    }
  }
  return false;
}

function getBuildingDoors(ctx, b) {
  const doors = [];
  const x0 = b.x, y0 = b.y, x1 = b.x + b.w - 1, y1 = b.y + b.h - 1;
  for (let x = x0; x <= x1; x++) {
    if (ctx.map[y0][x] === ctx.TILES.DOOR) doors.push({ x, y: y0 });
    if (y1 !== y0 && ctx.map[y1][x] === ctx.TILES.DOOR) doors.push({ x, y: y1 });
  }
  for (let y = y0 + 1; y <= y1 - 1; y++) {
    if (ctx.map[y][x0] === ctx.TILES.DOOR) doors.push({ x: x0, y });
    if (x1 !== x0 && ctx.map[y][x1] === ctx.TILES.DOOR) doors.push({ x: x1, y });
  }
  return doors;
}

function outsideOfDoor(b, d) {
  const x0 = b.x, y0 = b.y, x1 = b.x + b.w - 1, y1 = b.y + b.h - 1;
  if (d.y === y0)       return { x: d.x,     y: d.y - 1 }; // top side
  if (d.y === y1)       return { x: d.x,     y: d.y + 1 }; // bottom
  if (d.x === x0)       return { x: d.x - 1, y: d.y };     // left
  if (d.x === x1)       return { x: d.x + 1, y: d.y };     // right
  return null;
}

function fixHarborBuildingDoors(ctx, buildings, W, H, harborMask, reachable) {
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (!buildingTouchesHarbor(b, harborMask, W, H)) continue;

    const doors = getBuildingDoors(ctx, b);
    if (!doors.length) continue;

    const goodDoors = [];
    const badDoors = [];

    for (let j = 0; j < doors.length; j++) {
      const d = doors[j];
      const out = outsideOfDoor(b, d);
      if (!out) {
        badDoors.push(d);
        continue;
      }
      const ox = out.x | 0;
      const oy = out.y | 0;
      if (oy <= 0 || oy >= H - 1 || ox <= 0 || ox >= W - 1) {
        badDoors.push(d);
        continue;
      }
      if (!isTownWalkable(ctx, ox, oy)) {
        badDoors.push(d);
        continue;
      }
      if (!reachable[oy][ox]) {
        badDoors.push(d);
        continue;
      }
      goodDoors.push(d);
    }

    // If we have at least one good door, we can safely remove the bad ones.
    if (goodDoors.length > 0) {
      for (let j = 0; j < badDoors.length; j++) {
        const d = badDoors[j];
        ctx.map[d.y][d.x] = ctx.TILES.WALL;
      }
      continue;
    }

    // No good doors: attempt to carve a new one on a side with reachable outside ground.
    const candidates = layoutCandidateDoors(b);
    let carved = false;
    for (let j = 0; j < candidates.length && !carved; j++) {
      const c = candidates[j];
      const cx = c.x | 0;
      const cy = c.y | 0;
      const ox = (c.x + c.ox) | 0;
      const oy = (c.y + c.oy) | 0;
      if (cy <= 0 || cy >= H - 1 || cx <= 0 || cx >= W - 1) continue;
      if (oy <= 0 || oy >= H - 1 || ox <= 0 || ox >= W - 1) continue;
      if (ctx.map[cy][cx] !== ctx.TILES.WALL) continue;
      if (!isTownWalkable(ctx, ox, oy)) continue;
      if (!reachable[oy][ox]) continue;
      ctx.map[cy][cx] = ctx.TILES.DOOR;
      carved = true;
    }
    // If carving fails, we leave the building as-is; it may remain unreachable.
  }
}

function islandHasBuilding(k, compId, buildings, W, H) {
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    for (let y = b.y; y < b.y + b.h; y++) {
      if (y <= 0 || y >= H - 1) continue;
      for (let x = b.x; x < b.x + b.w; x++) {
        if (x <= 0 || x >= W - 1) continue;
        if (compId[y][x] === k) return true;
      }
    }
  }
  return false;
}

function ensureHarborIslandAccess(ctx, buildings, W, H, harborMask, reachable) {
  if (!harborMask) return;

  // Resolve harbor water tile id so we only convert real water into PIER.
  let WATER = null;
  try {
    const td = getTileDefByKey("town", "HARBOR_WATER") || null;
    if (td && typeof td.id === "number") WATER = td.id | 0;
  } catch (_) {}
  if (WATER == null) return;

  const harborLand = Array.from({ length: H }, () => Array(W).fill(false));

  for (let y = 1; y < H - 1; y++) {
    const row = harborMask[y];
    if (!row) continue;
    for (let x = 1; x < W - 1; x++) {
      if (!row[x]) continue;
      const t = ctx.map[y][x];
      const isLand =
        t === ctx.TILES.FLOOR ||
        t === ctx.TILES.ROAD ||
        t === ctx.TILES.PIER ||
        t === ctx.TILES.DOOR;
      if (isLand) harborLand[y][x] = true;
    }
  }

  const compId = Array.from({ length: H }, () => Array(W).fill(-1));
  let compCount = 0;
  const dirs4 = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (!harborLand[y][x]) continue;
      if (compId[y][x] !== -1) continue;
      const q = [];
      q.push({ x, y });
      compId[y][x] = compCount;
      while (q.length) {
        const cur = q.shift();
        for (let i = 0; i < dirs4.length; i++) {
          const nx = cur.x + dirs4[i].dx;
          const ny = cur.y + dirs4[i].dy;
          if (ny <= 0 || ny >= H - 1 || nx <= 0 || nx >= W - 1) continue;
          if (!harborLand[ny][nx]) continue;
          if (compId[ny][nx] !== -1) continue;
          compId[ny][nx] = compCount;
          q.push({ x: nx, y: ny });
        }
      }
      compCount++;
    }
  }

  if (!compCount) return;

  const gateBridgeMask = Array.isArray(ctx.townGateBridgeMask) ? ctx.townGateBridgeMask : null;

  for (let k = 0; k < compCount; k++) {
    let anyReachable = false;
    for (let y = 1; y < H - 1 && !anyReachable; y++) {
      for (let x = 1; x < W - 1 && !anyReachable; x++) {
        if (compId[y][x] !== k) continue;
        if (reachable[y][x]) anyReachable = true;
      }
    }
    if (anyReachable) continue;
    // Only consider islands that host a building; pure scenery islands can remain unreachable.
    if (!islandHasBuilding(k, compId, buildings, W, H)) continue;

    const mainLand = [];
    const islandLand = [];

    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (!harborLand[y][x]) continue;
        if (compId[y][x] === k) {
          islandLand.push({ x, y });
        } else if (reachable[y][x]) {
          mainLand.push({ x, y });
        }
      }
    }
    if (!mainLand.length || !islandLand.length) continue;

    let bestPair = null;
    let bestD = Infinity;
    for (let i = 0; i < mainLand.length; i++) {
      const a = mainLand[i];
      for (let j = 0; j < islandLand.length; j++) {
        const b = islandLand[j];
        const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        if (d < bestD) {
          bestD = d;
          bestPair = { a, b };
        }
      }
    }
    if (!bestPair) continue;

    function inBoundsLocal(x, y) {
      return x > 0 && y > 0 && x < W - 1 && y < H - 1;
    }

    function carveBridgePath(path) {
      for (let i = 0; i < path.length; i++) {
        const cx = path[i].x;
        const cy = path[i].y;
        if (!inBoundsLocal(cx, cy)) return false;
        // Do not overwrite buildings or walls.
        const tile = ctx.map[cy][cx];
        if (tile === ctx.TILES.WALL) return false;
        // Optionally avoid carving through gate bridge corridor.
        if (gateBridgeMask && gateBridgeMask[cy] && gateBridgeMask[cy][cx]) return false;
      }
      // Second pass: convert harbor water along path into PIER, widening to 2 tiles when possible.
      for (let i = 0; i < path.length; i++) {
        const cx = path[i].x;
        const cy = path[i].y;
        let t = ctx.map[cy][cx];
        if (t === WATER && harborMask[cy] && harborMask[cy][cx]) {
          ctx.map[cy][cx] = ctx.TILES.PIER;
          t = ctx.map[cy][cx];
        }
        if (t !== ctx.TILES.PIER) continue;
        // Widen: look at neighbors perpendicular to direction of travel between consecutive points.
        const prev = i > 0 ? path[i - 1] : null;
        const next = i + 1 < path.length ? path[i + 1] : null;
        let dx = 0, dy = 0;
        if (next) {
          dx = next.x - cx;
          dy = next.y - cy;
        } else if (prev) {
          dx = cx - prev.x;
          dy = cy - prev.y;
        }
        let sideOffsets;
        if (dx !== 0) {
          sideOffsets = [{ sx: 0, sy: -1 }, { sx: 0, sy: 1 }];
        } else if (dy !== 0) {
          sideOffsets = [{ sx: -1, sy: 0 }, { sx: 1, sy: 0 }];
        } else {
          sideOffsets = [];
        }
        for (let si = 0; si < sideOffsets.length; si++) {
          const sx = cx + sideOffsets[si].sx;
          const sy = cy + sideOffsets[si].sy;
          if (!inBoundsLocal(sx, sy)) continue;
          if (!harborMask[sy] || !harborMask[sy][sx]) continue;
          if (gateBridgeMask && gateBridgeMask[sy] && gateBridgeMask[sy][sx]) continue;
          if (ctx.map[sy][sx] !== WATER) continue;
          ctx.map[sy][sx] = ctx.TILES.PIER;
        }
      }
      return true;
    }

    const a = bestPair.a;
    const b = bestPair.b;

    // Build an L-shaped Manhattan path: horizontal then vertical.
    const path1 = [];
    let x = a.x;
    let y = a.y;
    while (x !== b.x) {
      x += (b.x > x ? 1 : -1);
      path1.push({ x, y });
    }
    while (y !== b.y) {
      y += (b.y > y ? 1 : -1);
      path1.push({ x, y });
    }

    if (!carveBridgePath(path1)) {
      // Try vertical then horizontal as a fallback.
      const path2 = [];
      x = a.x;
      y = a.y;
      while (y !== b.y) {
        y += (b.y > y ? 1 : -1);
        path2.push({ x, y });
      }
      while (x !== b.x) {
        x += (b.x > x ? 1 : -1);
        path2.push({ x, y });
      }
      carveBridgePath(path2);
    }
  }
}

export function ensureHarborAccessibility(ctx, buildings, W, H, gate) {
  try {
    if (!ctx || ctx.townKind !== "port") return;
    const harborMask = Array.isArray(ctx.townHarborMask) ? ctx.townHarborMask : null;
    if (!harborMask || !harborMask.length) return;

    const reachable = buildReachableMask(ctx, W, H, gate);
    fixHarborBuildingDoors(ctx, buildings, W, H, harborMask, reachable);

    const reachable2 = buildReachableMask(ctx, W, H, gate);
    ensureHarborIslandAccess(ctx, buildings, W, H, harborMask, reachable2);
  } catch (_) {
    // Harbor accessibility is best-effort; never break town generation.
  }
}