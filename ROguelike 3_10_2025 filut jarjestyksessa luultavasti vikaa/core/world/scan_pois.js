/**
 * World scanPOIs helper (Phase 3 extraction):
 * Registers towns/dungeons/ruins in the current window and triggers roads/bridges when enabled.
 */\nimport { addTown, addCastle, addDungeon, addRuins } from './poi.js';\nimport { ensureRoads, ensureExtraBridges } from './roads_bridges.js';\n
import { addTown, addDungeon, addRuins } from './poi.js';
import { ensureRoads, ensureExtraBridges } from './roads_bridges.js';

// Config helpers (duplicated from world_runtime for now; will be centralized later)
function _getConfig() {
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    if (GD && GD.config && GD.config.world) return GD.config.world;
  } catch (_) {}
  return {};
}
function _lsBool(key) {
  try {
    const v = localStorage.getItem(key);
    if (typeof v === "string") {
      const s = v.toLowerCase();
      return s === "1" || s === "true" || s === "yes" || s === "on";
    }
  } catch (_) {}
  return null;
}
function featureEnabled(name, defaultVal) {
  const ls = _lsBool(name);
  if (ls != null) return !!ls;
  const cfg = _getConfig();
  if (name === "WORLD_INFINITE") {
    if (typeof cfg.infinite === "boolean") return !!cfg.infinite;
    return !!defaultVal;
  }
  if (name === "WORLD_ROADS") {
    if (typeof cfg.roadsEnabled === "boolean") return !!cfg.roadsEnabled;
    return !!defaultVal;
  }
  if (name === "WORLD_BRIDGES") {
    if (typeof cfg.bridgesEnabled === "boolean") return !!cfg.bridgesEnabled;
    return !!defaultVal;
  }
  return !!defaultVal;
}

// Scan a rectangle of the current window (map space) and register POIs sparsely
export function scanPOIs(ctx, x0, y0, w, h) {
  const WT = (ctx.World && ctx.World.TILES) || { TOWN: 4, DUNGEON: 5, RUINS: 12, WATER: 0, RIVER: 7, BEACH: 8, MOUNTAIN: 3, GRASS: 1, FOREST: 2, DESERT: 9, SNOW: 10, SWAMP: 6, CASTLE: 15, TOWNK: 4, DUNGEONK: 5 };
  const world = ctx.world;
  for (let yy = y0; yy < y0 + h; yy++) {
    if (yy < 0 || yy >= ctx.map.length) continue;
    const row = ctx.map[yy];
    for (let xx = x0; xx < x0 + w; xx++) {
      if (xx < 0 || xx >= row.length) continue;
      const t = row[xx];
      if (t === WT.TOWN) {
        const wx = world.originX + xx;
        const wy = world.originY + yy;
        addTown(world, wx, wy);
      } else if (WT.CASTLE != null && t === WT.CASTLE) {
        const wx = world.originX + xx;
        const wy = world.originY + yy;
        addCastle(world, wx, wy);
      } else if (t === WT.DUNGEON) {
        const wx = world.originX + xx;
        const wy = world.originY + yy;

        // Detect mountain-adjacent dungeons at scan time so UI can highlight them reliably.
        let isMountainDungeon = false;
        try {
          const rows = ctx.map.length;
          const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
          if (yy >= 0 && yy < rows && xx >= 0 && xx < cols) {
            for (let dy = -1; dy <= 1 && !isMountainDungeon; dy++) {
              for (let dx = -1; dx <= 1 && !isMountainDungeon; dx++) {
                if (!dx && !dy) continue;
                const ny = yy + dy;
                const nx = xx + dx;
                if (ny < 0 || nx < 0 || ny >= rows || nx >= cols) continue;
                if (ctx.map[ny][nx] === WT.MOUNTAIN) {
                  isMountainDungeon = true;
                }
              }
            }
          }
        } catch (_) {}

        addDungeon(world, wx, wy, isMountainDungeon ? { isMountainDungeon: true } : undefined);
      } else if (t === WT.RUINS) {
        const wx = world.originX + xx;
        const wy = world.originY + yy;
        addRuins(world, wx, wy);
      }
    }
  }
    }
  }
  // After registering POIs in this strip/window, connect nearby towns with roads and mark bridges (feature-gated).
  try {
    if (featureEnabled("WORLD_ROADS", false)) ensureRoads(ctx);
  } catch (_) {}
  // Ensure there are usable river crossings independent of roads (feature-gated).
  try {
    if (featureEnabled("WORLD_BRIDGES", false)) {
      ensureExtraBridges(ctx);
      // One-time DEV log: report whether we have any bridge tiles recorded so far.
      try {
        const world = ctx.world;
        if (world && typeof ctx.log === "function" && !world._bridgesLoggedOnce) {
          const count = Array.isArray(world.bridges) ? world.bridges.length : 0;
          if (count > 0) {
            ctx.log(`World generation: ${count} bridge tiles currently recorded.`, "notice");
          } else {
            ctx.log("World generation: no bridge tiles are recorded in this window yet.", "notice");
          }
          world._bridgesLoggedOnce = true;
        }
      } catch (_) {}
    }
  } catch (_) {}
}