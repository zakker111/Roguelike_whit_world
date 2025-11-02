/**
 * Doors and Windows helpers for Town generation.
 * Exports:
 *  - candidateDoors(ctx,b): perimeter door candidates with outward vectors
 *  - ensureDoor(ctx,b): ensure a door exists on the building perimeter; return chosen door
 *  - getExistingDoor(ctx,b): return existing door or ensure and return one
 *  - placeWindowsOnAll(ctx, buildings): place WINDOW tiles on walls (non-prefab), spaced and not near doors
 */
import { attachGlobal } from "../utils/global.js";

function inBounds(ctx, x, y) {
  try {
    if (ctx && ctx.Utils && typeof ctx.Utils.inBounds === "function") return ctx.Utils.inBounds(ctx, x, y);
    if (typeof window !== "undefined" && window.Utils && typeof window.Utils.inBounds === "function") {
      return window.Utils.inBounds(ctx, x, y);
    }
  } catch (_) {}
  const rows = ctx.map.length;
  const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
  return x >= 0 && y >= 0 && x < cols && y < rows;
}

export function candidateDoors(ctx, b) {
  return [
    { x: b.x + ((b.w / 2) | 0), y: b.y, ox: 0, oy: -1 },                      // top
    { x: b.x + b.w - 1, y: b.y + ((b.h / 2) | 0), ox: +1, oy: 0 },            // right
    { x: b.x + ((b.w / 2) | 0), y: b.y + b.h - 1, ox: 0, oy: +1 },            // bottom
    { x: b.x, y: b.y + ((b.h / 2) | 0), ox: -1, oy: 0 },                      // left
  ];
}

export function ensureDoor(ctx, b) {
  const cands = candidateDoors(ctx, b);
  const good = cands.filter(d => inBounds({ map: ctx.map }, d.x + d.ox, d.y + d.oy) && ctx.map[d.y + d.oy][d.x + d.ox] === ctx.TILES.FLOOR);
  const total = (good.length ? good.length : cands.length);
  const rfn = (typeof ctx.rng === "function") ? ctx.rng : (() => 0.5);
  const pick = (good.length ? good : cands)[(Math.floor(rfn() * total)) % total];
  if (inBounds(ctx, pick.x, pick.y)) ctx.map[pick.y][pick.x] = ctx.TILES.DOOR;
  return pick;
}

export function getExistingDoor(ctx, b) {
  const cds = candidateDoors(ctx, b);
  for (const d of cds) {
    if (inBounds(ctx, d.x, d.y) && ctx.map[d.y][d.x] === ctx.TILES.DOOR) return { x: d.x, y: d.y };
  }
  const dd = ensureDoor(ctx, b);
  return { x: dd.x, y: dd.y };
}

// Windows along building walls (spaced, not near doors) for non-prefab buildings
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
  function isAdjacent(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1; }
  function nearDoor(x, y) {
    const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
    for (let i = 0; i < dirs.length; i++) {
      const nx = x + dirs[i].dx, ny = y + dirs[i].dy;
      if (!inBounds(ctx, nx, ny)) continue;
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
        if (!inBounds(ctx, p.x, p.y)) continue;
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
    const rfn = (typeof ctx.rng === "function") ? ctx.rng : (() => 0.5);
    while (placed.length < limit && candidates.length > 0 && attempts++ < candidates.length * 2) {
      const idx = Math.floor(rfn() * candidates.length);
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

attachGlobal("DoorsWindows", { candidateDoors, ensureDoor, getExistingDoor, placeWindowsOnAll });