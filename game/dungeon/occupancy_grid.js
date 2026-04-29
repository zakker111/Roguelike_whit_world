/**
 * OccupancyGrid: lightweight per-tile occupancy tracking for entities.
 *
 * Exports (ESM + window.OccupancyGrid):
 * - build({ map, enemies, npcs, props, player }): returns grid object
 * - create(): empty grid instance with methods
 *
 * Grid instance API:
 * - setEnemy(x,y), clearEnemy(x,y), hasEnemy(x,y)
 * - setNPC(x,y), clearNPC(x,y), hasNPC(x,y)
 * - setProp(x,y), clearProp(x,y), hasProp(x,y)
 * - isFree(x,y, { ignorePlayer=false }?) -> walkable excluding occupancies and optionally player
 */

function occKey(x, y) {
  return ((y & 0xffff) << 16) | (x & 0xffff);
}

export function create(map) {
  const enemies = new Set();
  const npcs = new Set();
  const props = new Set();
  const playerRef = { x: -1, y: -1 };
  const isWalkable = (x, y) => {
    if (!Array.isArray(map) || !map.length) return false;
    const rows = map.length, cols = map[0] ? map[0].length : 0;
    if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
    const t = map[y][x];
    // Dungeon/Town tileset: FLOOR, DOOR, STAIRS are walkable; WINDOW is not.
    // World walkability handled elsewhere.
    return t === 1 || t === 2 || t === 3;
  };

  return {
    setPlayer(x, y) { playerRef.x = x | 0; playerRef.y = y | 0; },
    setEnemy(x, y) { enemies.add(occKey(x | 0, y | 0)); },
    clearEnemy(x, y) { enemies.delete(occKey(x | 0, y | 0)); },
    hasEnemy(x, y) { return enemies.has(occKey(x | 0, y | 0)); },

    setNPC(x, y) { npcs.add(occKey(x | 0, y | 0)); },
    clearNPC(x, y) { npcs.delete(occKey(x | 0, y | 0)); },
    hasNPC(x, y) { return npcs.has(occKey(x | 0, y | 0)); },

    setProp(x, y) { props.add(occKey(x | 0, y | 0)); },
    clearProp(x, y) { props.delete(occKey(x | 0, y | 0)); },
    hasProp(x, y) { return props.has(occKey(x | 0, y | 0)); },

    isFree(x, y, opts) {
      const ignorePlayer = !!(opts && opts.ignorePlayer);
      if (!isWalkable(x, y)) return false;
      if (!ignorePlayer && playerRef.x === (x | 0) && playerRef.y === (y | 0)) return false;
      const key = occKey(x | 0, y | 0);
      return !enemies.has(key) && !npcs.has(key) && !props.has(key);
    }
  };
}

export function build({ map, enemies, npcs, props, player }) {
  const grid = create(map);
  if (player && typeof player.x === "number" && typeof player.y === "number") {
    grid.setPlayer(player.x, player.y);
  }
  if (Array.isArray(enemies)) {
    for (const e of enemies) grid.setEnemy(e.x, e.y);
  }
  if (Array.isArray(npcs)) {
    for (const n of npcs) grid.setNPC(n.x, n.y);
  }
  if (Array.isArray(props)) {
    for (const p of props) grid.setProp(p.x, p.y);
  }
  return grid;
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.OccupancyGrid = { create, build };
}