/**
 * Shared chunk-coordinate helpers for overworld systems.
 */

export const CHUNK_SIZE = 32;

export function chunkCoord(tile, size = CHUNK_SIZE) {
  return Math.floor((tile | 0) / (size | 0));
}

export function chunkKey(cx, cy) {
  return `${cx | 0},${cy | 0}`;
}

export function parseChunkKey(key) {
  const parts = String(key || "").split(",");
  return {
    cx: Number(parts[0] || 0) | 0,
    cy: Number(parts[1] || 0) | 0
  };
}

export function chunksForTileRect(x0, y0, w, h, size = CHUNK_SIZE) {
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(w) || !Number.isFinite(h)) return [];
  if (w <= 0 || h <= 0) return [];

  const startCx = chunkCoord(x0, size);
  const endCx = chunkCoord(x0 + w - 1, size);
  const startCy = chunkCoord(y0, size);
  const endCy = chunkCoord(y0 + h - 1, size);
  const out = [];

  for (let cy = startCy; cy <= endCy; cy++) {
    for (let cx = startCx; cx <= endCx; cx++) {
      out.push({ cx, cy, key: chunkKey(cx, cy) });
    }
  }
  return out;
}

export function chunkTileBounds(cx, cy, mapCols, mapRows, size = CHUNK_SIZE) {
  const x = (cx | 0) * (size | 0);
  const y = (cy | 0) * (size | 0);
  const w = Math.max(0, Math.min(size | 0, (mapCols | 0) - x));
  const h = Math.max(0, Math.min(size | 0, (mapRows | 0) - y));
  return { x, y, w, h };
}

export function isChunkWithinRadius(cx, cy, centerCx, centerCy, radius) {
  return Math.abs((cx | 0) - (centerCx | 0)) <= (radius | 0)
    && Math.abs((cy | 0) - (centerCy | 0)) <= (radius | 0);
}
