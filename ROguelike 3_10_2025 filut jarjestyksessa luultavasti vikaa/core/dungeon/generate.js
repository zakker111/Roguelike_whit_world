/**
 * Dungeon generation (Phase 3 extraction): level generation and props.
 */
import { getMod } from "../../utils/access.js";

// Spawn sparse wall torches on WALL tiles adjacent to FLOOR/DOOR/STAIRS.
// Options: { density:number (0..1), minSpacing:number (tiles) }
function spawnWallTorches(ctx, options = {}) {
  const density = typeof options.density === "number" ? Math.max(0, Math.min(1, options.density)) : 0.006;
  const minSpacing = Math.max(1, (options.minSpacing | 0) || 2);
  const list = [];
  const rows = ctx.map.length;
  const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
  const RU = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
  const rng = (RU && typeof RU.getRng === "function")
    ? RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
    : ((typeof ctx.rng === "function") ? ctx.rng : null);

  const isWall = (x, y) => ctx.inBounds(x, y) && ctx.map[y][x] === ctx.TILES.WALL;
  const isWalkableTile = (x, y) => ctx.inBounds(x, y) && (ctx.map[y][x] === ctx.TILES.FLOOR || ctx.map[y][x] === ctx.TILES.DOOR || ctx.map[y][x] === ctx.TILES.STAIRS);

  function nearTorch(x, y, r = minSpacing) {
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const dx = Math.abs(p.x - x);
      const dy = Math.abs(p.y - y);
      if (dx <= r && dy <= r) return true;
    }
    return false;
  }

  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      if (!isWall(x, y)) continue;
      // Must border at least one walkable tile (corridor/room edge)
      const bordersWalkable =
        isWalkableTile(x + 1, y) || isWalkableTile(x - 1, y) ||
        isWalkableTile(x, y + 1) || isWalkableTile(x, y - 1);
      if (!bordersWalkable) continue;
      // Sparse random placement with spacing constraint
      const rv = (typeof rng === "function") ? rng() : 0.5;
      if (rv < density && !nearTorch(x, y)) {
        list.push({ x, y, type: "wall_torch", name: "Wall Torch" });
      }
    }
  }
  return list;
}

export function generate(ctx, depth) {
  const D = (ctx && ctx.Dungeon) || (typeof window !== "undefined" ? window.Dungeon : null);
  if (D && typeof D.generateLevel === "function") {
    ctx.startRoomRect = ctx.startRoomRect || null;
    D.generateLevel(ctx, depth);
    // Clear decals on new floor
    ctx.decals = [];
    // Spawn sparse wall torches along walls adjacent to floor tiles
    try {
      ctx.dungeonProps = spawnWallTorches(ctx, { density: 0.006, minSpacing: 2 });
    } catch (_) { ctx.dungeonProps = []; }
    // FOV + Camera
    try { ctx.recomputeFOV && ctx.recomputeFOV(); } catch (_) {}
    try { ctx.updateCamera && ctx.updateCamera(); } catch (_) {}
    // Visibility sanity
    try {
      if (ctx.inBounds(ctx.player.x, ctx.player.y) && ctx.visible && !ctx.visible[ctx.player.y][ctx.player.x]) {
        ctx.log && ctx.log("FOV sanity check: player tile not visible after gen; recomputing.", "warn");
        ctx.recomputeFOV && ctx.recomputeFOV();
        if (ctx.inBounds(ctx.player.x, ctx.player.y)) {
          ctx.visible[ctx.player.y][ctx.player.x] = true;
          ctx.seen[ctx.player.y][ctx.player.x] = true;
        }
      }
    } catch (_) {}
    // Occupancy (centralized)
    try {
      const OF = ctx.OccupancyFacade || (typeof window !== "undefined" ? window.OccupancyFacade : null);
      if (OF && typeof OF.rebuild === "function") OF.rebuild(ctx);
    } catch (_) {}
    
    // Refresh UI and visuals via StateSync, then message
    try {
      const SS = ctx.StateSync || getMod(ctx, "StateSync");
      if (SS && typeof SS.applyAndRefresh === "function") {
        SS.applyAndRefresh(ctx, {});
      }
    } catch (_) {}
    try {
      const pl = (ctx.player && typeof ctx.player.level === "number") ? ctx.player.level : 1;
      const dl = Math.max(1, (ctx.floor | 0) || 1);
      const ed = Math.max(1, dl + Math.floor(Math.max(0, pl) / 2));
      ctx.log && ctx.log(`You explore the dungeon (Level ${dl}, Effective ${ed}).`);
    } catch (_) {
      ctx.log && ctx.log("You explore the dungeon.");
    }
    return true;
  }
  // Fallback: flat-floor
  const MAP_ROWS = ctx.MAP_ROWS || (ctx.map ? ctx.map.length : 80);
  const MAP_COLS = ctx.MAP_COLS || (ctx.map && ctx.map[0] ? ctx.map[0].length : 120);
  ctx.map = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(ctx.TILES.FLOOR));
  // One stair
  const sy = Math.max(1, MAP_ROWS - 2), sx = Math.max(1, MAP_COLS - 2);
  if (ctx.map[sy] && typeof ctx.map[sy][sx] !== "undefined") {
    ctx.map[sy][sx] = ctx.TILES.STAIRS;
  }
  ctx.enemies = [];
  ctx.corpses = [];
  ctx.decals = [];
  ctx.dungeonProps = [];
  try {
    const SS = ctx.StateSync || getMod(ctx, "StateSync");
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    } else {
      ctx.recomputeFOV && ctx.recomputeFOV();
      ctx.updateCamera && ctx.updateCamera();
      ctx.updateUI && ctx.updateUI();
      ctx.requestDraw && ctx.requestDraw();
    }
  } catch (_) {}
  ctx.log && ctx.log("You explore the dungeon.");
  return true;
}