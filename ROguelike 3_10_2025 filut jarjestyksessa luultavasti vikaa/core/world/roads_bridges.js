/**
 * World roads and bridges helpers (Phase 3 extraction).
 * Extracted from core/world_runtime.js without behavior changes.
 */



// Add extra bridges so players can always find at least one crossing point over rivers in the current window.
// Strategy: scan vertical and horizontal spans of RIVER/WATER and place a BEACH + bridge overlay on
// relatively narrow crossings ("rivers") while avoiding very wide spans ("oceans"/large lakes).
export function ensureExtraBridges(ctx) {
  const WT = (ctx.World && ctx.World.TILES) || { WATER: 0, RIVER: 7, BEACH: 8, GRASS: 1, FOREST: 2, DESERT: 9, SNOW: 10, SWAMP: 6, SHALLOW: 22 };
  const world = ctx.world;
  const ox = world.originX | 0, oy = world.originY | 0;
  const cols = ctx.map[0] ? ctx.map[0].length : 0;
  const rows = ctx.map.length;
  world.bridges = Array.isArray(world.bridges) ? world.bridges : [];
  const bridgeSet = world._bridgeSet || (world._bridgeSet = new Set());

  const MAX_BRIDGE_SPAN = 10; // maximum water width/height we consider a "river" crossing

  function markBridgeLocal(lx, ly) {
    if (lx < 0 || ly < 0 || lx >= cols || ly >= rows) return;
    const ax = ox + lx, ay = oy + ly;
    const key = `${ax},${ay}`;
    if (bridgeSet.has(key)) return;
    const tile = ctx.map[ly][lx];
    const shallowId = WT.SHALLOW != null ? WT.SHALLOW : WT.BEACH;
    // Convert water/river under the bridge to SHALLOW (or BEACH as fallback) so crossings are ford-like.
    if (tile === WT.WATER || tile === WT.RIVER) {
      ctx.map[ly][lx] = shallowId;
    }
    // Always record a bridge overlay so the renderer can draw wooden planks, regardless of underlying tile.
    world.bridges.push({ x: ax, y: ay });
    bridgeSet.add(key);
  }

  // Helper: local walkable check for land (not water/river)
  function isLandLocal(lx, ly) {
    if (lx < 0 || ly < 0 || lx >= cols || ly >= rows) return false;
    const t = ctx.map[ly][lx];
    return !(t === WT.WATER || t === WT.RIVER);
  }

  // Measure contiguous WATER/RIVER span horizontally through (lx, ly) without mutating
  function measureHorizontalSpan(lx, ly) {
    if (lx < 0 || ly < 0 || lx >= cols || ly >= rows) return null;
    if (!(ctx.map[ly][lx] === WT.WATER || ctx.map[ly][lx] === WT.RIVER)) return null;
    let left = lx;
    while (left - 1 >= 0 && (ctx.map[ly][left - 1] === WT.WATER || ctx.map[ly][left - 1] === WT.RIVER)) left--;
    let right = lx;
    while (right + 1 < cols && (ctx.map[ly][right + 1] === WT.WATER || ctx.map[ly][right + 1] === WT.RIVER)) right++;
    const width = right - left + 1;
    return { left, right, width };
  }

  // Measure contiguous WATER/RIVER span vertically through (lx, ly) without mutating
  function measureVerticalSpan(lx, ly) {
    if (lx < 0 || ly < 0 || lx >= cols || ly >= rows) return null;
    if (!(ctx.map[ly][lx] === WT.WATER || ctx.map[ly][lx] === WT.RIVER)) return null;
    let top = ly;
    while (top - 1 >= 0 && (ctx.map[top - 1][lx] === WT.WATER || ctx.map[top - 1][lx] === WT.RIVER)) top--;
    let bottom = ly;
    while (bottom + 1 < rows && (ctx.map[bottom + 1][lx] === WT.WATER || ctx.map[bottom + 1][lx] === WT.RIVER)) bottom++;
    const height = bottom - top + 1;
    return { top, bottom, height };
  }

  // Carve a horizontal bridge across a narrow water span; returns true if a bridge was placed.
  function carveAcrossRow(lx, ly) {
    const span = measureHorizontalSpan(lx, ly);
    if (!span) return false;
    if (span.width > MAX_BRIDGE_SPAN) return false; // skip very wide water bodies
    for (let x = span.left; x <= span.right; x++) {
      markBridgeLocal(x, ly);
    }
    return true;
  }

  // Carve a vertical bridge across a narrow water span; returns true if a bridge was placed.
  function carveAcrossCol(lx, ly) {
    const span = measureVerticalSpan(lx, ly);
    if (!span) return false;
    if (span.height > MAX_BRIDGE_SPAN) return false;
    for (let y = span.top; y <= span.bottom; y++) {
      markBridgeLocal(lx, y);
    }
    return true;
  }

  // Reduce frequency and cap per window
  const stride = 32; // place at most one bridge per ~32 tiles per span
  const maxBridges = Math.max(1, Math.floor((rows + cols) / 80)); // soft cap per window size
  let placed = 0;

  // Vertical scans (columns) — choose a row and carve horizontally across narrow river thickness
  for (let lx = 0; lx < cols; lx += 3) {
    if (placed >= maxBridges) break;
    let y = 0;
    while (y < rows && placed < maxBridges) {
      // find start of river span
      while (y < rows && !(ctx.map[y][lx] === WT.WATER || ctx.map[y][lx] === WT.RIVER)) y++;
      if (y >= rows) break;
      const y0 = y;
      while (y < rows && (ctx.map[y][lx] === WT.WATER || ctx.map[y][lx] === WT.RIVER)) y++;
      const y1 = y - 1;
      const spanLen = y1 - y0 + 1;
      if (spanLen >= 2) {
        for (let k = 0; k * stride < spanLen; k++) {
          if (placed >= maxBridges) break;
          const off = Math.floor(spanLen / 2) + k * stride;
          const lyBridge = y0 + Math.min(off, spanLen - 1);
          // ensure adjacent horizontal tiles lead to land within 1 step
          const hasLandSide = isLandLocal(Math.max(0, lx - 1), lyBridge) || isLandLocal(Math.min(cols - 1, lx + 1), lyBridge);
          if (hasLandSide) {
            if (carveAcrossRow(lx, lyBridge)) {
              placed++;
              break; // one per span in this pass
            }
          }
        }
      }
    }
  }

  // Horizontal scans (rows) — choose a column and carve vertically across narrow river thickness
  // Only proceed if we have not reached cap; this halves previous density
  if (placed < maxBridges) {
    for (let ly = 0; ly < rows; ly += 3) {
      if (placed >= maxBridges) break;
      let x = 0;
      while (x < cols && placed < maxBridges) {
        while (x < cols && !(ctx.map[ly][x] === WT.WATER || ctx.map[ly][x] === WT.RIVER)) x++;
        if (x >= cols) break;
        const x0 = x;
        while (x < cols && (ctx.map[ly][x] === WT.WATER || ctx.map[ly][x] === WT.RIVER)) x++;
        const x1 = x - 1;
        const spanLen = x1 - x0 + 1;
        if (spanLen >= 2) {
          for (let k = 0; k * stride < spanLen; k++) {
            if (placed >= maxBridges) break;
            const off = Math.floor(spanLen / 2) + k * stride;
            const lxBridge = x0 + Math.min(off, spanLen - 1);
            const hasLandSide = isLandLocal(lxBridge, Math.max(0, ly - 1)) || isLandLocal(lxBridge, Math.min(rows - 1, ly + 1));
            if (hasLandSide) {
              if (carveAcrossCol(lxBridge, ly)) {
                placed++;
                break;
              }
            }
          }
        }
      }
    }
  }
}