/**
 * World POI helpers (Phase 2): towns, dungeons, ruins registration.
 * Extracted from core/world_runtime.js with no behavior changes.
 */
import { getMod } from "../../utils/access.js";

// Config helpers (GameData.config overrides, with localStorage flags for quick toggles)
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
  // Feature toggles:
  // - WORLD_INFINITE: config.world.infinite
  // - WORLD_ROADS: config.world.roadsEnabled
  // - WORLD_BRIDGES: config.world.bridgesEnabled
  // Resolution order: localStorage override → config value → default
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

// Stable coordinate hash → [0,1). Used to derive deterministic POI metadata.
function h2(x, y) {
  const n = (((x | 0) * 73856093) ^ ((y | 0) * 19349663)) >>> 0;
  return (n % 1000003) / 1000003;
}

// Ensure POI bookkeeping containers exist on world
export function ensurePOIState(world) {
  if (!world.towns) world.towns = [];
  if (!world.dungeons) world.dungeons = [];
  if (!world.ruins) world.ruins = [];
  if (!world.castles) world.castles = [];
  if (!world._poiSet) world._poiSet = new Set();
}

// Add a town at world coords if not present; derive size deterministically
export function addTown(world, x, y) {
  ensurePOIState(world);
  const key = `${x},${y}`;
  if (world._poiSet.has(key)) return;
  const r = h2(x + 11, y - 7);
  const size = (r < 0.60) ? "small" : (r < 0.90 ? "big" : "city");
  world.towns.push({ x, y, size, kind: "town" });
  world._poiSet.add(key);
}

// Add a castle at world coords if not present. Castles are treated as large towns with kind=\"castle\".
// They are kept in both world.castles and world.towns for compatibility with existing town-based systems.
export function addCastle(world, x, y) {
  ensurePOIState(world);
  const key = `${x},${y}`;
  if (world._poiSet.has(key)) return;
  const size = "city";
  const rec = { x, y, size, kind: "castle" };
  world.towns.push(rec);
  world.castles.push(rec);
  world._poiSet.add(key);
}

// Add a dungeon at world coords if not present; derive level/size deterministically.
// Optional extra metadata (e.g. { isMountainDungeon: true, kind: "tower" }) can be passed via the opts object.
export function addDungeon(world, x, y, opts) {
  ensurePOIState(world);
  const key = `${x},${y}`;
  if (world._poiSet.has(key)) return;
  const r1 = h2(x - 5, y + 13);
  const level = 1 + Math.floor(r1 * 5); // 1..5
  const r2 = h2(x + 29, y + 3);
  const size = (r2 < 0.45) ? "small" : (r2 < 0.85 ? "medium" : "large");
  const dungeon = { x, y, level, size };
  if (opts && typeof opts === "object") {
    try {
      Object.assign(dungeon, opts);
    } catch (_) {}
  }

  // For tower-type dungeons, derive a deterministic floor count (3–5 floors) if not provided,
  // and optionally assign a towerType based on data/worldgen/towers.json when available.
  if (dungeon.kind === "tower") {
    const hasFloors = typeof dungeon.towerFloors === "number" && dungeon.towerFloors >= 2;
    if (!hasFloors) {
      const rFloors = h2(x + 101, y - 37);
      const floors = 3 + Math.floor(rFloors * 3); // 3..5
      dungeon.towerFloors = floors;
    }

    // Determine towerType via GameData.towers.defaults.typeWeights when present.
    try {
      const GD = (typeof window !== "undefined" ? window.GameData : null);
      const towersCfg = GD && GD.towers;
      let towerTypeId = null;

      if (towersCfg && towersCfg.types && typeof towersCfg.types === "object") {
        const defaults = (towersCfg.defaults && typeof towersCfg.defaults === "object") ? towersCfg.defaults : null;
        const weights = defaults && defaults.typeWeights && typeof defaults.typeWeights === "object"
          ? defaults.typeWeights
          : null;
        const entries = weights ? Object.entries(weights) : [];
        const filtered = entries.filter(([id, w]) =>
          towersCfg.types[id] &&
          typeof w === "number" &&
          w > 0
        );
        if (filtered.length) {
          let total = 0;
          for (let i = 0; i < filtered.length; i++) {
            total += filtered[i][1];
          }
          if (total > 0) {
            const rType = h2(x + 313, y - 97) * total;
            let acc = 0;
            for (let i = 0; i < filtered.length; i++) {
              const id = filtered[i][0];
              const w = filtered[i][1];
              acc += w;
              if (rType < acc) {
                towerTypeId = id;
                break;
              }
            }
          }
        }
        if (!towerTypeId && defaults && typeof defaults.defaultTowerType === "string") {
          const defId = defaults.defaultTowerType;
          if (towersCfg.types[defId]) {
            towerTypeId = defId;
          }
        }
      }

      if (!towerTypeId) {
        towerTypeId = "bandit_tower";
      }
      dungeon.towerType = towerTypeId;
    } catch (_) {}
  }

  world.dungeons.push(dungeon);
  world._poiSet.add(key);
}

// Add a ruins POI at world coords if not present
export function addRuins(world, x, y) {
  ensurePOIState(world);
  const key = `${x},${y}`;
  if (world._poiSet.has(key)) return;
  world.ruins.push({ x, y });
  world._poiSet.add(key);
}

// (Optional future) scanPOIs: left for Phase 3 when roads/bridges helpers are also extracted
// export function scanPOIs(ctx, x0, y0, w, h) { ... }