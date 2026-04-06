/**
 * World tick (Phase 3 extraction): optional per-turn hook for overworld mode.
 * Currently:
 * - Advances travelling caravans on the overworld map (with town dwell times).
 */
export function tick(ctx) {
  if (!ctx || ctx.mode !== "world" || !ctx.world) return true;

  try {
    spawnCaravansIfNeeded(ctx);
  } catch (_) {}

  try {
    advanceCaravans(ctx);
  } catch (_) {}

  // Escort ambush events: small chance each world tick while escorting
  try {
    maybeEscortAmbush(ctx);
  } catch (_) {}

  // Future: day/night effects or ambient overlays in world mode
  return true;
}

/**
 * Auto-escort travel: run world turns over time so the caravan (and player)
 * visibly travels toward its destination. This is invoked via GameAPI
 * (Game.startEscortAutoTravel wrapper) after completing a caravan encounter.
 */
export function startEscortAutoTravel(ctx) {
  if (!ctx || !ctx.world) return;
  const world = ctx.world;
  world._escortAutoTravel = world._escortAutoTravel || { running: false };
  const state = world._escortAutoTravel;
  if (state.running) return;
  state.running = true;

  let steps = 0;
  const maxSteps = 2000; // safety cap
  const delayMs = 140;

  function step() {
    try {
      const c = ctx && typeof ctx.getCtx === "function" ? ctx.getCtx() : ctx;
      const w = c && c.world;
      if (!c || !w) { state.running = false; return; }
      const escort = w.caravanEscort;
      if (!escort || !escort.active || c.mode !== "world") {
        state.running = false;
        return;
      }
      if (typeof c.turn === "function") c.turn();
    } catch (_) {}
    steps++;
    if (steps >= maxSteps) { state.running = false; return; }
    setTimeout(step, delayMs);
  }

  // Do one immediate step so the player sees the caravan start moving as soon
  // as they return to the overworld, then continue with a timed loop.
  try {
    const c = ctx && typeof ctx.getCtx === "function" ? ctx.getCtx() : ctx;
    const w = c && c.world;
    const escort = w && w.caravanEscort;
    if (escort && escort.active && c.mode === "world" && typeof c.turn === "function") {
      c.turn();
      steps++;
    }
  } catch (_) {}

  if (steps < maxSteps) {
    setTimeout(step, delayMs);
  } else {
    state.running = false;
  }
}

/**
 * Ensure caravans array exists on world.
 */
function ensureCaravanState(world) {
  if (!world.caravans) world.caravans = [];
}

/**
 * Get current global turn counter (for dwell timers). Falls back to 0 if unavailable.
 */
function getTurn(ctx) {
  try {
    if (ctx && ctx.time && typeof ctx.time.turnCounter === "number") {
      return ctx.time.turnCounter | 0;
    }
  } catch (_) {}
  return 0;
}

/**
 * Returns how many turns make up one in-game day. Defaults to 360 if not configured.
 */
function turnsPerDay(ctx) {
  try {
    if (ctx && ctx.time && typeof ctx.time.cycleTurns === "number") {
      return Math.max(1, ctx.time.cycleTurns | 0);
    }
  } catch (_) {}
  return 360;
}

/**
 * Get a RNG function suitable for world-level ambient systems (caravans etc.).
 * Prefers RNGUtils.getRng so behavior is deterministic per seed.
 */
function worldRng(ctx) {
  try {
    if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function") {
      const base = (typeof ctx.rng === "function") ? ctx.rng : undefined;
      return window.RNGUtils.getRng(base);
    }
  } catch (_) {}
  if (ctx && typeof ctx.rng === "function") return ctx.rng;
  return function () { return Math.random(); };
}

/**
 * Pick the nearest town (or castle) to the given world position that is not the same location.
 */
function pickNearestTown(world, wx, wy) {
  const towns = Array.isArray(world.towns) ? world.towns : [];
  if (!towns.length) return null;
  let best = null;
  let bestDist = Infinity;
  for (const t of towns) {
    if (!t) continue;
    const dx = (t.x | 0) - (wx | 0);
    const dy = (t.y | 0) - (wy | 0);
    const dist = Math.abs(dx) + Math.abs(dy);
    if (dist === 0) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = { x: t.x | 0, y: t.y | 0 };
    }
  }
  return best;
}

/**
 * Test walkability at world coordinates. When outside the current window, assume walkable so
 * caravans can keep moving even if the player is elsewhere.
 */
function isWalkableWorld(ctx, wx, wy) {
  try {
    const world = ctx.world;
    const map = ctx.map;
    if (!world || !Array.isArray(map) || !map.length) return true;
    const ox = (world.originX | 0) || 0;
    const oy = (world.originY | 0) || 0;
    const lx = wx - ox;
    const ly = wy - oy;
    const rows = map.length;
    const cols = rows ? (map[0] ? map[0].length : 0) : 0;
    if (ly < 0 || ly >= rows || lx < 0 || lx >= cols) {
      // Outside current window: treat as walkable; InfiniteGen already avoids extreme blockers.
      return true;
    }
    const tile = map[ly][lx];
    const W = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
    if (W && typeof W.isWalkable === "function") {
      return !!W.isWalkable(tile);
    }
  } catch (_) {}
  return true;
}

/**
 * Returns true if the given world coordinate is exactly on a town (or castle) tile.
 */
function isOnTownTile(world, wx, wy) {
  const towns = Array.isArray(world.towns) ? world.towns : [];
  for (const t of towns) {
    if (!t) continue;
    if ((t.x | 0) === (wx | 0) && (t.y | 0) === (wy | 0)) return true;
  }
  return false;
}

/**
 * Dynamically spawn caravans over time as the player reveals more of the world.
 * On every world turn there is a small global chance to spawn a caravan, as long
 * as there are at least two towns and the hard cap is not exceeded.
 */
function spawnCaravansIfNeeded(ctx) {
  const world = ctx.world;
  ensureCaravanState(world);
  const caravans = world.caravans;
  const towns = Array.isArray(world.towns) ? world.towns : [];
  if (!towns.length) return;

  const r = worldRng(ctx);
  const townCount = towns.length;
  const existing = Array.isArray(caravans) ? caravans.length : 0;

  // Hard cap so the world doesn't fill with caravans, but allow more caravans
  // when there are many towns so remote regions still see traffic.
  const maxCaravans = Math.max(8, Math.min(60, Math.floor(townCount * 1.2)));
  if (townCount < 2) return;
  if (existing >= maxCaravans) return;

  // Target density we would like to roughly maintain.
  const desired = Math.min(maxCaravans, Math.max(4, Math.floor(townCount * 0.8)));

  // Global per-turn spawn chance:
  // - Very high when there are no caravans yet, so the world doesn't feel empty.
  // - Higher while under desired density.
  // - Lower but non-zero when at/above desired density (up to the cap).
  let spawnChance;
  if (existing === 0) {
    spawnChance = 0.4;   // 40% chance each turn until first caravan appears
  } else if (existing < desired) {
    spawnChance = 0.14;  // 14% per world turn while under target
  } else {
    spawnChance = 0.04;  // 4% per world turn when at/above target but under cap
  }

  if (r() >= spawnChance) return;

  // Bias spawning toward towns near the player so cities you actually visit
  // are much more likely to see caravans.
  let px = null;
  let py = null;
  try {
    if (ctx.player && ctx.world && typeof ctx.player.x === "number" && typeof ctx.player.y === "number") {
      px = (ctx.world.originX | 0) + (ctx.player.x | 0);
      py = (ctx.world.originY | 0) + (ctx.player.y | 0);
    }
  } catch (_) {}

  // Helper: check if there is already a caravan currently parked at this town.
  function hasParkedCaravanAt(town) {
    if (!Array.isArray(caravans) || !caravans.length) return false;
    for (const cv of caravans) {
      if (!cv) continue;
      if (!cv.atTown) continue;
      if ((cv.x | 0) === (town.x | 0) && (cv.y | 0) === (town.y | 0)) return true;
    }
    return false;
  }

  // Try a few times to pick a suitable origin town (no parked caravan there,
  // and preferably close to the player if we know their world coords).
  let fromIdx = -1;
  let bestIdx = -1;
  let bestDist = Infinity;
  const attempts = Math.min(8, towns.length);

  for (let attempt = 0; attempt < attempts; attempt++) {
    const idx = (r() * towns.length) | 0;
    const t = towns[idx];
    if (!t) continue;
    if (hasParkedCaravanAt(t)) continue;

    if (px == null || py == null) {
      fromIdx = idx;
      break;
    }

    const dxp = (t.x | 0) - px;
    const dyp = (t.y | 0) - py;
    const distP = Math.abs(dxp) + Math.abs(dyp);
    if (distP < bestDist) {
      bestDist = distP;
      bestIdx = idx;
    }
  }

  if (fromIdx === -1) fromIdx = bestIdx;
  if (fromIdx === -1) return;

  spawnSingleCaravan(ctx, towns, caravans, fromIdx, r);
}

// Helper: spawn a single caravan from a specific town index toward another town.
// Usually chooses the nearest neighbour, but sometimes picks a far town so a few
// caravans travel longer routes across the map.
function spawnSingleCaravan(ctx, towns, caravans, fromIdx, r) {
  if (!Array.isArray(towns) || towns.length < 2) return false;
  const from = towns[fromIdx];
  if (!from) return false;

  // Find nearest and farthest other towns, based on Manhattan distance
  let nearest = null;
  let nearestDist = Infinity;
  let farthest = null;
  let farthestDist = -Infinity;

  for (let i = 0; i < towns.length; i++) {
    if (i === fromIdx) continue;
    const t = towns[i];
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

  if (!nearest) return false;

  // Default: nearest neighbour. With some chance, pick a far town so a subset
  // of caravans run long-haul routes.
  let destTown = nearest;
  try {
    const roll = (typeof r === "function") ? r() : Math.random();
    if (towns.length >= 4 && roll < 0.35 && farthest) {
      destTown = farthest;
    }
  } catch (_) {}

  const now = getTurn(ctx);
  const days = turnsPerDay(ctx);
  let idCounter = caravans.length ? caravans.length : 0;
  caravans.push({
    id: ++idCounter,
    x: from.x | 0,
    y: from.y | 0,
    from: { x: from.x | 0, y: from.y | 0 },
    dest: { x: destTown.x | 0, y: destTown.y | 0 },
    atTown: true,
    dwellUntil: now + 2 * days // start as parked for 2 days at origin
  });
  return true;
}

/**
 * Advance all caravans one step toward their current destination town.
 * Caravans are stored in world.caravans with world-space coordinates.
 * When they reach a town, they stay parked for a few in-game days (dwell) before moving on.
 */
function maybeEscortAmbush(ctx) {
  if (!ctx || ctx.mode !== "world" || !ctx.world) return;
  const world = ctx.world;
  const escort = world.caravanEscort || null;
  if (!escort || !escort.active || !Array.isArray(world.caravans) || !world.caravans.length) return;

  const cv = world.caravans.find(c => c && c.id === escort.id);
  if (!cv || !cv.atTown) {
    // Only trigger ambushes while the caravan is travelling between towns
  } else {
    return;
  }

  // Basic chance per world tick to trigger an ambush while escorting
  const r = worldRng(ctx);
  if (r() > 0.04) return; // ~4% per world tick

  // Start a caravan ambush encounter on the road
  try {
    const template = {
      id: "caravan_ambush",
      name: "Caravan Ambush",
      map: { w: 26, h: 16, generator: "caravan_road" },
      groups: [
        { faction: "guard", count: { min: 3, max: 4 }, type: "guard" },
        { faction: "guard", count: { min: 2, max: 3 }, type: "guard_elite" }
      ],
      objective: { type: "reachExit" },
      difficulty: ctx.encounterDifficulty || 4
    };
    const biome = "GRASS";

    let ok = false;
    // Preferred: GameAPI
    try {
      const GA = ctx.GameAPI || (typeof window !== "undefined" ? window.GameAPI : null);
      if (GA && typeof GA.enterEncounter === "function") {
        ok = !!GA.enterEncounter(template, biome, template.difficulty || 4);
      }
    } catch (_) {}

    // Fallback: EncounterRuntime directly
    if (!ok) {
      try {
        const ER = ctx.EncounterRuntime || getMod(ctx, "EncounterRuntime");
        if (ER && typeof ER.enter === "function") {
          ok = !!ER.enter(ctx, { template, biome, difficulty: template.difficulty || 4 });
        }
      } catch (_) {}
    }

    if (ok && ctx.log) {
      ctx.log("Bandits strike the caravan on the road!", "notice");
    }
  } catch (_) {}
}

function advanceCaravans(ctx) {
  const world = ctx.world;
  ensureCaravanState(world);
  const caravans = world.caravans;
  if (!Array.isArray(caravans) || !caravans.length) return;

  const escort = world.caravanEscort || null;
  const r = worldRng(ctx);

  const nowTurn = getTurn(ctx);
  const dayTurns = turnsPerDay(ctx);
  const minDwellDays = 2;
  const maxDwellDays = 4;

  for (const cv of caravans) {
    if (!cv) continue;

    // Initialize dwell metadata if missing
    if (typeof cv.dwellUntil !== "number") cv.dwellUntil = 0;
    if (typeof cv.atTown !== "boolean") cv.atTown = false;

    // If currently dwelling in a town, stay parked until the timer expires
    if (cv.atTown && nowTurn < (cv.dwellUntil | 0)) {
      continue;
    }

    // If dwell timer has expired or never set, clear atTown and choose next leg when at a town tile
    if (cv.atTown && nowTurn >= (cv.dwellUntil | 0)) {
      cv.atTown = false;
      // Force picking a new destination from this town
      cv.dest = pickNearestTown(world, cv.x | 0, cv.y | 0) || cv.dest;
    }

    // If destination missing or invalid, retarget to nearest town
    if (!cv.dest || typeof cv.dest.x !== "number" || typeof cv.dest.y !== "number") {
      const target = pickNearestTown(world, cv.x | 0, cv.y | 0);
      if (target) {
        cv.dest = target;
      } else {
        continue;
      }
    }

    const cx = cv.x | 0;
    const cy = cv.y | 0;
    const tx = cv.dest.x | 0;
    const ty = cv.dest.y | 0;

    // Track last position to detect stuck caravans across ticks.
    try {
      if (typeof cv.lastX !== "number") cv.lastX = cx;
      if (typeof cv.lastY !== "number") cv.lastY = cy;
    } catch (_) {}

    // Arrived at destination town: start a dwell period here and, if this is the
    // escorted caravan, pay the player and end the escort job.
    const arrivedNow = (cx === tx && cy === ty && isOnTownTile(world, cx, cy));
    if (arrivedNow) {
      cv.atTown = true;

      // If this caravan is being escorted, pay out the agreed reward once on arrival.
      try {
        if (escort && escort.active && escort.id === cv.id) {
          const reward = Math.max(1, (escort.reward | 0) || 0);
          if (reward > 0) {
            try {
              const GA = ctx.GameAPI || (typeof window !== "undefined" ? window.GameAPI : null);
              if (GA && typeof GA.addGold === "function") {
                GA.addGold(reward);
              } else if (ctx.player) {
                // Minimal fallback: push a gold item into player inventory.
                ctx.player.inventory = Array.isArray(ctx.player.inventory) ? ctx.player.inventory : [];
                ctx.player.inventory.push({ kind: "gold", amount: reward, name: `${reward} gold coins` });
              }
            } catch (_) {}
            try {
              ctx.log && ctx.log(`You safely escort the caravan to its destination and receive ${reward} gold.`, "good");
            } catch (_) {}
          }
          // Mark escort job as finished so auto-travel stops and future legs are independent.
          world.caravanEscort = { id: cv.id, reward: reward, active: false };
        }
      } catch (_) {}

      // Dwell for 2–4 in-game days at the destination town.
      const dwellDays = Math.max(minDwellDays, Math.min(maxDwellDays, (2 + (cx + cy) % 3) | 0));
      cv.dwellUntil = nowTurn + dwellDays * dayTurns;
      continue;
    }

    const dx = tx - cx;
    const dy = ty - cy;
    const stepX = dx === 0 ? 0 : (dx > 0 ? 1 : -1);
    const stepY = dy === 0 ? 0 : (dy > 0 ? 1 : -1);

    // Prefer axis with greater remaining distance, but fall back to the other if blocked.
    let nx = cx;
    let ny = cy;

    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    function tryStep(px, py) {
      if (px === cx && py === cy) return false;
      if (!isWalkableWorld(ctx, px, py)) return false;
      nx = px;
      ny = py;
      return true;
    }

    let moved = false;
    if (absDx >= absDy) {
      if (stepX && tryStep(cx + stepX, cy)) {
        moved = true;
      } else if (stepY && tryStep(cx, cy + stepY)) {
        moved = true;
      }
    } else {
      if (stepY && tryStep(cx, cy + stepY)) {
        moved = true;
      } else if (stepX && tryStep(cx + stepX, cy)) {
        moved = true;
      }
    }

    // As a last resort, try a simple sidestep to avoid getting stuck forever.
    if (!moved && (stepX || stepY)) {
      if (stepX && tryStep(cx + stepX, cy + (stepY || 0))) {
        moved = true;
      } else if (stepY && tryStep(cx + (stepX || 0), cy + stepY)) {
        moved = true;
      }
    }

    if (!moved) {
      // Simple nudge: if we failed to move this tick and the caravan also did not
      // move on the previous tick, try a small random step to avoid permanent stuck.
      try {
        const wasStuck = (typeof cv.lastX === "number" && typeof cv.lastY === "number" && cv.lastX === cx && cv.lastY === cy);
        if (wasStuck) {
          const dirs = [
            { dx: 1, dy: 0 },
            { dx: -1, dy: 0 },
            { dx: 0, dy: 1 },
            { dx: 0, dy: -1 },
          ];
          // Shuffle-like simple random pick order
          for (let i = 0; i < dirs.length; i++) {
            const j = (r() * dirs.length) | 0;
            const tmp = dirs[i];
            dirs[i] = dirs[j];
            dirs[j] = tmp;
          }
          for (let i = 0; i < dirs.length && !moved; i++) {
            const px = cx + dirs[i].dx;
            const py = cy + dirs[i].dy;
            if (tryStep(px, py)) {
              moved = true;
            }
          }
        }
      } catch (_) {}
    }

    if (moved) {
      cv.x = nx;
      cv.y = ny;
      try {
        cv.lastX = cx;
        cv.lastY = cy;
      } catch (_) {}

      // If the player is escorting this caravan and it is within the current window, move the player with it.
      try {
        if (escort && escort.active && escort.id === cv.id && Array.isArray(ctx.map) && ctx.map.length) {
          const ox = (world.originX | 0) || 0;
          const oy = (world.originY | 0) || 0;
          const lx = nx - ox;
          const ly = ny - oy;
          const rows = ctx.map.length;
          const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
          if (lx >= 0 && ly >= 0 && lx < cols && ly < rows) {
            ctx.player.x = lx;
            ctx.player.y = ly;
          }
        }
      } catch (_) {}
    } else {
      // Update last position even when staying still (no move succeeded).
      try {
        cv.lastX = cx;
        cv.lastY = cy;
      } catch (_) {}
    }
  }
}