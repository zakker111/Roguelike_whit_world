/**
 * Utils: small shared helpers reused across modules.
 *
 * Exports (ESM + window.Utils):
 * - manhattan(ax, ay, bx, by)
 * - inBounds(ctx, x, y)
 * - isWalkableTile(ctx, x, y): tile-only walkability (ignores occupancy)
 * - isFreeFloor(ctx, x, y): generic free-floor check (dungeon/town maps)
 * - isFreeTownFloor(ctx, x, y): town-specific free tile check including props/NPCs
 */

export function manhattan(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

import { inBounds } from "./bounds.js";
export { inBounds };

export function isWalkableTile(ctx, x, y) {
  if (!inBounds(ctx, x, y)) return false;
  const t = ctx.map[y][x];
  const T = ctx.TILES || {};
  // Walkable tiles for dungeon/town maps (include ROAD for towns)
  return t === T.FLOOR || t === T.DOOR || t === T.STAIRS || t === T.ROAD;
}

// Generic free-floor check for dungeon or town maps (ignores town props by default)
export function isFreeFloor(ctx, x, y) {
  if (!isWalkableTile(ctx, x, y)) return false;
  const { player, enemies } = ctx;
  if (player && player.x === x && player.y === y) return false;
  if (Array.isArray(enemies) && enemies.some(e => e.x === x && e.y === y)) return false;
  return true;
}

// Town-specific free-floor check (considers props and NPCs)
export function isFreeTownFloor(ctx, x, y) {
  if (!isWalkableTile(ctx, x, y)) return false;
  const { player, npcs, townProps } = ctx;
  if (player && player.x === x && player.y === y) return false;
  if (Array.isArray(npcs) && npcs.some(n => n.x === x && n.y === y)) return false;
  if (Array.isArray(townProps) && townProps.some(p => p.x === x && p.y === y)) return false;
  return true;
}

import { attachGlobal } from "./global.js";
// Back-compat: attach to window via helper
attachGlobal("Utils", {
  manhattan,
  inBounds,
  isWalkableTile,
  isFreeFloor,
  isFreeTownFloor,
});