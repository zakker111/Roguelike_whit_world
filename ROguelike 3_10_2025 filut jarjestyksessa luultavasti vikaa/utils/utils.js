/**
 * Utils: small shared helpers reused across modules.
 *
 * Exports (window.Utils):
 * - manhattan(ax, ay, bx, by)
 * - isFreeFloor(ctx, x, y): generic free-floor check (dungeon/town maps)
 * - isFreeTownFloor(ctx, x, y): town-specific free tile check including props/NPCs
 */
(function () {
  function manhattan(ax, ay, bx, by) {
    return Math.abs(ax - bx) + Math.abs(ay - by);
  }

  function isWalkableTile(ctx, x, y) {
    if (!ctx || !Array.isArray(ctx.map) || !ctx.map.length) return false;
    const rows = ctx.map.length, cols = ctx.map[0] ? ctx.map[0].length : 0;
    if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
    const t = ctx.map[y][x];
    const T = ctx.TILES || {};
    // Walkable tiles for dungeon/town maps
    return t === T.FLOOR || t === T.DOOR || t === T.STAIRS;
  }

  // Generic free-floor check for dungeon or town maps (ignores town props by default)
  function isFreeFloor(ctx, x, y) {
    if (!isWalkableTile(ctx, x, y)) return false;
    const { player, enemies } = ctx;
    if (player && player.x === x && player.y === y) return false;
    if (Array.isArray(enemies) && enemies.some(e => e.x === x && e.y === y)) return false;
    return true;
  }

  // Town-specific free-floor check (considers props and NPCs)
  function isFreeTownFloor(ctx, x, y) {
    if (!isWalkableTile(ctx, x, y)) return false;
    const { player, npcs, townProps } = ctx;
    if (player && player.x === x && player.y === y) return false;
    if (Array.isArray(npcs) && npcs.some(n => n.x === x && n.y === y)) return false;
    if (Array.isArray(townProps) && townProps.some(p => p.x === x && p.y === y)) return false;
    return true;
  }

  window.Utils = {
    manhattan,
    isFreeFloor,
    isFreeTownFloor,
  };
})();