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

// ---------------------------------------------------------------------------
// Prefab-driven full floor generator for towers
// ---------------------------------------------------------------------------

function hasTag(prefab, tag) {
  try {
    return Array.isArray(prefab.tags) &&
      prefab.tags.some(t => String(t || "").toLowerCase() === String(tag || "").toLowerCase());
  } catch (_) {
    return false;
  }
}

function sampleWithoutReplacement(arr, count, rng) {
  const out = [];
  if (!Array.isArray(arr) || !arr.length || count <= 0) return out;
  const src = arr.slice();
  const r = typeof rng === "function" ? rng : () => 0.5;
  const n = Math.min(src.length, count);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(r() * src.length) % src.length;
    out.push(src[idx]);
    src.splice(idx, 1);
  }
  return out;
}

function pickTowerRoomsForFloor(ctx, floorIndex, totalFloors) {
  const reg = towerRegistry(ctx);
  if (!reg || !reg.rooms || !reg.rooms.length) return [];
  const rooms = reg.rooms;
  const rng = getRng(ctx);
  const total = Math.max(1, totalFloors | 0);
  const f = Math.max(1, floorIndex | 0);
  const isTop = f === total;

  const nonBoss = rooms.filter(r => !hasTag(r, "boss"));
  if (isTop) {
    const bossRooms = rooms.filter(r => hasTag(r, "boss"));
    const boss = bossRooms[0] || rooms[0];
    const supportPool = nonBoss.filter(r => r !== boss);
    const supportCount = Math.max(1, Math.min(3, supportPool.length));
    const support = sampleWithoutReplacement(supportPool, supportCount, rng);
    return [boss, ...support];
  }

  if (!nonBoss.length) return [];
  // Target 3–5 rooms per floor, limited by available prefabs.
  const target = Math.max(3, Math.min(5, nonBoss.length));
  return sampleWithoutReplacement(nonBoss, target, rng);
}

function rectsOverlap(a, b) {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

function roomCenter(rect) {
  return {
    x: (rect && typeof rect.x === "number" && typeof rect.w === "number")
      ? (rect.x + Math.floor(rect.w / 2))
      : 0,
    y: (rect && typeof rect.y === "number" && typeof rect.h === "number")
      ? (rect.y + Math.floor(rect.h / 2))
      : 0
  };
}

function carveCorridor(ctx, x1, y1, x2, y2) {
  const T = ctx.TILES;
  const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
  const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
  if (!rows || !cols) return;

  const clampX = x => Math.max(0, Math.min(cols - 1, x | 0));
  const clampY = y => Math.max(0, Math.min(rows - 1, y | 0));

  let cx = clampX(x1);
  let cy = clampY(y1);
  const tx = clampX(x2);
  const ty = clampY(y2);

  const horizFirst = (Math.abs(tx - cx) >= Math.abs(ty - cy));

  function carveTile(x, y) {
    const t = ctx.map[y][x];
    if (t === T.WALL) ctx.map[y][x] = T.FLOOR;
  }

  if (horizFirst) {
    const stepX = tx >= cx ? 1 : -1;
    while (cx !== tx) {
      carveTile(cx, cy);
      cx += stepX;
    }
    const stepY = ty >= cy ? 1 : -1;
    while (cy !== ty) {
      carveTile(cx, cy);
      cy += stepY;
    }
  } else {
    const stepY = ty >= cy ? 1 : -1;
    while (cy !== ty) {
      carveTile(cx, cy);
      cy += stepY;
    }
    const stepX = tx >= cx ? 1 : -1;
    while (cx !== tx) {
      carveTile(cx, cy);
      cx += stepX;
    }
  }
  carveTile(tx, ty);
}

export function buildTowerFloorLayout(ctx, towerRun, floorIndex, totalFloors) {
  if (!ctx || !towerRun) return null;
  const T = ctx.TILES;

  // Determine a compact map size for towers based on the base dungeon size.
  const baseRows = (typeof ctx.MAP_ROWS === "number" && ctx.MAP_ROWS > 0)
    ? ctx.MAP_ROWS
    : (Array.isArray(ctx.map) ? ctx.map.length : 60);
  const baseCols = (typeof ctx.MAP_COLS === "number" && ctx.MAP_COLS > 0)
    ? ctx.MAP_COLS
    : (Array.isArray(ctx.map) && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 80);

  const rows = Math.max(14, Math.floor(baseRows * 0.4));
  const cols = Math.max(20, Math.floor(baseCols * 0.4));

  // Initialize a fresh map and visibility arrays.
  ctx.map = Array.from({ length: rows }, () => Array(cols).fill(T.WALL));
  ctx.seen = Array.from({ length: rows }, () => Array(cols).fill(false));
  ctx.visible = Array.from({ length: rows }, () => Array(cols).fill(false));
  ctx.enemies = [];
  ctx.corpses = [];
  ctx.decals = [];

  const f = Math.max(1, floorIndex | 0);
  const total = Math.max(1, totalFloors | 0);

  const meta = {
    map: ctx.map,
    seen: ctx.seen,
    visible: ctx.visible,
    enemies: ctx.enemies,
    corpses: ctx.corpses,
    decals: ctx.decals,
    dungeonProps: [],
    chestSpots: [],
    floorIndex: f,
    floorLevel: ctx.floor || (towerRun.baseLevel + (f - 1)),
    exitToWorldPos: null,
    stairsUpPos: null,
    stairsDownPos: null
  };

  const rng = getRng(ctx);
  const rooms = pickTowerRoomsForFloor(ctx, f, total);
  if (!rooms.length) {
    // No prefabs available; leave meta as-is and let callers fall back.
    return meta;
  }

  const roomMetas = [];
  const maxTriesPerRoom = 50;

  for (let i = 0; i < rooms.length; i++) {
    const prefab = rooms[i];
    const w = (prefab.size && prefab.size.w) | 0;
    const h = (prefab.size && prefab.size.h) | 0;
    if (!w || !h) continue;

    let placed = false;
    for (let t = 0; t < maxTriesPerRoom && !placed; t++) {
      const x0 = 1 + Math.floor(rng() * Math.max(1, cols - w - 2));
      const y0 = 1 + Math.floor(rng() * Math.max(1, rows - h - 2));
      const rect = { x: x0, y: y0, w, h };
      let overlaps = false;
      for (let j = 0; j < roomMetas.length; j++) {
        if (rectsOverlap(rect, roomMetas[j])) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;

      if (!stampTowerRoom(ctx, prefab, x0, y0, meta)) continue;

      const room = { prefab, x: x0, y: y0, w, h, doors: [] };
      // Collect door positions for corridor connections.
      try {
        const tiles = Array.isArray(prefab.tiles) ? prefab.tiles : [];
        for (let yy = 0; yy < h; yy++) {
          const row = tiles[yy];
          if (!row) continue;
          for (let xx = 0; xx < w; xx++) {
            const codeRaw = row[xx];
            const code = (typeof codeRaw === "string" ? codeRaw.toUpperCase() : "");
            if (code === "DOOR") {
              room.doors.push({ x: x0 + xx, y: y0 + yy });
            }
          }
        }
      } catch (_) {}
      roomMetas.push(room);
      placed = true;
    }
  }

  if (!roomMetas.length) {
    return meta;
  }

  // Ensure each room has at least one door; if not, synthesize a door at center.
  for (const r of roomMetas) {
    if (!Array.isArray(r.doors) || !r.doors.length) {
      const c = roomCenter(r);
      r.doors = [{ x: c.x, y: c.y }];
      try {
        if (ctx.map[c.y] && typeof ctx.map[c.y][c.x] !== "undefined") {
          ctx.map[c.y][c.x] = T.DOOR;
        }
      } catch (_) {}
    }
  }

  // Connect rooms via corridors (simple spanning tree).
  if (roomMetas.length > 1) {
    const connected = [roomMetas[0]];
    const remaining = roomMetas.slice(1);

    function pickRandomDoor(room) {
      if (!room.doors || !room.doors.length) {
        const c = roomCenter(room);
        return { x: c.x, y: c.y };
      }
      return room.doors[Math.floor(rng() * room.doors.length) % room.doors.length];
    }

    while (remaining.length) {
      const idx = Math.floor(rng() * remaining.length) % remaining.length;
      const room = remaining.splice(idx, 1)[0];
      const target = connected[Math.floor(rng() * connected.length) % connected.length];
      const a = pickRandomDoor(room);
      const b = pickRandomDoor(target);
      carveCorridor(ctx, a.x, a.y, b.x, b.y);
      connected.push(room);
    }
  }

  // Choose a base entry room: prefer connector/hall rooms if available.
  let entryRoom = roomMetas[0];
  for (const r of roomMetas) {
    const pf = r.prefab;
    if (hasTag(pf, "hall") || hasTag(pf, "connector")) {
      entryRoom = r;
      break;
    }
  }
  const entryCenter = roomCenter(entryRoom);
  const ex = Math.max(1, Math.min(cols - 2, entryCenter.x | 0));
  const ey = Math.max(1, Math.min(rows - 2, entryCenter.y | 0));
  // Seed player position so tower runtime can place stairs/exit consistently.
  ctx.player.x = ex;
  ctx.player.y = ey;

  return meta;
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