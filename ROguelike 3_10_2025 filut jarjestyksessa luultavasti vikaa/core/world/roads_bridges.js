/**
 * World roads and bridges helpers (Phase 3 extraction).
 * Extracted from core/world_runtime.js without behavior changes.
 */

// Build roads between nearby towns in current window and mark bridge points where crossing water/river
export function ensureRoads(ctx) {
  const WT = (ctx.World && ctx.World.TILES) || { WATER: 0, RIVER: 7, BEACH: 8, MOUNTAIN: 3 };
  const world = ctx.world;
  if (!world) return;
  world.roads = Array.isArray(world.roads) ? world.roads : [];
  world.bridges = Array.isArray(world.bridges) ? world.bridges : [];
  const roadSet = world._roadSet || (world._roadSet = new Set());
  const bridgeSet = world._bridgeSet || (world._bridgeSet = new Set());

  const ox = world.originX | 0, oy = world.originY | 0;
  const cols = ctx.map[0] ? ctx.map[0].length : 0;
  const rows = ctx.map.length;

  function inWin(x, y) {
    const lx = x - ox, ly = y - oy;
    return lx >= 0 && ly >= 0 && lx < cols && ly < rows;
  }

  function addRoadPoint(x, y) {
    const key = `${x},${y}`;
    if (!roadSet.has(key)) {
      roadSet.add(key);
      world.roads.push({ x, y });
    }
  }
  function addBridgePoint(x, y) {
    const key = `${x},${y}`;
    if (!bridgeSet.has(key)) {
      bridgeSet.add(key);
      world.bridges.push({ x, y });
    }
  }

  function carveRoad(x0, y0, x1, y1) {
    let x = x0, y = y0;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      if (inWin(x, y)) {
        const lx = x - ox, ly = y - oy;
        const t = ctx.map[ly][lx];
        // Across water/river: carve to BEACH and mark bridge overlay
        if (t === WT.WATER || t === WT.RIVER) {
          ctx.map[ly][lx] = WT.BEACH;
          addBridgePoint(x, y);
        }
        addRoadPoint(x, y);
      }
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }

  const towns = Array.isArray(world.towns) ? world.towns.slice(0) : [];
  // Connect each town to its nearest neighbor within a reasonable distance, but only if BOTH endpoints are within the current window
  for (let i = 0; i < towns.length; i++) {
    const a = towns[i];
    if (!inWin(a.x, a.y)) continue;
    let best = null, bd = Infinity;
    for (let j = 0; j < towns.length; j++) {
      if (i === j) continue;
      const b = towns[j];
      if (!inWin(b.x, b.y)) continue; // avoid dangling roads that lead off-window
      const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (d < bd) { bd = d; best = b; }
    }
    if (best && bd <= 100) {
      carveRoad(a.x, a.y, best.x, best.y);
    }
  }
}

// Add extra bridges so players can always find at least one crossing point over rivers in the current window.
// Strategy: scan vertical and horizontal spans of RIVER/WATER and place a BEACH + bridge overlay every N tiles.
export function ensureExtraBridges(ctx) {
  const WT = (ctx.World && ctx.World.TILES) || { WATER: 0, RIVER: 7, BEACH: 8, GRASS: 1, FOREST: 2, DESERT: 9, SNOW: 10, SWAMP: 6 };
  const world = ctx.world;
  const ox = world.originX | 0, oy = world.originY | 0;
  const cols = ctx.map[0] ? ctx.map[0].length : 0;
  const rows = ctx.map.length;
  world.bridges = Array.isArray(world.bridges) ? world.bridges : [];
  const bridgeSet = world._bridgeSet || (world._bridgeSet = new Set());

  function markBridgeLocal(lx, ly) {
    if (lx < 0 || ly < 0 || lx >= cols || ly >= rows) return;
    const ax = ox + lx, ay = oy + ly;
    const key = `${ax},${ay}`;
    if (bridgeSet.has(key)) return;
    // Carve to BEACH to be walkable and record overlay
    ctx.map[ly][lx] = WT.BEACH;
    world.bridges.push({ x: ax, y: ay });
    bridgeSet.add(key);
  }

  // Helper: local walkable check for land (not water/river)
  function isLandLocal(lx, ly) {
    if (lx < 0 || ly < 0 || lx >= cols || ly >= rows) return false;
    const t = ctx.map[ly][lx];
    return !(t === WT.WATER || t === WT.RIVER);
  }

  // Carve a full horizontal bridge at (lx, ly) across all contiguous WATER/RIVER tiles, ensuring a continuous span from land to land.
  function carveAcrossRow(lx, ly) {
    // Extend left
    let x = lx;
    while (x >= 0 && (ctx.map[ly][x] === WT.WATER || ctx.map[ly][x] === WT.RIVER)) {
      markBridgeLocal(x, ly);
      x--;
    }
    // Also extend right
    x = lx + 1;
    while (x < cols && (ctx.map[ly][x] === WT.WATER || ctx.map[ly][x] === WT.RIVER)) {
      markBridgeLocal(x, ly);
      x++;
    }
  }

  // Carve a full vertical bridge at (lx, ly) across all contiguous WATER/RIVER tiles
  function carveAcrossCol(lx, ly) {
    // Up
    let y = ly;
    while (y >= 0 && (ctx.map[y][lx] === WT.WATER || ctx.map[y][lx] === WT.RIVER)) {
      markBridgeLocal(lx, y);
      y--;
    }
    // Down
    y = ly + 1;
    while (y < rows && (ctx.map[y][lx] === WT.WATER || ctx.map[y][lx] === WT.RIVER)) {
      markBridgeLocal(lx, y);
      y++;
    }
  }

  // Reduce frequency and cap per window
  const stride = 32; // place at most one bridge per ~32 tiles per span
  const maxBridges = Math.max(1, Math.floor((rows + cols) / 80)); // soft cap per window size
  let placed = 0;

  // Vertical scans (columns) — choose a row and carve horizontally across the whole river thickness
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
            carveAcrossRow(lx, lyBridge);
            placed++;
            break; // one per span in this pass
          }
        }
      }
    }
  }

  // Horizontal scans (rows) — choose a column and carve vertically across the whole river thickness
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
              carveAcrossCol(lxBridge, ly);
              placed++;
              break;
            }
          }
        }
      }
    }
  }
}