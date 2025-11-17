// Centralized tile lookup helper sourced from GameData.tiles
// Returns a tile definition object for a given mode ("overworld","town","dungeon",...) and numeric id,
// or null if not found. Safe against missing GameData/tiles.
// Examples:
//   const td = getTileDef("region", World.TILES.MOUNTAIN);
//   const door = getTileDefByKey("town", "DOOR");
// Notes:
// - Mode should match appearsIn in world_assets.json tiles (e.g., "overworld", "town", "dungeon", "region").
// - Properties may include walkable, blocksFOV, emitsLight, etc., used by renderers/FOV.
import { getGameData } from "../utils/access.js";

export function getTileDef(mode, id) {
  try {
    const GD = getGameData();
    const arr = GD && GD.tiles && Array.isArray(GD.tiles.tiles) ? GD.tiles.tiles : null;
    if (!arr) return null;
    const m = String(mode || "").toLowerCase();
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      if ((t.id | 0) === (id | 0) &&
          Array.isArray(t.appearsIn) &&
          t.appearsIn.some(s => String(s).toLowerCase() === m)) {
        return t;
      }
    }
  } catch (_) {}
  return null;
}

// Lookup by symbolic key for a given mode, e.g., getTileDefByKey("town", "DOOR")
export function getTileDefByKey(mode, key) {
  try {
    const GD = getGameData();
    const arr = GD && GD.tiles && Array.isArray(GD.tiles.tiles) ? GD.tiles.tiles : null;
    if (!arr) return null;
    const m = String(mode || "").toLowerCase();
    const k = String(key || "").toUpperCase();
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      if (String(t.key || "").toUpperCase() === k &&
          Array.isArray(t.appearsIn) &&
          t.appearsIn.some(s => String(s).toLowerCase() === m)) {
        return t;
      }
    }
  } catch (_) {}
  return null;
}

// Back-compat: attach to window for classic scripts
import { attachGlobal } from "../utils/global.js";
attachGlobal("TileLookup", { getTileDef, getTileDefByKey });