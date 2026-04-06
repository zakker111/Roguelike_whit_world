/**
 * WorldRuntime POI helpers extracted from core/world_runtime.js.
 *
 * These helpers are pure functions operating on ctx/world, so that
 * core/world_runtime.js can stay focused on orchestration and generation.
 */

/**
 * Stable coordinate hash → [0,1). Used to derive deterministic POI metadata.
 */
function h2(x, y) {
  const n = (((x | 0) * 73856093) ^ ((y | 0) * 19349663)) >>> 0;
  return (n % 1000003) / 1000003;
}

/**
 * Ensure POI bookkeeping containers exist on world.
 */
export function ensurePOIState(world) {
  if (!world.towns) world.towns = [];
  if (!world.dungeons) world.dungeons = [];
  if (!world.ruins) world.ruins = [];
  if (!world._poiSet) world._poiSet = new Set();
}

/**
 * Add a town at world coords if not present; derive size deterministically.
 */
export function addTown(world, x, y) {
  ensurePOIState(world);
  const key = `${x},${y}`;
  if (world._poiSet.has(key)) return;
  const r = h2(x + 11, y - 7);
  const size = r < 0.60 ? "small" : r < 0.90 ? "big" : "city";
  world.towns.push({ x, y, size });
  world._poiSet.add(key);
}

/**
 * Add a dungeon at world coords if not present; derive level/size deterministically.
 */
export function addDungeon(world, x, y) {
  ensurePOIState(world);
  const key = `${x},${y}`;
  if (world._poiSet.has(key)) return;
  const r1 = h2(x - 5, y + 13);
  const level = 1 + Math.floor(r1 * 5); // 1..5
  const r2 = h2(x + 29, y + 3);
  const size = r2 < 0.45 ? "small" : r2 < 0.85 ? "medium" : "large";
  world.dungeons.push({ x, y, level, size });
  world._poiSet.add(key);
}

/**
 * Add a ruins POI at world coords if not present.
 */
export function addRuins(world, x, y) {
  ensurePOIState(world);
  const key = `${x},${y}`;
  if (world._poiSet.has(key)) return;
  world.ruins.push({ x, y });
  world._poiSet.add(key);
}

/**
 * For debugging: force a castle POI to spawn close to the starting position so it's easy to inspect.
 * This is layered on top of the normal (very rare) castle placement in InfiniteGen.
 */
export function spawnDebugCastleNearPlayer(ctx) {
  try {
    const W = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
    const WT = W && W.TILES;
    const world = ctx.world;
    const map = ctx.map;
    if (!WT || !world || !Array.isArray(map) || !map.length) return;
    if (typeof WT.CASTLE !== "number") return;

    const rows = map.length;
    const cols = map[0] ? map[0].length : 0;
    if (!cols) return;

    const px =
      ctx.player && typeof ctx.player.x === "number" ? (ctx.player.x | 0) : cols >> 1;
    const py =
      ctx.player && typeof ctx.player.y === "number" ? (ctx.player.y | 0) : rows >> 1;

    const radius = 4;
    const candidates = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (!dx && !dy) continue;
        const x = px + dx;
        const y = py + dy;
        if (x < 0 || y < 0 || y >= rows || x >= cols) continue;
        candidates.push({ x, y });
      }
    }
    if (!candidates.length) return;

    function isPOITile(t) {
      return (
        t === WT.TOWN ||
        t === WT.DUNGEON ||
        t === WT.RUINS ||
        (WT.CASTLE != null && t === WT.CASTLE)
      );
    }

    function isReasonableSpot(x, y) {
      const t = map[y][x];
      if (isPOITile(t)) return false;
      if (t === WT.WATER || t === WT.RIVER || t === WT.MOUNTAIN || t === WT.SWAMP) {
        return false;
      }
      return true;
    }

    let chosen = null;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (isReasonableSpot(c.x, c.y)) {
        chosen = c;
        break;
      }
    }
    if (!chosen) return;

    map[chosen.y][chosen.x] = WT.CASTLE;
    world.map = map;
  } catch (_) {}
}

/**
 * Spawn initial travelling caravans after the first POIs are registered.
 * Caravans are stored in world.caravans with world-space coordinates and a destination town.
 */
export function spawnInitialCaravans(ctx) {
  try {
    const world = ctx.world;
    if (!world) return;
    const towns = Array.isArray(world.towns) ? world.towns : [];
    if (!towns.length) return;

    if (!Array.isArray(world.caravans)) world.caravans = [];

    // Use RNGUtils when available so caravans are deterministic per seed.
    let r = null;
    try {
      if (
        typeof window !== "undefined" &&
        window.RNGUtils &&
        typeof window.RNGUtils.getRng === "function"
      ) {
        r = window.RNGUtils.getRng(
          typeof ctx.rng === "function" ? ctx.rng : undefined
        );
      } else if (typeof ctx.rng === "function") {
        r = ctx.rng;
      }
    } catch (_) {}
    if (typeof r !== "function") {
      r = function () {
        return Math.random();
      };
    }

    const desired = Math.min(16, Math.max(4, Math.floor(towns.length * 0.8)));
    let idCounter = world.caravans.length ? world.caravans.length : 0;
    const existing = world.caravans.length;

    for (let i = existing; i < desired; i++) {
      const fromIndex = (r() * towns.length) | 0;
      const from = towns[fromIndex];
      if (!from) continue;

      // Find nearest and farthest other towns from this origin.
      let nearest = null;
      let nearestDist = Infinity;
      let farthest = null;
      let farthestDist = -Infinity;
      for (let j = 0; j < towns.length; j++) {
        if (j === fromIndex) continue;
        const t = towns[j];
        if (!t) continue;
        const dx = (t.x | 0) - (from.x | 0);
        const dy = (t.y | 0) - (from.y | 0);
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist === 0) continue;
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = t;
        }
        if (dist > farthestDist) {
          farthestDist = dist;
          farthest = t;
        }
      }
      if (!nearest) continue;

      // Default to nearest, but sometimes choose a far destination so some initial
      // caravans run longer routes across the world.
      let destTown = nearest;
      try {
        const roll = typeof r === "function" ? r() : Math.random();
        if (towns.length >= 4 && roll < 0.35 && farthest) {
          destTown = farthest;
        }
      } catch (_) {}

      world.caravans.push({
        id: ++idCounter,
        x: from.x | 0,
        y: from.y | 0,
        from: { x: from.x | 0, y: from.y | 0 },
        dest: { x: destTown.x | 0, y: destTown.y | 0 },
        atTown: true,
        dwellUntil: 0,
      });
    }
  } catch (_) {}
}