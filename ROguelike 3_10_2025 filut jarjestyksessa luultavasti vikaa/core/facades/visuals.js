/**
 * Game visuals: tiles and palette-driven colors.
 */
export const TILES = {
  WALL: 0,
  FLOOR: 1,
  DOOR: 2,
  STAIRS: 3,
  WINDOW: 4, // town-only: blocks movement, lets light through
  ROAD: 5,   // town-only: outdoor road; walkable; always brown
  // Harbor/town extensions: ids must match data/world/world_assets.json
  HARBOR_WATER: 18,
  SHIP_DECK: 19,
  PIER: 20,
};

function getPalette() {
  try {
    if (typeof window !== "undefined" && window.GameData && window.GameData.palette && typeof window.GameData.palette === "object") {
      return window.GameData.palette;
    }
  } catch (_) {}
  return null;
}

export function getColors() {
  const PAL = getPalette();
  return {
    wall: (PAL && PAL.tiles && PAL.tiles.wall) || "#1b1f2a",
    wallDark: (PAL && PAL.tiles && PAL.tiles.wallDark) || "#131722",
    floor: (PAL && PAL.tiles && PAL.tiles.floor) || "#0f1320",
    floorLit: (PAL && PAL.tiles && PAL.tiles.floorLit) || "#0f1628",
    player: (PAL && PAL.entities && PAL.entities.player) || "#9ece6a",
    enemy: (PAL && PAL.entities && PAL.entities.enemyDefault) || "#f7768e",
    enemyGoblin: (PAL && PAL.entities && PAL.entities.goblin) || "#8bd5a0",
    enemyTroll: (PAL && PAL.entities && PAL.entities.troll) || "#e0af68",
    enemyOgre: (PAL && PAL.entities && PAL.entities.ogre) || "#f7768e",
    item: (PAL && PAL.entities && PAL.entities.item) || "#7aa2f7",
    corpse: (PAL && PAL.entities && PAL.entities.corpse) || "#c3cad9",
    corpseEmpty: (PAL && PAL.entities && PAL.entities.corpseEmpty) || "#6b7280",
    dim: (PAL && PAL.overlays && PAL.overlays.dim) || "rgba(13, 16, 24, 0.75)"
  };
}

// Optional back-compat
if (typeof window !== "undefined") {
  window.GameVisuals = { TILES, getColors };
}