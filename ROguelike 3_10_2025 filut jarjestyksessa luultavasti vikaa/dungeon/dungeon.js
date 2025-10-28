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
import { attachGlobal } from "../utils/global.js";

function mix32(a) {
  a = (a ^ 61) ^ (a >>> 16);
  a = (a + (a << 3)) | 0;
  a = a ^ (a >>> 4);
  a = Math.imul(a, 0x27d4eb2d);
  a = a ^ (a >>> 15);
  return a >>> 0;
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
// Local seeded PRNG (Mulberry32) to avoid RNGFallback
function mulberry32(seed) {
  let t = (seed >>> 0);
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateLevel(ctx, depth) {
  const { ROWS, COLS, MAP_ROWS, MAP_COLS, TILES, player } = ctx;

  // Determine per-dungeon seed from root RNG + entrance/level/size
  const rootSeed = (typeof window !== "undefined" && window.RNG && typeof window.RNG.getSeed === "function")
    ? (window.RNG.getSeed() || 0)
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

  // Place player at start (do not reset player; preserve inventory/equipment/HP across transitions)
player.x = start.x;
player.y = start.y;

// On first generation, still place a chest in the start room if supported
const DI = (ctx.DungeonItems || (typeof window !== "undefined" ? window.DungeonItems : null));
if (DI && typeof DI.placeChestInStartRoom === "function") {
  try { DI.placeChestInStartRoom(ctx); } catch (_) {}
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

  // If this dungeon entrance is in a mountain biome, place a second portal inside leading to a dungeon across the mountain.
  try {
    const W = (typeof window !== "undefined" ? window.World : null);
    const world = ctx.world || null;
    const WT = W ? W.TILES : null;
    const gen = world && world.gen;
    const dinfoAbs = ctx.dungeonInfo || ctx.dungeon || null;

    function isMountainAt(ax, ay) {
      try { return gen && typeof gen.tileAt === "function" && WT && gen.tileAt(ax | 0, ay | 0) === WT.MOUNTAIN; } catch (_) { return false; }
    }
    function isMountainEntranceNear(abs) {
      if (!abs) return false;
      const x0 = abs.x | 0, y0 = abs.y | 0;
      if (isMountainAt(x0, y0)) return true;
      const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1},{dx:1,dy:1},{dx:1,dy:-1},{dx:-1,dy:1},{dx:-1,dy:-1}];
      for (const d of dirs) { if (isMountainAt(x0 + d.dx, y0 + d.dy)) return true; }
      return false;
    }

    const isMountainEntrance = isMountainEntranceNear(dinfoAbs);
    if (isMountainEntrance) {
      // Pick a different room from the end room (prefer mid/far) to place the mountain pass portal
      let passRoomIdx = Math.max(1, Math.floor(rooms.length / 2));
      if (passRoomIdx === endRoomIndex) passRoomIdx = Math.max(1, Math.min(rooms.length - 1, passRoomIdx - 1));
      const passC = center(rooms[passRoomIdx] || rooms[rooms.length - 1] || { x: 2, y: 2, w: 1, h: 1 });
      // Mark with STAIRS tile as well (distinct behavior handled by runtime)
      ctx.map[passC.y][passC.x] = STAIRS;
      // Record portal location for runtime to detect
      ctx._mountainPassAt = { x: passC.x, y: passC.y };
    }
  } catch (_) {}

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
  const sizeMult = sizeStr === "small" ? 0.8 : sizeStr === "large" ? 1.35 : 1.1;
  const baseEnemies = 8 + Math.floor(depth * 4);
  const enemyCount = Math.max(6, Math.floor(baseEnemies * sizeMult));
  const makeEnemy = ctx.enemyFactory || defaultEnemyFactory;

  // Ensure enemy registry is loaded before spawning
  try {
    const EM0 = (typeof window !== "undefined" ? window.Enemies : null);
    if (EM0 && typeof EM0.ensureLoaded === "function") EM0.ensureLoaded();
  } catch (_) {}

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
    const pl = (ctx.player && typeof ctx.player.level === "number") ? ctx.player.level : 1;
    const ed = Math.max(1, (depth | 0) + Math.floor(Math.max(0, pl) / 2) + 1);
    let enemy = makeEnemy(p.x, p.y, ed, drng);

    // If factory failed, build from registry cycling through types for diversity
    if (!enemy || typeof enemy.x !== "number" || typeof enemy.y !== "number") {
      enemy = null;
      try {
        if (cycleTypes.length) {
          const pickKey = cycleTypes[i % cycleTypes.length];
          const td = EM && typeof EM.getTypeDef === "function" ? EM.getTypeDef(pickKey) : null;
          if (td) {
            const pl = (ctx.player && typeof ctx.player.level === "number") ? ctx.player.level : 1;
            const ed2 = Math.max(1, (depth | 0) + Math.floor(Math.max(0, pl) / 2) + 1);
            enemy = {
              x: p.x, y: p.y,
              type: pickKey,
              glyph: (td.glyph && td.glyph.length) ? td.glyph : ((pickKey && pickKey.length) ? pickKey.charAt(0) : "?"),
              hp: td.hp(ed2),
              atk: td.atk(ed2),
              xp: td.xp(ed2),
              level: (EM.levelFor && typeof EM.levelFor === "function") ? EM.levelFor(pickKey, ed2, drng) : ed2,
              announced: false
            };
          }
        }
      } catch (_) {
        enemy = null;
      }
    }
    if (enemy && typeof enemy.x === "number" && typeof enemy.y === "number") {
      ctx.enemies.push(enemy);
    } else {
      try { ctx.log && ctx.log("Fallback enemy spawned (dungeon create failed).", "warn"); } catch (_) {}
      ctx.enemies.push({ x: p.x, y: p.y, type: "fallback_enemy", glyph: "?", hp: 3, atk: 1, xp: 5, level: depth, announced: false });
    }
  }

  // Extra packs: a portion of rooms get 1–2 additional enemies spawned inside
  (function spawnExtraPacks() {
    const packs = Math.max(1, Math.floor(rooms.length * 0.3));
    function randomInRoom(r) {
      const x = ri(r.x, r.x + r.w - 1);
      const y = ri(r.y, r.y + r.h - 1);
      return { x, y };
    }
    let placed = 0; let tries = 0;
    while (placed < packs && tries++ < rooms.length * 4) {
      const idx = ri(0, rooms.length - 1);
      const r = rooms[idx];
      // Skip start room
      if (ctx.startRoomRect && r === ctx.startRoomRect) continue;
      const add = 1 + (drng() < 0.6 ? 1 : 0); // 1–2 extras
      for (let k = 0; k < add; k++) {
        const p = randomInRoom(r);
        if (ctx.map[p.y][p.x] !== TILES.FLOOR) continue;
        // Avoid player tile and occupied enemy tiles
        const occupied = ctx.enemies.some(e => e && e.x === p.x && e.y === p.y) || (p.x === ctx.player.x && p.y === ctx.player.y);
        if (occupied) continue;
        const pl2 = (ctx.player && typeof ctx.player.level === "number") ? ctx.player.level : 1;
        const ed2 = Math.max(1, (depth | 0) + Math.floor(Math.max(0, pl2) / 2) + 1);
        let e = makeEnemy(p.x, p.y2, drng);
        if (e && typeof e.x === "number" && typeof e.y === "number") {
          ctx.enemies.push(e);
        } else {
          try { ctx.log && ctx.log("Fallback enemy spawned (extra pack create failed).", "warn"); } catch (_) {}
          ctx.enemies.push({ x: p.x, y: p.y, type: "fallback_enemy", glyph: "?", hp: 3, atk: 1, xp: 5, level: depth, announced: false });
        }
      }
      placed++;
    }
  })();

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
  return null;
}

// Back-compat: attach to window via helper
attachGlobal("Dungeon", { generateLevel });