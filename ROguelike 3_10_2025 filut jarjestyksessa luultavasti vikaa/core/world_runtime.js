/**
 * WorldRuntime: generation and helpers for overworld mode.
 *
 * Exports (ESM + window.WorldRuntime):
 * - generate(ctx, { width, height }?)
 *
 * Notes:
 * - Delegates to ctx.World.generate; picks a town-adjacent start via World.pickTownStart when available.
 * - Clears town/dungeon-specific arrays; sets seen/visible fully for world mode.
 * - Updates camera/FOV/UI and logs arrival message; hides town exit button via TownRuntime.
 */

export function generate(ctx, opts = {}) {
  const W = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
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

  const start = (typeof W.pickTownStart === "function")
    ? W.pickTownStart(ctx.world, (ctx.rng || Math.random))
    : { x: 1, y: 1 };

  ctx.player.x = start.x;
  ctx.player.y = start.y;
  ctx.mode = "world";

  // Clear non-world entities
  ctx.enemies = [];
  ctx.corpses = [];
  ctx.decals = [];
  ctx.npcs = [];   // no NPCs on overworld
  ctx.shops = [];  // no shops on overworld

  // Apply world map and reveal it fully
  ctx.map = ctx.world.map;
  const rows = ctx.map.length;
  const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
  ctx.seen = Array.from({ length: rows }, () => Array(cols).fill(true));
  ctx.visible = Array.from({ length: rows }, () => Array(cols).fill(true));

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

  try { typeof ctx.requestDraw === "function" && ctx.requestDraw(); } catch (_) {}

  return true;
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.WorldRuntime = { generate };
}