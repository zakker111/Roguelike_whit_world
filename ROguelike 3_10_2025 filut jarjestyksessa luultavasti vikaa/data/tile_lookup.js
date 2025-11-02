// Centralized tile lookup helper sourced from GameData.tiles
// Returns a tile definition object for a given mode ("overworld","town","dungeon",...) and numeric id,
// or null if not found. Safe against missing GameData/tiles.

// Simple caches keyed by mode:id and mode:key to avoid repeated linear scans.
// Caches are reset when the tiles array reference changes.
let _LAST_TILES_REF = null;
let _MODE_ID_CACHE = Object.create(null);
let _MODE_KEY_CACHE = Object.create(null);
function _ensureCacheFresh(arrRef) {
  if (_LAST_TILES_REF !== arrRef) {
    _LAST_TILES_REF = arrRef;
    _MODE_ID_CACHE = Object.create(null);
    _MODE_KEY_CACHE = Object.create(null);
  }
}

export function getTileDef(mode, id) {
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const arr = GD && GD.tiles && Array.isArray(GD.tiles.tiles) ? GD.tiles.tiles : null;
    if (!arr) return null;
    _ensureCacheFresh(arr);
    const m = String(mode || "").toLowerCase();
    const key = m + ":" + (id | 0);
    const hit = _MODE_ID_CACHE[key];
    if (hit) return hit;
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      if ((t.id | 0) === (id | 0) &&
          Array.isArray(t.appearsIn) &&
          t.appearsIn.some(s => String(s).toLowerCase() === m)) {
        _MODE_ID_CACHE[key] = t;
        return t;
      }
    }
  } catch (_) {}
  return null;
}

// Lookup by symbolic key for a given mode, e.g., getTileDefByKey("town", "DOOR")
export function getTileDefByKey(mode, key) {
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const arr = GD && GD.tiles && Array.isArray(GD.tiles.tiles) ? GD.tiles.tiles : null;
    if (!arr) return null;
    _ensureCacheFresh(arr);
    const m = String(mode || "").toLowerCase();
    const k = String(key || "").toUpperCase();
    const cacheKey = m + ":" + k;
    const hit = _MODE_KEY_CACHE[cacheKey];
    if (hit) return hit;
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      if (String(t.key || "").toUpperCase() === k &&
          Array.isArray(t.appearsIn) &&
          t.appearsIn.some(s => String(s).toLowerCase() === m)) {
        _MODE_KEY_CACHE[cacheKey] = t;
        return t;
      }
    }
  } catch (_) {}
  return null;
}

// Back-compat: attach to window for classic scripts
import { attachGlobal } from "../utils/global.js";
attachGlobal("TileLookup", { getTileDef, getTileDefByKey });