/**
 * WorldRuntime: generation and helpers for overworld mode.
 *
 * Exports (ESM + window.WorldRuntime):
 * - generate(ctx, { width, height }?)
 * - tryMovePlayerWorld(ctx, dx, dy)
 * - tick(ctx)      // optional per-turn hook for world mode
 */

function _key(x, y) { return `${x | 0},${y | 0}`; }
function _markExplored(ctx, x, y, radius = 0) {
  try {
    if (!ctx.worldExplored || !(ctx.worldExplored instanceof Set)) ctx.worldExplored = new Set();
    ctx.worldExplored.add(_key(x, y));
    // Optional: reveal a small radius around player to make exploration feel less pixel-perfect
    const r = Math.max(0, radius | 0);
    if (r > 0) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy;
          if (Math.abs(dx) + Math.abs(dy) <= r) ctx.worldExplored.add(_key(nx, ny));
        }
      }
    }
  } catch (_) {}
}
// Mark the entire current window as explored using absolute coordinates.
// This keeps the minimap in sync with the visible world window after streaming/recompose.
function _markWindowExplored(ctx) {
  try {
    const explored = (ctx.worldExplored && ctx.worldExplored instanceof Set) ? ctx.worldExplored : (ctx.worldExplored = new Set());
    const map = ctx.world && ctx.world.map ? ctx.world.map : ctx.map;
    const rows = Array.isArray(map) ? map.length : 0;
    const cols = rows ? (map[0] ? map[0].length : 0) : 0;
    const origin = (ctx.world && ctx.world.origin) ? ctx.world.origin : { x0: 0, y0: 0 };
    for (let yy = 0; yy < rows; yy++) {
      for (let xx = 0; xx < cols; xx++) {
        explored.add(_key(origin.x0 + xx, origin.y0 + yy));
      }
    }
  } catch (_) {}
}

export function generate(ctx, opts = {}) {
  // Default to noise-driven generator (ChunkedWorld) when available. Fallback to World.
  let W = null;
  try {
    if (typeof window !== "undefined" && window.ChunkedWorld && typeof window.ChunkedWorld.generate === "function") {
      W = window.ChunkedWorld;
      // Back-compat: expose as World if not already set so existing modules that import/use window.World continue to work.
      if (typeof window.World === "undefined") {
        try { window.World = window.ChunkedWorld; } catch (_) {}
      }
    } else {
      W = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
    }
  } catch (_) {
    W = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
  }

  if (!(W && typeof W.generate === "function")) {
    ctx.log && ctx.log("World module missing; generating dungeon instead.", "warn");
    ctx.mode = "dungeon";
    try { if (typeof ctx.generateLevel === "function") ctx.generateLevel(ctx.floor || 1); } catch (_) {}
    return false;
  }

  const width = (typeof opts.width === "number") ? opts.width : (ctx.MAP_COLS || 120);
  const height = (typeof opts.height === "number") ? opts.height : (ctx.MAP_ROWS || 80);

  try {
    ctx.world = W.generate(ctx, { width, height });
  } catch (e) {
    ctx.log && ctx.log("World generation failed; falling back to dungeon.", "warn");
    ctx.mode = "dungeon";
    try { if (typeof ctx.generateLevel === "function") ctx.generateLevel(ctx.floor || 1); } catch (_) {}
    return false;
  }

  const startAbs = (typeof W.pickTownStart === "function")
    ? W.pickTownStart(ctx.world, (ctx.rng || Math.random))
    : { x: 1, y: 1 };

  // Absolute world position separate from local player indices
  ctx.worldPos = { x: startAbs.x | 0, y: startAbs.y | 0 };

  // Map window origin to translate absolute into local indices
  const origin = (ctx.world && ctx.world.origin) ? ctx.world.origin : { x0: 0, y0: 0 };
  ctx.player.x = (ctx.worldPos.x - origin.x0) | 0;
  ctx.player.y = (ctx.worldPos.y - origin.y0) | 0;
  ctx.mode = "world";

  // Clear non-world entities
  ctx.enemies = [];
  ctx.corpses = [];
  ctx.decals = [];
  ctx.npcs = [];   // no NPCs on overworld
  ctx.shops = [];  // no shops on overworld

  // Apply world map
  ctx.map = ctx.world.map;
  const rows = ctx.map.length;
  const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;

  // World exploration tracking (for minimap): initialize and mark visible window explored (absolute).
  ctx.seen = Array.from({ length: rows }, () => Array(cols).fill(true));
  ctx.visible = Array.from({ length: rows }, () => Array(cols).fill(true));
  ctx.worldExplored = new Set();
  _markWindowExplored(ctx);

  // Camera/FOV/UI
  try { typeof ctx.updateCamera === "function" && ctx.updateCamera(); } catch (_) {}
  try { typeof ctx.recomputeFOV === "function" && ctx.recomputeFOV(); } catch (_) {}
  try { typeof ctx.updateUI === "function" && ctx.updateUI(); } catch (_) {}

  // Arrival log
  ctx.log && ctx.log("You arrive in the overworld. Towns: small (t), big (T), cities (C). Dungeons (D). Press G on a town/dungeon tile to enter/exit.", "notice");

  // Hide town exit button via TownRuntime
  try {
    const TR = (ctx && ctx.TownRuntime) || (typeof window !== "undefined" ? window.TownRuntime : null);
    if (TR && typeof TR.hideExitButton === "function") TR.hideExitButton(ctx);
  } catch (_) {}

  // Draw is handled by the orchestrator (core/game.js) after sync; avoid redundant frames here.
  return true;
}

export function tryMovePlayerWorld(ctx, dx, dy) {
  if (!ctx || ctx.mode !== "world" || !ctx.world || !ctx.world.map) return false;

  const W = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
  if (!W) return false;

  // Compute absolute next position
  const origin = (ctx.world && ctx.world.origin) ? ctx.world.origin : { x0: 0, y0: 0 };
  const nextAbs = { x: (ctx.worldPos.x | 0) + (dx | 0), y: (ctx.worldPos.y | 0) + (dy | 0) };

  // Determine whether a recompose is needed (outside current window or near its edges)
  const rows = ctx.world.map.length;
  const cols = rows ? (ctx.world.map[0] ? ctx.world.map[0].length : 0) : 0;
  const nxLocal = nextAbs.x - origin.x0;
  const nyLocal = nextAbs.y - origin.y0;
  const MARG = 4;
  const outside = (nxLocal < 0) || (nyLocal < 0) || (nxLocal >= cols) || (nyLocal >= rows);
  const nearEdge = (nxLocal < MARG) || (nyLocal < MARG) || (nxLocal > cols - 1 - MARG) || (nyLocal > rows - 1 - MARG);
  const needsRecompose = outside || nearEdge;

  // Walkability check
  let walkable = true;
  try {
    if (typeof W.tileAt === "function") {
      const t = W.tileAt(ctx.world, nextAbs.x, nextAbs.y);
      walkable = !!W.isWalkable(t);
    } else {
      // Finite fallback: use current window tile if inside
      const t = (!outside) ? ctx.world.map[nyLocal][nxLocal] : null;
      walkable = t == null ? false : !!W.isWalkable(t);
    }
  } catch (_) {}

  if (!walkable) return false;

  // Apply movement
  ctx.worldPos = { x: nextAbs.x | 0, y: nextAbs.y | 0 };

  if (needsRecompose && typeof W.recompose === "function") {
    // Recenter window on new absolute position
    const nextWorld = W.recompose(ctx.world, ctx.worldPos.x, ctx.worldPos.y, cols, rows);
    ctx.world = nextWorld;
    ctx.map = nextWorld.map;
    const o2 = nextWorld.origin || { x0: 0, y0: 0 };
    ctx.player.x = (ctx.worldPos.x - o2.x0) | 0;
    ctx.player.y = (ctx.worldPos.y - o2.y0) | 0;
    // Mark newly visible window as explored for minimap update
    _markWindowExplored(ctx);
  } else {
    // Move locally within the current window
    ctx.player.x = nxLocal | 0;
    ctx.player.y = nyLocal | 0;
    // Mark explored at absolute position (radius halo) to expand minimap progressively
    _markExplored(ctx, ctx.worldPos.x, ctx.worldPos.y, 2);
  }

  try { typeof ctx.updateCamera === "function" && ctx.updateCamera(); } catch (_) {}
  // Roll for encounter first so acceptance can switch mode before advancing world time
  try {
    const ES = ctx.EncounterService || (typeof window !== "undefined" ? window.EncounterService : null);
    if (ES && typeof ES.maybeTryEncounter === "function") {
      ES.maybeTryEncounter(ctx);
    }
  } catch (_) {}
  // Advance a turn after the roll (if an encounter opened, next turn will tick region)
  try { typeof ctx.turn === "function" && ctx.turn(); } catch (_) {}
  return true;
}

/**
 * Optional per-turn hook for world mode.
 * Ensures window streaming/recompose when near boundaries, and minimap exploration reflects visible window.
 */
export function tick(ctx) {
  if (!ctx || ctx.mode !== "world" || !ctx.world || !ctx.world.map) return true;

  const W = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
  if (!W) return true;

  try {
    const origin = (ctx.world && ctx.world.origin) ? ctx.world.origin : { x0: 0, y0: 0 };
    const rows = ctx.world.map.length;
    const cols = rows ? (ctx.world.map[0] ? ctx.world.map[0].length : 0) : 0;
    const nxLocal = (ctx.worldPos.x | 0) - origin.x0;
    const nyLocal = (ctx.worldPos.y | 0) - origin.y0;
    const MARG = 4;

    const outside = (nxLocal < 0) || (nyLocal < 0) || (nxLocal >= cols) || (nyLocal >= rows);
    const nearEdge = (nxLocal < MARG) || (nyLocal < MARG) || (nxLocal > cols - 1 - MARG) || (nyLocal > rows - 1 - MARG);
    const needsRecompose = outside || nearEdge;

    if (needsRecompose && typeof W.recompose === "function") {
      const nextWorld = W.recompose(ctx.world, ctx.worldPos.x | 0, ctx.worldPos.y | 0, cols, rows);
      ctx.world = nextWorld;
      ctx.map = nextWorld.map;
      const o2 = nextWorld.origin || { x0: 0, y0: 0 };
      ctx.player.x = (ctx.worldPos.x - o2.x0) | 0;
      ctx.player.y = (ctx.worldPos.y - o2.y0) | 0;
      // Mark the visible window explored so minimap updates immediately
      _markWindowExplored(ctx);

      // Camera/FOV/UI refresh (draw scheduled by orchestrator after tick)
      try { typeof ctx.updateCamera === "function" && ctx.updateCamera(); } catch (_) {}
      try { typeof ctx.recomputeFOV === "function" && ctx.recomputeFOV(); } catch (_) {}
      try { typeof ctx.updateUI === "function" && ctx.updateUI(); } catch (_) {}
    }
  } catch (_) {}

  return true;
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.WorldRuntime = { generate, tryMovePlayerWorld, tick };
}