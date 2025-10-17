/**
 * RegionMapRuntime: overlay mode to browse the world at full scale.
 *
 * Exports (ESM + window.RegionMapRuntime):
 * - open(ctx): switch to region mode using the current world as the map
 * - tryMove(ctx, dx, dy): move the cursor (player marker) without advancing time
 * - onAction(ctx): press G to return to world when on an orange edge tile
 * - tick(ctx): no-op (region map doesn't advance time)
 */
export function open(ctx) {
  try {
    const world = ctx.world;
    if (!world || !Array.isArray(world.map)) return false;

    // Build region overlay state
    const width = world.width || (world.map[0] ? world.map[0].length : 0);
    const height = world.height || world.map.length;

    // Center-edge exit tiles so user can return easily
    const exitTiles = [
      { x: Math.floor(width / 2), y: 0 },
      { x: Math.floor(width / 2), y: height - 1 },
      { x: 0, y: Math.floor(height / 2) },
      { x: width - 1, y: Math.floor(height / 2) },
    ];

    ctx.region = {
      width,
      height,
      map: world.map,
      cursor: { x: ctx.player.x, y: ctx.player.y },
      enterWorldPos: { x: ctx.player.x, y: ctx.player.y },
      exitTiles,
    };

    // Switch to region mode and use the world map for rendering
    ctx.mode = "region";
    ctx.map = world.map;

    // Reveal fully (seen/visible shaped to map)
    const rows = ctx.map.length;
    const cols = ctx.map[0] ? ctx.map[0].length : 0;
    ctx.seen = Array.from({ length: rows }, () => Array(cols).fill(true));
    ctx.visible = Array.from({ length: rows }, () => Array(cols).fill(true));

    // Keep player marker at the cursor location
    // (camera will center on player in RenderCore.computeView)
    ctx.player.x = ctx.region.cursor.x;
    ctx.player.y = ctx.region.cursor.y;

    // Hide town exit button while in region map if present
    try {
      const TR = (ctx.TownRuntime || (typeof window !== "undefined" ? window.TownRuntime : null));
      if (TR && typeof TR.hideExitButton === "function") {
        TR.hideExitButton(ctx);
      }
    } catch (_) {}

    return true;
  } catch (_) {
    return false;
  }
}

export function tryMove(ctx, dx, dy) {
  try {
    if (!ctx.region || !Array.isArray(ctx.map)) return false;
    const nx = ctx.player.x + (dx | 0);
    const ny = ctx.player.y + (dy | 0);
    const rows = ctx.map.length;
    const cols = ctx.map[0] ? ctx.map[0].length : 0;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return false;
    ctx.player.x = nx;
    ctx.player.y = ny;
    // No time advance in region overlay; camera adjusts on next draw
    if (typeof ctx.updateCamera === "function") ctx.updateCamera();
    if (typeof ctx.requestDraw === "function") ctx.requestDraw();
    return true;
  } catch (_) {
    return false;
  }
}

export function onAction(ctx) {
  try {
    if (!ctx.region || !Array.isArray(ctx.region.exitTiles)) return false;
    const hereKey = `${ctx.player.x},${ctx.player.y}`;
    const onExit = ctx.region.exitTiles.some(e => `${e.x},${e.y}` === hereKey);
    if (!onExit) return false;

    // Return to overworld: restore mode/map and player pos
    const w = ctx.world;
    if (!w || !Array.isArray(w.map)) return false;
    ctx.mode = "world";
    ctx.map = w.map;
    if (ctx.region.enterWorldPos) {
      ctx.player.x = ctx.region.enterWorldPos.x;
      ctx.player.y = ctx.region.enterWorldPos.y;
    }

    // Reveal fully in overworld (seen/visible shaped to map)
    const rows = ctx.map.length;
    const cols = ctx.map[0] ? ctx.map[0].length : 0;
    ctx.seen = Array.from({ length: rows }, () => Array(cols).fill(true));
    ctx.visible = Array.from({ length: rows }, () => Array(cols).fill(true));

    // Clear overlay state
    ctx.region = null;

    // Center camera and redraw
    if (typeof ctx.updateCamera === "function") ctx.updateCamera();
    if (typeof ctx.requestDraw === "function") ctx.requestDraw();

    return true;
  } catch (_) {
    return false;
  }
}

export function tick(_ctx) {
  // Region overlay does not advance time; keep as no-op.
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.RegionMapRuntime = { open, tryMove, onAction, tick };
}