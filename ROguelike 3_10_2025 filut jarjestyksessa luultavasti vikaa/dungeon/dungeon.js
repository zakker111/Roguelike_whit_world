/**
 * Dungeon: rooms, corridors, player/exit placement, enemy spawns.
 *
 * Exports (ESM + window.Dungeon):
 * - generateLevel(ctx, depth): mutates ctx.map/seen/visible/enemies/corpses/startRoomRect and positions player.
 *
 * Determinism:
 * - Uses a per-dungeon PRNG derived from the root RNG seed and the overworld entrance (x,y), level, and size.
 * - Avoids Math.random; all randomness goes through the local dungeon PRNG so initial generation is reproducible.
 * - Runtime changes (corpses/decals/enemies) should be persisted via DungeonState.
 */

function mix32(a) {
  a = (a ^ 61) ^ (a >>> 16);
  a = (a + (a << 3)) | 0;
  a = a ^ (a >>> 4);
  a = Math.imul(a, 0x27d4eb2d);
  a = a ^ (a >>> 15);
  return a >>> 0;
}
function mulberry32(a) {
  return function() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function sizeCode(sizeStr) {
  const s = String(sizeStr || "medium").toLowerCase();
  return s === "small" ? 1 : s === "large" ? 3 : 2;
}
function deriveDungeonSeed(rootSeed, x, y, level, sizeStr) {
  let s = (Number(rootSeed) >>> 0);
  s = mix32(s ^ Math.imul(0x9e3779b1, (x >>> 0)));
  s = mix32(s ^ Math.imul(0x85ebca6b, (y >>> 0)));
  s = mix32(s ^ Math.imul(0xc2b2ae35, (level >>> 0)));
  s = mix32(s ^ (sizeCode(sizeStr) >>> 0));
  return s >>> 0;
}

export function generateLevel(ctx, depth) {
  const { ROWS, COLS, MAP_ROWS, MAP_COLS, TILES, player } = ctx;

  // Determine per-dungeon seed from root RNG + entrance/level/size
  const rootSeed = (typeof window !== "undefined" && window.RNG && typeof RNG.getSeed === "function")
    ? (RNG.getSeed() || 0)
    : 0;
  const dinfo = ctx.dungeonInfo || ctx.dungeon || { x: player.x, y: player.y, level: depth, size: "medium" };
  const dseed = deriveDungeonSeed(rootSeed, dinfo.x | 0, dinfo.y | 0, (depth | 0) || (dinfo.level | 0) || 1, dinfo.size);
  const drng = mulberry32(dseed);
  const ri = (min, max) => Math.floor(drng() * (Math.max(min|0, max|0) - Math.min(min|0, max|0) + 1)) + Math.min(min|0, max|0);
  const ch = (p) => drng() < p;

  // Size/difficulty config from ctx.dungeon
  const sizeStr = (dinfo && dinfo.size) ? String(dinfo.size).toLowerCase() : "medium";
  const sizeFactor = sizeStr === "small" ? 0.6 : sizeStr === "large" ? 1.0 : 0.85;
  const baseRows = (typeof MAP_ROWS === "number" && MAP_ROWS > 0) ? MAP_ROWS : ROWS;
  const baseCols = (typeof MAP_COLS === "number" && MAP_COLS > 0) ? MAP_COLS : COLS;
  const rRows = Math.max(20, Math.floor(baseRows * sizeFactor));
  const rCols = Math.max(30, Math.floor(baseCols * sizeFactor));

  // Init arrays/state
  ctx.map = Array.from({ length: rRows }, () => Array(rCols).fill(TILES.WALL));
  ctx.seen = Array.from({ length: rRows }, () => Array(rCols).fill(false));
  ctx.visible = Array.from({ length: rRows }, () => Array(rCols).fill(false));
  ctx.enemies = [];
  ctx.corpses = [];
  ctx.isDead = false;

  // Rooms
  const rooms = [];
  const area = rRows * rCols;
  const roomAttempts = Math.max(40, Math.floor(area / 120)); // scale with map size
  for (let i = 0; i < roomAttempts; i++) {
    // Room sizes scale gently with dungeon size
    const w = ri(Math.max(4, Math.floor(6 * sizeFactor)), Math.max(7, Math.floor(10 * sizeFactor)));
    const h = ri(Math.max(3, Math.floor(5 * sizeFactor)), Math.max(6, Math.floor(8 * sizeFactor)));
    const x = ri(1, Math.max(1, rCols - w - 2));
    const y = ri(1, Math.max(1, rRows - h - 2));
    const rect = { x, y, w, h };
    if (rooms.every(r => !intersect(rect, r))) {
      rooms.push(rect);
      carveRoom(ctx.map, TILES, rect);
    }
  }

  if (rooms.length === 0) {
    const w = Math.min(9, Math.max(4, Math.floor(rCols / 5) || 6));
    const h = Math.min(7, Math.max(3, Math.floor(rRows / 5) || 4));
    const x = Math.max(1, Math.min(rCols - w - 2, Math.floor(rCols / 2 - w / 2)));
    const y = Math.max(1, Math.min(rRows - h - 2, Math.floor(rRows / 2 - h / 2)));
    const rect = { x, y, w, h };
    rooms.push(rect);
    carveRoom(ctx.map, TILES, rect);
  }
  rooms.sort((a, b) => a.x - b.x);

  // Corridors between room centers + a few extras
  for (let i = 1; i < rooms.length; i++) {
    const a = center(rooms[i - 1]);
    const b = center(rooms[i]);
    if (ch(0.5)) {
      hCorridor(ctx.map, TILES, a.x, b.x, a.y);
      vCorridor(ctx.map, TILES, a.y, b.y, b.x);
    } else {
      vCorridor(ctx.map, TILES, a.y, b.y, a.x);
      hCorridor(ctx.map, TILES, a.x, b.x, b.y);
    }
  }

  const extra = Math.max(0, Math.floor(rooms.length * 0.3));
  for (let n = 0; n < extra; n++) {
    const i = ri(0, rooms.length - 1);
    const j = ri(0, rooms.length - 1);
    if (i === j) continue;
    const a = center(rooms[i]);
    const b = center(rooms[j]);
    if (ch(0.5)) {
      hCorridor(ctx.map, TILES, a.x, b.x, a.y);
      vCorridor(ctx.map, TILES, a.y, b.y, b.x);
    } else {
      vCorridor(ctx.map, TILES, a.y, b.y, a.x);
      hCorridor(ctx.map, TILES, a.x, b.x, b.y);
    }
  }

  // Start placement
  const start = center(rooms[0] || { x: 2, y: 2, w: 1, h: 1 });
  ctx.startRoomRect = rooms[0] || { x: start.x, y: start.y, w: 1, h: 1 };

  // Place player at start
  if (depth === 1) {
    const PlayerMod = (ctx.Player || (typeof window !== "undefined" ? window.Player : null));
    if (PlayerMod && typeof PlayerMod.resetFromDefaults === "function") {
      PlayerMod.resetFromDefaults(ctx.player);
    } else if (PlayerMod && typeof PlayerMod.createInitial === "function") {
      const init = PlayerMod.createInitial();
      Object.assign(ctx.player, init);
    } else {
      Object.assign(ctx.player, {
        hp: 20, maxHp: 40, inventory: [], atk: 1, xp: 0, level: 1, xpNext: 20,
        equipment: { left: null, right: null, head: null, torso: null, legs: null, hands: null }
      });
    }
    ctx.player.x = start.x;
    ctx.player.y = start.y;

    const DI = (ctx.DungeonItems || (typeof window !== "undefined" ? window.DungeonItems : null));
    if (DI && typeof DI.placeChestInStartRoom === "function") {
      // Note: DI may use RNG service or ctx.utils; initial chest placement may vary slightly.
      // Persistence ensures consistency on re-entry.
      DI.placeChestInStartRoom(ctx);
    }
  } else {
    player.x = start.x;
    player.y = start.y;
  }

  // Place a landmark exit tile far from start (descending disabled in game logic)
  let endRoomIndex = rooms.length - 1;
  if (rooms.length > 1 && ctx.startRoomRect) {
    const sc = center(ctx.startRoomRect);
    const endC = center(rooms[endRoomIndex]);
    if (inRect(endC.x, endC.y, ctx.startRoomRect)) {
      let best = endRoomIndex;
      let bestD = -1;
      for (let k = 0; k < rooms.length; k++) {
        const c = center(rooms[k]);
        if (inRect(c.x, c.y, ctx.startRoomRect)) continue;
        const d = Math.abs(c.x - sc.x) + Math.abs(c.y - sc.y);
        if (d > bestD) { bestD = d; best = k; }
      }
      endRoomIndex = best;
    }
  }
  const end = center(rooms[endRoomIndex] || { x: rCols - 3, y: rRows - 3, w: 1, h: 1 });
  const STAIRS = typeof TILES.STAIRS === "number" ? TILES.STAIRS : TILES.DOOR;
  ctx.map[end.y][end.x] = STAIRS;

  // Safety net: ensure at least one stairs exists
  let stairsCount = 0;
  for (let yy = 1; yy < rRows - 1; yy++) {
    for (let xx = 1; xx < rCols - 1; xx++) {
      if (ctx.map[yy][xx] === STAIRS) stairsCount++;
    }
  }
  if (stairsCount === 0) {
    let best = null, bestD = -1;
    for (let yy = 1; yy < rRows - 1; yy++) {
      for (let xx = 1; xx < rCols - 1; xx++) {
        if (ctx.map[yy][xx] !== TILES.FLOOR) continue;
        if (ctx.startRoomRect && inRect(xx, yy, ctx.startRoomRect)) continue;
        const d = Math.abs(xx - ctx.player.x) + Math.abs(yy - ctx.player.y);
        if (d > bestD) { bestD = d; best = { x: xx, y: yy }; }
      }
    }
    if (!best) best = { x: Math.max(1, rCols - 2), y: Math.max(1, rRows - 2) };
    ctx.map[best.y][best.x] = STAIRS;
  }

  // Enemies scale with dungeon difficulty and size
  const sizeMult = sizeStr === "small" ? 0.7 : sizeStr === "large" ? 1.2 : 1.0;
  const baseEnemies = 6 + Math.floor(depth * 3);
  const enemyCount = Math.max(4, Math.floor(baseEnemies * sizeMult));
  const makeEnemy = ctx.enemyFactory || defaultEnemyFactory;

  // For now: ensure diversity — cycle through available types so each dungeon has different enemies regardless of level
  const EM = (typeof window !== "undefined" ? window.Enemies : null);
  let cycleTypes = [];
  try {
    if (EM && typeof EM.listTypes === "function" && typeof EM.getTypeDef === "function") {
      cycleTypes = EM.listTypes().slice(0);
    }
    // Fallback: use GameData.enemies ids if registry not yet applied
    if ((!cycleTypes || cycleTypes.length === 0) && typeof window !== "undefined" && window.GameData && Array.isArray(window.GameData.enemies)) {
      cycleTypes = window.GameData.enemies.map(e => e.id || e.key).filter(Boolean);
    }
    // Deterministic shuffle using drng
    for (let i = cycleTypes.length - 1; i > 0; i--) {
      const j = Math.floor(drng() * (i + 1));
      const tmp = cycleTypes[i]; cycleTypes[i] = cycleTypes[j]; cycleTypes[j] = tmp;
    }
  } catch (_) {}

  // Helper for linear stat tables when building from raw JSON
  function linearAt(arr, d, fallback = 1) {
    if (!Array.isArray(arr) || arr.length === 0) return fallback;
    let chosen = arr[0];
    for (const e of arr) { if ((e[0] | 0) <= d) chosen = e; }
    const minD = chosen[0] | 0, baseV = Number(chosen[1] || fallback), slope = Number(chosen[2] || 0);
    const delta = Math.max(0, d - minD);
    return Math.max(1, Math.floor(baseV + slope * delta));
  }

  for (let i = 0; i < enemyCount; i++) {
    const p = randomFloor(ctx, rooms, ri);
    let enemy = makeEnemy(p.x, p.y, depth, drng);

    // If factory fails or to enforce diversity, build from registry cycling through types
    if (!enemy || typeof enemy.x !== "number" || typeof enemy.y !== "number" || cycleTypes.length) {
      try {
        if (cycleTypes.length) {
          const pickKey = cycleTypes[i % cycleTypes.length] || "goblin";
          let td = EM && typeof EM.getTypeDef === "function" ? EM.getTypeDef(pickKey) : null;
          if (td) {
            enemy = {
              x: p.x, y: p.y,
              type: pickKey,
              glyph: (td.glyph && td.glyph.length) ? td.glyph : ((pickKey && pickKey.length) ? pickKey.charAt(0) : "?"),
              hp: td.hp(depth),
              atk: td.atk(depth),
              xp: td.xp(depth),
              level: (EM.levelFor && typeof EM.levelFor === "function") ? EM.levelFor(pickKey, depth, drng) : depth,
              announced: false
            };
          } else {
            // Build directly from GameData.enemies JSON if registry not yet applied
            const row = (typeof window !== "undefined" && window.GameData && Array.isArray(window.GameData.enemies))
              ? window.GameData.enemies.find(e => (e.id || e.key) === pickKey)
              : null;
            if (row) {
              enemy = {
                x: p.x, y: p.y,
                type: pickKey,
                glyph: (row.glyph && row.glyph.length) ? row.glyph : ((pickKey && pickKey.length) ? pickKey.charAt(0) : "?"),
                hp: linearAt(row.hp || [], depth, 3),
                atk: linearAt(row.atk || [], depth, 1),
                xp: linearAt(row.xp || [], depth, 5),
                level: depth,
                announced: false
              };
            } else {
              enemy = { x: p.x, y: p.y, type: "goblin", glyph: "g", hp: 3, atk: 1, xp: 5, level: depth, announced: false };
            }
          }
        } else {
          enemy = { x: p.x, y: p.y, type: "goblin", glyph: "g", hp: 3, atk: 1, xp: 5, level: depth, announced: false };
        }
      } catch (_) {
        enemy = { x: p.x, y: p.y, type: "goblin", glyph: "g", hp: 3, atk: 1, xp: 5, level: depth, announced: false };
      }
    }
    ctx.enemies.push(enemy);
  }

  const FlavorMod = (ctx.Flavor || (typeof window !== "undefined" ? window.Flavor : null));
  if (FlavorMod && typeof FlavorMod.announceFloorEnemyCount === "function") {
    try { FlavorMod.announceFloorEnemyCount(ctx); } catch (_) {}
  }
}

function carveRoom(map, TILES, { x, y, w, h }) {
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      map[j][i] = TILES.FLOOR;
    }
  }
}

function hCorridor(map, TILES, x1, x2, y) {
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
    map[y][x] = TILES.FLOOR;
  }
}

function vCorridor(map, TILES, y1, y2, x) {
  for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
    map[y][x] = TILES.FLOOR;
  }
}

function intersect(a, b) {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

function center(r) {
  return { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) };
}

function inRect(x, y, r) {
  if (!r) return false;
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

function randomFloor(ctx, rooms, ri) {
  const { TILES, player } = ctx;
  // Use the actual generated map dimensions to avoid mismatches with MAP_ROWS/COLS
  const rRows = Array.isArray(ctx.map) ? ctx.map.length : 0;
  const rCols = (rRows > 0 && Array.isArray(ctx.map[0])) ? ctx.map[0].length : 0;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < rCols && y < rRows;

  // Helper to check if a position is currently occupied by an enemy; guards nulls
  const isEnemyAt = (xx, yy) => Array.isArray(ctx.enemies) && ctx.enemies.some(e => e && e.x === xx && e.y === yy);

  let x, y;
  let tries = 0;
  do {
    x = ri(1, Math.max(1, rCols - 2));
    y = ri(1, Math.max(1, rRows - 2));
    tries++;
    if (tries > 500) {
      // Scan for any suitable floor tile as a safe fallback
      for (let yy = 1; yy < Math.max(1, rRows - 1); yy++) {
        for (let xx = 1; xx < Math.max(1, rCols - 1); xx++) {
          if (!inBounds(xx, yy)) continue;
          if (ctx.map[yy][xx] !== TILES.FLOOR) continue;
          if ((xx === player.x && yy === player.y)) continue;
          if (ctx.startRoomRect && inRect(xx, yy, ctx.startRoomRect)) continue;
          if (isEnemyAt(xx, yy)) continue;
          return { x: xx, y: yy };
        }
      }
      // Last resort: try neighbors around the player (avoid player's tile)
      const neigh = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1},{x:1,y:1},{x:1,y:-1},{x:-1,y:1},{x:-1,y:-1}];
      for (const d of neigh) {
        const xx = player.x + d.x, yy = player.y + d.y;
        if (!inBounds(xx, yy)) continue;
        if (ctx.map[yy][xx] !== TILES.FLOOR) continue;
        if (ctx.startRoomRect && inRect(xx, yy, ctx.startRoomRect)) continue;
        if (isEnemyAt(xx, yy)) continue;
        return { x: xx, y: yy };
      }
      // Final fallback: any floor tile that's not the player's tile
      for (let yy = 1; yy < Math.max(1, rRows - 1); yy++) {
        for (let xx = 1; xx < Math.max(1, rCols - 1); xx++) {
          if (!inBounds(xx, yy)) continue;
          if (ctx.map[yy][xx] !== TILES.FLOOR) continue;
          if ((xx === player.x && yy === player.y)) continue;
          return { x: xx, y: yy };
        }
      }
      // Give up: place one step to the right if in bounds
      const fx = Math.min(Math.max(1, rCols - 2), Math.max(1, player.x + 1));
      const fy = Math.min(Math.max(1, rRows - 2), Math.max(1, player.y));
      return { x: fx, y: fy };
    }
  } while (!(inBounds(x, y) && ctx.map[y][x] === TILES.FLOOR) ||
           (x === player.x && y === player.y) ||
           (ctx.startRoomRect && inRect(x, y, ctx.startRoomRect)) ||
           isEnemyAt(x, y));
  return { x, y };
}

function defaultEnemyFactory(x, y, depth, rng) {
  const EM = (typeof window !== "undefined" ? window.Enemies : null);
  if (EM && typeof EM.createEnemyAt === "function") {
    return EM.createEnemyAt(x, y, depth, rng);
  }
  return { x, y, type: "goblin", glyph: "g", hp: 3, atk: 1, xp: 5, level: depth, announced: false };
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.Dungeon = { generateLevel };
}