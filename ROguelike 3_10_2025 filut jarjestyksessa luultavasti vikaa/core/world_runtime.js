/**
 * WorldRuntime: generation and helpers for overworld mode (now supports near-infinite expansion).
 *
 * Exports (ESM + window.WorldRuntime):
 * - generate(ctx, { width, height }?)
 * - tryMovePlayerWorld(ctx, dx, dy)
 * - tick(ctx)      // optional per-turn hook for world mode
 */

function currentSeed() {
  try {
    if (typeof window !== "undefined" && window.RNG && typeof window.RNG.getSeed === "function") {
      return window.RNG.getSeed();
    }
  } catch (_) {}
  return (Date.now() >>> 0);
}

// Config helpers (GameData.config overrides, with localStorage flags for quick toggles)
function _getConfig() {
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    if (GD && GD.config && GD.config.world) return GD.config.world;
  } catch (_) {}
  return {};
}
function _lsBool(key) {
  try {
    const v = localStorage.getItem(key);
    if (typeof v === "string") {
      const s = v.toLowerCase();
      return s === "1" || s === "true" || s === "yes" || s === "on";
    }
  } catch (_) {}
  return null;
}
function featureEnabled(name, defaultVal) {
  // LocalStorage override takes precedence, else config value, else default
  const ls = _lsBool(name);
  if (ls != null) return !!ls;
  const cfg = _getConfig();
  if (name === "WORLD_INFINITE") {
    // config.world.infinite boolean
    if (typeof cfg.infinite === "boolean") return !!cfg.infinite;
    return !!defaultVal;
  }
  if (name === "WORLD_ROADS") {
    if (typeof cfg.roadsEnabled === "boolean") return !!cfg.roadsEnabled;
    return !!defaultVal;
  }
  if (name === "WORLD_BRIDGES") {
    if (typeof cfg.bridgesEnabled === "boolean") return !!cfg.bridgesEnabled;
    return !!defaultVal;
  }
  return !!defaultVal;
}

// Stable coordinate hash → [0,1). Used to derive deterministic POI metadata.
function h2(x, y) {
  const n = (((x | 0) * 73856093) ^ ((y | 0) * 19349663)) >>> 0;
  return (n % 1000003) / 1000003;
}

// Ensure POI bookkeeping containers exist on world
function ensurePOIState(world) {
  if (!world.towns) world.towns = [];
  if (!world.dungeons) world.dungeons = [];
  if (!world.ruins) world.ruins = [];
  if (!world._poiSet) world._poiSet = new Set();
}

// Add a town at world coords if not present; derive size deterministically
function addTown(world, x, y) {
  ensurePOIState(world);
  const key = `${x},${y}`;
  if (world._poiSet.has(key)) return;
  // Size distribution: small/big/city via hash
  const r = h2(x + 11, y - 7);
  const size = (r < 0.60) ? "small" : (r < 0.90 ? "big" : "city");
  world.towns.push({ x, y, size });
  world._poiSet.add(key);
}

// Add a dungeon at world coords if not present; derive level/size deterministically
function addDungeon(world, x, y) {
  ensurePOIState(world);
  const key = `${x},${y}`;
  if (world._poiSet.has(key)) return;
  const r1 = h2(x - 5, y + 13);
  const level = 1 + Math.floor(r1 * 5); // 1..5
  const r2 = h2(x + 29, y + 3);
  const size = (r2 < 0.45) ? "small" : (r2 < 0.85 ? "medium" : "large");
  world.dungeons.push({ x, y, level, size });
  world._poiSet.add(key);
}

// Add a ruins POI at world coords if not present
function addRuins(world, x, y) {
  ensurePOIState(world);
  const key = `${x},${y}`;
  if (world._poiSet.has(key)) return;
  world.ruins.push({ x, y });
  world._poiSet.add(key);
}

// Scan a rectangle of the current window (map space) and register POIs sparsely
function scanPOIs(ctx, x0, y0, w, h) {
  const WT = (ctx.World && ctx.World.TILES) || { TOWN: 4, DUNGEON: 5, RUINS: 12, WATER: 0, RIVER: 7, BEACH: 8, MOUNTAIN: 3, GRASS: 1, FOREST: 2, DESERT: 9, SNOW: 10, SWAMP: 6, TOWNK: 4, DUNGEONK: 5 };
  const world = ctx.world;
  for (let yy = y0; yy < y0 + h; yy++) {
    if (yy < 0 || yy >= ctx.map.length) continue;
    const row = ctx.map[yy];
    for (let xx = x0; xx < x0 + w; xx++) {
      if (xx < 0 || xx >= row.length) continue;
      const t = row[xx];
      if (t === WT.TOWN) {
        const wx = world.originX + xx;
        const wy = world.originY + yy;
        addTown(world, wx, wy);
      } else if (t === WT.DUNGEON) {
        const wx = world.originX + xx;
        const wy = world.originY + yy;
        addDungeon(world, wx, wy);
      } else if (t === WT.RUINS) {
        const wx = world.originX + xx;
        const wy = world.originY + yy;
        addRuins(world, wx, wy);
      }
    }
  }
  // After registering POIs in this strip/window, connect nearby towns with roads and mark bridges (feature-gated).
  try {
    if (featureEnabled("WORLD_ROADS", false)) ensureRoads(ctx);
  } catch (_) {}
  // Ensure there are usable river crossings independent of roads (feature-gated).
  try {
    if (featureEnabled("WORLD_BRIDGES", false)) ensureExtraBridges(ctx);
  } catch (_) {}
}

// Build roads between nearby towns in current window and mark bridge points where crossing water/river
function ensureRoads(ctx) {
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
function ensureExtraBridges(ctx) {
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



// Expand map arrays on any side by K tiles, generating via world.gen.tileAt against world origin offsets.
function expandMap(ctx, side, K) {
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
    world.originX -= K;
    // Newly added strip is columns [0..K-1]
    scanPOIs(ctx, 0, 0, K, rows);
    // Shift player and entities right by K to preserve world position mapping (unless suspended)
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
    scanPOIs(ctx, cols, 0, K, rows);
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
    world.originY -= K;
    // Newly added strip is rows [0..K-1]
    scanPOIs(ctx, 0, 0, cols, K);
    // Shift player and entities down by K to preserve world position mapping (unless suspended)
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
    scanPOIs(ctx, 0, rows, cols, K);
  }

  world.width = ctx.map[0] ? ctx.map[0].length : 0;
  world.height = ctx.map.length;
  // Keep world.map and fog refs in sync
  world.map = ctx.map;
  world.seenRef = ctx.seen;
  world.visibleRef = ctx.visible;
  return true;
}

// Ensure (nx,ny) is inside map bounds; expand outward by chunk size if needed.
function ensureInBounds(ctx, nx, ny, CHUNK = 32) {
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

// Expose ensureInBounds for other runtimes (town/dungeon) to place the player at absolute world coords.
export function _ensureInBounds(ctx, nx, ny, CHUNK = 32) {
  return ensureInBounds(ctx, nx, ny, CHUNK);
}

export function generate(ctx, opts = {}) {
  // Prefer infinite generator; fall back to finite world if module missing or disabled
  const IG = (typeof window !== "undefined" ? window.InfiniteGen : null);
  const W = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);

  const width = (typeof opts.width === "number") ? opts.width : (ctx.MAP_COLS || 120);
  const height = (typeof opts.height === "number") ? opts.height : (ctx.MAP_ROWS || 80);

  // Clear non-world entities
  ctx.enemies = [];
  ctx.corpses = [];
  ctx.decals = [];
  ctx.npcs = [];
  ctx.shops = [];

  // Feature gate for infinite world
  const infiniteEnabled = featureEnabled("WORLD_INFINITE", true);

  // Create generator (infinite only)
  if (IG && typeof IG.create === "function") {
    const seed = currentSeed();
    const gen = IG.create(seed);

    // Choose a deterministic world start, then center the initial window on it so the player is on screen.
    const startWorld = gen.pickStart();
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const originX = (startWorld.x | 0) - centerX;
    const originY = (startWorld.y | 0) - centerY;

    const map = Array.from({ length: height }, (_, y) => {
      const wy = originY + y;
      const row = new Array(width);
      for (let x = 0; x < width; x++) {
        const wx = originX + x;
        row[x] = gen.tileAt(wx, wy);
      }
      return row;
    });

    ctx.world = {
      type: "infinite",
      gen,
      originX,
      originY,
      width,
      height,
      // Keep a live reference to the current windowed map for modules that read ctx.world.map
      map,            // note: will be kept in sync on expansion
      towns: [],       // optional: can be populated lazily if we scan tiles
      dungeons: [],
      roads: [],
      bridges: [],
    };

    // Place player at the center of the initial window
    ctx.map = map;
    ctx.world.width = map[0] ? map[0].length : 0;
    ctx.world.height = map.length;

    ctx.player.x = centerX;
    ctx.player.y = centerY;
    ctx.mode = "world";

    // Allocate fog-of-war arrays; FOV module will mark seen/visible around player
    ctx.seen = Array.from({ length: ctx.world.height }, () => Array(ctx.world.width).fill(false));
    ctx.visible = Array.from({ length: ctx.world.height }, () => Array(ctx.world.width).fill(false));
    // Keep references on world so we can restore them after visiting towns/dungeons
    ctx.world.seenRef = ctx.seen;
    ctx.world.visibleRef = ctx.visible;

    // Register POIs present in the initial window (sparse anchors only) and lay initial roads/bridges
    try { scanPOIs(ctx, 0, 0, ctx.world.width, ctx.world.height); } catch (_) {}

    // Camera/FOV/UI via StateSync
    try {
      const SS = ctx.StateSync || (typeof window !== "undefined" ? window.StateSync : null);
      if (SS && typeof SS.applyAndRefresh === "function") {
        SS.applyAndRefresh(ctx, {});
      }
    } catch (_) {}

    // Arrival log
    ctx.log && ctx.log("You arrive in the overworld. The world expands as you explore. Minimap shows discovered tiles.", "notice");

    // Hide town exit button via TownRuntime
    try {
      const TR = (ctx && ctx.TownRuntime) || (typeof window !== "undefined" ? window.TownRuntime : null);
      if (TR && typeof TR.hideExitButton === "function") TR.hideExitButton(ctx);
    } catch (_) {}

    return true;
  }

  // Infinite generator unavailable: throw a hard error (no finite fallback)
  try { ctx.log && ctx.log("Error: Infinite world generator unavailable or not initialized.", "bad"); } catch (_) {}
  throw new Error("Infinite world generator unavailable or not initialized");
}

export function tryMovePlayerWorld(ctx, dx, dy) {
  if (!ctx || ctx.mode !== "world" || !ctx.world || !ctx.map) return false;

  // Compute intended target
  let nx = ctx.player.x + (dx | 0);
  let ny = ctx.player.y + (dy | 0);

  // Ensure expand-shift is enabled during normal movement (may have been suspended during transitions)
  if (ctx._suspendExpandShift) ctx._suspendExpandShift = false;

  // Top-edge water band: treat any attempt to move above row 0 as blocked (like water), do not expand upward
  if (ny < 0) {
    return false;
  }

  // Expand if outside (only for infinite worlds)
  try {
    if (ctx.world && ctx.world.type === "infinite" && ctx.world.gen && typeof ctx.world.gen.tileAt === "function") {
      const expanded = ensureInBounds(ctx, nx, ny, 32);
      if (expanded) {
        // Player may have been shifted by left/top prepends; recompute target
        nx = ctx.player.x + (dx | 0);
        ny = ctx.player.y + (dy | 0);
      }
    }
  } catch (_) {}

  const rows = ctx.map.length, cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
  if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return false;

  let walkable = true;
  try {
    // Prefer World.isWalkable for compatibility with tiles.json overrides
    const W = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
    if (W && typeof W.isWalkable === "function") {
      walkable = !!W.isWalkable(ctx.map[ny][nx]);
    } else if (ctx.world && ctx.world.gen && typeof ctx.world.gen.isWalkable === "function") {
      walkable = !!ctx.world.gen.isWalkable(ctx.map[ny][nx]);
    }
  } catch (_) {}

  if (!walkable) return false;

  ctx.player.x = nx; ctx.player.y = ny;

  try {
    const SS = ctx.StateSync || (typeof window !== "undefined" ? window.StateSync : null);
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    }
  } catch (_) {}

  // Non-combat skill hooks on overworld step
  try {
    const W = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
    const WT = W ? W.TILES : null;
    const tileHere = ctx.world && ctx.world.map ? ctx.world.map[ny][nx] : null;
    const isWild = WT ? (tileHere === WT.FOREST || tileHere === WT.GRASS || tileHere === WT.BEACH || tileHere === WT.SWAMP) : true;

    // Survivalism: gradual progress when traversing wild tiles
    if (isWild) {
      try { ctx.player.skills = ctx.player.skills || {}; ctx.player.skills.survivalism = (ctx.player.skills.survivalism || 0) + 0.2; } catch (_) {}
    }

    // Foraging via region map berry bushes only (overworld walking no longer grants berries)
  } catch (_) {}

  // Quest markers: trigger quest encounter immediately if stepping onto an active marker
  try {
    const QS = ctx.QuestService || (typeof window !== "undefined" ? window.QuestService : null);
    if (QS && typeof QS.maybeTriggerOnWorldStep === "function") {
      QS.maybeTriggerOnWorldStep(ctx);
      // QS may have switched mode to 'encounter'; in that case, skip ambient encounters this step.
      if (ctx.mode !== "world") {
        try { typeof ctx.turn === "function" && ctx.turn(); } catch (_) {}
        return true;
      }
    }
  } catch (_) {}

  // Encounter roll before advancing time (modules may switch mode)
  try {
    const ES = ctx.EncounterService || (typeof window !== "undefined" ? window.EncounterService : null);
    if (ES && typeof ES.maybeTryEncounter === "function") {
      ES.maybeTryEncounter(ctx);
    }
  } catch (_) {}
  try { typeof ctx.turn === "function" && ctx.turn(); } catch (_) {}
  return true;
}

/**
 * Optional per-turn hook for world mode.
 * Keeps the interface consistent with TownRuntime/DungeonRuntime tick hooks.
 */
export function tick(ctx) {
  // Placeholder for future day/night effects or ambient overlays in world mode
  return true;
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.WorldRuntime = { generate, tryMovePlayerWorld, tick, ensureInBounds: _ensureInBounds };
}