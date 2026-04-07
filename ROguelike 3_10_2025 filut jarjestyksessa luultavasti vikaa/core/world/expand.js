/**
 * World expansion helpers (Phase 3 extraction): expandMap and ensureInBounds.
 */
import { allocFog } from "../engine/fog.js";
import { scanPOIs as scanPOIsExt } from "./scan_pois.js";

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

function shouldLogExpandPerf(dtMs) {
  if (dtMs >= 8) return true;
  try {
    if (typeof window !== "undefined" && window.DEV) return true;
    if (typeof localStorage !== "undefined" && localStorage.getItem("DEV") === "1") return true;
  } catch (_) {
    return false;
  }
  return false;
}

function logExpandPerf(ctx, details) {
  try {
    if (!shouldLogExpandPerf(details.dtMs)) return;
    const LG = (typeof window !== "undefined") ? window.Logger : null;
    const message = `[WorldGen] expandMap side=${details.side} size=${details.cols}x${details.rows} dt=${details.dtMs.toFixed(1)}ms`;
    if (LG && typeof LG.log === "function") {
      LG.log(message, "notice", Object.assign({ category: "WorldGen", perf: "expandMap" }, details));
    } else if (typeof console !== "undefined" && typeof console.debug === "function") {
      console.debug(message, details);
    }
  } catch (_) {
    return;
  }
}

function reshapeVisibleGrid(ctx, rows, cols) {
  ctx.visible = allocFog(rows, cols, false, true);
  if (ctx.world) ctx.world.visibleRef = ctx.visible;
}

/**
 * Expand the visible world window on one side without copying tile/fog payloads.
 * Tiles and persistent seen-memory live in sparse world-coordinate stores.
 * Only the current visible grid is reshaped because it is frame-local state.
 */
export function expandMap(ctx, side, K) {
  const t0 = nowMs();
  const world = ctx.world;
  const gen = world && world.gen;
  if (!gen || typeof gen.tileAt !== "function") return false;

  const rows = ctx.map.length;
  const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
  const growX = (side === "left" || side === "right") ? (K | 0) : 0;
  const growY = (side === "top" || side === "bottom") ? (K | 0) : 0;
  const nextCols = cols + growX;
  const nextRows = rows + growY;
  let scanX = 0;
  let scanY = 0;
  let scanW = 0;
  let scanH = 0;

  if (side === "left") {
    const _prevOX = world.originX | 0;
    const _prevOY = world.originY | 0;
    world.originX -= K;
    world.width = nextCols;
    world.height = nextRows;
    scanX = 0;
    scanY = 0;
    scanW = K;
    scanH = rows;
    try {
      if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") {
        window.Logger.log(`[WorldGen] Expanded ${String(side)}`, "notice", {
          category: "WorldGen",
          side: String(side),
          tilesAdded: K | 0,
          originXFrom: _prevOX,
          originXTo: world.originX,
          originYFrom: _prevOY,
          originYTo: _prevOY,
          playerShifted: !ctx._suspendExpandShift
        });
      }
    } catch (_) {
      void 0;
    }
    if (!ctx._suspendExpandShift) {
      try { ctx.player.x += K; } catch (_) { void 0; }
      try {
        if (Array.isArray(ctx.enemies)) for (const e of ctx.enemies) if (e) e.x += K;
        if (Array.isArray(ctx.corpses)) for (const c of ctx.corpses) if (c) c.x += K;
        if (Array.isArray(ctx.decals)) for (const d of ctx.decals) if (d) d.x += K;
      } catch (_) {
        void 0;
      }
      try {
        const cam = (typeof ctx.getCamera === "function") ? ctx.getCamera() : (ctx.camera || null);
        const TILE = (typeof ctx.TILE === "number") ? ctx.TILE : 32;
        if (cam) cam.x += K * TILE;
      } catch (_) {
        void 0;
      }
    }
  } else if (side === "right") {
    world.width = nextCols;
    world.height = nextRows;
    scanX = cols;
    scanY = 0;
    scanW = K;
    scanH = rows;
    try {
      if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") {
        window.Logger.log(`[WorldGen] Expanded ${String(side)}`, "notice", {
          category: "WorldGen",
          side: String(side),
          tilesAdded: K | 0,
          originXFrom: world.originX | 0,
          originXTo: world.originX | 0,
          originYFrom: world.originY | 0,
          originYTo: world.originY | 0,
          playerShifted: false
        });
      }
    } catch (_) {
      void 0;
    }
  } else if (side === "top") {
    const _prevOX = world.originX | 0;
    const _prevOY = world.originY | 0;
    world.originY -= K;
    world.width = nextCols;
    world.height = nextRows;
    scanX = 0;
    scanY = 0;
    scanW = cols;
    scanH = K;
    try {
      if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") {
        window.Logger.log(`[WorldGen] Expanded ${String(side)}`, "notice", {
          category: "WorldGen",
          side: String(side),
          tilesAdded: K | 0,
          originXFrom: _prevOX,
          originXTo: _prevOX,
          originYFrom: _prevOY,
          originYTo: world.originY,
          playerShifted: !ctx._suspendExpandShift
        });
      }
    } catch (_) {
      void 0;
    }
    if (!ctx._suspendExpandShift) {
      try { ctx.player.y += K; } catch (_) { void 0; }
      try {
        if (Array.isArray(ctx.enemies)) for (const e of ctx.enemies) if (e) e.y += K;
        if (Array.isArray(ctx.corpses)) for (const c of ctx.corpses) if (c) c.y += K;
        if (Array.isArray(ctx.decals)) for (const d of ctx.decals) if (d) d.y += K;
      } catch (_) {
        void 0;
      }
    }
  } else if (side === "bottom") {
    world.width = nextCols;
    world.height = nextRows;
    scanX = 0;
    scanY = rows;
    scanW = cols;
    scanH = K;
    try {
      if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") {
        window.Logger.log(`[WorldGen] Expanded ${String(side)}`, "notice", {
          category: "WorldGen",
          side: String(side),
          tilesAdded: K | 0,
          originXFrom: world.originX | 0,
          originXTo: world.originX | 0,
          originYFrom: world.originY | 0,
          originYTo: world.originY | 0,
          playerShifted: false
        });
      }
    } catch (_) {
      void 0;
    }
  }

  reshapeVisibleGrid(ctx, world.height | 0, world.width | 0);
  world.map = ctx.map;
  world.seenRef = ctx.seen;
  if (scanW > 0 && scanH > 0) {
    scanPOIsExt(ctx, scanX, scanY, scanW, scanH);
  }
  logExpandPerf(ctx, {
    side: String(side),
    added: K | 0,
    rows: world.height | 0,
    cols: world.width | 0,
    dtMs: nowMs() - t0
  });
  return true;
}

/**
 * Ensure (nx,ny) is inside map bounds; expand outward by chunk size if needed.
 */
export function ensureInBounds(ctx, nx, ny, CHUNK = 32) {
  let expanded = false;

  if (nx < 0) { expandMap(ctx, "left", Math.max(CHUNK, -nx + 4)); expanded = true; }
  if (ny < 0) { expandMap(ctx, "top", Math.max(CHUNK, -ny + 4)); expanded = true; }
  // Recompute after potential prepends
  const rows2 = ctx.map.length;
  const cols2 = rows2 ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
  if (nx >= cols2) { expandMap(ctx, "right", Math.max(CHUNK, nx - cols2 + 5)); expanded = true; }
  if (ny >= rows2) { expandMap(ctx, "bottom", Math.max(CHUNK, ny - rows2 + 5)); expanded = true; }

  return expanded;
}
