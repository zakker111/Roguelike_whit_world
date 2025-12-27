/**
 * DungeonRuntime: generation and persistence glue for dungeon mode.
 *
 * Exports (ESM + window.DungeonRuntime):
 * - keyFromWorldPos(x, y)
 * - save(ctx, logOnce=false)
 * - load(ctx, x, y): returns boolean
 * - generate(ctx, depth=1)
 * - generateLoot(ctx, source)
 * - returnToWorldIfAtExit(ctx)
 * - killEnemy(ctx, enemy)
 * - enter(ctx, info)
 */

import { getMod } from "../../utils/access.js";
import { keyFromWorldPos as keyFromWorldPosExt, save as saveExt, load as loadExt } from "./state.js";
import { generate as generateExt } from "./generate.js";
import { generateLoot as generateLootExt, lootHere as lootHereExt } from "./loot.js";
import { tryMoveDungeon as tryMoveDungeonExt } from "./movement.js";
import { tick as tickExt } from "./tick.js";
import { returnToWorldIfAtExit as returnToWorldIfAtExitExt, computeAcrossMountainTarget as computeAcrossMountainTargetExt } from "./transitions.js";
import { enter as enterExt } from "./enter.js";
import { killEnemy as killEnemyExt } from "./kill_enemy.js";
import { stampTowerRoomsForFloor, towerPrefabsAvailable } from "./tower_prefabs.js";

export function keyFromWorldPos(x, y) {
  return keyFromWorldPosExt(x, y);
}

// Spawn sparse wall torches on WALL tiles adjacent to FLOOR/DOOR/STAIRS.
// Options: { density:number (0..1), minSpacing:number (tiles) }
function spawnWallTorches(ctx, options = {}) {
  const density = typeof options.density === "number" ? Math.max(0, Math.min(1, options.density)) : 0.006;
  const minSpacing = Math.max(1, (options.minSpacing | 0) || 2);
  const list = [];
  const rows = ctx.map.length;
  const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
  const RU = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
  const rng = (RU && typeof RU.getRng === "function")
    ? RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
    : ((typeof ctx.rng === "function") ? ctx.rng : null);

  const isWall = (x, y) => ctx.inBounds(x, y) && ctx.map[y][x] === ctx.TILES.WALL;
  const isWalkableTile = (x, y) => ctx.inBounds(x, y) && (ctx.map[y][x] === ctx.TILES.FLOOR || ctx.map[y][x] === ctx.TILES.DOOR || ctx.map[y][x] === ctx.TILES.STAIRS);

  function nearTorch(x, y, r = minSpacing) {
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const dx = Math.abs(p.x - x);
      const dy = Math.abs(p.y - y);
      if (dx <= r && dy <= r) return true;
    }
    return false;
  }

  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      if (!isWall(x, y)) continue;
      // Must border at least one walkable tile (corridor/room edge)
      const bordersWalkable =
        isWalkableTile(x + 1, y) || isWalkableTile(x - 1, y) ||
        isWalkableTile(x, y + 1) || isWalkableTile(x, y - 1);
      if (!bordersWalkable) continue;
      // Sparse random placement with spacing constraint
      const rv = (typeof rng === "function") ? rng() : 0.5;
      if (rv < density && !nearTorch(x, y)) {
        list.push({ x, y, type: "wall_torch", name: "Wall Torch" });
      }
    }
  }
  return list;
}

export function save(ctx, logOnce = false) {
  return saveExt(ctx, logOnce);
}

export function load(ctx, x, y) {
  return loadExt(ctx, x, y);
}

export function generate(ctx, depth) {
  return generateExt(ctx, depth);
}

export function generateLoot(ctx, source) {
  return generateLootExt(ctx, source);
}

// Tower helpers --------------------------------------------------------------

function isTowerInfo(info) {
  if (!info) return false;
  try {
    const k = String(info.kind || "").toLowerCase();
    return k === "tower";
  } catch (_) {
    return false;
  }
}

function ensureTowerMeta(ctx, info) {
  if (!ctx) return null;
  const dinfo = info || ctx.dungeonInfo || ctx.dungeon || null;
  if (!dinfo || !isTowerInfo(dinfo)) return null;
  const floors = (() => {
    try {
      const n = Number(dinfo.towerFloors);
      if (Number.isFinite(n) && n >= 2 && n <= 10) return Math.floor(n);
    } catch (_) {}
    // Fallback: at least 3 floors for towers
    return 3;
  })();
  const baseLevel = Math.max(1, (dinfo.level | 0) || 1);
  if (!ctx.towerRun) {
    ctx.towerRun = {
      kind: "tower",
      entrance: { x: dinfo.x | 0, y: dinfo.y | 0 },
      totalFloors: floors,
      baseLevel,
      currentFloor: 0,
      floors: Object.create(null),
    };
  } else {
    // Keep base settings but ensure totals/levels are sane
    ctx.towerRun.kind = "tower";
    ctx.towerRun.entrance = { x: dinfo.x | 0, y: dinfo.y | 0 };
    ctx.towerRun.totalFloors = floors;
    ctx.towerRun.baseLevel = baseLevel;
  }
  return ctx.towerRun;
}

function pickFloorTileCandidates(ctx) {
  const out = [];
  try {
    const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
    const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
    const T = ctx.TILES;
    for (let y = 1; y < rows - 1; y++) {
      const row = ctx.map[y];
      for (let x = 1; x < cols - 1; x++) {
        if (!row) continue;
        if (row[x] === T.FLOOR) {
          out.push({ x, y });
        }
      }
    }
  } catch (_) {}
  return out;
}

function pickFarFloorFrom(ctx, sx, sy, blacklist) {
  const list = pickFloorTileCandidates(ctx);
  if (!list.length) return null;
  const bl = Array.isArray(blacklist) ? blacklist : [];
  let best = null;
  let bestD = -1;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (bl.some(b => b && b.x === p.x && b.y === p.y)) continue;
    const d = Math.abs(p.x - sx) + Math.abs(p.y - sy);
    if (d > bestD) {
      bestD = d;
      best = p;
    }
  }
  return best || list[0];
}

function pickNearFloorFrom(ctx, sx, sy, blacklist) {
  const list = pickFloorTileCandidates(ctx);
  if (!list.length) return null;
  const bl = Array.isArray(blacklist) ? blacklist : [];
  let best = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p.x === sx && p.y === sy) continue;
    if (bl.some(b => b && b.x === p.x && b.y === p.y)) continue;
    const d = Math.abs(p.x - sx) + Math.abs(p.y - sy);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best || list[0];
}

// Spawn a tower boss (Bandit Captain) on the given floor meta when this
// is the top floor of a tower run. Boss stats/definition come from
// data/entities/enemies.json; weightByDepth is zero so it never spawns
// randomly outside towers.
function spawnTowerBossOnFloor(ctx, meta) {
  try {
    if (!ctx || !meta) return;
    const EM = (ctx.Enemies || (typeof window !== "undefined" ? window.Enemies : null));
    if (!EM || typeof EM.getTypeDef !== "function") return;
    const def = EM.getTypeDef("bandit_captain") || EM.getTypeDef("bandit");
    if (!def) return;

    const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
    const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
    if (!rows || !cols) return;

    const T = ctx.TILES;
    const isFloor = (x, y) =>
      y >= 0 && x >= 0 && y < rows && x < cols && ctx.map[y][x] === T.FLOOR;
    const isEnemyAt = (x, y) =>
      Array.isArray(ctx.enemies) && ctx.enemies.some(e => e && e.x === x && e.y === y);
    const isBlocked = (x, y) =>
      (meta.exitToWorldPos && x === meta.exitToWorldPos.x && y === meta.exitToWorldPos.y) ||
      (meta.stairsUpPos && x === meta.stairsUpPos.x && y === meta.stairsUpPos.y) ||
      (meta.stairsDownPos && x === meta.stairsDownPos.x && y === meta.stairsDownPos.y) ||
      (ctx.player && x === ctx.player.x && y === ctx.player.y) ||
      isEnemyAt(x, y);

    // Prefer a tile far from the player's starting spot / stairs-down.
    const seed = (meta.stairsDownPos && isFloor(meta.stairsDownPos.x, meta.stairsDownPos.y))
      ? meta.stairsDownPos
      : { x: ctx.player.x | 0, y: ctx.player.y | 0 };

    const blacklist = [];
    if (meta.exitToWorldPos) blacklist.push(meta.exitToWorldPos);
    if (meta.stairsUpPos) blacklist.push(meta.stairsUpPos);
    if (meta.stairsDownPos) blacklist.push(meta.stairsDownPos);

    let candidate = pickFarFloorFrom(ctx, seed.x, seed.y, blacklist);
    if (!candidate || !isFloor(candidate.x, candidate.y) || isBlocked(candidate.x, candidate.y)) {
      // Fallback: scan for any suitable floor tile.
      candidate = null;
      for (let y = 1; y < rows - 1 && !candidate; y++) {
        for (let x = 1; x < cols - 1; x++) {
          if (!isFloor(x, y)) continue;
          if (isBlocked(x, y)) continue;
          candidate = { x, y };
          break;
        }
      }
    }
    if (!candidate) return;

    const depth = Math.max(1, (ctx.floor | 0) || 1);
    const level =
      EM.levelFor && typeof EM.levelFor === "function"
        ? EM.levelFor("bandit_captain", depth, ctx.rng)
        : depth;
    const glyph =
      def.glyph && def.glyph.length
        ? def.glyph
        : ("bandit_captain".length ? "bandit_captain".charAt(0) : "?");

    const boss = {
      x: candidate.x,
      y: candidate.y,
      type: "bandit_captain",
      glyph,
      hp: def.hp(depth),
      atk: def.atk(depth),
      xp: def.xp(depth),
      level,
      announced: false,
    };

    ctx.enemies.push(boss);
  } catch (_) {}
}

// Spawn tower chests on a given floor using JSON-defined chest spots when
// available; falls back to heuristic placement. Top floor always gets a
// high-tier "boss" chest near the Bandit Captain when possible.
function spawnTowerChestsOnFloor(ctx, meta, floorIndex, totalFloors) {
  try {
    const DI = ctx && (ctx.DungeonItems || (typeof window !== "undefined" ? window.DungeonItems : null));
    if (!DI || typeof DI.spawnChest !== "function") return;

    const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
    const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
    if (!rows || !cols) return;

    const T = ctx.TILES;
    const RU = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
    const rng = (RU && typeof RU.getRng === "function")
      ? RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
      : ((typeof ctx.rng === "function") ? ctx.rng : () => 0.5);

    const f = Math.max(1, floorIndex | 0);
    const total = Math.max(1, totalFloors | 0);
    const isTop = f === total;

    const chestSpots = Array.isArray(meta.chestSpots) ? meta.chestSpots.slice() : [];

    const isInBounds = (x, y) =>
      y >= 0 && x >= 0 && y < rows && x < cols;

    const isBlockedForChest = (x, y) => {
      if (!isInBounds(x, y)) return true;
      const tile = ctx.map[y][x];
      if (tile !== T.FLOOR) return true;
      if (meta.exitToWorldPos && meta.exitToWorldPos.x === x && meta.exitToWorldPos.y === y) return true;
      if (meta.stairsUpPos && meta.stairsUpPos.x === x && meta.stairsUpPos.y === y) return true;
      if (meta.stairsDownPos && meta.stairsDownPos.x === x && meta.stairsDownPos.y === y) return true;
      if (ctx.player && ctx.player.x === x && ctx.player.y === y) return true;
      if (Array.isArray(ctx.enemies) && ctx.enemies.some(e => e && e.x === x && e.y === y)) return true;
      if (Array.isArray(ctx.corpses) && ctx.corpses.some(c => c && c.x === x && c.y === y)) return true;
      return false;
    };

    const manhattan = (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by);

    const findFallbackChestTile = () => {
      const blacklist = [];
      if (meta.exitToWorldPos) blacklist.push(meta.exitToWorldPos);
      if (meta.stairsUpPos) blacklist.push(meta.stairsUpPos);
      if (meta.stairsDownPos) blacklist.push(meta.stairsDownPos);
      const seedX = (ctx.player && typeof ctx.player.x === "number") ? (ctx.player.x | 0) : 0;
      const seedY = (ctx.player && typeof ctx.player.y === "number") ? (ctx.player.y | 0) : 0;
      const far = pickFarFloorFrom(ctx, seedX, seedY, blacklist);
      if (far && !isBlockedForChest(far.x, far.y)) return far;
      // Fallback: first free floor tile we can find
      for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
          if (!isBlockedForChest(x, y)) return { x, y };
        }
      }
      return null;
    };

    if (isTop) {
      // Always try to spawn a boss chest on the top floor.
      const boss = Array.isArray(ctx.enemies)
        ? ctx.enemies.find(e => e && String(e.type || "").toLowerCase() === "bandit_captain")
        : null;

      let bestSpot = null;
      if (chestSpots.length) {
        let bestD = Number.POSITIVE_INFINITY;
        for (let i = 0; i < chestSpots.length; i++) {
          const s = chestSpots[i];
          const x = s.x | 0;
          const y = s.y | 0;
          if (isBlockedForChest(x, y)) continue;
          let d = 0;
          if (boss) d = manhattan(x, y, boss.x | 0, boss.y | 0);
          else if (meta.stairsDownPos) d = manhattan(x, y, meta.stairsDownPos.x, meta.stairsDownPos.y);
          else d = 0;
          if (d < bestD) {
            bestD = d;
            bestSpot = { x, y };
          }
        }
      }
      if (!bestSpot) {
        bestSpot = findFallbackChestTile();
      }
      if (bestSpot) {
        DI.spawnChest(ctx, {
          where: { x: bestSpot.x, y: bestSpot.y },
          tier: 3,
          decayAll: 99,
          loot: ["anyEquipment", "anyEquipment", "potion"],
          announce: true
        });
      }
      return;
    }

    // Lower floors: small chance of 0–1 smaller chests.
    if (!chestSpots.length) {
      // No JSON-defined chest spots; keep lower floors simple for now.
      return;
    }
    const roll = rng();
    const baseChance = 0.4;
    const floorBias = 0.1 * (f - 1);
    if (roll >= baseChance + floorBias) return;

    // Pick a random chest spot that is still valid.
    const shuffled = chestSpots.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
    }
    let picked = null;
    for (let i = 0; i < shuffled.length; i++) {
      const s = shuffled[i];
      const x = s.x | 0;
      const y = s.y | 0;
      if (!isBlockedForChest(x, y)) {
        picked = { x, y };
        break;
      }
    }
    if (!picked) {
      picked = findFallbackChestTile();
    }
    if (!picked) return;

    const tier = (f >= total - 1) ? 3 : 2;
    DI.spawnChest(ctx, {
      where: { x: picked.x, y: picked.y },
      tier,
      decayAll: 99,
      loot: ["anyEquipment", "potion"],
      announce: false
    });
  } catch (_) {}
}

function gotoTowerFloor(ctx, floorIndex, direction) {
  if (!ctx || !ctx.towerRun) return false;
  const tr = ctx.towerRun;
  const total = Math.max(2, Math.floor(tr.totalFloors || 3));
  const f = Math.max(1, Math.min(total, floorIndex | 0));
  tr.totalFloors = total;

  let meta = tr.floors[f];
  const fromWorld = direction === "fromWorld";
  const goingUp = direction === "up";
  const goingDown = direction === "down";

  if (!meta) {
    // Fresh floor: generate via core/dungeon/generate and then place tower stairs.
    ctx.floor = tr.baseLevel + (f - 1);
    if (ctx.dungeonInfo) ctx.dungeonInfo.level = ctx.floor;
    generateExt(ctx, ctx.floor);

    const T = ctx.TILES;
    const px = ctx.player.x | 0;
    const py = ctx.player.y | 0;

    meta = {
      map: ctx.map,
      seen: ctx.seen,
      visible: ctx.visible,
      enemies: ctx.enemies,
      corpses: ctx.corpses,
      decals: Array.isArray(ctx.decals) ? ctx.decals : [],
      dungeonProps: Array.isArray(ctx.dungeonProps) ? ctx.dungeonProps : [],
      floorIndex: f,
      floorLevel: ctx.floor,
      exitToWorldPos: null,
      stairsUpPos: null,
      stairsDownPos: null,
      chestSpots: [],
    };

    // Base floor: designate entrance tile as exit-to-world stairs.
    if (f === 1) {
      meta.exitToWorldPos = { x: px, y: py };
      ctx.dungeonExitAt = { x: px, y: py };
      try {
        if (ctx.inBounds && ctx.inBounds(px, py)) {
          ctx.map[py][px] = T.STAIRS;
          if (Array.isArray(ctx.seen) && ctx.seen[py]) ctx.seen[py][px] = true;
          if (Array.isArray(ctx.visible) && ctx.visible[py]) ctx.visible[py][px] = true;
        }
      } catch (_) {}
    }

    const hasUp = f < total;
    const hasDown = f > 1;

    if (hasUp || hasDown) {
      const startX = px;
      const startY = py;
      const blacklist = [];
      if (meta.exitToWorldPos) blacklist.push(meta.exitToWorldPos);

      if (hasUp) {
        const up = pickFarFloorFrom(ctx, startX, startY, blacklist);
        if (up) {
          meta.stairsUpPos = { x: up.x, y: up.y };
          blacklist.push(up);
          try {
            ctx.map[up.y][up.x] = T.STAIRS;
          } catch (_) {}
        }
      }
      if (hasDown) {
        const down = pickNearFloorFrom(ctx, startX, startY, blacklist);
        if (down) {
          meta.stairsDownPos = { x: down.x, y: down.y };
          try {
            ctx.map[down.y][down.x] = T.STAIRS;
          } catch (_) {}
        }
      }
    }

    // JSON-driven tower room prefabs: stamp rooms and collect props/chest spots.
    try {
      if (towerPrefabsAvailable(ctx)) {
        stampTowerRoomsForFloor(ctx, meta, f, total);
      }
    } catch (_) {}

    // On the final floor of the tower, spawn a dedicated boss enemy.
    if (f === total) {
      spawnTowerBossOnFloor(ctx, meta);
    }

    // Spawn tower chests using JSON chest spots when available.
    try {
      spawnTowerChestsOnFloor(ctx, meta, f, total);
    } catch (_) {}

    tr.floors[f] = meta;
  } else {
    // Revisit existing floor: restore state references.
    ctx.map = meta.map;
    ctx.seen = meta.seen;
    ctx.visible = meta.visible;
    ctx.enemies = meta.enemies;
    ctx.corpses = meta.corpses;
    ctx.decals = Array.isArray(meta.decals) ? meta.decals : [];
    ctx.dungeonProps = Array.isArray(meta.dungeonProps) ? meta.dungeonProps : [];
    ctx.floor = meta.floorLevel || (tr.baseLevel + (f - 1));
    if (ctx.dungeonInfo) ctx.dungeonInfo.level = ctx.floor;
  }

  // Determine spawn position on this floor based on direction.
  let spawn = null;
  if (fromWorld) {
    spawn = meta.exitToWorldPos || meta.stairsDownPos || meta.stairsUpPos;
  } else if (goingUp) {
    // Arriving from below: appear at the \"down\" stairs for this floor if present.
    spawn = meta.stairsDownPos || meta.exitToWorldPos || meta.stairsUpPos;
  } else if (goingDown) {
    // Arriving from above: appear at the \"up\" stairs for this floor if present.
    spawn = meta.stairsUpPos || meta.exitToWorldPos || meta.stairsDownPos;
  }
  if (!spawn) {
    spawn = { x: ctx.player.x | 0, y: ctx.player.y | 0 };
  }

  ctx.player.x = spawn.x | 0;
  ctx.player.y = spawn.y | 0;

  if (meta.exitToWorldPos) {
    ctx.dungeonExitAt = { x: meta.exitToWorldPos.x, y: meta.exitToWorldPos.y };
  }

  tr.currentFloor = f;

  // Refresh UI/visuals via StateSync when available.
  try {
    const SS = ctx.StateSync || getMod(ctx, "StateSync");
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    } else {
      if (ctx.recomputeFOV) ctx.recomputeFOV();
      if (ctx.updateCamera) ctx.updateCamera();
      if (ctx.updateUI) ctx.updateUI();
      if (ctx.requestDraw) ctx.requestDraw();
    }
  } catch (_) {}

  try {
    const msg = `You explore tower floor ${f}/${tr.totalFloors}.`;
    ctx.log && ctx.log(msg, "info");
  } catch (_) {}

  return true;
}

function handleTowerStairsOrExit(ctx) {
  // Only handle towers here; presence of ctx.towerRun is our signal.
  if (!ctx || !ctx.towerRun) {
    return false;
  }
  const tr = ctx.towerRun;
  const f = tr.currentFloor || 1;
  const meta = tr.floors && tr.floors[f];
  if (!meta) {
    try { ctx.log && ctx.log("Tower: no floor metadata; cannot use stairs.", "warn"); } catch (_) {}
    return false;
  }

  const px = ctx.player.x | 0;
  const py = ctx.player.y | 0;
  const onExit = !!(meta.exitToWorldPos && f === 1 && px === meta.exitToWorldPos.x && py === meta.exitToWorldPos.y);
  const onUp = !!(meta.stairsUpPos && px === meta.stairsUpPos.x && py === meta.stairsUpPos.y);
  const onDown = !!(meta.stairsDownPos && px === meta.stairsDownPos.x && py === meta.stairsDownPos.y);

  // If not on any known tower stairs, do nothing; let caller fall back to
  // other dungeon behavior (loot/guidance) but never trigger a world exit
  // from here.
  if (!onExit && !onUp && !onDown) {
    try { ctx.log && ctx.log("Tower: this staircase is not wired for floor travel.", "info"); } catch (_) {}
    return false;
  }

  // Base floor exit back to overworld.
  if (onExit && f === 1) {
    try { ctx.log && ctx.log("You descend back to the overworld from the tower base.", "info"); } catch (_) {}
    const ok = returnToWorldIfAtExitExt(ctx);
    if (ok) {
      try { ctx.towerRun = null; } catch (_) {}
    }
    return ok;
  }

  // Internal stairs: move within the tower.
  if (onUp && f < tr.totalFloors) {
    try { ctx.log && ctx.log(`You climb to tower floor ${f + 1}/${tr.totalFloors}.`, "info"); } catch (_) {}
    return gotoTowerFloor(ctx, f + 1, "up");
  }
  if (onDown && f > 1) {
    try { ctx.log && ctx.log(`You descend to tower floor ${f - 1}/${tr.totalFloors}.`, "info"); } catch (_) {}
    return gotoTowerFloor(ctx, f - 1, "down");
  }

  try {
    ctx.log && ctx.log("This staircase does not lead out of the tower.", "info");
  } catch (_) {}
  return false;
}

export function returnToWorldIfAtExit(ctx) {
  try {
    if (ctx && ctx.towerRun) {
      // For towers, rely solely on our custom handler; never fall back to
      // legacy behavior from here or internal stairs will incorrectly exit
      // to the overworld.
      return handleTowerStairsOrExit(ctx);
    }
  } catch (_) {}
  // Non-tower dungeons: use the legacy helper.
  return returnToWorldIfAtExitExt(ctx);
}

export function lootHere(ctx) {
  return lootHereExt(ctx);
}

export function killEnemy(ctx, enemy) {
  return killEnemyExt(ctx, enemy);
}

export function enter(ctx, info) {
  if (info && isTowerInfo(info)) {
    if (!ctx || !ctx.world) return false;
    // Preserve world fog-of-war references so we can restore on exit.
    try {
      if (ctx.world) {
        ctx.world.seenRef = ctx.seen;
        ctx.world.visibleRef = ctx.visible;
      }
    } catch (_) {}
    ctx.dungeon = info;
    ctx.dungeonInfo = info;
    ctx.mode = "dungeon";
    ctx.cameFromWorld = true;
    // Ensure worldReturnPos is set so overworld exit knows where to place the player.
    ctx.worldReturnPos = { x: info.x | 0, y: info.y | 0 };

    // Towers behave like persistent multi-floor dungeons: try loading an
    // existing state (including towerRun) before generating a fresh run.
    try {
      const loaded = loadExt(ctx, info.x, info.y);
      if (loaded && ctx.towerRun && ctx.towerRun.kind === "tower") {
        return true;
      }
    } catch (_) {}

    // No saved tower state: initialize tower meta and enter base floor.
    const tr = ensureTowerMeta(ctx, info);
    if (!tr) return false;
    return gotoTowerFloor(ctx, 1, "fromWorld");
  }

  return enterExt(ctx, info);
}

export function tryMoveDungeon(ctx, dx, dy) {
  return tryMoveDungeonExt(ctx, dx, dy);
}

// Determine a target world coordinate across a mountain from this dungeon's entrance.
function computeAcrossMountainTarget(ctx) {
  return computeAcrossMountainTargetExt(ctx);
}

export function tick(ctx) {
  return tickExt(ctx);
}

// Back-compat: attach to window for classic scripts
import { attachGlobal } from "../../utils/global.js";
if (typeof window !== "undefined") {
  attachGlobal("DungeonRuntime", { keyFromWorldPos, save, load, generate, generateLoot, returnToWorldIfAtExit, lootHere, killEnemy, enter, tryMoveDungeon, tick });
}