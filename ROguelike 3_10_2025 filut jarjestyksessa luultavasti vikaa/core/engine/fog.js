/**
 * Fog helpers: allocation and access for seen/visible grids.
 *
 * Default allocFog mode returns plain Array<Array<boolean>> so behavior is unchanged.
 * Callers can opt into typed rows (Uint8Array) via the useTyped flag.
 */

/**
 * Allocate a 2D visibility/fog grid.
 *
 * @param {number} rows
 * @param {number} cols
 * @param {boolean} [fill=false]
 * @param {boolean} [useTyped=false] when true, rows are Uint8Array instead of plain arrays.
 * @returns {Array<boolean[]|Uint8Array>}
 */
export function allocFog(rows, cols, fill = false, useTyped = false) {
  const r = (rows | 0) || 0;
  const c = (cols | 0) || 0;
  const v = !!fill;

  if (r <= 0 || c <= 0) {
    return Array.from({ length: Math.max(0, r) }, () => Array(Math.max(0, c)).fill(v));
  }

  // Typed rows mode: use Uint8Array for each row. Values are 0/1; callers should treat them as truthy flags.
  if (useTyped && typeof Uint8Array !== "undefined") {
    const out = new Array(r);
    const init = v ? 1 : 0;
    for (let y = 0; y < r; y++) {
      const row = new Uint8Array(c);
      if (init) row.fill(init);
      out[y] = row;
    }
    return out;
  }

  // Fallback/default: plain boolean arrays
  return Array.from({ length: r }, () => Array(c).fill(v));
}

/**
 * Set a fog cell, handling both plain arrays and typed-array rows.
 * Values are stored as true/false for arrays and 1/0 for typed rows.
 */
export function fogSet(grid, x, y, val) {
  if (!grid || y < 0 || y >= grid.length) return;
  const row = grid[y];
  if (!row || typeof row.length !== "number" || x < 0 || x >= row.length) return;
  const on = !!val;
  if (ArrayBuffer.isView(row)) {
    row[x] = on ? 1 : 0;
  } else if (Array.isArray(row)) {
    row[x] = on;
  }
}

/**
 * Read a fog cell as a boolean, regardless of underlying row representation.
 */
export function fogGet(grid, x, y) {
  if (!grid || y < 0 || y >= grid.length) return false;
  const row = grid[y];
  if (!row || typeof row.length !== "number" || x < 0 || x >= row.length) return false;
  return !!row[x];
}
