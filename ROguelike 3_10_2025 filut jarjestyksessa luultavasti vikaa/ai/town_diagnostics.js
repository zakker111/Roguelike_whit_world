/**
 * Town diagnostics: home route reachability and late-night shelter checks.
 *
 * Exports:
 *  - checkHomeRoutes(ctx, opts?)
 *
 * Notes:
 *  - This is used by the GOD panel and smoketest; it is not on the hot turn path.
 *  - Helpers here are copies of a few TownAI helpers, kept local to avoid
 *    pulling in the entire runtime module.
 */

import { computePath } from "./pathfinding.js";

// --- Minimal helpers copied from town_ai.js for diagnostics ---

function isWalkTown(ctx, x, y) {
  const { map, TILES } = ctx;
  if (y &lt; 0 || y &gt;= map.length) return false;
  if (x &lt; 0 || x &gt;= (map[0] ? map[0].length : 0)) return false;
  const t = map[y][x];
  return t === TILES.FLOOR || t === TILES.DOOR || t === TILES.ROAD;
}

function insideBuilding(b, x, y) {
  return x &gt; b.x && x &lt; b.x + b.w - 1 && y &gt; b.y && y &lt; b.y + b.h - 1;
}

function propBlocks(type) {
  // Only these props block movement: table, shelf, counter.
  // Everything else is walkable (sign, rug, bed, chair, fireplace, chest, crate, barrel, plant, stall, lamp, well, bench).
  const t = String(type || "").toLowerCase();
  return t === "table" || t === "shelf" || t === "counter";
}

// Fast occupancy-aware free-tile check for diagnostics.
// Uses ctx._occ if present; otherwise scans NPCs and blocking props.
function isFreeTile(ctx, x, y) {
  if (!isWalkTown(ctx, x, y)) return false;
  const { player, npcs, townProps } = ctx;
  if (player.x === x && player.y === y) return false;
  const occ = ctx._occ;
  if (occ && occ.has(`${x},${y}`)) return false;
  if (!occ && Array.isArray(npcs) && npcs.some(n =&gt; n.x === x && n.y === y)) return false;
  if (Array.isArray(townProps) && townProps.some(p =&gt; p.x === x && p.y === y && propBlocks(p.type))) return false;
  return true;
}

function nearestFreeAdjacent(ctx, x, y, constrainToBuilding = null) {
  const dirs = [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
    { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
    { dx: 1, dy: 1 }, { dx: 1, dy: -1 },
    { dx: -1, dy: 1 }, { dx: -1, dy: -1 },
  ];
  for (const d of dirs) {
    const nx = x + d.dx;
    const ny = y + d.dy;
    if (constrainToBuilding && !insideBuilding(constrainToBuilding, nx, ny)) continue;
    if (isFreeTile(ctx, nx, ny)) return { x: nx, y: ny };
  }
  return null;
}

// If the intended target tile is occupied by an interior prop (e.g., bed),
// pick the nearest free interior tile adjacent to it within the same building.
function adjustInteriorTarget(ctx, building, target) {
  if (!target || !building) return target;
  // If target is already free, keep it
  if (isFreeTile(ctx, target.x, target.y) && insideBuilding(building, target.x, target.y)) return target;
  const alt = nearestFreeAdjacent(ctx, target.x, target.y, building);
  return alt || target;
}

// Lightweight helpers for assigning a home when missing (diagnostics only)

function randInt(ctx, a, b) {
  const r = (typeof ctx.rng === "function") ? ctx.rng() : 0.5;
  return Math.floor(r * (b - a + 1)) + a;
}

function randomInteriorSpot(ctx, b) {
  const { map, townProps } = ctx;
  const spots = [];
  for (let y = b.y + 1; y &lt; b.y + b.h - 1; y++) {
    for (let x = b.x + 1; x &lt; b.x + b.w - 1; x++) {
      if (map[y][x] !== ctx.TILES.FLOOR) continue;
      if (townProps.some(p =&gt; p.x === x && p.y === y)) continue;
      spots.push({ x, y });
    }
  }
  if (!spots.length) return null;
  return spots[randInt(ctx, 0, spots.length - 1)];
}

function ensureHome(ctx, n) {
  if (n._home) return;
  const { townBuildings, shops, townPlaza } = ctx;
  if (!Array.isArray(townBuildings) || townBuildings.length === 0) return;
  const b = townBuildings[randInt(ctx, 0, townBuildings.length - 1)];
  const pos = randomInteriorSpot(ctx, b) || { x: b.door.x, y: b.door.y };
  n._home = { building: b, x: pos.x, y: pos.y, door: { x: b.door.x, y: b.door.y } };
  if (shops && shops.length && typeof ctx.rng === "function" && ctx.rng() &lt; 0.6) {
    const s = shops[randInt(ctx, 0, shops.length - 1)];
    n._work = { x: s.x, y: s.y };
  } else if (townPlaza) {
    n._work = {
      x: Math.max(1, Math.min(ctx.map[0].length - 2, townPlaza.x + randInt(ctx, -2, 2))),
      y: Math.max(1, Math.min(ctx.map.length - 2, townPlaza.y + randInt(ctx, -2, 2))),
    };
  }
  // Assign a personalized home-depart minute within 18:00-21:00 to stagger returns
  if (typeof n._homeDepartMin !== "number") {
    n._homeDepartMin = randInt(ctx, 18 * 60, 21 * 60); // 1080..1260
  }
}

// --- Diagnostics: home routes and shelter ---

export function checkHomeRoutes(ctx, opts = {}) {
  const res = { total: 0, reachable: 0, unreachable: 0, skipped: 0, details: [] };
  const npcs = Array.isArray(ctx.npcs) ? ctx.npcs : [];

  // Track resident presence and type counts
  let residentsTotal = 0, residentsAtHome = 0, residentsAtTavern = 0;
  let shopkeepersTotal = 0, greetersTotal = 0, petsTotal = 0, guardsTotal = 0;
  const tavernB = (ctx.tavern && ctx.tavern.building) ? ctx.tavern.building : null;

  // Inn/tavern occupancy across all NPCs (not just residents)
  let innOccupancyAny = 0;
  let innSleepingAny = 0;
  const sleepersAtTavern = [];

  // Late-night window determination (02:00–05:00)
  const t = ctx.time;
  const minutes = t ? (t.hours * 60 + t.minutes) : 12 * 60;
  const LATE_START = 2 * 60, LATE_END = 5 * 60;
  const inLateWindow = minutes >= LATE_START && minutes &lt; LATE_END;
  const residentsAwayLate = [];

  // Helper: skip NPCs that are not expected to have homes (e.g., pets)
  function shouldSkip(n) {
    return !!n.isPet;
  }

  // Occupancy for theoretical pathing: ignore props entirely so we only test map geometry (walls/doors)
  const emptyOcc = new Set();

  function computeHomePathStandalone(ctx, n) {
    if (!n._home || !n._home.building) return null;
    const B = n._home.building;
    let targetInside = n._home.bed ? { x: n._home.bed.x, y: n._home.bed.y } : { x: n._home.x, y: n._home.y };
    targetInside = adjustInteriorTarget(ctx, B, targetInside);

    const insideNow = insideBuilding(B, n.x, n.y);
    if (!insideNow) {
      const door = B.door || nearestFreeAdjacent(ctx, B.x + ((B.w / 2) | 0), B.y, null);
      if (!door) return null;
      const p1 = computePath(ctx, emptyOcc, n.x, n.y, door.x, door.y);

      // pick a spot just inside the building for stage 2
      let inSpot = nearestFreeAdjacent(ctx, door.x, door.y, B);
      if (!inSpot) {
        // deterministic fallback: first free interior spot
        for (let y = B.y + 1; y &lt; B.y + B.h - 1 && !inSpot; y++) {
          for (let x = B.x + 1; x &lt; B.x + B.w - 1 && !inSpot; x++) {
            if (ctx.map[y][x] !== ctx.TILES.FLOOR) continue;
            inSpot = { x, y };
          }
        }
      }
      inSpot = inSpot || targetInside || { x: door.x, y: door.y };
      const p2 = computePath(ctx, emptyOcc, inSpot.x, inSpot.y, targetInside.x, targetInside.y);

      // concat without duplicating the connecting node
      const path = (function concatPaths(a, b) {
        if (!a || !b) return a || b || null;
        if (a.length === 0) return b.slice(0);
        if (b.length === 0) return a.slice(0);
        const res0 = a.slice(0);
        const firstB = b[0];
        const lastA = a[a.length - 1];
        const skipFirst = (firstB.x === lastA.x && firstB.y === lastA.y);
        for (let i = skipFirst ? 1 : 0; i &lt; b.length; i++) res0.push(b[i]);
        return res0;
      })(p1, p2);
      // Treat a 1-node path as "already at home"
      return (path && path.length >= 1) ? path : null;
    } else {
      const path = computePath(ctx, emptyOcc, n.x, n.y, targetInside.x, targetInside.y);
      // Treat a 1-node path as "already at home"
      return (path && path.length >= 1) ? path : null;
    }
  }

  for (let i = 0; i &lt; npcs.length; i++) {
    const n = npcs[i];

    // Type counters
    if (n.isShopkeeper || n._shopRef) shopkeepersTotal++;
    if (n.greeter) greetersTotal++;
    if (n.isPet) petsTotal++;
    if (n.isGuard) guardsTotal++;

    // Inn/tavern occupancy across all NPCs
    const atTavernNowAny = tavernB && insideBuilding(tavernB, n.x, n.y);
    if (atTavernNowAny) {
      innOccupancyAny++;
      if (n._sleeping) {
        innSleepingAny++;
        sleepersAtTavern.push({
          index: i,
          name: typeof n.name === "string" ? n.name : `NPC ${i + 1}`,
          x: n.x,
          y: n.y,
        });
      }
    }

    // Count residents' current locations
    if (n.isResident) {
      residentsTotal++;
      const atHomeNow = n._home && n._home.building && insideBuilding(n._home.building, n.x, n.y);
      const atTavernNow = tavernB && insideBuilding(tavernB, n.x, n.y);
      if (atHomeNow) residentsAtHome++;
      else if (atTavernNow) residentsAtTavern++;
      // Late-night away list
      if (inLateWindow && !atHomeNow && !atTavernNow) {
        residentsAwayLate.push({
          index: i,
          name: typeof n.name === "string" ? n.name : `Resident ${i + 1}`,
          x: n.x,
          y: n.y,
        });
      }
    }

    if (shouldSkip(n)) {
      res.skipped++;
      continue;
    }

    // Ensure each NPC has a home before checking, so diagnostics can attach homes to roamers.
    try {
      ensureHome(ctx, n);
    } catch (_) {
      // ignore
    }

    if (!n._home || !n._home.building) {
      res.unreachable++;
      res.details.push({
        index: i,
        name: typeof n.name === "string" ? n.name : `NPC ${i + 1}`,
        reason: "no-home",
      });
      continue;
    }

    const path = computeHomePathStandalone(ctx, n);
    if (path && path.length >= 1) {
      res.reachable++;
      // store for render if desired
      n._homeDebugPath = path.slice(0);
    } else {
      res.unreachable++;
      n._homeDebugPath = null;
      res.details.push({
        index: i,
        name: typeof n.name === "string" ? n.name : `NPC ${i + 1}`,
        reason: "no-path",
      });
    }
  }

  // total = checked NPCs (excluding skipped like pets)
  res.total = Math.max(0, npcs.length - res.skipped);
  res.residents = { total: residentsTotal, atHome: residentsAtHome, atTavern: residentsAtTavern };
  res.residentsAwayLate = residentsAwayLate;

  // Tavern summary for GOD panel (all NPCs)
  res.tavern = { any: innOccupancyAny, sleeping: innSleepingAny };
  res.sleepersAtTavern = sleepersAtTavern;

  // Type breakdown (for GOD panel diagnostics)
  const roamersTotal = Math.max(0, res.total - residentsTotal - shopkeepersTotal - greetersTotal - guardsTotal);
  res.counts = {
    npcTotal: npcs.length,
    checkedTotal: res.total,
    pets: petsTotal,
    residentsTotal,
    shopkeepersTotal,
    greetersTotal,
    guardsTotal,
    roamersTotal,
  };

  return res;
}