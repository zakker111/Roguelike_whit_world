import * as World from "../world/world.js";

// ---- Persistence of cut trees per region (do not respawn after cutting) ----
const REGION_CUTS_LS_KEY = "REGION_CUTS_V1";

function _loadCutsMap() {
  try {
    const raw = localStorage.getItem(REGION_CUTS_LS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? obj : {};
  } catch (_) {
    return {};
  }
}

function _saveCutsMap(map) {
  try {
    localStorage.setItem(REGION_CUTS_LS_KEY, JSON.stringify(map || {}));
  } catch (_) {}
}

export function applyRegionCuts(sample, key) {
  if (!key) return;
  const map = _loadCutsMap();
  const arr = Array.isArray(map[key]) ? map[key] : [];
  if (!arr.length) return;
  const h = sample.length;
  const w = sample[0] ? sample[0].length : 0;
  const WT = World.TILES;
  for (const s of arr) {
    const parts = String(s).split(",");
    if (parts.length !== 2) continue;
    const x = (Number(parts[0]) | 0);
    const y = (Number(parts[1]) | 0);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    // Only convert if currently a TREE or BERRY_BUSH to avoid clobbering non-decor tiles
    try {
      const t = sample[y][x];
      if (t === WT.TREE || t === WT.BERRY_BUSH) sample[y][x] = WT.FOREST;
    } catch (_) {}
  }
}

export function addRegionCut(key, x, y) {
  if (!key) return;
  const map = _loadCutsMap();
  const k = String(key);
  const arr = Array.isArray(map[k]) ? map[k] : [];
  const tag = `${x | 0},${y | 0}`;
  if (!arr.includes(tag)) arr.push(tag);
  map[k] = arr;
  _saveCutsMap(map);
}

// Per-tile region cut key
export function regionCutKey(worldX, worldY, width, height) {
  return `r:${worldX},${worldY}:${width}x${height}`;
}

// ---- Persistence of animal presence per region (remember areas where animals were seen and cleared) ----
const REGION_ANIMALS_LS_KEY = "REGION_ANIMALS_V2";

function _loadAnimalsMap() {
  try {
    const raw = localStorage.getItem(REGION_ANIMALS_LS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? obj : {};
  } catch (_) {
    return {};
  }
}

// Back-compat: migrate old boolean entries from V1 if present
(function migrateAnimalsV1() {
  try {
    const rawOld = localStorage.getItem("REGION_ANIMALS_V1");
    if (!rawOld) return;
    const oldMap = JSON.parse(rawOld);
    if (!oldMap || typeof oldMap !== "object") return;
    const newMap = _loadAnimalsMap();
    Object.keys(oldMap).forEach(k => {
      const v = oldMap[k];
      if (v) {
        const cur = newMap[k];
        if (!cur || typeof cur !== "object") newMap[k] = { seen: true, cleared: false };
        else newMap[k].seen = true;
      }
    });
    localStorage.setItem(REGION_ANIMALS_LS_KEY, JSON.stringify(newMap));
    // Optionally clear old key
    // localStorage.removeItem("REGION_ANIMALS_V1");
  } catch (_) {}
})();

function _saveAnimalsMap(map) {
  try {
    localStorage.setItem(REGION_ANIMALS_LS_KEY, JSON.stringify(map || {}));
  } catch (_) {}
}

// Per-tile animal memory keys
function regionAnimalsKey(worldX, worldY) {
  return `a:${worldX},${worldY}`;
}

export function markAnimalsSeen(worldX, worldY) {
  const map = _loadAnimalsMap();
  const k = regionAnimalsKey(worldX | 0, worldY | 0);
  const cur = (map[k] && typeof map[k] === "object") ? map[k] : { seen: false, cleared: false };
  cur.seen = true;
  map[k] = cur;
  _saveAnimalsMap(map);
}

export function markAnimalsCleared(worldX, worldY) {
  const map = _loadAnimalsMap();
  const k = regionAnimalsKey(worldX | 0, worldY | 0);
  const cur = (map[k] && typeof map[k] === "object") ? map[k] : { seen: false, cleared: false };
  cur.seen = true;
  cur.cleared = true;
  map[k] = cur;
  _saveAnimalsMap(map);
}

export function animalsSeenHere(worldX, worldY) {
  const map = _loadAnimalsMap();
  const k = regionAnimalsKey(worldX | 0, worldY | 0);
  const v = map[k];
  if (v && typeof v === "object") return !!v.seen;
  return !!v; // back-compat: boolean true means seen
}

export function animalsClearedHere(worldX, worldY) {
  const map = _loadAnimalsMap();
  const k = regionAnimalsKey(worldX | 0, worldY | 0);
  const v = map[k];
  if (v && typeof v === "object") return !!v.cleared;
  return false;
}

// ---- Persistence of per-tile Region Map state (map + corpses) ----
const REGION_STATE_LS_KEY = "REGION_STATE_V1";

function _loadRegionStateMap() {
  try {
    const raw = localStorage.getItem(REGION_STATE_LS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? obj : {};
  } catch (_) {
    return {};
  }
}

function _saveRegionStateMap(map) {
  try {
    localStorage.setItem(REGION_STATE_LS_KEY, JSON.stringify(map || {}));
  } catch (_) {}
}

// Per-tile region state keys
function regionStateKey(worldX, worldY) {
  return `s:${worldX},${worldY}`;
}

export function saveRegionState(ctx) {
  try {
    const pos = ctx.region && ctx.region.enterWorldPos ? ctx.region.enterWorldPos : null;
    if (!pos) return;
    const key = regionStateKey(pos.x | 0, pos.y | 0);
    const mapObj = _loadRegionStateMap();
    // Filter corpses within the region bounds
    const corpses = Array.isArray(ctx.corpses)
      ? ctx.corpses.map(c => ({ x: c.x | 0, y: c.y | 0, looted: !!c.looted, loot: Array.isArray(c.loot) ? c.loot : [] }))
      : [];
    const st = {
      w: (ctx.region.width | 0),
      h: (ctx.region.height | 0),
      map: ctx.region.map, // small numeric grid
      corpses
    };
    mapObj[key] = st;
    _saveRegionStateMap(mapObj);
  } catch (_) {}
}

export function loadRegionState(worldX, worldY) {
  try {
    const key = regionStateKey(worldX | 0, worldY | 0);
    const mapObj = _loadRegionStateMap();
    const st = mapObj[key];
    if (st && typeof st === "object" && Array.isArray(st.map) && st.w && st.h) return st;
  } catch (_) {}
  return null;
}
