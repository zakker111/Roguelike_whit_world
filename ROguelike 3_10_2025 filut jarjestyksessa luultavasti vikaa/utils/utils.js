/**
 * Utils: small shared helpers reused across modules.
 *
 * Exports (ESM + window.Utils):
 * - manhattan(ax, ay, bx, by)
 * - inBounds(ctx, x, y)
 * - isWalkableTile(ctx, x, y): JSON-first walkability (ignores occupancy)
 * - isFreeFloor(ctx, x, y): generic free-floor check (dungeon/town maps)
 * - isFreeTownFloor(ctx, x, y): town-specific free tile check including props/NPCs
 */

export function manhattan(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

export function inBounds(ctx, x, y) {
  if (!ctx || !Array.isArray(ctx.map) || !ctx.map.length) return false;
  const rows = ctx.map.length, cols = ctx.map[0] ? ctx.map[0].length : 0;
  return x >= 0 && y >= 0 && x < cols && y < rows;
}

// Helper: get tile def from GameData.tiles for the current mode
function getTileDef(ctx, id) {
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const tiles = GD && GD.tiles && Array.isArray(GD.tiles.tiles) ? GD.tiles.tiles : null;
    if (!tiles) return null;
    const mode = String(ctx && ctx.mode ? ctx.mode : "").toLowerCase() || "dungeon";
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if ((t.id | 0) === (id | 0) && Array.isArray(t.appearsIn) && t.appearsIn.some(s => String(s).toLowerCase() === mode)) {
        return t;
      }
    }
  } catch (_) {}
  return null;
}

// Minimal logger helper (DEV-friendly)
function logWarnOnce(msg) {
  try {
    if (!logWarnOnce._seen) logWarnOnce._seen = new Set();
    if (logWarnOnce._seen.has(msg)) return;
    logWarnOnce._seen.add(msg);
    if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") {
      window.Logger.log(msg, "warn");
    } else if (typeof window !== "undefined" && window.DEV) {
      console.warn("[Utils] " + msg);
    }
  } catch (_) {}
}

export function isWalkableTile(ctx, x, y) {
  if (!inBounds(ctx, x, y)) return false;
  const t = ctx.map[y][x];
  const td = getTileDef(ctx, t);
  if (td && td.properties && typeof td.properties.walkable === "boolean") {
    return !!td.properties.walkable;
  }
  logWarnOnce(`tiles.json: walkable missing for tile id=${t} in mode='${String(ctx.mode || "")}'. Movement blocked.`);
  return false;
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

// Back-compat: attach to window for classic scripts
if (typeof window !== "undefined") {
  window.Utils = {
    manhattan,
    inBounds,
    isWalkableTile,
    isFreeFloor,
    isFreeTownFloor,
  };
}