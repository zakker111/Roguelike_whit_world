/**
 * Overworld base layer: offscreen world cache and fallback viewport base draw.
 */
import * as RenderCore from "../render_core.js";
import { fillOverworldFor, tilesRef, fallbackFillOverworld } from "./overworld_tile_cache.js";
import { getTileDef } from "../../data/tile_lookup.js";
import { CHUNK_SIZE, chunkCoord, chunkTileBounds, chunksForTileRect, isChunkWithinRadius, parseChunkKey } from "../../core/world/chunk_cache.js";
import * as World from "../../world/world.js";

const KEEP_CHUNK_RADIUS = 4;
const WORLD = {
  mapRef: null,
  mapCols: 0,
  mapRows: 0,
  TILE: 0,
  _tilesRef: null,
  chunks: new Map()
};

function nowMs() {
  try {
    if (typeof performance !== "undefined" && performance && typeof performance.now === "function") {
      return performance.now();
    }
  } catch (_) {
    return Date.now();
  }
  return Date.now();
}

function isDevLoggingEnabled() {
  try {
    if (typeof window !== "undefined" && window.DEV) return true;
    if (typeof localStorage !== "undefined" && localStorage.getItem("DEV") === "1") return true;
  } catch (_) {
    return false;
  }
  return false;
}

function logChunkPerf(details) {
  try {
    const dtMs = Number(details && details.dtMs) || 0;
    if (dtMs < 6 && !isDevLoggingEnabled()) return;
    const LG = (typeof window !== "undefined") ? window.Logger : null;
    const message = `[RenderOverworld] base chunks built=${details.builtChunks} visible=${details.visibleChunks} evicted=${details.evictedChunks} dt=${dtMs.toFixed(1)}ms`;
    if (LG && typeof LG.log === "function") {
      LG.log(message, "notice", Object.assign({ category: "Render", perf: "overworldBaseChunks" }, details));
    } else if (typeof console !== "undefined" && typeof console.debug === "function") {
      console.debug(message, details);
    }
  } catch (_) {
    return;
  }
}

function resetChunkCache(map, mapCols, mapRows, TILE) {
  WORLD.mapRef = map;
  WORLD.mapCols = mapCols;
  WORLD.mapRows = mapRows;
  WORLD.TILE = TILE;
  WORLD._tilesRef = tilesRef();
  WORLD.chunks.clear();
}

function buildChunkCanvas(map, cx, cy, mapCols, mapRows, TILE, WT) {
  const bounds = chunkTileBounds(cx, cy, mapCols, mapRows, CHUNK_SIZE);
  if (!bounds.w || !bounds.h) return null;

  const off = RenderCore.createOffscreen(bounds.w * TILE, bounds.h * TILE);
  const oc = off.getContext("2d");
  const debugMissingDefs = !!tilesRef() && isDevLoggingEnabled();
  let missingDefsCount = 0;
  let missingSet = null;
  let lastFill = "";

  for (let yy = 0; yy < bounds.h; yy++) {
    const rowM = map[bounds.y + yy];
    for (let xx = 0; xx < bounds.w; xx++) {
      const t = rowM[bounds.x + xx];
      if (debugMissingDefs) {
        const td = getTileDef("overworld", t);
        if (!td) {
          missingDefsCount++;
          if (!missingSet) missingSet = new Set();
          missingSet.add(t);
        }
      }
      const fill = fillOverworldFor(WT, t);
      if (fill !== lastFill) {
        oc.fillStyle = fill;
        lastFill = fill;
      }
      oc.fillRect(xx * TILE, yy * TILE, TILE, TILE);
    }
  }

  if (missingDefsCount > 0 && missingSet && typeof window !== "undefined") {
    try {
      const LG = window.Logger;
      const msg = `[RenderOverworld] Missing ${missingDefsCount} tile def lookups; ids without defs: ${Array.from(missingSet).join(", ")}. Using fallback colors.`;
      if (LG && typeof LG.log === "function") LG.log(msg, "warn", { category: "Render" });
      else if (typeof console !== "undefined" && typeof console.warn === "function") console.warn(msg);
    } catch (_) {
      return null;
    }
  }

  return {
    canvas: off,
    x: bounds.x,
    y: bounds.y,
    w: bounds.w,
    h: bounds.h
  };
}

function drawVisibleChunks(ctx2d, cam, visibleChunks) {
  if (!visibleChunks.length) return false;
  for (const chunk of visibleChunks) {
    if (!chunk || !chunk.canvas) continue;
    const dx = chunk.x * WORLD.TILE - cam.x;
    const dy = chunk.y * WORLD.TILE - cam.y;
    ctx2d.drawImage(chunk.canvas, dx, dy);
  }
  return true;
}

function evictFarChunks(visibleChunkCoords) {
  if (!visibleChunkCoords.length) return 0;
  const centerIndex = (visibleChunkCoords.length / 2) | 0;
  const center = visibleChunkCoords[centerIndex];
  const centerCx = center ? center.cx : 0;
  const centerCy = center ? center.cy : 0;
  let evicted = 0;

  for (const key of Array.from(WORLD.chunks.keys())) {
    const parsed = parseChunkKey(key);
    if (!isChunkWithinRadius(parsed.cx, parsed.cy, centerCx, centerCy, KEEP_CHUNK_RADIUS)) {
      WORLD.chunks.delete(key);
      evicted++;
    }
  }

  return evicted;
}

export function drawWorldBase(ctx, view) {
  const {
    ctx2d, TILE, map,
    cam, tileOffsetX, tileOffsetY, startX, startY, endX, endY
  } = Object.assign({}, view, ctx);

  const WT = World.TILES;
  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;

  try {
    const mw = mapCols, mh = mapRows;
    if (mw && mh) {
      const needsReset = WORLD.mapRef !== map
        || WORLD.mapCols !== mw
        || WORLD.mapRows !== mh
        || WORLD.TILE !== TILE
        || WORLD._tilesRef !== tilesRef();
      const resetReason = needsReset ? {
        mapRefChanged: WORLD.mapRef !== map,
        mapSizeChanged: WORLD.mapCols !== mw || WORLD.mapRows !== mh,
        tileSizeChanged: WORLD.TILE !== TILE,
        tilesRefChanged: WORLD._tilesRef !== tilesRef()
      } : null;
      if (needsReset) resetChunkCache(map, mw, mh, TILE);

      const visibleX0 = Math.max(0, startX | 0);
      const visibleY0 = Math.max(0, startY | 0);
      const visibleX1 = Math.min(mw - 1, endX | 0);
      const visibleY1 = Math.min(mh - 1, endY | 0);

      if (visibleX0 <= visibleX1 && visibleY0 <= visibleY1) {
        const t0 = nowMs();
        const visibleChunkCoords = chunksForTileRect(
          visibleX0,
          visibleY0,
          visibleX1 - visibleX0 + 1,
          visibleY1 - visibleY0 + 1,
          CHUNK_SIZE
        );
        let builtChunks = 0;
        const visibleChunks = [];

        for (const entry of visibleChunkCoords) {
          let chunk = WORLD.chunks.get(entry.key);
          if (!chunk) {
            chunk = buildChunkCanvas(map, entry.cx, entry.cy, mw, mh, TILE, WT);
            if (chunk) {
              WORLD.chunks.set(entry.key, chunk);
              builtChunks++;
            }
          }
          if (chunk) visibleChunks.push(chunk);
        }

        const evictedChunks = evictFarChunks(visibleChunkCoords);
        ctx2d.fillStyle = "#0b0c10";
        ctx2d.fillRect(0, 0, cam.width, cam.height);
        if (drawVisibleChunks(ctx2d, cam, visibleChunks)) {
          logChunkPerf({
            dtMs: nowMs() - t0,
            builtChunks,
            visibleChunks: visibleChunks.length,
            evictedChunks,
            cacheSize: WORLD.chunks.size,
            mapCols: mw,
            mapRows: mh,
            chunkSize: CHUNK_SIZE,
            centerChunkX: chunkCoord((visibleX0 + visibleX1) / 2),
            centerChunkY: chunkCoord((visibleY0 + visibleY1) / 2),
            reset: resetReason
          });
          try {
            if (typeof window !== "undefined" && window.TilesValidation && typeof window.TilesValidation.recordMap === "function") {
              window.TilesValidation.recordMap({ mode: "overworld", map });
            }
          } catch (_) {
            return;
          }
          return;
        }
      }
    }
  } catch (_) {
    // Fall back to direct viewport fill below if chunk rendering fails.
  }

  for (let y = startY; y <= endY; y++) {
    const yIn = y >= 0 && y < mapRows;
    const row = yIn ? map[y] : null;
    for (let x = startX; x <= endX; x++) {
      const screenX = (x - startX) * TILE - tileOffsetX;
      const screenY = (y - startY) * TILE - tileOffsetY;
      if (!yIn || x < 0 || x >= mapCols) {
        ctx2d.fillStyle = "#0b0c10";
        ctx2d.fillRect(screenX, screenY, TILE, TILE);
        continue;
      }
      const t = row[x];
      const fill = fillOverworldFor(WT, t);
      ctx2d.fillStyle = fill;
      ctx2d.fillRect(screenX, screenY, TILE, TILE);
    }
  }

  try {
    if (typeof window !== "undefined" && window.TilesValidation && typeof window.TilesValidation.recordMap === "function") {
      window.TilesValidation.recordMap({ mode: "overworld", map });
    }
  } catch (_) {
    return;
  }
}
