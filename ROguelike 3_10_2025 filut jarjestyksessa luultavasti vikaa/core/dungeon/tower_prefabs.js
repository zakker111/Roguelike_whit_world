/**
 * Tower room prefabs: JSON-driven interior layouts for tower floors.
 *
 * Data source:
 *   data/dungeon/tower_prefabs.json -> GameData.towerPrefabs
 *
 * Each room prefab:
 *   {
 *     id: "tower_barracks_small",
 *     category: "tower_room",
 *     tags: ["barracks","bandits"],
 *     size: { w, h },
 *     tiles: [[ "WALL","FLOOR","CRATE","CHEST",... ], ...]
 *   }
 *
 * Tile codes:
 *   - WALL/FLOOR/DOOR/STAIRS: mapped to ctx.TILES.*
 *   - Embedded prop codes (see jcdocs.embeddedPropCodes):
 *       CHEST    -> chest spawn spot (meta.chestSpots; actual chest via DungeonItems)
 *       CRATE    -> dungeon prop { type: "crate" }
 *       BARREL   -> dungeon prop { type: "barrel" }
 *       CAMPFIRE -> dungeon prop { type: "campfire" }
 *       CAPTIVE  -> dungeon prop { type: "captive" }
 *       BED/TABLE/CHAIR/RUG -> dungeon props of same type (visual only for now)
 *
 * Stamping:
 *   - We look for an all-FLOOR rectangle big enough for the room.
 *   - We avoid tiles used for tower stairs/entrance so we do not overwrite exits.
 *   - We write tiles into ctx.map and accumulate dungeonProps + chestSpots into meta.
 */

import { getGameData, getRNGUtils } from "../../utils/access.js";

function towerRegistry(ctx) {
  try {
    const GD = getGameData(ctx);
    if (!GD || !GD.towerPrefabs || typeof GD.towerPrefabs !== "object") return null;
    const rooms = Array.isArray(GD.towerPrefabs.rooms) ? GD.towerPrefabs.rooms : null;
    if (!rooms || rooms.length === 0) return null;
    return { rooms };
  } catch (_) {
    return null;
  }
}

export function towerPrefabsAvailable(ctx) {
  return !!towerRegistry(ctx);
}

// Map embedded codes in tower_prefabs.json to dungeon props or chest spots.
const TOWER_PROPMAP = {
  CHEST: "chest_spot",
  CRATE: "crate",
  BARREL: "barrel",
  CAMPFIRE: "campfire",
  CAPTIVE: "captive",
  BED: "bed",
  TABLE: "table",
  CHAIR: "chair",
  RUG: "rug"
};

function getRng(ctx) {
  const RU = getRNGUtils(ctx) || (typeof window !== "undefined" ? (window.RNGUtils || null) : null);
  if (RU && typeof RU.getRng === "function") {
    const seedFn = typeof ctx.rng === "function" ? ctx.rng : undefined;
    try { return RU.getRng(seedFn); } catch (_) {}
  }
  if (typeof ctx.rng === "function") return ctx.rng;
  return () => 0.5;
}

// Find a rectangle of FLOOR tiles where a prefab can be stamped without
// touching protected tiles like stairs/entrance.
function findRectForPrefab(ctx, prefab, meta) {
  if (!ctx || !prefab || !prefab.size || !Array.isArray(prefab.tiles)) return null;
  const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
  const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
  if (!rows || !cols) return null;

  const w = prefab.size.w | 0;
  const h = prefab.size.h | 0;
  if (!w || !h) return null;

  const T = ctx.TILES;

  const blacklist = [];
  try {
    if (meta && meta.exitToWorldPos) blacklist.push(meta.exitToWorldPos);
    if (meta && meta.stairsUpPos) blacklist.push(meta.stairsUpPos);
    if (meta && meta.stairsDownPos) blacklist.push(meta.stairsDownPos);
  } catch (_) {}

  const isBlacklisted = (x, y) =>
    blacklist.some(p => p && p.x === x && p.y === y);

  outer: for (let y0 = 1; y0 <= rows - h - 1; y0++) {
    for (let x0 = 1; x0 <= cols - w - 1; x0++) {
      // Check rectangle
      for (let yy = 0; yy < h; yy++) {
        const row = ctx.map[y0 + yy];
        if (!row) continue outer;
        for (let xx = 0; xx < w; xx++) {
          const wx = x0 + xx;
          const wy = y0 + yy;
          const t = row[wx];
          if (t !== T.FLOOR) continue outer;
          if (isBlacklisted(wx, wy)) continue outer;
        }
      }
      return { x: x0, y: y0 };
    }
  }
  return null;
}

// Stamp a single tower room prefab into ctx.map and collect props + chest spots.
export function stampTowerRoom(ctx, prefab, bx, by, meta) {
  if (!ctx || !prefab || !prefab.size || !Array.isArray(prefab.tiles)) return false;
  const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
  const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
  if (!rows || !cols) return false;

  const w = prefab.size.w | 0;
  const h = prefab.size.h | 0;
  if (!w || !h) return false;

  const x0 = bx | 0;
  const y0 = by | 0;
  const x1 = x0 + w - 1;
  const y1 = y0 + h - 1;
  if (x0 < 0 || y0 < 0 || x1 >= cols || y1 >= rows) return false;

  const T = ctx.TILES;
  if (!meta) meta = {};
  if (!Array.isArray(meta.dungeonProps)) meta.dungeonProps = Array.isArray(ctx.dungeonProps) ? ctx.dungeonProps : [];
  if (!Array.isArray(meta.chestSpots)) meta.chestSpots = [];

  for (let yy = 0; yy < h; yy++) {
    const row = prefab.tiles[yy];
    if (!row || row.length < w) return false;
  }

  for (let yy = 0; yy < h; yy++) {
    const row = prefab.tiles[yy];
    for (let xx = 0; xx < w; xx++) {
      const codeRaw = row[xx];
      const code = (typeof codeRaw === "string" ? codeRaw.toUpperCase() : "");
      const wx = x0 + xx;
      const wy = y0 + yy;

      if (!ctx.inBounds || !ctx.inBounds(wx, wy)) continue;

      const mapped = TOWER_PROPMAP[code];
      if (mapped) {
        if (mapped === "chest_spot") {
          ctx.map[wy][wx] = T.FLOOR;
          meta.chestSpots.push({ x: wx, y: wy, tags: Array.isArray(prefab.tags) ? prefab.tags.slice() : [] });
        } else {
          ctx.map[wy][wx] = T.FLOOR;
          const propsArr = meta.dungeonProps;
          if (!propsArr.some(p => p && p.x === wx && p.y === wy && p.type === mapped)) {
            propsArr.push({ x: wx, y: wy, type: mapped });
          }
        }
        continue;
      }

      // Structural tiles
      let t = ctx.map[wy][wx];
      if (code === "WALL") t = T.WALL;
      else if (code === "FLOOR") t = T.FLOOR;
      else if (code === "DOOR") t = T.DOOR;
      else if (code === "STAIRS") t = T.STAIRS;
      ctx.map[wy][wx] = t;
    }
  }

  return true;
}

// High-level helper: pick and stamp rooms for a tower floor.
export function stampTowerRoomsForFloor(ctx, meta, floorIndex, totalFloors) {
  const reg = towerRegistry(ctx);
  if (!reg) return;
  const rooms = reg.rooms;
  if (!rooms || !rooms.length) return;

  const rng = getRng(ctx);
  const total = Math.max(1, totalFloors | 0);
  const f = Math.max(1, floorIndex | 0);
  const isTop = f === total;

  // Ensure containers exist on meta so callers can rely on them.
  if (!Array.isArray(meta.dungeonProps)) meta.dungeonProps = Array.isArray(ctx.dungeonProps) ? ctx.dungeonProps : [];
  if (!Array.isArray(meta.chestSpots)) meta.chestSpots = [];

  function hasTag(prefab, tag) {
    try {
      return Array.isArray(prefab.tags) && prefab.tags.some(t => String(t || "").toLowerCase() === tag);
    } catch (_) {
      return false;
    }
  }

  if (isTop) {
    const bossRooms = rooms.filter(r => hasTag(r, "boss"));
    const prefab = bossRooms[0] || rooms[0];
    const pos = findRectForPrefab(ctx, prefab, meta);
    if (pos) {
      stampTowerRoom(ctx, prefab, pos.x, pos.y, meta);
    }
  } else {
    const nonBoss = rooms.filter(r => !hasTag(r, "boss"));
    if (!nonBoss.length) return;
    const idx = Math.floor(rng() * nonBoss.length) % nonBoss.length;
    const prefab = nonBoss[idx];
    const pos = findRectForPrefab(ctx, prefab, meta);
    if (pos) {
      stampTowerRoom(ctx, prefab, pos.x, pos.y, meta);
    }
  }
}