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

  // World exploration tracking (for minimap): initialize and mark start (absolute) as explored.
  ctx.seen = Array.from({ length: rows }, () => Array(cols).fill(true));
  ctx.visible = Array.from({ length: rows }, () => Array(cols).fill(true));
  ctx.worldExplored = new Set();
  _markExplored(ctx, ctx.worldPos.x, ctx.worldPos.y, 2);

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
  const wmap = ctx.world.map;
  const rows = wmap.length, cols = rows ? (wmap[0] ? wmap[0].length : 0) : 0;

  // Absolute target
  const origin = (ctx.world && ctx.world.origin) ? ctx.world.origin : { x0: 0, y0: 0 };
  const nextAbs = { x: ctx.worldPos.x + (dx | 0), y: ctx.worldPos.y + (dy | 0) };

  // Local indices in current window
  const nxLocal = nextAbs.x - origin.x0;
  const nyLocal = nextAbs.y - origin.y0;

  // Recompose window if stepping out of safe margin
  const MARG = 3;
  const needsRecompose = (nxLocal < MARG) || (nyLocal < MARG) || (nxLocal > cols - 1 - MARG) || (nyLocal > rows - 1 - MARG);

  const W = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
  if (!W) return false;

  // Check walkability using sampler if available when recomposing, else current tile
  let walkable = true;
  try {
    if (needsRecompose && typeof W.tileAt === "function") {
      const t = W.tileAt(ctx.world, nextAbs.x, nextAbs.y);
      walkable = !!W.isWalkable(t);
    } else {
      const t = (nyLocal >= 0 && nyLocal < rows && nxLocal >= 0 && nxLocal < cols) ? wmap[nyLocal][nxLocal] : null;
      walkable = t == null ? false : !!W.isWalkable(t);
    }
  } catch (_) {}

  if (!walkable) return false;

  // Apply movement
  ctx.worldPos = nextAbs;

  if (needsRecompose && typeof W.recompose === "function") {
    // Recenter window on new absolute position
    const nextWorld = W.recompose(ctx.world, ctx.worldPos.x, ctx.worldPos.y, cols, rows);
    ctx.world = nextWorld;
    ctx.map = nextWorld.map;
    // Update local indices from new origin
    const o2 = nextWorld.origin || { x0: 0, y0: 0 };
    ctx.player.x = (ctx.worldPos.x - o2.x0) | 0;
    ctx.player.y = (ctx.worldPos.y - o2.y0) | 0;
  } else {
    // No recompose: move local
    ctx.player.x = nxLocal | 0;
    ctx.player.y = nyLocal | 0;
  }

  // Mark explored area around the new absolute position for minimap reveal.
  _markExplored(ctx, ctx.worldPos.x, ctx.worldPos.y, 2);

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
 * Keeps the interface consistent with TownRuntime/DungeonRuntime tick hooks.
 * Currently a no-op placeholder for future world-side time/day effects.
 */
export function tick(ctx) {
  // Intentionally minimal; world mode reveals everything and has no occupancy/NPCs.
  // Modules can extend this later for overlays or time-driven effects.
  return true;
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.WorldRuntime = { generate, tryMovePlayerWorld, tick };
}