/**
 * Town helpers:
 *  - randInt, manhattan, rngFor
 *  - schedule helpers (inWindow, isOpenAt)
 *  - tile / occupancy helpers (isWalkTown, insideBuilding, propBlocks, isFreeTile, nearestFreeAdjacent, adjustInteriorTarget)
 *
 * Shared between town runtime and related modules.
 */

import { getRNGUtils } from "../utils/access.js";

function randInt(ctx, a, b) {
  return Math.floor(ctx.rng() * (b - a + 1)) + a;
}

function manhattan(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

// Seeded RNG helper: prefers RNGUtils.getRng(ctx.rng), falls back to ctx.rng; deterministic when unavailable
function rngFor(ctx) {
  try {
    const RU = getRNGUtils(ctx);
    if (RU && typeof RU.getRng === "function") {
      return RU.getRng(typeof ctx.rng === "function" ? ctx.rng : undefined);
    }
  } catch (_) {}
  if (typeof ctx.rng === "function") return ctx.rng;
  // Deterministic fallback: constant function
  return () => 0.5;
}

// ---- Schedules ----

function inWindow(start, end, m, dayMinutes) {
  return end > start ? (m >= start && m < end) : (m >= start || m < end);
}

function isOpenAt(shop, minutes, dayMinutes) {
  if (!shop) return false;
  if (shop.alwaysOpen) return true;
  if (typeof shop.openMin !== "number" || typeof shop.closeMin !== "number") return false;
  const o = shop.openMin;
  const c = shop.closeMin;
  if (o === c) return false;
  return inWindow(o, c, minutes, dayMinutes);
}

// ---- Movement/pathing ----

function isWalkTown(ctx, x, y) {
  const { map, TILES } = ctx;
  if (y < 0 || y >= map.length) return false;
  if (x < 0 || x >= (map[0] ? map[0].length : 0)) return false;
  const t = map[y][x];
  return t === TILES.FLOOR || t === TILES.DOOR || t === TILES.ROAD;
}

function insideBuilding(b, x, y) {
  return x > b.x && x < b.x + b.w - 1 && y > b.y && y < b.y + b.h - 1;
}

function propBlocks(type) {
  // Only these props block movement: table, shelf, counter.
  // Everything else is walkable (sign, rug, bed, chair, fireplace, chest, crate, barrel, plant, stall, lamp, well, bench).
  const t = String(type || "").toLowerCase();
  return t === "table" || t === "shelf" || t === "counter";
}

// Fast occupancy-aware free-tile check:
// If ctx._occ is provided (Set of "x,y"), prefer it over O(n) scans of npcs.
function isFreeTile(ctx, x, y) {
  if (!isWalkTown(ctx, x, y)) return false;
  const { player, npcs, townProps } = ctx;
  if (player.x === x && player.y === y) return false;
  const occ = ctx._occ;
  if (occ && occ.has(`${x},${y}`)) return false;
  if (!occ && Array.isArray(npcs) && npcs.some(n => n.x === x && n.y === y)) return false;
  if (Array.isArray(townProps) && townProps.some(p => p.x === x && p.y === y && propBlocks(p.type))) return false;
  return true;
}

function nearestFreeAdjacent(ctx, x, y, constrainToBuilding = null) {
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
    if (constrainToBuilding && !insideBuilding(constrainToBuilding, nx, ny)) continue;
    if (isFreeTile(ctx, nx, ny)) return { x: nx, y: ny };
  }
  return null;
}

// If the intended target tile is occupied by an interior prop (e.g., bed),
// pick the nearest free interior tile adjacent to it within the same building.
function adjustInteriorTarget(ctx, building, target) {
  if (!target || !building) return target;
  // If target is already free, keep it
  if (isFreeTile(ctx, target.x, target.y) && insideBuilding(building, target.x, target.y)) return target;
  const alt = nearestFreeAdjacent(ctx, target.x, target.y, building);
  return alt || target;
}

export {
  randInt,
  manhattan,
  rngFor,
  inWindow,
  isOpenAt,
  isWalkTown,
  insideBuilding,
  propBlocks,
  isFreeTile,
  nearestFreeAdjacent,
  adjustInteriorTarget,
};