import { getMod } from "../../utils/access.js";

function nowMs() {
  try {
    if (typeof performance !== "undefined" && performance && typeof performance.now === "function") {
      return performance.now();
    }
  } catch {
    return Date.now();
  }
  return Date.now();
}

function shouldLogWorldPerf(dtMs) {
  if (dtMs >= 6) return true;
  try {
    if (typeof window !== "undefined" && window.DEV) return true;
    if (typeof localStorage !== "undefined" && localStorage.getItem("DEV") === "1") return true;
  } catch {
    return false;
  }
  return false;
}

function logWorldPerf(details) {
  try {
    if (!shouldLogWorldPerf(details.dtMs)) return;
    const LG = (typeof window !== "undefined") ? window.Logger : null;
    const message = `[WorldTick] total=${details.dtMs.toFixed(1)}ms spawn=${details.spawnMs.toFixed(1)}ms advance=${details.advanceMs.toFixed(1)}ms escort=${details.escortMs.toFixed(1)}ms caravans=${details.caravans} towns=${details.towns}`;
    if (LG && typeof LG.log === "function") {
      LG.log(message, "notice", Object.assign({ category: "WorldTick", perf: "tick" }, details));
    } else if (typeof console !== "undefined" && typeof console.debug === "function") {
      console.debug(message, details);
    }
  } catch {
    return;
  }
}

/**
 * World tick (Phase 3 extraction): optional per-turn hook for overworld mode.
 * Currently:
 * - Advances travelling caravans on the overworld map (with town dwell times).
 */
export function tick(ctx) {
  if (!ctx || ctx.mode !== "world" || !ctx.world) return true;
  const t0 = nowMs();
  let spawnMs = 0;
  let advanceMs = 0;
  let escortMs = 0;

  try {
    const t = nowMs();
    spawnCaravansIfNeeded(ctx);
    spawnMs = nowMs() - t;
  } catch { /\* ignore \*/ }

  try {
    const t = nowMs();
    advanceCaravans(ctx);
    advanceMs = nowMs() - t;
  } catch { /\* ignore \*/ }

  // Escort ambush events: small chance each world tick while escorting
  try {
    const t = nowMs();
    maybeEscortAmbush(ctx);
    escortMs = nowMs() - t;
  } catch { /\* ignore \*/ }

  logWorldPerf({
    dtMs: nowMs() - t0,
    spawnMs,
    advanceMs,
    escortMs,
    caravans: Array.isArray(ctx.world.caravans) ? ctx.world.caravans.length : 0,
    towns: Array.isArray(ctx.world.towns) ? ctx.world.towns.length : 0
  });

  // Wandering merchants
  try {
    const tw = nowMs();
    spawnWanderersIfNeeded(ctx);
    advanceWanderers(ctx);
    const wandererMs = nowMs() - tw;
    if (shouldLogWorldPerf(wandererMs)) {
      try {
        const LG = (typeof window !== "undefined") ? window.Logger : null;
        const msg = `[WorldTick] wanderers=${wandererMs.toFixed(1)}ms count=${Array.isArray(ctx.world.wanderers) ? ctx.world.wanderers.length : 0}`;
        if (LG && typeof LG.log === "function") LG.log(msg, "notice", { category: "WorldTick", perf: "tick" });
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

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
    } catch { /\* ignore \*/ }
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
  } catch { /\* ignore \*/ }

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
  } catch { /\* ignore \*/ }
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
  } catch { /\* ignore \*/ }
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
  } catch { /\* ignore \*/ }
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
  } catch { /\* ignore \*/ }
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
  } catch { /\* ignore \*/ }

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
  } catch { /\* ignore \*/ }

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
    let synced = false;

    let applyCtxSyncAndRefresh = null;
    try {
      const GA = ctx.GameAPI || getMod(ctx, "GameAPI");
      if (GA && typeof GA.applyCtxSyncAndRefresh === "function") {
        applyCtxSyncAndRefresh = GA.applyCtxSyncAndRefresh;
      }
    } catch { /\* ignore \*/ }

    // Prefer ctx-first entry via Modes (no ctx reacquire).
    try {
      const M = ctx.Modes || getMod(ctx, "Modes");
      if (M && typeof M.enterEncounter === "function") {
        ok = !!M.enterEncounter(ctx, template, biome, template.difficulty || 4, applyCtxSyncAndRefresh || undefined);
        if (ok) synced = true;
      }
    } catch { /\* ignore \*/ }

    // Fallback: EncounterRuntime directly
    if (!ok) {
      try {
        const ER = ctx.EncounterRuntime || getMod(ctx, "EncounterRuntime");
        if (ER && typeof ER.enter === "function") {
          ok = !!ER.enter(ctx, { template, biome, difficulty: template.difficulty || 4 });
        }
      } catch { /\* ignore \*/ }
    }

    if (ok && !synced) {
      try {
        if (typeof applyCtxSyncAndRefresh === "function") {
          applyCtxSyncAndRefresh(ctx);
          synced = true;
        }
      } catch { /\* ignore \*/ }
    }

    if (ok && ctx.log) {
      ctx.log("Bandits strike the caravan on the road!", "notice");
    }
  } catch { /\* ignore \*/ }
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
    } catch { /\* ignore \*/ }

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
            } catch { /\* ignore \*/ }
            try {
              ctx.log && ctx.log(`You safely escort the caravan to its destination and receive ${reward} gold.`, "good");
            } catch { /\* ignore \*/ }
          }
          // Mark escort job as finished so auto-travel stops and future legs are independent.
          world.caravanEscort = { id: cv.id, reward: reward, active: false };
        }
      } catch { /\* ignore \*/ }

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
      } catch { /\* ignore \*/ }
    }

    if (moved) {
      cv.x = nx;
      cv.y = ny;
      try {
        cv.lastX = cx;
        cv.lastY = cy;
      } catch { /\* ignore \*/ }

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
      } catch { /\* ignore \*/ }
    } else {
      // Update last position even when staying still (no move succeeded).
      try {
        cv.lastX = cx;
        cv.lastY = cy;
      } catch { /\* ignore \*/ }
    }
  }
}

// ---------------------------------------------------------------------------
// Wandering merchants
// ---------------------------------------------------------------------------

function getWandererConfig() {
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    if (GD && GD.wanderers && typeof GD.wanderers === "object") return GD.wanderers;
  } catch { /* ignore */ }
  return null;
}

function ensureWandererState(world) {
  if (!world.wanderers) world.wanderers = [];
}

function spawnWanderersIfNeeded(ctx) {
  const world = ctx.world;
  ensureWandererState(world);
  const wanderers = world.wanderers;
  const towns = Array.isArray(world.towns) ? world.towns : [];

  const cfg = getWandererConfig();
  const merchants = (cfg && Array.isArray(cfg.merchants)) ? cfg.merchants : [];
  const maxActive = (cfg && typeof cfg.maxActive === "number") ? cfg.maxActive : 3;
  const minTowns = (cfg && typeof cfg.minTowns === "number") ? cfg.minTowns : 2;
  const spawnChance = (cfg && typeof cfg.spawnChancePerTick === "number") ? cfg.spawnChancePerTick : 0.008;

  if (towns.length < minTowns) return;
  if (wanderers.length >= maxActive) return;
  if (!merchants.length) return;

  const r = worldRng(ctx);
  if (r() >= spawnChance) return;

  // Pick a merchant archetype weighted by weight field
  let totalWeight = 0;
  for (let i = 0; i < merchants.length; i++) {
    totalWeight += (merchants[i].weight || 1);
  }
  let roll = r() * totalWeight;
  let archetype = merchants[0];
  for (let i = 0; i < merchants.length; i++) {
    roll -= (merchants[i].weight || 1);
    if (roll <= 0) { archetype = merchants[i]; break; }
  }

  // Pick a spawn town near the player
  let px = null;
  let py = null;
  try {
    if (ctx.player && ctx.world && typeof ctx.player.x === "number" && typeof ctx.player.y === "number") {
      px = (ctx.world.originX | 0) + (ctx.player.x | 0);
      py = (ctx.world.originY | 0) + (ctx.player.y | 0);
    }
  } catch { /* ignore */ }

  let bestIdx = -1;
  let bestDist = Infinity;
  const attempts = Math.min(8, towns.length);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const idx = (r() * towns.length) | 0;
    const t = towns[idx];
    if (!t) continue;
    if (px == null || py == null) { bestIdx = idx; break; }
    const dx = (t.x | 0) - px;
    const dy = (t.y | 0) - py;
    const dist = Math.abs(dx) + Math.abs(dy);
    if (dist < bestDist) { bestDist = dist; bestIdx = idx; }
  }
  if (bestIdx === -1) return;

  const from = towns[bestIdx];
  const dest = pickNearestTown(world, from.x | 0, from.y | 0);
  if (!dest) return;

  const now = getTurn(ctx);
  wanderers.push({
    id: `wanderer_${now}_${wanderers.length}`,
    archetypeId: archetype.id || "traveling_merchant",
    name: archetype.name || "Traveling Merchant",
    glyph: archetype.glyph || "M",
    color: archetype.color || "#FFD700",
    shopPool: archetype.shopPool || "wandering_merchant",
    x: from.x | 0,
    y: from.y | 0,
    from: { x: from.x | 0, y: from.y | 0 },
    dest: { x: dest.x | 0, y: dest.y | 0 },
    atTown: true,
    dwellUntil: now + ((archetype.dwellTurns && archetype.dwellTurns.min) || 60),
    townsVisited: 1,
    maxTownsVisited: archetype.maxTownsVisited || 3,
    spawnTurn: now,
    dialogue: archetype.dialogue || {},
  });
}

function advanceWanderers(ctx) {
  const world = ctx.world;
  ensureWandererState(world);
  const wanderers = world.wanderers;
  if (!wanderers.length) return;

  const r = worldRng(ctx);
  const nowT = getTurn(ctx);

  // Process in reverse so we can splice expired wanderers
  for (let i = wanderers.length - 1; i >= 0; i--) {
    const w = wanderers[i];
    if (!w) { wanderers.splice(i, 1); continue; }

    // Initialize if missing
    if (typeof w.dwellUntil !== "number") w.dwellUntil = 0;
    if (typeof w.atTown !== "boolean") w.atTown = false;
    if (typeof w.townsVisited !== "number") w.townsVisited = 0;

    // If dwelling at a town, wait
    if (w.atTown && nowT < (w.dwellUntil | 0)) continue;

    // Dwell expired at town: pick next destination or despawn
    if (w.atTown && nowT >= (w.dwellUntil | 0)) {
      w.atTown = false;
      if ((w.townsVisited | 0) >= (w.maxTownsVisited | 0)) {
        // Reached max towns, despawn
        wanderers.splice(i, 1);
        continue;
      }
      w.dest = pickNearestTown(world, w.x | 0, w.y | 0) || w.dest;
    }

    // Validate destination
    if (!w.dest || typeof w.dest.x !== "number" || typeof w.dest.y !== "number") {
      const target = pickNearestTown(world, w.x | 0, w.y | 0);
      if (target) { w.dest = target; } else { continue; }
    }

    const cx = w.x | 0;
    const cy = w.y | 0;
    const tx = w.dest.x | 0;
    const ty = w.dest.y | 0;

    // Arrived at destination town
    if (cx === tx && cy === ty && isOnTownTile(world, cx, cy)) {
      w.atTown = true;
      w.townsVisited = (w.townsVisited | 0) + 1;

      const cfg = getWandererConfig();
      const merchants = (cfg && Array.isArray(cfg.merchants)) ? cfg.merchants : [];
      const arch = merchants.find(m => m.id === w.archetypeId) || {};
      const dMin = (arch.dwellTurns && arch.dwellTurns.min) || 60;
      const dMax = (arch.dwellTurns && arch.dwellTurns.max) || 120;
      w.dwellUntil = nowT + dMin + ((r() * (dMax - dMin + 1)) | 0);
      continue;
    }

    // Move toward destination (same algorithm as caravans)
    const dx = tx - cx;
    const dy = ty - cy;
    const stepX = dx === 0 ? 0 : (dx > 0 ? 1 : -1);
    const stepY = dy === 0 ? 0 : (dy > 0 ? 1 : -1);

    let nx = cx;
    let ny = cy;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    function tryStep(px, py) {
      if (px === cx && py === cy) return false;
      if (!isWalkableWorld(ctx, px, py)) return false;
      nx = px; ny = py;
      return true;
    }

    let moved = false;
    if (absDx >= absDy) {
      if (stepX && tryStep(cx + stepX, cy)) moved = true;
      else if (stepY && tryStep(cx, cy + stepY)) moved = true;
    } else {
      if (stepY && tryStep(cx, cy + stepY)) moved = true;
      else if (stepX && tryStep(cx + stepX, cy)) moved = true;
    }

    if (!moved && (stepX || stepY)) {
      if (stepX && tryStep(cx + stepX, cy + (stepY || 0))) moved = true;
      else if (stepY && tryStep(cx + (stepX || 0), cy + stepY)) moved = true;
    }

    if (moved) {
      w.x = nx;
      w.y = ny;
    }
  }
}
