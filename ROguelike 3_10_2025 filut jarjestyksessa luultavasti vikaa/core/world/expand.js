/**
 * World expansion helpers (Phase 3 extraction): expandMap and ensureInBounds.
 */
import { scanPOIs as scanPOIsExt } from "./scan_pois.js";

/**
 * Expand map arrays on any side by K tiles, generating via world.gen.tileAt against world origin offsets.
 * Preserves fog arrays and shifts entities/camera when prepending (left/top) unless ctx._suspendExpandShift is true.
 */
export function expandMap(ctx, side, K) {
  const world = ctx.world;
  const gen = world && world.gen;
  if (!gen || typeof gen.tileAt !== "function") return false;

  const rows = ctx.map.length;
  const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;

  // Helper: normalize a visibility/seen row to a plain Array for safe concat operations.
  const toRowArray = (row, lenHint) => {
    if (!row) return new Array(lenHint | 0).fill(false);
    // Typed arrays (e.g., Uint8Array) need conversion to plain array when concatenating.
    if (ArrayBuffer.isView(row)) return Array.from(row);
    // Already a plain array
    return row;
  };

  if (side === "left") {
    // prepend K columns; shift origin and player by +K to keep world coords aligned, and offset camera to avoid visual snap
    for (let y = 0; y < rows; y++) {
      const row = ctx.map[y];
      const seenRow = toRowArray(ctx.seen[y], cols);
      const visRow = toRowArray(ctx.visible[y], cols);
      const prepend = new Array(K);
      const seenPre = new Array(K).fill(false);
      const visPre = new Array(K).fill(false);
      for (let i = 0; i < K; i++) {
        const wx = world.originX - (K - i); // new world x
        const wy = world.originY + y;
        prepend[i] = gen.tileAt(wx, wy);
      }
      ctx.map[y] = prepend.concat(row);
      ctx.seen[y] = seenPre.concat(seenRow);
      ctx.visible[y] = visPre.concat(visRow);
    }
    const _prevOX = world.originX | 0, _prevOY = world.originY | 0;
    world.originX -= K;
    // Newly added strip is columns [0..K-1]
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
    } catch (_) {}
    scanPOIsExt(ctx, 0, 0, K, rows);
    // Shift player and entities right by K to preserve world position mapping, unless ctx._suspendExpandShift is true.
    if (!ctx._suspendExpandShift) {
      try { ctx.player.x += K; } catch (_) {}
      try {
        if (Array.isArray(ctx.enemies)) for (const e of ctx.enemies) if (e) e.x += K;
        if (Array.isArray(ctx.corpses)) for (const c of ctx.corpses) if (c) c.x += K;
        if (Array.isArray(ctx.decals)) for (const d of ctx.decals) if (d) d.x += K;
      } catch (_) {}
      // Offset camera so the screen doesn't jump this frame
      try {
        const cam = (typeof ctx.getCamera === "function") ? ctx.getCamera() : (ctx.camera || null);
        const TILE = (typeof ctx.TILE === "number") ? ctx.TILE : 32;
        if (cam) cam.x += K * TILE;
      } catch (_) {}
    }
  } else if (side === "right") {
    // append K columns
    for (let y = 0; y < rows; y++) {
      const row = ctx.map[y];
      const seenRow = toRowArray(ctx.seen[y], cols);
      const visRow = toRowArray(ctx.visible[y], cols);
      const append = new Array(K);
      const seenApp = new Array(K).fill(false);
      const visApp = new Array(K).fill(false);
      for (let i = 0; i < K; i++) {
        const wx = world.originX + cols + i;
        const wy = world.originY + y;
        append[i] = gen.tileAt(wx, wy);
      }
      ctx.map[y] = row.concat(append);
      ctx.seen[y] = seenRow.concat(seenApp);
      ctx.visible[y] = visRow.concat(visApp);
    }
    // Newly added strip starts at previous width (cols)
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
    } catch (_) {}
    scanPOIsExt(ctx, cols, 0, K, rows);
  } else if (side === "top") {
    // prepend K rows; shift origin and player by +K to keep world coords aligned, and offset camera to avoid visual snap
    const newRows = [];
    const newSeen = [];
    const newVis = [];
    for (let i = 0; i < K; i++) {
      const arr = new Array(cols);
      for (let x = 0; x < cols; x++) {
        const wx = world.originX + x;
        const wy = world.originY - (K - i);
        arr[x] = gen.tileAt(wx, wy);
      }
      newRows.push(arr);
      newSeen.push(new Array(cols).fill(false));
      newVis.push(new Array(cols).fill(false));
    }
    ctx.map = newRows.concat(ctx.map);
    ctx.seen = newSeen.concat(ctx.seen.map(r => toRowArray(r, cols)));
    ctx.visible = newVis.concat(ctx.visible.map(r => toRowArray(r, cols)));
    const _prevOX2 = world.originX | 0, _prevOY2 = world.originY | 0;
    world.originY -= K;
    try {
      if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") {
        window.Logger.log(`[WorldGen] Expanded ${String(side)}`, "notice", {
          category: "WorldGen",
          side: String(side),
          tilesAdded: K | 0,
          originXFrom: _prevOX2,
          originXTo: _prevOX2,
          originYFrom: _prevOY2,
          originYTo: world.originY,
          playerShifted: !ctx._suspendExpandShift
        });
      }
    } catch (_) {}
    // Newly added strip is rows [0..K-1]
    scanPOIsExt(ctx, 0, 0, cols, K);
    // Shift player and entities down by K to preserve world position mapping, unless ctx._suspendExpandShift is true.
    if (!ctx._suspendExpandShift) {
      try { ctx.player.y += K; } catch (_) {}
      try {
        if (Array.isArray(ctx.enemies)) for (const e of ctx.enemies) if (e) e.y += K;
        if (Array.isArray(ctx.corpses)) for (const c of ctx.corpses) if (c) c.y += K;
        if (Array.isArray(ctx.decals)) for (const d of ctx.decals) if (d) d.y += K;
      } catch (_) {}
      // Let updateCamera after movement handle centering to keep perceived 1-tile movement consistent
    }
  } else if (side === "bottom") {
    // append K rows
    for (let i = 0; i < K; i++) {
      const arr = new Array(cols);
      const seenArr = new Array(cols).fill(false);
      const visArr = new Array(cols).fill(false);
      for (let x = 0; x < cols; x++) {
        const wx = world.originX + x;
        const wy = world.originY + rows + i;
        arr[x] = gen.tileAt(wx, wy);
      }
      ctx.map.push(arr);
      ctx.seen.push(seenArr);
      ctx.visible.push(visArr);
    }
    // Newly added strip starts at previous height (rows)
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
    } catch (_) {}
    scanPOIsExt(ctx, 0, rows, cols, K);
  }

  world.width = ctx.map[0] ? ctx.map[0].length : 0;
  world.height = ctx.map.length;
  // Keep world.map and fog refs in sync
  world.map = ctx.map;
  world.seenRef = ctx.seen;
  world.visibleRef = ctx.visible;
  return true;
}

/**
 * Ensure (nx,ny) is inside map bounds; expand outward by chunk size if needed.
 */
export function ensureInBounds(ctx, nx, ny, CHUNK = 32) {
  let expanded = false;
  const rows = ctx.map.length;
  const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;

  if (nx < 0) { expandMap(ctx, "left", Math.max(CHUNK, -nx + 4)); expanded = true; }
  if (ny < 0) { expandMap(ctx, "top", Math.max(CHUNK, -ny + 4)); expanded = true; }
  // Recompute after potential prepends
  const rows2 = ctx.map.length;
  const cols2 = rows2 ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
  if (nx >= cols2) { expandMap(ctx, "right", Math.max(CHUNK, nx - cols2 + 5)); expanded = true; }
  if (ny >= rows2) { expandMap(ctx, "bottom", Math.max(CHUNK, ny - rows2 + 5)); expanded = true; }

  return expanded;
}