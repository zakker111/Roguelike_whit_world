/**
 * Central constants used by core and UI modules.
 */
export const TILE = 32;
export const COLS = 30;
export const ROWS = 20;

export const MAP_COLS = 120;
export const MAP_ROWS = 80;

export const FOV_DEFAULT = 8;

export const TILES = {
  WALL: 0,
  FLOOR: 1,
  DOOR: 2,
  STAIRS: 3,
  WINDOW: 4, // town-only: blocks movement, lets light through
};

export const COLORS = {
  wall: "#1b1f2a",
  wallDark: "#131722",
  floor: "#0f1320",
  floorLit: "#0f1628",
  player: "#9ece6a",
  enemy: "#f7768e",
  enemyGoblin: "#8bd5a0",
  enemyTroll: "#e0af68",
  enemyOgre: "#f7768e",
  item: "#7aa2f7",
  corpse: "#c3cad9",
  corpseEmpty: "#6b7280",
  dim: "rgba(13, 16, 24, 0.75)",
};