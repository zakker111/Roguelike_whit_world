/**
 * RegionMapRuntime: behaves like a normal game mode (like town/dungeon),
 * using the overworld map with simple enter/exit semantics.
 *
 * Exports (ESM + window.RegionMapRuntime):
 * - open(ctx): enter region mode
 * - tryMove(ctx, dx, dy): move and advance time (like town/dungeon)
 * - onAction(ctx): press G anywhere to exit back to overworld
 * - tick(ctx): optional per-turn hook (no-op)
 */
export function open(ctx) {
  try {
    const world = ctx.world;
    if (!world || !Array.isArray(world.map)) return false;

    // Save return position
    const enterWorldPos = { x: ctx.player.x | 0, y: ctx.player.y | 0 };

    // Switch to region mode and use the world map directly
    ctx.mode = "region";
    ctx.map = world.map;

    // Region state used only for restoring player pos on exit
    ctx.region = { enterWorldPos };

    // Reveal fully (no fog-of-war in region mode)
    const rows = ctx.map.length;
    const cols = ctx.map[0] ? ctx.map[0].length : 0;
    ctx.seen = Array.from({ length: rows }, () => Array(cols).fill(true));
    ctx.visible = Array.from({ length: rows }, () => Array(cols).fill(true));

    // Center camera on player via caller's refresh flow
    return true;
  } catch (_) {
    return false;
  }
}

export function tryMove(ctx, dx, dy) {
  try {
    if (!Array.isArray(ctx.map)) return false;
    const nx = (ctx.player.x | 0) + (dx | 0);
    const ny = (ctx.player.y | 0) + (dy | 0);
    const rows = ctx.map.length;
    const cols = ctx.map[0] ? ctx.map[0].length : 0;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return false;
    // Respect walkability rules for region mode (tiles.json driven)
    if (typeof ctx.isWalkable === "function" ? !ctx.isWalkable(nx, ny) : false) return false;

    ctx.player.x = nx;
    ctx.player.y = ny;

    // Advance time and refresh like other modes
    if (typeof ctx.turn === "function") {
      ctx.turn();
      return true;
    }

    // Fallback: camera + UI + redraw if turn() unavailable
    if (typeof ctx.updateCamera === "function") ctx.updateCamera();
    if (typeof ctx.recomputeFOV === "function") ctx.recomputeFOV();
    if (typeof ctx.updateUI === "function") ctx.updateUI();
    if (typeof ctx.requestDraw === "function") ctx.requestDraw();

    return true;
  } catch (_) {
    return false;
  }
}

export function onAction(ctx) {
  try {
    const w = ctx.world;
    if (!w || !Array.isArray(w.map)) return false;

    // Exit back to overworld and restore player position
    ctx.mode = "world";
    ctx.map = w.map;
    if (ctx.region && ctx.region.enterWorldPos) {
      ctx.player.x = ctx.region.enterWorldPos.x | 0;
      ctx.player.y = ctx.region.enterWorldPos.y | 0;
    }

    // Reveal fully in overworld
    const rows = ctx.map.length;
    const cols = ctx.map[0] ? ctx.map[0].length : 0;
    ctx.seen = Array.from({ length: rows }, () => Array(cols).fill(true));
    ctx.visible = Array.from({ length: rows }, () => Array(cols).fill(true));

    // Clear region state
    ctx.region = null;

    // Camera/UI/redraw handled by caller's applyCtxSyncAndRefresh
    return true;
  } catch (_) {
    return false;
  }
}

export function tick(_ctx) {
  // No special per-turn behavior for region mode.
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.RegionMapRuntime = { open, tryMove, onAction, tick };
}