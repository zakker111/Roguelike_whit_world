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

import { getMod, getGameData } from "../../utils/access.js";
import { keyFromWorldPos as keyFromWorldPosExt, save as saveExt, load as loadExt } from "./state.js";
import { generate as generateExt } from "./generate.js";
import { generateLoot as generateLootExt, lootHere as lootHereExt } from "./loot.js";
import { tryMoveDungeon as tryMoveDungeonExt } from "./movement.js";
import { tick as tickExt } from "./tick.js";
import { returnToWorldIfAtExit as returnToWorldIfAtExitExt, computeAcrossMountainTarget as computeAcrossMountainTargetExt } from "./transitions.js";
import { enter as enterExt } from "./enter.js";
import { killEnemy as killEnemyExt } from "./kill_enemy.js";
import { towerPrefabsAvailable, buildTowerFloorLayout } from "./tower_prefabs.js";

export function keyFromWorldPos(x, y) {
  return keyFromWorldPosExt(x, y);
}

// Spawn sparse wall torches on WALL tiles adjacent to FLOOR/DOOR/STAIRS.
// Options: { density:number (0..1), minSpacing:number (tiles) }
//
// Tower-specific notes:
// - Towers are multi-floor dungeons managed via ctx.towerRun.
// - Each floor stores its own meta (map, seen/visible, enemies, corpses, decals, dungeonProps, chestSpots, stairs).
// - Floors are generated once and then persisted through DungeonState; revisiting restores exactly what you left.
// - Tower floors are assembled from JSON room prefabs (data/dungeon/tower_prefabs.json) plus corridors,
//   then decorated with props and chests based on meta.dungeonProps/meta.chestSpots.
// - spawnTowerEnemiesOnFloor places bandit enemies, spawnTowerBossOnFloor adds a dedicated boss on the top floor,
//   and spawnTowerChestsOnFloor wires in loot chests using JSON chest spots when available.
//
// Captives and allies:
// - Some tower prefabs embed CAPTIVE props, stamped into meta.dungeonProps.
// - Standing on a captive prop and pressing G in a tower calls releaseCaptiveHere(ctx):
//   - Removes the captive prop from that tile.
//   - Spawns a guard-faction ally on a nearby free floor tile (if any).
//   - The ally uses normal enemy AI but has _ignorePlayer = true so it never targets the player, only hostile factions
//     (e.g., bandits). Allies are saved in towerRun like any other enemy and persist across floor changes and exits.

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
    // Fallback: at least 3 floors for towers when metadata is missing.
    return 3;
  })();

  const baseLevel = Math.max(1, (dinfo.level | 0) || 1);

  // Resolve tower type and optional config from GameData.towers. This is
  // advisory only for now; existing hard-coded behavior remains functional
  // when config is absent.
  let towerTypeId = null;
  let towerConfig = null;
  try {
    const GD = getGameData(ctx);
    const towersCfg = GD && GD.towers;
    const explicitType = dinfo.towerType ? String(dinfo.towerType) : null;
    if (towersCfg && towersCfg.types && typeof towersCfg.types === "object") {
      if (explicitType && towersCfg.types[explicitType]) {
        towerTypeId = explicitType;
        towerConfig = towersCfg.types[explicitType];
      } else {
        const defaults = (towersCfg.defaults && typeof towersCfg.defaults === "object") ? towersCfg.defaults : null;
        const defId = defaults && typeof defaults.defaultTowerType === "string" ? defaults.defaultTowerType : null;
        if (defId && towersCfg.types[defId]) {
          towerTypeId = defId;
          towerConfig = towersCfg.types[defId];
        }
      }
    }
  } catch (_) {}

  if (!towerTypeId) {
    towerTypeId = dinfo.towerType ? String(dinfo.towerType) : "bandit_tower";
  }

  if (!ctx.towerRun) {
    ctx.towerRun = {
      kind: "tower",
      entrance: { x: dinfo.x | 0, y: dinfo.y | 0 },
      totalFloors: floors,
      baseLevel,
      currentFloor: 0,
      floors: Object.create(null),
      typeId: towerTypeId,
      config: towerConfig || null,
    };
  } else {
    // Keep base settings but ensure totals/levels are sane
    ctx.towerRun.kind = "tower";
    ctx.towerRun.entrance = { x: dinfo.x | 0, y: dinfo.y | 0 };
    ctx.towerRun.totalFloors = floors;
    ctx.towerRun.baseLevel = baseLevel;
    ctx.towerRun.typeId = towerTypeId;
    if (towerConfig) {
      ctx.towerRun.config = towerConfig;
    }
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

// Tower-specific enemy helpers ------------------------------------------------

function getTowerTheme(ctx) {
  try {
    const GD = getGameData(ctx);
    const themes = GD && GD.towerThemes;
    if (!themes || typeof themes !== "object") return null;
    const tr = ctx && ctx.towerRun;
    const cfg = tr && tr.config;
    const typeId = tr && tr.typeId;
    const themeId = (cfg && typeof cfg.themeId === "string") ? cfg.themeId : (typeId || "bandit_tower");
    const theme = themes[themeId];
    return (theme && typeof theme === "object") ? theme : null;
  } catch (_) {
    return null;
  }
}

function towerEnemyFactoryLocal(ctx, x, y, depth, rng) {
  try {
    const EM = (ctx && ctx.Enemies) || (typeof window !== "undefined" ? window.Enemies : null);
    if (!EM || typeof EM.getTypeDef !== "function") return null;

    const theme = getTowerTheme(ctx);
    const pool = [];

    if (theme && Array.isArray(theme.enemies) && theme.enemies.length) {
      for (let i = 0; i < theme.enemies.length; i++) {
        const entry = theme.enemies[i];
        if (!entry || !entry.id) continue;
        const key = String(entry.id);
        const w = Number(entry.weight);
        if (!(w > 0)) continue;
        const def = EM.getTypeDef(key);
        if (def) pool.push({ key, w, def });
      }
    }

    // Fallback: hard-coded bandit pool when theme data is missing or invalid.
    if (!pool.length) {
      const rawPool = [
        { key: "bandit",       w: 5 },
        { key: "bandit_guard", w: 3 },
        { key: "bandit_elite", w: 1 },
      ];
      for (const entry of rawPool) {
        const def = EM.getTypeDef(entry.key);
        if (def) pool.push({ key: entry.key, w: entry.w, def });
      }
    }

    if (!pool.length) return null;

    let rfn = rng;
    try {
      if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function") {
        rfn = window.RNGUtils.getRng(rng);
      }
    } catch (_) {}
    if (typeof rfn !== "function") {
      rfn = () => 0.5;
    }

    let totalW = 0;
    for (const p of pool) totalW += p.w;
    if (!(totalW > 0)) return null;

    let r = rfn() * totalW;
    let chosen = pool[0];
    for (const p of pool) {
      if (r < p.w) { chosen = p; break; }
      r -= p.w;
    }

    const td = chosen.def;
    const d = Math.max(1, depth | 0);
    const level = (EM.levelFor && typeof EM.levelFor === "function")
      ? EM.levelFor(chosen.key, d, rfn)
      : d;
    const glyph = (td.glyph && td.glyph.length)
      ? td.glyph
      : (chosen.key && chosen.key.length ? chosen.key.charAt(0) : "?");

    return {
      x,
      y,
      type: chosen.key,
      glyph,
      hp: td.hp(d),
      atk: td.atk(d),
      xp: td.xp(d),
      level,
      announced: false,
    };
  } catch (_) {
    return null;
  }
}

function scaleTowerEnemyForDifficulty(ctx, enemy, depth, floorIndex, hpMultCfg, atkMultCfg) {
  try {
    if (!ctx || !enemy) return;
    const pl = (ctx.player && typeof ctx.player.level === "number") ? ctx.player.level : 1;
    const eLevel = (typeof enemy.level === "number" ? (enemy.level | 0) : ((depth | 0) || 1));
    const f = Math.max(1, floorIndex | 0);

    // Base multipliers from configuration (per-floor scaling).
    let hpMult = (typeof hpMultCfg === "number" && hpMultCfg > 0) ? hpMultCfg : 1;
    let atkMult = (typeof atkMultCfg === "number" && atkMultCfg > 0) ? atkMultCfg : 1;

    // Additional boost when player significantly outlevels the enemy, to keep
    // tower fights relevant if player overlevels content.
    const diff = pl - eLevel;
    if (diff > 1) {
      const boost = Math.min(3, Math.max(1, diff - 1));
      const boostHp = 1 + 0.20 * boost;
      const boostAtk = 1 + 0.15 * boost;
      hpMult *= boostHp;
      atkMult *= boostAtk;
      enemy.level = Math.max(1, eLevel + boost);
    }

    if (typeof enemy.hp === "number") {
      enemy.hp = Math.max(1, Math.round(enemy.hp * hpMult));
    }
    if (typeof enemy.atk === "number") {
      enemy.atk = Math.max(0.1, Math.round(enemy.atk * atkMult * 10) / 10);
    }
  } catch (_) {}
}

function spawnTowerEnemiesOnFloor(ctx, meta, floorIndex, totalFloors) {
  try {
    if (!ctx || !meta) return;
    const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
    const cols = (rows && Array.isArray(ctx.map[0])) ? ctx.map[0].length : 0;
    if (!rows || !cols) return;
    const T = ctx.TILES;

    const isInBounds = (x, y) => y >= 0 && x >= 0 && y < rows && x < cols;

    const isBlocked = (x, y) => {
      if (!isInBounds(x, y)) return true;
      const tile = ctx.map[y][x];
      // Only spawn on regular floor tiles; avoid walls, doors, stairs, etc.
      if (tile !== T.FLOOR) return true;
      if (meta.exitToWorldPos && meta.exitToWorldPos.x === x && meta.exitToWorldPos.y === y) return true;
      if (meta.stairsUpPos && meta.stairsUpPos.x === x && meta.stairsUpPos.y === y) return true;
      if (meta.stairsDownPos && meta.stairsDownPos.x === x && meta.stairsDownPos.y === y) return true;
      if (ctx.player && ctx.player.x === x && ctx.player.y === y) return true;
      if (Array.isArray(ctx.enemies) && ctx.enemies.some(e => e && e.x === x && e.y === y)) return true;
      if (Array.isArray(ctx.corpses) && ctx.corpses.some(c => c && c.x === x && c.y === y)) return true;
      return false;
    };

    const RU = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
    const rng = (RU && typeof RU.getRng === "function")
      ? RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
      : ((typeof ctx.rng === "function") ? ctx.rng : () => 0.5);

    const f = Math.max(1, floorIndex | 0);
    const total = Math.max(1, totalFloors | 0);
    const isTop = f === total;

    // Difficulty config (optional): derive depth and per-floor HP/ATK scaling.
    let baseDepth = Math.max(1, (ctx.floor | 0) || 1);
    let hpMultCfg = 1;
    let atkMultCfg = 1;
    try {
      const tr = ctx.towerRun;
      const GD = getGameData(ctx);
      const towersCfg = GD && GD.towers;
      const tType = tr && tr.config;
      const defaults = towersCfg && towersCfg.defaults && typeof towersCfg.defaults === "object"
        ? towersCfg.defaults
        : null;
      const diffCfg = (tType && tType.difficulty) || (defaults && defaults.difficulty) || null;
      if (diffCfg) {
        const baseOffset = Number.isFinite(diffCfg.baseLevelOffset) ? diffCfg.baseLevelOffset : 0;
        const levelPerFloor = Number.isFinite(diffCfg.levelPerFloor) && diffCfg.levelPerFloor > 0
          ? diffCfg.levelPerFloor
          : 1;
        const hpPerFloor = Number.isFinite(diffCfg.enemyHpPerFloor) ? diffCfg.enemyHpPerFloor : 0.15;
        const atkPerFloor = Number.isFinite(diffCfg.enemyAtkPerFloor) ? diffCfg.enemyAtkPerFloor : 0.10;
        const baseLevel = tr && typeof tr.baseLevel === "number" ? Math.max(1, tr.baseLevel | 0) : baseDepth;
        baseDepth = Math.max(1, Math.round(baseLevel + baseOffset + (f - 1) * levelPerFloor));
        hpMultCfg = 1 + (f - 1) * hpPerFloor;
        atkMultCfg = 1 + (f - 1) * atkPerFloor;
      }
    } catch (_) {}

    let enemyCount = 6 + Math.floor(baseDepth * 1.5);
    enemyCount = Math.max(3, Math.min(enemyCount, Math.floor((rows * cols) / 20)));
    if (f === 1) {
      // First floor: slightly lower density so entry is less punishing.
      enemyCount = Math.max(3, Math.floor(enemyCount * 0.7));
    }
    if (isTop && total > 1) {
      // Final floor (boss arena): reduce ambient bandit count sharply so the
      // focus stays on the boss. Roughly half of what a normal floor would have.
      enemyCount = Math.max(3, Math.floor(enemyCount * 0.5));
    };

    const candidates = [];
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        if (!isBlocked(x, y)) candidates.push({ x, y });
      }
    }
    if (!candidates.length) return;

    // Shuffle candidates
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = candidates[i]; candidates[i] = candidates[j]; candidates[j] = tmp;
    }

    if (!Array.isArray(ctx.enemies)) ctx.enemies = [];
    meta.enemies = ctx.enemies;

    const count = Math.min(enemyCount, candidates.length);
    for (let i = 0; i < count; i++) {
      const p = candidates[i];
      const depthForEnemy = Math.max(1, baseDepth + (f - 1));
      let enemy = towerEnemyFactoryLocal(ctx, p.x, p.y, depthForEnemy, rng);
      if (!enemy) {
        // Fallback to registry generic factory if available
        try {
          const EM = (typeof window !== "undefined" ? window.Enemies : null);
          if (EM && typeof EM.createEnemyAt === "function") {
            enemy = EM.createEnemyAt(p.x, p.y, depthForEnemy, rng);
          }
        } catch (_) {}
      }
      if (!enemy) continue;
      scaleTowerEnemyForDifficulty(ctx, enemy, depthForEnemy, f, hpMultCfg, atkMultCfg);
      ctx.enemies.push(enemy);
    }
  } catch (_) {}
}

// Spawn a tower boss on the given floor meta when this is the top floor of
// a tower run. Boss stats/definition normally come from data/entities/enemies.json.
// Boss type is chosen from configuration when available (towers.json +
// tower_themes.json) and falls back to bandit_captain when missing.
function spawnTowerBossOnFloor(ctx, meta) {
  try {
    if (!ctx || !meta) return;
    const EM = (ctx.Enemies || (typeof window !== "undefined" ? window.Enemies : null));
    if (!EM || typeof EM.getTypeDef !== "function") return;

    // Determine boss type from tower config/theme when possible.
    let bossType = "bandit_captain";
    try {
      const GD = getGameData(ctx);
      const themes = GD && GD.towerThemes;
      const tr = ctx.towerRun;
      const cfg = tr && tr.config;
      const typeId = tr && tr.typeId;
      const themeId = (cfg && typeof cfg.themeId === "string") ? cfg.themeId : (typeId || "bandit_tower");
      const theme = themes && themes[themeId];

      // Explicit typeId on the tower config takes precedence.
      const explicit = cfg && cfg.boss && typeof cfg.boss.typeId === "string" ? cfg.boss.typeId : null;
      if (explicit) {
        bossType = explicit;
      } else if (theme && Array.isArray(theme.bosses) && theme.bosses.length) {
        // Weighted pick from theme.bosses.
        let entries = theme.bosses.filter(b => b && b.id && Number(b.weight) > 0);
        if (entries.length) {
          let total = 0;
          for (let i = 0; i < entries.length; i++) total += Number(entries[i].weight);
          if (total > 0) {
            const r = (typeof ctx.rng === "function" ? ctx.rng() : Math.random()) * total;
            let acc = 0;
            for (let i = 0; i < entries.length; i++) {
              acc += Number(entries[i].weight);
              if (r < acc) {
                bossType = String(entries[i].id);
                break;
              }
            }
          }
        }
      }
    } catch (_) {}

    let def = EM.getTypeDef(bossType);
    if (!def) def = EM.getTypeDef("bandit_captain") || EM.getTypeDef("bandit");
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
        ? EM.levelFor(bossType, depth, ctx.rng)
        : depth;
    const glyph =
      def.glyph && def.glyph.length
        ? def.glyph
        : (bossType.length ? bossType.charAt(0) : "?");

    const boss = {
      x: candidate.x,
      y: candidate.y,
      type: bossType,
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
// high-tier \"boss\" chest near the boss when possible. Chest counts and
// tiers are configurable via data/worldgen/towers.json (types[*].chests).
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

    // Read chest config (with defaults) from towers.json when available.
    let lowerMaxChests = 1;
    let lowerLockedChance = 0.2;
    let topBossTier = 3;
    let topExtra = 1;
    try {
      const GD = getGameData(ctx);
      const towersCfg = GD && GD.towers;
      const tr = ctx.towerRun;
      const tType = tr && tr.config;
      const defaults = towersCfg && towersCfg.defaults && typeof towersCfg.defaults === "object"
        ? towersCfg.defaults
        : null;
      const chestCfg = (tType && tType.chests) || (defaults && defaults.chests) || null;
      if (chestCfg) {
        if (chestCfg.lowerFloors) {
          if (Number.isFinite(chestCfg.lowerFloors.maxChests) && chestCfg.lowerFloors.maxChests >= 0) {
            lowerMaxChests = chestCfg.lowerFloors.maxChests;
          }
          if (Number.isFinite(chestCfg.lowerFloors.lockedChance) && chestCfg.lowerFloors.lockedChance >= 0) {
            lowerLockedChance = chestCfg.lowerFloors.lockedChance;
          }
        }
        if (chestCfg.topFloor) {
          if (Number.isFinite(chestCfg.topFloor.bossChestTier) && chestCfg.topFloor.bossChestTier >= 1) {
            topBossTier = chestCfg.topFloor.bossChestTier | 0;
          }
          if (Number.isFinite(chestCfg.topFloor.extraChests) && chestCfg.topFloor.extraChests >= 0) {
            topExtra = chestCfg.topFloor.extraChests | 0;
          }
          // lockedBossChest reserved for future lockpicking integration; currently ignored.
        }
      }
    } catch (_) {}

    if (isTop) {
      // Always try to spawn a boss chest on the top floor.
      const boss = Array.isArray(ctx.enemies)
        ? ctx.enemies.find(e => e && typeof e.type === "string")
        : null;

      const ref = boss || meta.stairsDownPos || meta.exitToWorldPos || { x: ctx.player.x | 0, y: ctx.player.y | 0 };

      const pickBestSpot = () => {
        let bestSpot = null;
        if (chestSpots.length) {
          let bestD = Number.POSITIVE_INFINITY;
          for (let i = 0; i < chestSpots.length; i++) {
            const s = chestSpots[i];
            const x = s.x | 0;
            const y = s.y | 0;
            if (isBlockedForChest(x, y)) continue;
            const d = manhattan(x, y, ref.x | 0, ref.y | 0);
            if (d < bestD) {
              bestD = d;
              bestSpot = { x, y };
            }
          }
        }
        if (!bestSpot) bestSpot = findFallbackChestTile();
        return bestSpot;
      };

      const bossSpot = pickBestSpot();
      if (bossSpot) {
        DI.spawnChest(ctx, {
          where: { x: bossSpot.x, y: bossSpot.y },
          tier: topBossTier,
          decayAll: 99,
          loot: ["anyEquipment", "anyEquipment", "potion"],
          announce: true
        });
      }

      // Optional extra chests on top floor (smaller rewards).
      const extraCount = Math.max(0, topExtra | 0);
      if (extraCount > 0 && chestSpots.length > 0) {
        const shuffled = chestSpots.slice();
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          const tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
        }
        let placed = 0;
        for (let i = 0; i < shuffled.length && placed < extraCount; i++) {
          const s = shuffled[i];
          const x = s.x | 0;
          const y = s.y | 0;
          if (isBlockedForChest(x, y)) continue;
          DI.spawnChest(ctx, {
            where: { x, y },
            tier: topBossTier,
            decayAll: 99,
            loot: ["anyEquipment", "potion"],
            announce: false
          });
          placed++;
        }
      }
      return;
    }

    // Lower floors: up to lowerMaxChests chests, with an overall chance derived
    // from lowerLockedChance for now (lockedChance is reserved for future
    // lockpicking integration; currently used only as a density hint).
    if (!chestSpots.length || lowerMaxChests <= 0) {
      return;
    }

    const shuffled = chestSpots.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
    }

    const maxToPlace = Math.min(lowerMaxChests | 0, shuffled.length);
    let placed = 0;
    for (let i = 0; i < shuffled.length && placed < maxToPlace; i++) {
      const s = shuffled[i];
      const x = s.x | 0;
      const y = s.y | 0;
      if (isBlockedForChest(x, y)) continue;

      // Use lockedChance as a simple probability gate for whether this spot
      // gets a chest at all. Locking behavior is not yet wired to the
      // lockpicking mini-game; all tower chests are still normal for now.
      const roll = rng();
      if (roll > lowerLockedChance) continue;

      const tier = (f >= total - 1) ? 3 : 2;
      DI.spawnChest(ctx, {
        where: { x, y },
        tier,
        decayAll: 99,
        loot: ["anyEquipment", "potion"],
        announce: false
      });
      placed++;
    }
  } catch (_) {}
}

// Release a captive dungeon prop in a tower and spawn a neutral ally who
// fights bandits (and other hostile factions) but ignores the player.
export function releaseCaptiveHere(ctx) {
  try {
    if (!ctx || ctx.mode !== "dungeon") return false;
    if (!ctx.towerRun || ctx.towerRun.kind !== "tower") return false;

    const props = Array.isArray(ctx.dungeonProps) ? ctx.dungeonProps : [];
    const px = ctx.player && typeof ctx.player.x === "number" ? (ctx.player.x | 0) : 0;
    const py = ctx.player && typeof ctx.player.y === "number" ? (ctx.player.y | 0) : 0;

    const idx = props.findIndex(
      (p) =>
        p &&
        p.x === px &&
        p.y === py &&
        String(p.type || "").toLowerCase() === "captive"
    );
    if (idx < 0) return false;

    // Remove the captive prop from this tile.
    props.splice(idx, 1);
    ctx.dungeonProps = props;

    const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
    const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
    if (!rows || !cols) return true;

    const T = ctx.TILES;
    const isInBounds = (x, y) => y >= 0 && x >= 0 && y < rows && x < cols;
    const hasEnemyAt = (x, y) =>
      Array.isArray(ctx.enemies) && ctx.enemies.some((e) => e && e.x === x && e.y === y);
    const hasCorpseAt = (x, y) =>
      Array.isArray(ctx.corpses) && ctx.corpses.some((c) => c && c.x === x && c.y === y);
    const hasPropAt = (x, y) =>
      Array.isArray(ctx.dungeonProps) && ctx.dungeonProps.some((p) => p && p.x === x && p.y === y);

    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];

    let sx = null;
    let sy = null;
    for (let i = 0; i < dirs.length; i++) {
      const nx = px + dirs[i].x;
      const ny = py + dirs[i].y;
      if (!isInBounds(nx, ny)) continue;
      const tile = ctx.map[ny][nx];
      if (tile !== T.FLOOR && tile !== T.DOOR) continue;
      if (hasEnemyAt(nx, ny)) continue;
      if (hasCorpseAt(nx, ny)) continue;
      if (hasPropAt(nx, ny)) continue;
      sx = nx;
      sy = ny;
      break;
    }

    if (sx == null || sy == null) {
      // No space to spawn an ally; captive is freed flavor-wise only.
      try {
        ctx.log && ctx.log("You free the captive, but there's no room for them to fight here.", "info");
      } catch (_) {}
    } else {
      const EM = ctx.Enemies || (typeof window !== "undefined" ? window.Enemies : null);
      if (EM && typeof EM.getTypeDef === "function") {
        let type = "guard"; // captured guards that now fight back
        let def = EM.getTypeDef(type);
        if (!def) {
          // Fallback: reuse bandit stats but flip faction to guard-like.
          type = "bandit";
          def = EM.getTypeDef(type);
        }
        if (def) {
          const depth = Math.max(1, (ctx.floor | 0) || 1);
          let rfn = ctx.rng;
          try {
            const RU = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
            if (RU && typeof RU.getRng === "function") {
              rfn = RU.getRng(typeof ctx.rng === "function" ? ctx.rng : undefined);
            }
          } catch (_) {}
          if (typeof rfn !== "function") rfn = () => 0.5;
          const level =
            EM.levelFor && typeof EM.levelFor === "function"
              ? EM.levelFor(type, depth, rfn)
              : depth;
          const glyph =
            (def.glyph && def.glyph.length) ? def.glyph : (type && type.length ? type.charAt(0) : "?");

          const ally = {
            x: sx,
            y: sy,
            type,
            glyph,
            hp: def.hp(depth),
            atk: def.atk(depth),
            xp: def.xp ? def.xp(depth) : 0,
            level,
            faction: def.faction || "guard",
            announced: false,
            // Do not consider the player as a target; only fight hostile factions.
            _ignorePlayer: true,
          };

          if (!Array.isArray(ctx.enemies)) ctx.enemies = [];
          ctx.enemies.push(ally);

          try {
            ctx.log && ctx.log("You free a captive! They grab a weapon and turn on the bandits.", "good");
          } catch (_) {}
        }
      }
    }

    // Refresh visuals/UI
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

    return true;
  } catch (_) {
    return false;
  }
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
  const isTop = f === total;

  if (!meta) {
    // Fresh floor: for towers, prefer prefab-driven generation; fallback to
    // classic generator only when prefab data is unavailable.
    ctx.floor = tr.baseLevel + (f - 1);
    if (ctx.dungeonInfo) ctx.dungeonInfo.level = ctx.floor;

    let usedPrefabs = false;

    if (towerPrefabsAvailable(ctx)) {
      meta = buildTowerFloorLayout(ctx, tr, f, total);
      usedPrefabs = !!(meta && meta.map);
    }

    if (!usedPrefabs) {
      // Fallback: generic level generation.
      generateExt(ctx, ctx.floor);
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
    } else {
      // Prefab layout already initialized ctx.map/seen/visible/enemies/corpses/decals.
      if (!meta) {
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
      }
      if (!Array.isArray(meta.dungeonProps)) meta.dungeonProps = [];
      if (!Array.isArray(meta.chestSpots)) meta.chestSpots = [];
      meta.floorIndex = f;
      meta.floorLevel = ctx.floor;
      if (!meta.exitToWorldPos) meta.exitToWorldPos = null;
      if (!meta.stairsUpPos) meta.stairsUpPos = null;
      if (!meta.stairsDownPos) meta.stairsDownPos = null;
    }

    const T = ctx.TILES;
    const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
    const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;

    const clampPos = (x, y) => ({
      x: Math.max(0, Math.min((cols ? cols - 1 : 0), x | 0)),
      y: Math.max(0, Math.min((rows ? rows - 1 : 0), y | 0)),
    });

    let px = (ctx.player && typeof ctx.player.x === "number") ? (ctx.player.x | 0) : 0;
    let py = (ctx.player && typeof ctx.player.y === "number") ? (ctx.player.y | 0) : 0;
    let seed = clampPos(px, py);

    try {
      if (!ctx.inBounds || !ctx.inBounds(seed.x, seed.y) || ctx.map[seed.y][seed.x] !== T.FLOOR) {
        const near = pickNearFloorFrom(ctx, seed.x, seed.y, []);
        if (near) seed = near;
      }
    } catch (_) {}

    const blacklist = [];

    if (f === 1) {
      // Base floor: designate entrance tile as exit-to-world stairs.
      meta.exitToWorldPos = { x: seed.x, y: seed.y };
      try {
        ctx.map[seed.y][seed.x] = T.STAIRS;
      } catch (_) {}
      blacklist.push(meta.exitToWorldPos);

      // Inner stairs up to the next floor, unless this is the top.
      if (!isTop) {
        const up = pickFarFloorFrom(ctx, seed.x, seed.y, blacklist);
        if (up) {
          meta.stairsUpPos = { x: up.x, y: up.y };
          try {
            ctx.map[up.y][up.x] = T.STAIRS;
          } catch (_) {}
          blacklist.push(meta.stairsUpPos);
        }
      }
    } else {
      // Floors above base: spawn at stairs-down, then place stairs-up if not top.
      meta.stairsDownPos = { x: seed.x, y: seed.y };
      try {
        ctx.map[seed.y][seed.x] = T.STAIRS;
      } catch (_) {}
      blacklist.push(meta.stairsDownPos);

      if (!isTop) {
        const up = pickFarFloorFrom(ctx, seed.x, seed.y, blacklist);
        if (up) {
          meta.stairsUpPos = { x: up.x, y: up.y };
          try {
            ctx.map[up.y][up.x] = T.STAIRS;
          } catch (_) {}
        }
      }
    }

    // Add wall torches for ambience.
    try {
      const torches = spawnWallTorches(ctx, { density: 0.01, minSpacing: 2 });
      if (Array.isArray(torches) && torches.length) {
        if (!Array.isArray(meta.dungeonProps)) meta.dungeonProps = [];
        meta.dungeonProps = meta.dungeonProps.concat(torches);
      }
    } catch (_) {}

    // Spawn tower enemies (bandits) on this floor.
    try {
      spawnTowerEnemiesOnFloor(ctx, meta, f, total);
    } catch (_) {}

    // On the final floor of the tower, spawn a dedicated boss enemy.
    if (isTop) {
      spawnTowerBossOnFloor(ctx, meta);
    }

    // Spawn tower chests using JSON chest spots when available.
    try {
      spawnTowerChestsOnFloor(ctx, meta, f, total);
    } catch (_) {}

    // Ensure ctx.dungeonProps reflects the full set of props (torches + prefab props)
    // so they render immediately on first visit.
    ctx.dungeonProps = Array.isArray(meta.dungeonProps) ? meta.dungeonProps : [];

    tr.floors[f] = meta;
  } else {
    // Revisit existing floor: restore state references.
    ctx.map = meta.map;
    ctx.seen = meta.seen;
    ctx.visible = meta.visible;
    ctx.enemies = meta.enemies || [];
    ctx.corpses = meta.corpses || [];
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
    // Arriving from below: appear at the "down" stairs for this floor if present.
    spawn = meta.stairsDownPos || meta.exitToWorldPos || meta.stairsUpPos;
  } else if (goingDown) {
    // Arriving from above: appear at the "up" stairs for this floor if present.
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
        const tr = ctx.towerRun;
        const f = tr.currentFloor && tr.currentFloor >= 1 ? tr.currentFloor : 1;
        // Re-enter the tower via tower runtime so per-floor meta, props,
        // and spawn positions are applied consistently.
        return gotoTowerFloor(ctx, f, "fromWorld");
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
  attachGlobal("DungeonRuntime", { keyFromWorldPos, save, load, generate, generateLoot, returnToWorldIfAtExit, lootHere, killEnemy, enter, tryMoveDungeon, tick, releaseCaptiveHere });
}