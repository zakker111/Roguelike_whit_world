// Grid helpers and common direction sets

export const DIRS_4 = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

export const DIRS_8 = [
  ...DIRS_4,
  { dx: 1, dy: 1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: -1 },
];

// Safe bounds check for a 2D map array
export function inBounds(map, x, y) {
  const rows = map.length;
  const cols = map[0] ? map[0].length : 0;
  return x >= 0 && y >= 0 && x < cols && y < rows;
}

// Back-compat
import { attachGlobal } from "./global.js";
attachGlobal("GridUtils", { DIRS_4, DIRS_8, inBounds });