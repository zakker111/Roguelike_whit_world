/**
 * Fog helpers: allocation for seen/visible grids.
 *
 * Step 0: these return plain Array<Array<boolean>> so behavior is unchanged.
 * Later steps can swap the internals (typed arrays, bitsets) without touching callers.
 */

/**
 * Allocate a 2D visibility/fog grid.
 *
 * @param {number} rows
 * @param {number} cols
 * @param {boolean} [fill=false]
 * @returns {boolean[][]}
 */
export function allocFog(rows, cols, fill = false) {
  const r = (rows | 0) || 0;
  const c = (cols | 0) || 0;
  const v = !!fill;
  if (r <= 0 || c <= 0) {
    return Array.from({ length: Math.max(0, r) }, () => Array(Math.max(0, c)).fill(v));
  }
  return Array.from({ length: r }, () => Array(c).fill(v));
}
