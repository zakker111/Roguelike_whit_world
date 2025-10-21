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

// Expand map arrays on any side by K tiles, generating via world.gen.tileAt against world origin offsets.
function expandMap(ctx, side, K) {
  const world = ctx.world;
  const gen = world && world.gen;
  if (!gen || typeof gen.tileAt !== "function") return false;

  const rows = ctx.map.length;
  const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;

  if (side === "left") {
    // prepend K columns
    for (let y = 0; y < rows; y++) {
      const row = ctx.map[y];
      const seenRow = ctx.seen[y] || [];
      const visRow = ctx.visible[y] || [];
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
    // Shift player and any world entities right by K to preserve world position mapping
    try {
      ctx.player.x += K;
    } catch (_) {}
    try {
      if (Array.isArray(ctx.enemies)) for (const e of ctx.enemies) if (e) e.x += K;
      if (Array.isArray(ctx.corpses)) for (const c of ctx.corpses) if (c) c.x += K;
      if (Array.isArray(ctx.decals)) for (const d of ctx.decals) if (d) d.x += K;
    } catch (_) {}
  } else if (side === "right") {
    // append K columns
    for (let y = 0; y < rows; y++) {
      const row = ctx.map[y];
      const seenRow = ctx.seen[y] || [];
      const visRow = ctx.visible[y] || [];
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
  } else if (side === "top") {
    // prepend K rows
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
    ctx.seen = newSeen.concat(ctx.seen);
    ctx.visible = newVis.concat(ctx.visible);
    world.originY -= K;
    // Shift player and entities down by K to preserve world position mapping
    try {
      ctx.player.y += K;
    } catch (_) {}
    try {
      if (Array.isArray(ctx.enemies)) for (const e of ctx.enemies) if (e) e.y += K;
      if (Array.isArray(ctx.corpses)) for (const c of ctx.corpses) if (c) c.y += K;
      if (Array.isArray(ctx.decals)) for (const d of ctx.decals) if (d) d.y += K;
    } catch (_) {}
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
  }

  world.width = ctx.map[0] ? ctx.map[0].length : 0;
  world.height = ctx.map.length;
  // Keep world.map in sync for modules that still read from ctx.world.map
  world.map = ctx.map;
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

export function generate(ctx, opts = {}) {
  // Prefer infinite generator; fall back to finite world if module missing
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

  // Create generator (infinite) or fall back
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

    // Camera/FOV/UI
    try { typeof ctx.updateCamera === "function" && ctx.updateCamera(); } catch (_) {}
    try { typeof ctx.recomputeFOV === "function" && ctx.recomputeFOV(); } catch (_) {}
    try { typeof ctx.updateUI === "function" && ctx.updateUI(); } catch (_) {}

    // Arrival log
    ctx.log && ctx.log("You arrive in the overworld. The world expands as you explore. Minimap shows discovered tiles.", "notice");

    // Hide town exit button via TownRuntime
    try {
      const TR = (ctx && ctx.TownRuntime) || (typeof window !== "undefined" ? window.TownRuntime : null);
      if (TR && typeof TR.hideExitButton === "function") TR.hideExitButton(ctx);
    } catch (_) {}

    return true;
  }

  // Fallback to finite world (existing module)
  if (!(W && typeof W.generate === "function")) {
    ctx.log && ctx.log("World module missing; generating dungeon instead.", "warn");
    ctx.mode = "dungeon";
    try { if (typeof ctx.generateLevel === "function") ctx.generateLevel(ctx.floor || 1); } catch (_) {}
    return false;
  }

  try {
    ctx.world = W.generate(ctx, { width, height });
  } catch (e) {
    ctx.log && ctx.log("World generation failed; falling back to dungeon.", "warn");
    ctx.mode = "dungeon";
    try { if (typeof ctx.generateLevel === "function") ctx.generateLevel(ctx.floor || 1); } catch (_) {}
    return false;
  }

  const start = (typeof W.pickTownStart === "function")
    ? W.pickTownStart(ctx.world, (ctx.rng || Math.random))
    : { x: 1, y: 1 };

  ctx.player.x = start.x;
  ctx.player.y = start.y;
  ctx.mode = "world";

  ctx.enemies = [];
  ctx.corpses = [];
  ctx.decals = [];
  ctx.npcs = [];
  ctx.shops = [];

  ctx.map = ctx.world.map;
  const rows = ctx.map.length;
  const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
  // Fog-of-war: start unseen; FOV will reveal around player
  ctx.seen = Array.from({ length: rows }, () => Array(cols).fill(false));
  ctx.visible = Array.from({ length: rows }, () => Array(cols).fill(false));

  try { typeof ctx.updateCamera === "function" && ctx.updateCamera(); } catch (_) {}
  try { typeof ctx.recomputeFOV === "function" && ctx.recomputeFOV(); } catch (_) {}
  try { typeof ctx.updateUI === "function" && ctx.updateUI(); } catch (_) {}

  ctx.log && ctx.log("You arrive in the overworld.", "notice");

  try {
    const TR = (ctx && ctx.TownRuntime) || (typeof window !== "undefined" ? window.TownRuntime : null);
    if (TR && typeof TR.hideExitButton === "function") TR.hideExitButton(ctx);
  } catch (_) {}

  return true;
}

export function tryMovePlayerWorld(ctx, dx, dy) {
  if (!ctx || ctx.mode !== "world" || !ctx.world || !ctx.map) return false;

  // Compute intended target
  let nx = ctx.player.x + (dx | 0);
  let ny = ctx.player.y + (dy | 0);

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

  try { typeof ctx.updateCamera === "function" && ctx.updateCamera(); } catch (_) {}

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
  window.WorldRuntime = { generate, tryMovePlayerWorld, tick };
}