export function createMapOps(getCtx) {
  const ctx = () => (typeof getCtx === "function" ? getCtx() : null);

  function inBounds(x, y) {
    const c = ctx();

    // Centralize via Utils.inBounds; fallback to local map bounds
    const U = (c && c.Utils) || (typeof window !== "undefined" ? window.Utils : null);
    if (U && typeof U.inBounds === "function") {
      return !!U.inBounds(c, x, y);
    }

    const map = c && c.map;
    const rows = Array.isArray(map) ? map.length : 0;
    const cols = rows && Array.isArray(map[0]) ? map[0].length : 0;
    return x >= 0 && y >= 0 && x < cols && y < rows;
  }

  function isWalkable(x, y) {
    const c = ctx();
    const TILES = (c && c.TILES) || (typeof window !== "undefined" ? window.TILES : null) || {};

    // Upstairs overlay-aware walkability: when active and inside the inn interior, honor upstairs tiles.
    try {
      if (c && c.innUpstairsActive && c.tavern && c.innUpstairs) {
        const b = c.tavern.building || null;
        const up = c.innUpstairs;
        if (b && up) {
          const ox = up.offset ? up.offset.x : (b.x + 1);
          const oy = up.offset ? up.offset.y : (b.y + 1);
          const lx = x - ox, ly = y - oy;
          const w = up.w | 0, h = up.h | 0;
          if (lx >= 0 && ly >= 0 && lx < w && ly < h) {
            const row = up.tiles && up.tiles[ly];
            const t = row ? row[lx] : null;
            if (t != null) {
              // Treat WALL as not walkable; allow FLOOR and STAIRS; disallow DOOR upstairs to avoid "walkable doors" issue.
              return t === TILES.FLOOR || t === TILES.STAIRS;
            }
          }
        }
      }
    } catch (_) {}

    // Centralize via Utils.isWalkableTile; fallback to tile-type check
    const U = (c && c.Utils) || (typeof window !== "undefined" ? window.Utils : null);
    if (U && typeof U.isWalkableTile === "function") {
      return !!U.isWalkableTile(c, x, y);
    }

    const map = c && c.map;
    const rows = Array.isArray(map) ? map.length : 0;
    const cols = rows && Array.isArray(map[0]) ? map[0].length : 0;
    if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
    const t = map[y][x];

    // Fallback walkability when Utils.isWalkableTile is unavailable.
    // Keep in sync with utils.isWalkableTile for town/dungeon maps.
    return (
      t === TILES.FLOOR ||
      t === TILES.DOOR ||
      t === TILES.STAIRS ||
      t === TILES.ROAD ||
      t === TILES.PIER ||
      t === TILES.SHIP_DECK ||
      t === TILES.SHIP_EDGE
    );
  }

  return {
    inBounds,
    isWalkable,
  };
}

// Back-compat naming to match the other game_*_ops modules.
export const createGameMapOps = createMapOps;
