import { getTileDef } from "../data/tile_lookup.js";

export const TILES = {
  WATER: 0,
  GRASS: 1,
  FOREST: 2,
  MOUNTAIN: 3,
  TOWN: 4,
  DUNGEON: 5,
  SWAMP: 6,
  RIVER: 7,
  BEACH: 8,
  DESERT: 9,
  SNOW: 10,
  TREE: 11, // region-only decorative tree tile; walkable but blocks FOV in region
  RUINS: 12, // overworld ruins POI; opens a themed Region Map
  BERRY_BUSH: 14, // region-only forage bush; walkable, does not block FOV
  CASTLE: 15, // overworld castle POI; uses town-mode layout but marked as castle
  SNOW_FOREST: 16, // snowy forest biome (snow with dense trees)
};

export function isWalkable(tile) {
  // Prefer tiles.json property when available for overworld mode, then fallback.
  try {
    const td = getTileDef("overworld", tile);
    if (td && td.properties && typeof td.properties.walkable === "boolean") {
      return !!td.properties.walkable;
    }
  } catch (_) {}
  // Fallback: non-walkable water, river, mountains
  return tile !== TILES.WATER && tile !== TILES.RIVER && tile !== TILES.MOUNTAIN;
}

export function biomeName(tile) {
  switch (tile) {
    case TILES.WATER: return "Ocean/Lake";
    case TILES.RIVER: return "River";
    case TILES.BEACH: return "Beach";
    case TILES.SWAMP: return "Swamp";
    case TILES.FOREST: return "Forest";
    case TILES.MOUNTAIN: return "Mountain";
    case TILES.DESERT: return "Desert";
    case TILES.SNOW: return "Snow";
    // Forested snow uses its own tile id but is treated as "Snow" for biome logic.
    case TILES.SNOW_FOREST: return "Snow";
    case TILES.GRASS: return "Plains";
    case TILES.TOWN: return "Town";
    case TILES.CASTLE: return "Castle";
    case TILES.DUNGEON: return "Dungeon";
    case TILES.RUINS: return "Ruins";
    default: return "Unknown";
  }
}