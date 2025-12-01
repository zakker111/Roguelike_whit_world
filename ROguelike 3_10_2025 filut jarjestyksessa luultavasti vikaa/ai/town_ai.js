/**
 * TownAI
 * Handles town NPC population, scheduling, pathing, and per-turn routines.
 *
 * Exports (ESM + window.TownAI):
 *  - populateTown(ctx): spawn shopkeepers, residents, pets, greeters
 *  - townNPCsAct(ctx): per-turn movement and routines
 *  - checkHomeRoutes(ctx): diagnostics for reachability to homes (and late-night shelter)
 *
 * How it's structured
 * - Schedules: shop hours and day phases decide intent (work, plaza, home, tavern).
 * - Pathfinding: budgeted A* (computePathBudgeted) + greedy nudge to avoid CPU spikes in dense towns.
 * - Movement: stepTowards consumes planned paths; waits and recomputes when blocked.
 * - Populate: assigns homes/work; residents get beds if present and staggered return times.
 * - Diagnostics: optional debug paths for home and current destination help visualize routing.
 *
 * Performance notes
 * - Pathfinding budget scales with NPC count; MAX_VISITS prevents worst-case traversal bursts.
 * - Runtime occupancy considers blocking props; relaxed occupancy is used only for debug visualization.
 */

import { getGameData, getRNGUtils, getMod } from "../utils/access.js";
import { computePath, computePathBudgeted } from "./pathfinding.js";

  function randInt(ctx, a, b) { return Math.floor(ctx.rng() * (b - a + 1)) + a; }
  function manhattan(ax, ay, bx, by) { return Math.abs(ax - bx) + Math.abs(ay - by); }

  // Seeded RNG helper: prefers RNGUtils.getRng(ctx.rng), falls back to ctx.rng; deterministic when unavailable
  function rngFor(ctx) {
    try {
      const RU = getRNGUtils(ctx);
      if (RU && typeof RU.getRng === "function") {
        return RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined);
      }
    } catch (_) {}
    if (typeof ctx.rng === "function") return ctx.rng;
    // Deterministic fallback: constant function
    return () => 0.5;
  }

  // ---- Schedules ----
  function inWindow(start, end, m, dayMinutes) {
    return (end > start) ? (m >= start && m < end) : (m >= start || m < end);
  }
  function isOpenAt(shop, minutes, dayMinutes) {
    if (!shop) return false;
    if (shop.alwaysOpen) return true;
    if (typeof shop.openMin !== "number" || typeof shop.closeMin !== "number") return false;
    const o = shop.openMin, c = shop.closeMin;
    if (o === c) return false;
    return inWindow(o, c, minutes, dayMinutes);
  }

  // ---- Movement/pathing ----
  function isWalkTown(ctx, x, y) {
    const { map, TILES } = ctx;
    if (y < 0 || y >= map.length) return false;
    if (x < 0 || x >= (map[0] ? map[0].length : 0)) return false;
    const t = map[y][x];
    return t === TILES.FLOOR || t === TILES.DOOR || t === TILES.ROAD;
  }

  function insideBuilding(b, x, y) {
    return x > b.x && x < b.x + b.w - 1 && y > b.y && y < b.y + b.h - 1;
  }

  function propBlocks(type) {
    // Only these props block movement: table, shelf, counter.
    // Everything else is walkable (sign, rug, bed, chair, fireplace, chest, crate, barrel, plant, stall, lamp, well, bench).
    const t = String(type || "").toLowerCase();
    return t === "table" || t === "shelf" || t === "counter";
  }

  // ---- Inn upstairs helpers (overlay-aware pathing/seating) ----
  function innUpstairsRect(ctx) {
    const tav = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
    const up = ctx.innUpstairs;
    if (!tav || !up) return null;
    const ox = up.offset ? up.offset.x : (tav.x + 1);
    const oy = up.offset ? up.offset.y : (tav.y + 1);
    return { x0: ox, y0: oy, x1: ox + (up.w | 0) - 1, y1: oy + (up.h | 0) - 1, w: (up.w | 0), h: (up.h | 0) };
  }
  function inUpstairsInterior(ctx, x, y) {
    const r = innUpstairsRect(ctx);
    if (!r) return false;
    return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
  }
  function upstairsTileAt(ctx, x, y) {
    const up = ctx.innUpstairs;
    const r = innUpstairsRect(ctx);
    if (!up || !r) return null;
    const lx = x - r.x0, ly = y - r.y0;
    if (lx < 0 || ly < 0 || lx >= r.w || ly >= r.h) return null;
    const row = (up.tiles && up.tiles[ly]) ? up.tiles[ly] : null;
    if (!row) return null;
    return row[lx];
  }
  function isWalkInnUpstairs(ctx, x, y, occUp) {
    if (!inUpstairsInterior(ctx, x, y)) return false;
    const t = upstairsTileAt(ctx, x, y);
    if (t == null) return false;
    const T = ctx.TILES;
    const walk = (t === T.FLOOR || t === T.STAIRS);
    if (!walk) return false;
    if (occUp && occUp.has(`${x},${y}`)) return false;
    return true;
  }
  function buildOccUpstairs(ctx) {
    const s = new Set();
    const up = ctx.innUpstairs;
    const tav = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
    if (!up || !tav) return s;
    // Block upstairs props except signs/rugs
    try {
      const props = Array.isArray(up.props) ? up.props : [];
      for (const p of props) {
        if (!p) continue;
        if (propBlocks(p.type)) s.add(`${p.x},${p.y}`);
      }
    } catch (_) {}
    // Block upstairs NPCs (those with _floor === "upstairs") at their coordinates
    try {
      const npcs = Array.isArray(ctx.npcs) ? ctx.npcs : [];
      for (const n of npcs) {
        if (!n) continue;
        if (n._floor === "upstairs") s.add(`${n.x},${n.y}`);
      }
    } catch (_) {}
    return s;
  }
  function nearestFreeAdjacentUpstairs(ctx, x, y, occUp) {
    const dirs = [{dx:0,dy:0},{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1},{dx:1,dy:1},{dx:1,dy:-1},{dx:-1,dy:1},{dx:-1,dy:-1}];
    for (const d of dirs) {
      const nx = x + d.dx, ny = y + d.dy;
      if (isWalkInnUpstairs(ctx, nx, ny, occUp)) return { x: nx, y: ny };
    }
    return null;
  }
  // Return raw upstairs bed tiles (stand directly on the bed tile when sleeping)
  function innUpstairsBedAdj(ctx) {
    const up = ctx.innUpstairs;
    if (!up) return [];
    const out = [];
    const props = Array.isArray(up.props) ? up.props : [];
    for (const p of props) {
      if (!p) continue;
      if (String(p.type || "").toLowerCase() === "bed") out.push({ x: p.x, y: p.y });
    }
    return out;
  }
  function innUpstairsSeatAdj(ctx) {
    const up = ctx.innUpstairs;
    if (!up) return [];
    const occUp = buildOccUpstairs(ctx);
    const out = [];
    const props = Array.isArray(up.props) ? up.props : [];
    for (const p of props) {
      const t = String(p.type || "").toLowerCase();
      if (t !== "chair" && t !== "table") continue;
      const adj = nearestFreeAdjacentUpstairs(ctx, p.x, p.y, occUp);
      if (adj) out.push(adj);
    }
    return out;
  }
  function chooseInnUpstairsBed(ctx) {
    // Choose directly on a bed tile upstairs
    const beds = innUpstairsBeds(ctx);
    if (!beds.length) return null;
    const rnd = rngFor(ctx);
    return beds[Math.floor(rnd() * beds.length)];
  }
  function chooseInnUpstairsSeat(ctx) {
    const seats = innUpstairsSeatAdj(ctx);
    if (!seats.length) return null;
    const rnd = rngFor(ctx);
    return seats[Math.floor(rnd() * seats.length)];
  }

  // Raw upstairs bed tiles (props positions), used for proximity checks to decide sleeping
  function innUpstairsBeds(ctx) {
    const up = ctx.innUpstairs;
    if (!up || !Array.isArray(up.props)) return [];
    const out = [];
    for (const p of up.props) {
      if (!p) continue;
      if (String(p.type || "").toLowerCase() === "bed") out.push({ x: p.x, y: p.y });
    }
    return out;
  }

  // A* restricted to upstairs interior using overlay tiles
  function computePathUpstairs(ctx, occUp, sx, sy, tx, ty) {
    const r = innUpstairsRect(ctx);
    if (!r) return null;
    const inB = (x, y) => x >= r.x0 && y >= r.y0 && x <= r.x1 && y <= r.y1;
    const dirs4 = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
    const key = (x, y) => `${x},${y}`;
    const h = (x, y) => Math.abs(x - tx) + Math.abs(y - ty);

    const open = [];
    const gScore = new Map();
    const fScore = new Map();
    const cameFrom = new Map();
    const startK = key(sx, sy);
    gScore.set(startK, 0);
    fScore.set(startK, h(sx, sy));
    open.push({ x: sx, y: sy, f: fScore.get(startK) });

    const MAX_VISITS = 4000;
    const visited = new Set();

    function pushOpen(x, y, f) { open.push({ x, y, f }); }
    function popOpen() {
      if (open.length > 24) open.sort((a, b) => a.f - b.f || h(a.x, a.y) - h(b.x, b.y));
      return open.shift();
    }

    let found = null;
    while (open.length && visited.size < MAX_VISITS) {
      const cur = popOpen();
      const ck = key(cur.x, cur.y);
      if (visited.has(ck)) continue;
      visited.add(ck);
      if (cur.x === tx && cur.y === ty) { found = cur; break; }

      for (const d of dirs4) {
        const nx = cur.x + d.dx, ny = cur.y + d.dy;
        if (!inB(nx, ny)) continue;
        if (!isWalkInnUpstairs(ctx, nx, ny, occUp)) continue;

        const nk = key(nx, ny);
        const tentativeG = (gScore.get(ck) ?? Infinity) + 1;
        if (tentativeG < (gScore.get(nk) ?? Infinity)) {
          cameFrom.set(nk, { x: cur.x, y: cur.y });
          gScore.set(nk, tentativeG);
          const f = tentativeG + h(nx, ny);
          fScore.set(nk, f);
          pushOpen(nx, ny, f);
        }
      }
    }

    if (!found) return null;

    const path = [];
    let cur = { x: found.x, y: found.y };
    while (cur) {
      path.push({ x: cur.x, y: cur.y });
      const prev = cameFrom.get(key(cur.x, cur.y));
      cur = prev ? { x: prev.x, y: prev.y } : null;
    }
    path.reverse();
    return path;
  }

  // Fast occupancy-aware free-tile check:
  // If ctx._occ is provided (Set of "x,y"), prefer it over O(n) scans of npcs.
  function isFreeTile(ctx, x, y) {
    if (!isWalkTown(ctx, x, y)) return false;
    const { player, npcs, townProps } = ctx;
    if (player.x === x && player.y === y) return false;
    const occ = ctx._occ;
    if (occ && occ.has(`${x},${y}`)) return false;
    if (!occ && Array.isArray(npcs) && npcs.some(n => n.x === x && n.y === y)) return false;
    if (Array.isArray(townProps) && townProps.some(p => p.x === x && p.y === y && propBlocks(p.type))) return false;
    return true;
  }

  function nearestFreeAdjacent(ctx, x, y, constrainToBuilding = null) {
    const dirs = [{dx:0,dy:0},{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1},{dx:1,dy:1},{dx:1,dy:-1},{dx:-1,dy:1},{dx:-1,dy:-1}];
    for (const d of dirs) {
      const nx = x + d.dx, ny = y + d.dy;
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

  // Pathfinding helpers (extracted to dedicated module)

  // ---- Pathfinding budget/throttling ----
  // Limit the number of A* computations per tick to avoid CPU spikes in dense towns.
  // The budget scales with NPC count but is clamped so very large towns don't stall turns.
  const PATH_BUDGET_MIN = 6;
  const PATH_BUDGET_MAX = 32;

  function initPathBudget(ctx, npcCount) {
    const phaseNow = (ctx && ctx.time && ctx.time.phase) ? String(ctx.time.phase) : "day";
    // Baseline fraction of NPCs allowed to request full A* per tick.
    const baseFrac = (phaseNow === "day") ? 0.26 : 0.18;
    const approx = Math.max(1, Math.floor(npcCount * baseFrac));
    const defaultBudget = Math.max(
      PATH_BUDGET_MIN,
      Math.min(PATH_BUDGET_MAX, approx)
    );
    const configured = (typeof ctx.townPathBudget === "number")
      ? Math.max(0, ctx.townPathBudget | 0)
      : null;
    ctx._townPathBudgetRemaining =
      (configured != null)
        ? Math.max(PATH_BUDGET_MIN, Math.min(PATH_BUDGET_MAX, configured))
        : defaultBudget;
  }

  function stepTowards(ctx, occ, n, tx, ty, opts = {}) {
    if (typeof tx !== "number" || typeof ty !== "number") return false;

    // Consume existing plan if valid and targeted to the same goal
    if (n._plan && n._planGoal && n._planGoal.x === tx && n._planGoal.y === ty) {
      // Ensure current position matches first node
      if (n._plan.length && (n._plan[0].x !== n.x || n._plan[0].y !== n.y)) {
        const idx = n._plan.findIndex(p => p.x === n.x && p.y === n.y);
        if (idx >= 0) {
          n._plan = n._plan.slice(idx);
        } else {
          n._plan = null;
          n._fullPlan = null;
          n._fullPlanGoal = null;
        }
      }
      if (n._plan && n._plan.length >= 2) {
        const next = n._plan[1];
        const keyNext = `${next.x},${next.y}`;
        const isReserved = ctx._reservedShopDoors && ctx._reservedShopDoors.has(keyNext);
        let isOwnDoor = !!(n.isShopkeeper && n._shopRef && n._shopRef.x === next.x && n._shopRef.y === next.y);
        if (!isOwnDoor && n.isShopkeeper && n._shopRef && String(n._shopRef.type || "").toLowerCase() === "inn") {
          const B = n._shopRef.building;
          if (B && ctx.map[next.y] && ctx.map[next.y][next.x] === ctx.TILES.DOOR) {
            const onPerimeter = (next.y === B.y || next.y === B.y + B.h - 1 || next.x === B.x || next.x === B.x + B.w - 1);
            if (onPerimeter) isOwnDoor = true;
          }
        }
        const avoidDoorInside = (() => {
          try {
            const shop = n._shopRef || null;
            const isInnKeeper = !!(n.isShopkeeper && shop && String(shop.type || "").toLowerCase() === "inn");
            const B = shop && shop.building ? shop.building : null;
            const nextIsDoor = (ctx.map[next.y] && ctx.map[next.y][next.x] === ctx.TILES.DOOR);
            const insideNow = B ? insideBuilding(B, n.x, n.y) : false;
            return isInnKeeper && nextIsDoor && insideNow;
          } catch (_) { return false; }
        })();
        // Bound-building restriction: if NPC is bound to a building and currently inside it, do not step outside
        let avoidExit = false;
        try {
          const BBound = n._boundToBuilding || null;
          const insideBoundNow = !!(BBound && insideBuilding(BBound, n.x, n.y));
          if (BBound && insideBoundNow && !insideBuilding(BBound, next.x, next.y)) {
            avoidExit = true;
          }
        } catch (_) {}
        const blocked = (occ.has(keyNext) && !(isReserved && isOwnDoor)) || avoidDoorInside || avoidExit;
        if (isWalkTown(ctx, next.x, next.y) && !blocked && !(ctx.player.x === next.x && ctx.player.y === next.y)) {
          if (typeof window !== "undefined" && window.DEBUG_TOWN_PATHS) {
            n._debugPath = (Array.isArray(n._fullPlan) ? n._fullPlan.slice(0) : n._plan.slice(0));
          } else {
            n._debugPath = null;
          }
          const pxPrev = n.x, pyPrev = n.y;
          occ.delete(`${n.x},${n.y}`); n.x = next.x; n.y = next.y; occ.add(`${n.x},${n.y}`);
          n._lastX = pxPrev; n._lastY = pyPrev;
          return true;
        } else {
          n._plan = null;
          n._fullPlan = null;
          n._fullPlanGoal = null;
        }
      } else if (n._plan && n._plan.length === 1) {
        if (typeof window !== "undefined" && window.DEBUG_TOWN_PATHS) {
          n._debugPath = (Array.isArray(n._fullPlan) ? n._fullPlan.slice(0) : n._plan.slice(0));
        }
        return false;
      }
    }

    // Always go through the budgeted solver; urgent requests get priority in the queue
    const full = computePathBudgeted(ctx, occ, n.x, n.y, tx, ty, { urgent: !!(opts && opts.urgent) });
    if (full && full.length >= 2) {
      n._plan = full.slice(0);
      n._planGoal = { x: tx, y: ty };
      n._fullPlan = full.slice(0);
      n._fullPlanGoal = { x: tx, y: ty };
      if (typeof window !== "undefined" && window.DEBUG_TOWN_PATHS) n._debugPath = full.slice(0);
      const next = full[1];
      const keyNext = `${next.x},${next.y}`;
      const isReserved = ctx._reservedShopDoors && ctx._reservedShopDoors.has(keyNext);
      let isOwnDoor = !!(n.isShopkeeper && n._shopRef && n._shopRef.x === next.x && n._shopRef.y === next.y);
      if (!isOwnDoor && n.isShopkeeper && n._shopRef && String(n._shopRef.type || "").toLowerCase() === "inn") {
        const B = n._shopRef.building;
        if (B && ctx.map[next.y] && ctx.map[next.y][next.x] === ctx.TILES.DOOR) {
          const onPerimeter = (next.y === B.y || next.y === B.y + B.h - 1 || next.x === B.x || next.x === B.x + B.w - 1);
          if (onPerimeter) isOwnDoor = true;
        }
      }
      const avoidDoorInside2 = (() => {
        try {
          const shop = n._shopRef || null;
          const isInnKeeper = !!(n.isShopkeeper && shop && String(shop.type || "").toLowerCase() === "inn");
          const B = shop && shop.building ? shop.building : null;
          const nextIsDoor = (ctx.map[next.y] && ctx.map[next.y][next.x] === ctx.TILES.DOOR);
          const insideNow = B ? insideBuilding(B, n.x, n.y) : false;
          return isInnKeeper && nextIsDoor && insideNow;
        } catch (_) { return false; }
      })();
      const blocked = (occ.has(keyNext) && !(isReserved && isOwnDoor)) || avoidDoorInside2;
      if (isWalkTown(ctx, next.x, next.y) && !blocked && !(ctx.player.x === next.x && ctx.player.y === next.y)) {
        const pxPrev = n.x, pyPrev = n.y;
        occ.delete(`${n.x},${n.y}`); n.x = next.x; n.y = next.y; occ.add(`${n.x},${n.y}`);
        n._lastX = pxPrev; n._lastY = pyPrev;
        return true;
      }
      n._plan = null; n._planGoal = null;
      n._fullPlan = null; n._fullPlanGoal = null;
    }

    const dirs4 = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
    const dirs = dirs4.slice().sort((a, b) =>
      (Math.abs((n.x + a.dx) - tx) + Math.abs((n.y + a.dy) - ty)) -
      (Math.abs((n.x + b.dx) - tx) + Math.abs((n.y + b.dy) - ty))
    );

    const prevKey = (typeof n._lastX === "number" && typeof n._lastY === "number") ? `${n._lastX},${n._lastY}` : null;
    let chosen = null;
    let backStep = null;

    for (const d of dirs) {
      const nx = n.x + d.dx, ny = n.y + d.dy;
      if (!isWalkTown(ctx, nx, ny)) continue;
      if (ctx.player.x === nx && ctx.player.y === ny) continue;

      const keyN = `${nx},${ny}`;
      const isReservedN = ctx._reservedShopDoors && ctx._reservedShopDoors.has(keyN);
      let isOwnDoorN = !!(n.isShopkeeper && n._shopRef && n._shopRef.x === nx && n._shopRef.y === ny);
      if (!isOwnDoorN && n.isShopkeeper && n._shopRef && String(n._shopRef.type || "").toLowerCase() === "inn") {
        const B = n._shopRef.building;
        if (B && ctx.map[ny] && ctx.map[ny][nx] === ctx.TILES.DOOR) {
          const onPerimeter = (ny === B.y || ny === B.y + B.h - 1 || nx === B.x || nx === B.x + B.w - 1);
          if (onPerimeter) isOwnDoorN = true;
        }
      }
      if (occ.has(keyN) && !(isReservedN && isOwnDoorN)) continue;

      // Bound-building: avoid stepping onto a door tile while inside; never step outside the bound building
      try {
        const BBound = n._boundToBuilding || null;
        const insideBoundNow = BBound ? insideBuilding(BBound, n.x, n.y) : false;
        const nextIsDoor = (ctx.map[ny] && ctx.map[ny][nx] === ctx.TILES.DOOR);
        if (BBound && insideBoundNow && nextIsDoor) continue;
        if (BBound && insideBoundNow && !insideBuilding(BBound, nx, ny)) continue;
      } catch (_) {}

      const isBack = prevKey && keyN === prevKey;
      if (isBack) {
        if (!backStep) backStep = { nx, ny };
        continue;
      }
      chosen = { nx, ny };
      break;
    }

    if (!chosen && backStep) {
      chosen = backStep;
    }

    if (chosen) {
      if (typeof window !== "undefined" && window.DEBUG_TOWN_PATHS) {
        n._debugPath = [{ x: n.x, y: n.y }, { x: chosen.nx, y: chosen.ny }];
      } else {
        n._debugPath = null;
      }
      n._plan = null; n._planGoal = null;
      n._fullPlan = null; n._fullPlanGoal = null;
      const pxPrev = n.x, pyPrev = n.y;
      occ.delete(`${n.x},${n.y}`); n.x = chosen.nx; n.y = chosen.ny; occ.add(`${n.x},${n.y}`);
      n._lastX = pxPrev; n._lastY = pyPrev;
      return true;
    }

    n._debugPath = null;
    n._plan = null; n._planGoal = null;
    n._fullPlan = null; n._fullPlanGoal = null;
    return false;
  }

  // Route into Inn upstairs: go to ground stairs, then upstairs path to target
  function routeIntoInnUpstairs(ctx, occGround, n, targetUp) {
    const tav = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
    const up = ctx.innUpstairs;
    const stairs = Array.isArray(ctx.innStairsGround) ? ctx.innStairsGround.slice(0) : [];
    if (!tav || !up || !stairs.length || !targetUp) return false;

    // Default floor if missing
    if (!n._floor) n._floor = "ground";

    // If not upstairs yet: aim for nearest ground stairs tile
    if (n._floor !== "upstairs") {
      // Pick nearest stairs by manhattan
      let sPick = stairs[0];
      let bd = Math.abs(stairs[0].x - n.x) + Math.abs(stairs[0].y - n.y);
      for (let i = 1; i < stairs.length; i++) {
        const s = stairs[i];
        const d = Math.abs(s.x - n.x) + Math.abs(s.y - n.y);
        if (d < bd) { bd = d; sPick = s; }
      }
      // Step toward stairs using ground pathing
      const handled = stepTowards(ctx, occGround, n, sPick.x, sPick.y, { urgent: true });
      // Exact stairs landing: toggle immediately
      if (n.x === sPick.x && n.y === sPick.y && insideBuilding(tav, n.x, n.y)) {
        n._floor = "upstairs";
        n._nearStairsCount = 0;
        return true;
      }
      // Proximity-based toggle: if inside inn and within 1 tile of any stairs for consecutive ticks, toggle upstairs
      if (insideBuilding(tav, n.x, n.y)) {
        let near = false;
        for (let i = 0; i < stairs.length; i++) {
          const s = stairs[i];
          const md = Math.abs(s.x - n.x) + Math.abs(s.y - n.y);
          if (md <= 1) { near = true; break; }
        }
        if (near) {
          n._nearStairsCount = (typeof n._nearStairsCount === "number") ? (n._nearStairsCount + 1) : 1;
          // Small threshold (2) to avoid accidental toggles during crowd jitter
          if (n._nearStairsCount >= 2) {
            n._floor = "upstairs";
            n._nearStairsCount = 0;
            return true;
          }
        } else {
          n._nearStairsCount = 0;
        }
      }
      return true;
    }

    // Upstairs movement: overlay-aware A*
    const occUp = buildOccUpstairs(ctx);
    const path = computePathUpstairs(ctx, occUp, n.x, n.y, targetUp.x, targetUp.y);
    if (path && path.length >= 2) {
      const next = path[1];
      const keyNext = `${next.x},${next.y}`;
      if (isWalkInnUpstairs(ctx, next.x, next.y, occUp)) {
        // Move upstairs; separate occupancy from ground
        const pxPrev = n.x, pyPrev = n.y;
        // Do not touch occGround for upstairs moves; maintain local upstairs occupancy only
        n.x = next.x; n.y = next.y;
        n._lastX = pxPrev; n._lastY = pyPrev;
        // If we step onto upstairs stairs tile, we could toggle down — leave for future flows
        return true;
      }
    }
    // Small jitter upstairs if blocked
    if (ctx.rng() < 0.15) {
      const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
      for (const d of dirs) {
        const nx = n.x + d.dx, ny = n.y + d.dy;
        if (isWalkInnUpstairs(ctx, nx, ny, buildOccUpstairs(ctx))) { n.x = nx; n.y = ny; return true; }
      }
    }
    return false;
  }

  // ---- Populate helpers ----
  function isFreeTownFloor(ctx, x, y) {
    const { map, TILES, player, npcs, townProps } = ctx;
    if (y < 0 || y >= map.length) return false;
    if (x < 0 || x >= (map[0] ? map[0].length : 0)) return false;
    const t = map[y][x];
    if (t !== TILES.FLOOR && t !== TILES.DOOR && t !== TILES.ROAD) return false;
    if (x === player.x && y === player.y) return false;
    const occ = ctx._occ;
    if (occ ? occ.has(`${x},${y}`) : (Array.isArray(npcs) && npcs.some(n => n.x === x && n.y === y))) return false;
    if (Array.isArray(townProps) && townProps.some(p => p.x === x && p.y === y)) return false;
    return true;
  }

  function randomInteriorSpot(ctx, b) {
    const { map, townProps } = ctx;
    const spots = [];
    for (let y = b.y + 1; y < b.y + b.h - 1; y++) {
      for (let x = b.x + 1; x < b.x + b.w - 1; x++) {
        if (map[y][x] !== ctx.TILES.FLOOR) continue;
        if (townProps.some(p => p.x === x && p.y === y)) continue;
        spots.push({ x, y });
      }
    }
    if (!spots.length) return null;
    const rnd = rngFor(ctx);
    return spots[Math.floor(rnd() * spots.length)];
  }

  function addProp(ctx, x, y, type, name) {
    const { map, townProps, TILES } = ctx;
    if (x <= 0 || y <= 0 || y >= map.length - 1 || x >= (map[0] ? map[0].length : 0) - 1) return false;
    if (map[y][x] !== TILES.FLOOR) return false;
    if (townProps.some(p => p.x === x && p.y === y)) return false;
    townProps.push({ x, y, type, name });
    return true;
  }

  function addSignNear(ctx, x, y, text) {
    const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
    for (const d of dirs) {
      const sx = x + d.dx, sy = y + d.dy;
      if (addProp(ctx, sx, sy, "sign", text)) return true;
    }
    return false;
  }

  function bedsFor(ctx, building) {
    return (ctx.townProps || []).filter(p =>
      p.type === "bed" &&
      p.x > building.x && p.x < building.x + building.w - 1 &&
      p.y > building.y && p.y < building.y + building.h - 1
    );
  }

  function populateTown(ctx) {
    const { shops, npcs, townBuildings, townPlaza, rng } = ctx;

    // Shopkeepers with homes and signs
    (function spawnShopkeepers() {
      if (!Array.isArray(shops) || shops.length === 0) return;
      const GD = getGameData(ctx);
      const ND = GD && GD.npcs ? GD.npcs : null;
      const keeperLines = (ND && Array.isArray(ND.shopkeeperLines) && ND.shopkeeperLines.length) ? ND.shopkeeperLines : ["We open on schedule.","Welcome in!","Back soon."];
      const keeperNames = (ND && Array.isArray(ND.shopkeeperNames) && ND.shopkeeperNames.length) ? ND.shopkeeperNames : ["Shopkeeper","Trader","Smith"];
      const caravanLines = [
        "Fresh goods from the road.",
        "We stay only while the caravan is in town.",
        "Have a look before we move on."
      ];
      for (const s of shops) {
        // Shop signs are placed during town generation (worldgen/town_gen.js) with outward placement.
        // Avoid duplicating signs here to prevent incorrect sign placement inside buildings like the Inn.
        // choose spawn location:
        // Inn: always spawn inside to keep entrance clear and ensure availability
        const isInn = String(s.type || "").toLowerCase() === "inn";
        const isCaravanShop = String(s.type || "").toLowerCase() === "caravan";
        let spot = null;
        if (isInn && s.inside) {
          spot = { x: s.inside.x, y: s.inside.y };
        } else {
          // Other shops: prefer adjacent free tile near door (avoid blocking the door tile itself)
          const neigh = [
            { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
            { dx: 1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 },
          ];
          for (const d of neigh) {
            const nx = s.x + d.dx, ny = s.y + d.dy;
            if (isFreeTownFloor(ctx, nx, ny)) { spot = { x: nx, y: ny }; break; }
          }
          if (!spot) {
            spot = { x: s.x, y: s.y };
          }
        }
        if (npcs.some(n => n.x === spot.x && n.y === spot.y)) continue;

        // In smaller towns shopkeepers more often live in their shop; in cities less often
        const size = (ctx.townSize || "big");
        let baseLive = 0.4;
        if (size === "small") baseLive = 0.6;
        else if (size === "city") baseLive = 0.25;
        const livesInShop = (isInn && s.building) ? true : (rng() < baseLive && s.building);
        let home = null;
        if (livesInShop && s.building) {
          const h = randomInteriorSpot(ctx, s.building) || s.inside || { x: s.x, y: s.y };
          home = { building: s.building, x: h.x, y: h.y, door: { x: s.x, y: s.y } };
        } else if (Array.isArray(townBuildings) && townBuildings.length) {
          const b = townBuildings[randInt(ctx, 0, townBuildings.length - 1)];
          const pos = randomInteriorSpot(ctx, b) || { x: b.door.x, y: b.door.y };
          home = { building: b, x: pos.x, y: pos.y, door: { x: b.door.x, y: b.door.y } };
        }
        // Special-case: innkeeper should always have home at inn as well
        if (isInn && s.building && !home) {
          const h2 = randomInteriorSpot(ctx, s.building) || s.inside || { x: s.x, y: s.y };
          home = { building: s.building, x: h2.x, y: h2.y, door: { x: s.x, y: s.y } };
        }

        const shopBase = s.name ? `${s.name} ` : "";
        let keeperName;
        if (isCaravanShop) {
          keeperName = "Caravan master";
        } else {
          keeperName = shopBase ? `${shopBase}Keeper` : (keeperNames[Math.floor(rng() * keeperNames.length)] || "Shopkeeper");
        }
        const linesForKeeper = isCaravanShop ? caravanLines : keeperLines;

        npcs.push({
          x: spot.x, y: spot.y,
          name: keeperName,
          lines: linesForKeeper,
          isShopkeeper: true,
          _work: { x: s.x, y: s.y },
          _workInside: s.inside || { x: s.x, y: s.y },
          _shopRef: s,
          _home: home,
          _livesAtShop: !!livesInShop,
          // Hard-binding: Inn keeper is bound to the inn building and must stay inside at all times
          _boundToBuilding: isInn ? s.building : null
        });
      }
    })();

    // Residents
    (function spawnResidents() {
      if (!Array.isArray(townBuildings) || townBuildings.length === 0) return;

      // Exclude dedicated guard barracks buildings from generic resident assignment (guards use them as their home).
      const buildingsForResidents = townBuildings.filter(b => {
        const id = (b && b.prefabId) ? String(b.prefabId).toLowerCase() : "";
        return !id.includes("guard_barracks");
      });
      if (!buildingsForResidents.length) return;

      // Helper to find any free interior spot deterministically
      function firstFreeInteriorSpot(ctx, b) {
        for (let y = b.y + 1; y < b.y + b.h - 1; y++) {
          for (let x = b.x + 1; x < b.x + b.w - 1; x++) {
            if (ctx.map[y][x] !== ctx.TILES.FLOOR) continue;
            if ((ctx.townProps || []).some(p => p.x === x && p.y === y && p.type && p.type !== "sign" && p.type !== "rug")) continue;
            if ((ctx.npcs || []).some(n => n.x === x && n.y === y)) continue;
            return { x, y };
          }
        }
        return null;
      }

      const GD = getGameData(ctx);
      const ND = GD && GD.npcs ? GD.npcs : null;
      const linesHome = (ND && Array.isArray(ND.residentLines) && ND.residentLines.length) ? ND.residentLines : ["Home sweet home.","A quiet day indoors.","Just tidying up."];
      const residentNames = (ND && Array.isArray(ND.residentNames) && ND.residentNames.length) ? ND.residentNames : ["Resident","Villager"];

      const benches = (ctx.townProps || []).filter(p => p.type === "bench");
      const pickBenchNearPlaza = () => {
        if (!benches.length || !townPlaza) return null;
        const candidates = benches.slice().sort((a, b) =>
          manhattan(a.x, a.y, townPlaza.x, townPlaza.y) - manhattan(b.x, b.y, townPlaza.x, townPlaza.y));
        const b = candidates[0] || null;
        if (!b) return null;
        const seat = nearestFreeAdjacent(ctx, b.x, b.y, null);
        return seat ? { x: seat.x, y: seat.y } : { x: b.x, y: b.y };
      };
      const pickRandomShopDoor = () => {
        if (!shops || !shops.length) return null;
        const s = shops[randInt(ctx, 0, shops.length - 1)];
        // Prefer an adjacent floor tile next to the door so residents don't block the door itself
        const adj = nearestFreeAdjacent(ctx, s.x, s.y, null);
        return adj ? { x: adj.x, y: adj.y } : { x: s.x, y: s.y };
      };
      function pickRandomTownWanderTarget() {
        const rows = ctx.map.length;
        const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
        if (!rows || !cols) return null;
        for (let t = 0; t < 80; t++) {
          const x = randInt(ctx, 2, cols - 3);
          const y = randInt(ctx, 2, rows - 3);
          if (!isFreeTownFloor(ctx, x, y)) continue;
          if (townPlaza && manhattan(x, y, townPlaza.x, townPlaza.y) <= 4) continue;
          return { x, y };
        }
        return null;
      }

      // Ensure every building (except guard barracks) has occupants (at least one), scaled by area
      for (const b of buildingsForResidents) {
        const area = b.w * b.h;
        const baseCount = Math.max(1, Math.min(3, Math.floor(area / 30)));
        const residentCount = baseCount + (rng() < 0.4 ? 1 : 0);
        const bedList = bedsFor(ctx, b);
        let created = 0;
        let tries = 0;
        while (created < residentCount && tries++ < 200) {
          const pos = randomInteriorSpot(ctx, b) || firstFreeInteriorSpot(ctx, b) || { x: Math.max(b.x + 1, Math.min(b.x + b.w - 2, Math.floor(b.x + b.w / 2))), y: Math.max(b.y + 1, Math.min(b.y + b.h - 2, Math.floor(b.y + b.h / 2))) };
          if (!pos) break;
          if (npcs.some(n => n.x === pos.x && n.y === pos.y)) continue;

          let errand = null;
          let errandIsShopDoor = false;
          const hasInn = !!(ctx.tavern && ctx.tavern.building);
          const roleRoll = rng();

          if (roleRoll < 0.30) {
            // Homebody: day errand stays inside/near their own house
            const homeSpot = firstFreeInteriorSpot(ctx, b) || { x: pos.x, y: pos.y };
            errand = { x: homeSpot.x, y: homeSpot.y };
          } else if (roleRoll < 0.60) {
            // Old behavior: bench near plaza or shop door
            if (rng() < 0.5) {
              const pb = pickBenchNearPlaza();
              if (pb) { errand = { x: pb.x, y: pb.y }; errandIsShopDoor = false; }
            } else {
              const sd = pickRandomShopDoor();
              if (sd) { errand = sd; errandIsShopDoor = true; }
            }
          } else if (hasInn && roleRoll < 0.80) {
            // Inn-goer: prefer the inn entrance as daytime errand
            const tavB = ctx.tavern.building;
            const door = (ctx.tavern.door && typeof ctx.tavern.door.x === "number" && typeof ctx.tavern.door.y === "number")
              ? ctx.tavern.door
              : { x: tavB.x + ((tavB.w / 2) | 0), y: tavB.y + ((tavB.h / 2) | 0) };
            errand = { x: door.x, y: door.y };
          } else {
            // Wanderer: pick a random walkable tile somewhere in town (away from plaza center)
            const wander = pickRandomTownWanderTarget();
            if (wander) errand = wander;
          }

          let sleepSpot = null;
          if (bedList.length) {
            const bidx = randInt(ctx, 0, bedList.length - 1);
            sleepSpot = { x: bedList[bidx].x, y: bedList[bidx].y };
          }
          const rname = residentNames[Math.floor(rng() * residentNames.length)] || "Resident";
          const likesInn = ctx.rng() < 0.45 || (hasInn && roleRoll >= 0.60 && roleRoll < 0.80);
          npcs.push({
            x: pos.x, y: pos.y,
            name: rng() < 0.2 ? `Child` : rname,
            lines: linesHome,
            isResident: true,
            _home: { building: b, x: pos.x, y: pos.y, door: { x: b.door.x, y: b.door.y }, bed: sleepSpot },
            _work: errand,
            _workIsShopDoor: !!errandIsShopDoor,
            _likesInn: !!likesInn
          });
          created++;
        }
        // Guarantee at least one occupant
        if (created === 0) {
          const pos = firstFreeInteriorSpot(ctx, b) || { x: b.door.x, y: b.door.y };
          const rname = residentNames[Math.floor(rng() * residentNames.length)] || "Resident";
          const workToShop = (rng() < 0.5 && shops && shops.length);
          const workTarget = workToShop ? { x: shops[0].x, y: shops[0].y }
                                        : (townPlaza ? { x: townPlaza.x, y: townPlaza.y } : null);
          npcs.push({
            x: pos.x, y: pos.y,
            name: rname,
            lines: linesHome,
            isResident: true,
            _home: { building: b, x: pos.x, y: pos.y, door: { x: b.door.x, y: b.door.y }, bed: null },
            _work: workTarget,
            _workIsShopDoor: !!workToShop,
            _likesInn: ctx.rng() < 0.45
          });
        }
      }
    })();

    // Pets
    (function spawnPets() {
      const maxCats = 2, maxDogs = 2;
      const GD = getGameData(ctx);
      const ND = GD && GD.npcs ? GD.npcs : null;
      const namesCat = (ND && Array.isArray(ND.petCats) && ND.petCats.length) ? ND.petCats : ["Cat","Mittens","Whiskers"];
      const namesDog = (ND && Array.isArray(ND.petDogs) && ND.petDogs.length) ? ND.petDogs : ["Dog","Rover","Buddy"];
      function placeFree() {
        for (let t = 0; t < 200; t++) {
          const x = randInt(ctx, 2, ctx.map[0].length - 3);
          const y = randInt(ctx, 2, ctx.map.length - 3);
          if (isFreeTownFloor(ctx, x, y)) return { x, y };
        }
        return null;
      }
      for (let i = 0; i < maxCats; i++) {
        const spot = placeFree(); if (!spot) break;
        ctx.npcs.push({ x: spot.x, y: spot.y, name: namesCat[i % namesCat.length], lines: ["Meow."], isPet: true, kind: "cat" });
      }
      for (let i = 0; i < maxDogs; i++) {
        const spot = placeFree(); if (!spot) break;
        ctx.npcs.push({ x: spot.x, y: spot.y, name: namesDog[i % namesDog.length], lines: ["Woof."], isPet: true, kind: "dog" });
      }
    })();

    // Corpse cleaners: a small number of NPCs that remove bodies from town streets.
    (function spawnCorpseCleaners() {
      const maxCleaners = 2;
      const GD = getGameData(ctx);
      const ND = GD && GD.npcs ? GD.npcs : null;
      const cleanerNames =
        ND && Array.isArray(ND.cleanerNames) && ND.cleanerNames.length
          ? ND.cleanerNames
          : ["Caretaker", "Gravedigger"];
      const cleanerLines =
        ND && Array.isArray(ND.cleanerLines) && ND.cleanerLines.length
          ? ND.cleanerLines
          : [
              "I'll see these bodies to rest.",
              "Can't leave the dead in the streets.",
            ];

      function placeFree() {
        for (let t = 0; t < 200; t++) {
          const x = randInt(ctx, 2, ctx.map[0].length - 3);
          const y = randInt(ctx, 2, ctx.map.length - 3);
          if (isFreeTownFloor(ctx, x, y)) return { x, y };
        }
        return null;
      }

      for (let i = 0; i < maxCleaners; i++) {
        const spot = placeFree();
        if (!spot) break;
        if (ctx.npcs.some(n => n && n.x === spot.x && n.y === spot.y)) continue;
        const name = cleanerNames[i % cleanerNames.length] || "Caretaker";
        ctx.npcs.push({
          x: spot.x,
          y: spot.y,
          name,
          lines: cleanerLines,
          isCorpseCleaner: true,
        });
      }
    })();
  }

  function ensureHome(ctx, n) {
    if (n._home) return;
    const { townBuildings, shops, townPlaza } = ctx;
    if (!Array.isArray(townBuildings) || townBuildings.length === 0) return;
    const b = townBuildings[randInt(ctx, 0, townBuildings.length - 1)];
    const pos = randomInteriorSpot(ctx, b) || { x: b.door.x, y: b.door.y };
    n._home = { building: b, x: pos.x, y: pos.y, door: { x: b.door.x, y: b.door.y } };
    if (shops && shops.length && ctx.rng() < 0.6) {
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

  // Ensure that at most one NPC per building uses a given bed tile.
  // If there are more NPCs than beds, extra NPCs will have no bed assigned
  // and will fall back to chairs or floor via existing home logic.
  function dedupeHomeBeds(ctx) {
    const npcs = Array.isArray(ctx.npcs) ? ctx.npcs : [];
    const townBuildings = Array.isArray(ctx.townBuildings) ? ctx.townBuildings : [];
    const townProps = Array.isArray(ctx.townProps) ? ctx.townProps : [];
    if (!npcs.length || !townBuildings.length || !townProps.some(p => p.type === "bed")) return;

    const bedsByBuilding = new Map();
    const usedByBuilding = new Map();
    const bKey = (b) => `${b.x},${b.y},${b.w},${b.h}`;

    function bedsForBuilding(b) {
      const key = bKey(b);
      if (bedsByBuilding.has(key)) return bedsByBuilding.get(key);
      const list = bedsFor(ctx, b) || [];
      bedsByBuilding.set(key, list);
      return list;
    }

    // First pass: record existing bed usage and drop assignments to non-existent or already-used beds.
    for (const n of npcs) {
      if (!n || !n._home || !n._home.building) continue;
      const B = n._home.building;
      const key = bKey(B);
      let used = usedByBuilding.get(key);
      if (!used) {
        used = new Set();
        usedByBuilding.set(key, used);
      }
      if (n._home.bed) {
        const bed = n._home.bed;
        const beds = bedsForBuilding(B);
        const exists = beds.some(p => p.x === bed.x && p.y === bed.y);
        if (!exists) {
          // Bed no longer exists inside building (layout changed); clear assignment.
          n._home.bed = null;
          continue;
        }
        const kBed = `${bed.x},${bed.y}`;
        if (used.has(kBed)) {
          // Another NPC already owns this bed; drop this one so they can fall back to chair/floor.
          n._home.bed = null;
        } else {
          used.add(kBed);
        }
      }
    }

    // Second pass: assign free beds to NPCs without one, per building.
    for (const n of npcs) {
      if (!n || !n._home || !n._home.building) continue;
      const B = n._home.building;
      if (n._home.bed) continue;
      const beds = bedsForBuilding(B);
      if (!beds.length) continue;
      const key = bKey(B);
      let used = usedByBuilding.get(key);
      if (!used) {
        used = new Set();
        usedByBuilding.set(key, used);
      }
      const candidates = [];
      for (const bd of beds) {
        const kBed = `${bd.x},${bd.y}`;
        if (!used.has(kBed)) candidates.push(bd);
      }
      if (!candidates.length) continue;
      const pick = candidates[randInt(ctx, 0, candidates.length - 1)];
      n._home.bed = { x: pick.x, y: pick.y };
      used.add(`${pick.x},${pick.y}`);
    }
  }

  function townNPCsAct(ctx) {
    const { npcs, player, townProps } = ctx;
    if (!Array.isArray(npcs) || npcs.length === 0) return;

    // Lightweight town combat event: Bandits at the Gate.
    // Treat the event as active if either the global flag is set OR any NPC is marked with _banditEvent.
    let banditEvent = !!(ctx._townBanditEvent && ctx._townBanditEvent.active);
    let anyBandit = false;
    for (const n of npcs) {
      if (n && n.isBandit && !n._dead) {
        anyBandit = true;
        if (n._banditEvent) banditEvent = true;
      }
    }
    if (banditEvent && !anyBandit) {
      if (ctx._townBanditEvent) ctx._townBanditEvent.active = false;
      try { ctx.log && ctx.log("The guards drive off the bandits at the gate.", "good"); } catch (_) {}
    }

    function dist1(ax, ay, bx, by) {
      return Math.abs(ax - bx) + Math.abs(ay - by);
    }

    function nearestBandit(ctx, from) {
      let best = null;
      let bestD = Infinity;
      const list = ctx.npcs || [];
      for (const n of list) {
        if (!n || !n.isBandit || n._dead) continue;
        const d = dist1(from.x, from.y, n.x, n.y);
        if (d < bestD) { bestD = d; best = n; }
      }
      return best;
    }

    function nearestCivilian(ctx, from) {
      let best = null;
      let bestD = Infinity;
      const list = ctx.npcs || [];
      for (const n of list) {
        if (!n || n._dead) continue;
        if (n.isGuard || n.isBandit || n.isPet) continue;
        const d = dist1(from.x, from.y, n.x, n.y);
        if (d < bestD) { bestD = d; best = n; }
      }
      return best;
    }

    function applyHit(attacker, defender, baseMin, baseMax) {
      if (!defender) return;
      const r = rngFor({ rng: (defender && defender.rng) || ctx.rng || (() => 0.5) });
      const dmg = baseMin + Math.floor(r() * (baseMax - baseMin + 1));
      const maxHp = typeof defender.maxHp === "number" ? defender.maxHp : 20;
      if (typeof defender.hp !== "number") defender.hp = maxHp;
      defender.hp -= dmg;
      const nameA = attacker && attacker.name ? attacker.name : "Someone";
      const nameD = defender && defender.name ? defender.name : "someone";
      try {
        if (defender.hp > 0) {
          ctx.log && ctx.log(`${nameA} hits ${nameD} for ${dmg}. (${Math.max(0, defender.hp)} HP left)`, "combat");
        } else {
          defender._dead = true;
          ctx.log && ctx.log(`${nameA} kills ${nameD}.`, "fatal");
        }
      } catch (_) {}
    }

    // NPC vs NPC town combat: guards and bandits use a shared damage pipeline that mirrors
    // dungeon/encounter enemy-vs-enemy attacks (hit locations, block, crits, scaling).
    function townNpcAttack(attacker, defender) {
      if (!attacker || !defender || defender._dead) return;
      const rnd = rngFor(ctx);

      // Hit location
      let loc = { part: "torso", mult: 1.0, blockMod: 1.0, critBonus: 0.0 };
      try {
        if (typeof ctx.rollHitLocation === "function") {
          loc = ctx.rollHitLocation();
        }
      } catch (_) {}

      // Block chance based on defender type/faction, same helper used by dungeon enemies.
      let blockChance = 0;
      try {
        if (typeof ctx.getEnemyBlockChance === "function") {
          blockChance = ctx.getEnemyBlockChance(defender, loc);
        }
      } catch (_) {}

      try {
        if (rnd() < blockChance) {
          const nameA = attacker && (attacker.name || attacker.type) ? (attacker.name || attacker.type) : "Someone";
          const nameD = defender && (defender.name || defender.type) ? (defender.name || defender.type) : "someone";
          ctx.log &&
            ctx.log(
              `${nameD} blocks ${nameA}'s attack to the ${loc.part}.`,
              "block",
              { category: "Combat", side: "npc" }
            );
          return;
        }
      } catch (_) {}

      // Damage calculation: atk * enemyDamageMultiplier(level) * hit-location multiplier.
      const atk = (typeof attacker.atk === "number" && attacker.atk > 0) ? attacker.atk : 2;
      const level = (typeof attacker.level === "number" && attacker.level > 0) ? attacker.level : 1;
      let mult = 1.0;
      try {
        if (typeof ctx.enemyDamageMultiplier === "function") {
          mult = ctx.enemyDamageMultiplier(level);
        } else {
          mult = 1 + 0.15 * Math.max(0, level - 1);
        }
      } catch (_) {
        mult = 1 + 0.15 * Math.max(0, level - 1);
      }
      let raw = atk * mult * (loc.mult || 1.0);

      // Crits
      let isCrit = false;
      try {
        let critChance = 0.10 + (loc.critBonus || 0);
        critChance = Math.max(0, Math.min(0.5, critChance));
        if (rnd() < critChance) {
          isCrit = true;
          let cMult = 1.8;
          if (typeof ctx.critMultiplier === "function") {
            cMult = ctx.critMultiplier();
          } else {
            cMult = 1.6 + rnd() * 0.4;
          }
          raw *= cMult;
        }
      } catch (_) {}

      // No DR for NPC vs NPC (mirrors dungeon enemy-vs-enemy combat).
      let dmg = raw;
      try {
        if (ctx.utils && typeof ctx.utils.round1 === "function") {
          dmg = ctx.utils.round1(dmg);
        } else {
          dmg = Math.round(dmg * 10) / 10;
        }
      } catch (_) {}
      if (!(dmg > 0)) dmg = 0.1;

      const maxHp = typeof defender.maxHp === "number"
        ? defender.maxHp
        : (typeof defender.hp === "number" ? Math.max(1, defender.hp) : 20);
      if (typeof defender.hp !== "number") defender.hp = maxHp;
      defender.hp -= dmg;

      // Visual blood for non-ethereal targets
      try {
        const ttype = String(defender.type || defender.name || "");
        const ethereal = /ghost|spirit|wraith|skeleton/i.test(ttype);
        if (!ethereal && typeof ctx.addBloodDecal === "function" && dmg > 0) {
          ctx.addBloodDecal(defender.x, defender.y, isCrit ? 1.2 : 0.9);
        }
      } catch (_) {}

      // Logging
      const nameA = attacker && (attacker.name || attacker.type) ? (attacker.name || attacker.type) : "Someone";
      const nameD = defender && (defender.name || defender.type) ? (defender.name || defender.type) : "someone";
      try {
        if (defender.hp > 0) {
          if (isCrit) {
            ctx.log &&
              ctx.log(
                `Critical! ${nameA} hits ${nameD}'s ${loc.part} for ${dmg}.`,
                "crit",
                { category: "Combat", side: "npc" }
              );
          } else {
            ctx.log &&
              ctx.log(
                `${nameA} hits ${nameD}'s ${loc.part} for ${dmg}.`,
                "combat",
                { category: "Combat", side: "npc" }
              );
          }
        } else {
          defender._dead = true;
          ctx.log &&
            ctx.log(
              `${nameA} kills ${nameD}.`,
              "fatal",
              { category: "Combat", side: "npc" }
            );
        }
      } catch (_) {}
    }

    // Bandit attack against the player using the same damage model as dungeon/encounter enemies.
    function banditAttackPlayer(attacker) {
      if (!ctx || !ctx.player || !attacker) return;
      const player = ctx.player;
      const rnd = rngFor(ctx);
      const U = (ctx && ctx.utils) ? ctx.utils : null;

      const randFloat = (min, max, dec = 1) => {
        try {
          if (U && typeof U.randFloat === "function") {
            return U.randFloat(min, max, dec);
          }
        } catch (_) {}
        const r = typeof rnd === "function" ? rnd() : 0.5;
        const v = min + r * (max - min);
        const p = Math.pow(10, dec);
        return Math.round(v * p) / p;
      };

      // Hit location
      let loc = { part: "torso", mult: 1.0, blockMod: 1.0, critBonus: 0.0 };
      try {
        if (typeof ctx.rollHitLocation === "function") {
          loc = ctx.rollHitLocation();
        }
      } catch (_) {}

      // Block
      let blockChance = 0;
      try {
        if (typeof ctx.getPlayerBlockChance === "function") {
          blockChance = ctx.getPlayerBlockChance(loc);
        }
      } catch (_) {}

      try {
        if (rnd() < blockChance) {
          const name =
            (attacker && (attacker.name || attacker.type)) || "bandit";
          ctx.log &&
            ctx.log(
              `You block ${name}'s attack to your ${loc.part}.`,
              "block",
              { category: "Combat", side: "player" }
            );
          try {
            if (
              ctx.Flavor &&
              typeof ctx.Flavor.onBlock === "function"
            ) {
              ctx.Flavor.onBlock(ctx, {
                side: "player",
                attacker,
                defender: player,
                loc,
              });
            }
          } catch (_) {}
          try {
            if (typeof ctx.decayBlockingHands === "function") {
              ctx.decayBlockingHands();
            }
          } catch (_) {}
          try {
            if (typeof ctx.decayEquipped === "function") {
              ctx.decayEquipped("hands", randFloat(0.3, 1.0, 1));
            }
          } catch (_) {}
          return;
        }
      } catch (_) {}

      // Damage calculation
      const atk =
        typeof attacker.atk === "number" ? attacker.atk : 2;
      const level =
        typeof attacker.level === "number"
          ? attacker.level
          : (typeof player.level === "number" ? player.level : 1);
      let mult = 1 + 0.15 * Math.max(0, level - 1);
      try {
        if (typeof ctx.enemyDamageMultiplier === "function") {
          mult = ctx.enemyDamageMultiplier(level);
        }
      } catch (_) {}
      let raw = atk * mult * (loc.mult || 1);

      // Crits
      let isCrit = false;
      try {
        const critChance = Math.max(
          0,
          Math.min(0.5, 0.1 + (loc.critBonus || 0))
        );
        if (rnd() < critChance) {
          isCrit = true;
          let cMult = 1.8;
          try {
            if (typeof ctx.critMultiplier === "function") {
              cMult = ctx.critMultiplier(rnd);
            } else {
              cMult = 1.6 + rnd() * 0.4;
            }
          } catch (_) {}
          raw *= cMult;
        }
      } catch (_) {}

      let dmg = raw;
      try {
        if (typeof ctx.enemyDamageAfterDefense === "function") {
          dmg = ctx.enemyDamageAfterDefense(raw);
        }
      } catch (_) {}
      if (typeof dmg !== "number" || !(dmg > 0)) dmg = raw;

      // Clamp to one decimal place like other combat helpers
      try {
        if (U && typeof U.round1 === "function") {
          dmg = U.round1(dmg);
        } else {
          dmg = Math.round(dmg * 10) / 10;
        }
      } catch (_) {}

      player.hp -= dmg;

      // Blood decal
      try {
        if (typeof ctx.addBloodDecal === "function" && dmg > 0) {
          ctx.addBloodDecal(
            player.x,
            player.y,
            isCrit ? 1.4 : 1.0
          );
        }
      } catch (_) {}

      // Log hit
      try {
        const name =
          (attacker && (attacker.name || attacker.type)) || "bandit";
        if (isCrit) {
          ctx.log &&
            ctx.log(
              `Critical! ${name} hits your ${loc.part} for ${dmg}.`,
              "crit",
              { category: "Combat", side: "enemy" }
            );
        } else {
          ctx.log &&
            ctx.log(
              `${name} hits your ${loc.part} for ${dmg}.`,
              "info",
              { category: "Combat", side: "enemy" }
            );
        }
      } catch (_) {}

      // Status effects (daze/bleed) and flavor hook, same as dungeon/encounter
      try {
        const ST =
          ctx.Status ||
          (typeof window !== "undefined" ? window.Status : null);
        if (ST) {
          if (
            isCrit &&
            loc.part === "head" &&
            typeof ST.applyDazedToPlayer === "function"
          ) {
            const dur = 1 + Math.floor(rnd() * 2);
            try {
              ST.applyDazedToPlayer(ctx, dur);
            } catch (_) {}
          }
          if (isCrit && typeof ST.applyBleedToPlayer === "function") {
            try {
              ST.applyBleedToPlayer(ctx, 2);
            } catch (_) {}
          }
        }
        if (
          ctx.Flavor &&
          typeof ctx.Flavor.logHit === "function"
        ) {
          ctx.Flavor.logHit(ctx, {
            attacker,
            loc,
            crit: isCrit,
            dmg,
          });
        }
      } catch (_) {}

      // Equipment decay by hit part
      try {
        if (typeof ctx.decayEquipped === "function") {
          const critWear = isCrit ? 1.6 : 1.0;
          let wear = 0.5;
          if (loc.part === "torso")
            wear = randFloat(0.8, 2.0, 1);
          else if (loc.part === "head")
            wear = randFloat(0.3, 1.0, 1);
          else if (loc.part === "legs")
            wear = randFloat(0.4, 1.3, 1);
          else if (loc.part === "hands")
            wear = randFloat(0.3, 1.0, 1);
          ctx.decayEquipped(loc.part, wear * critWear);
        }
      } catch (_) {}

      // Persistent injury tracking (cosmetic, as in dungeon/encounter)
      try {
        if (player) {
          if (!Array.isArray(player.injuries)) player.injuries = [];
          const injuries = player.injuries;
          const addInjury = (name, opts) => {
            if (!name) return;
            const exists = injuries.some((it) =>
              typeof it === "string"
                ? it === name
                : it && it.name === name
            );
            if (exists) return;
            const healable =
              !opts || opts.healable !== false;
            const durationTurns = healable
              ? Math.max(10, (opts && opts.durationTurns) | 0)
              : 0;
            injuries.push({ name, healable, durationTurns });
            if (injuries.length > 24)
              injuries.splice(0, injuries.length - 24);
            try {
              ctx.log &&
                ctx.log(`You suffer ${name}.`, "warn");
            } catch (_) {}
          };
          const rInj = rnd();
          if (loc.part === "hands") {
            if (isCrit && rInj < 0.08)
              addInjury("missing finger", {
                healable: false,
                durationTurns: 0,
              });
            else if (rInj < 0.2)
              addInjury("bruised knuckles", {
                healable: true,
                durationTurns: 30,
              });
          } else if (loc.part === "legs") {
            if (isCrit && rInj < 0.1)
              addInjury("sprained ankle", {
                healable: true,
                durationTurns: 80,
              });
            else if (rInj < 0.25)
              addInjury("bruised leg", {
                healable: true,
                durationTurns: 40,
              });
          } else if (loc.part === "head") {
            if (isCrit && rInj < 0.12)
              addInjury("facial scar", {
                healable: false,
                durationTurns: 0,
              });
            else if (rInj < 0.2)
              addInjury("black eye", {
                healable: true,
                durationTurns: 60,
              });
          } else if (loc.part === "torso") {
            if (isCrit && rInj < 0.1)
              addInjury("deep scar", {
                healable: false,
                durationTurns: 0,
              });
            else if (rInj < 0.22)
              addInjury("rib bruise", {
                healable: true,
                durationTurns: 50,
              });
          }
        }
      } catch (_) {}

      // Player death handling
      if (player.hp <= 0) {
        player.hp = 0;
        try {
          if (typeof ctx.onPlayerDied === "function") {
            ctx.onPlayerDied();
          }
        } catch (_) {}
      }
    }

    function removeDeadNPCs(ctx) {
      if (!Array.isArray(ctx.npcs)) return;
      let changed = false;

      // Ensure corpses array exists so town deaths can leave bodies behind.
      try {
        if (!Array.isArray(ctx.corpses)) {
          ctx.corpses = [];
        }
      } catch (_) {}

      for (let i = ctx.npcs.length - 1; i >= 0; i--) {
        const n = ctx.npcs[i];
        if (n && n._dead) {
          // For town bandit events, leave a corpse marker with real loot when bandits or guards die.
          // Blood decals are handled at hit time by the shared combat helpers so visuals
          // stay consistent with dungeon/region combat.
          try {
            if (ctx.mode === "town" && (n.isBandit || n.isGuard)) {
              ctx.corpses = Array.isArray(ctx.corpses) ? ctx.corpses : [];
              const already = ctx.corpses.some(c => c && c.x === n.x && c.y === n.y);
              if (!already) {
                let loot = [];
                try {
                  const L =
                    ctx.Loot ||
                    getMod(ctx, "Loot") ||
                    (typeof window !== "undefined" ? window.Loot : null);
                  if (L && typeof L.generate === "function") {
                    loot = L.generate(ctx, n) || [];
                  }
                } catch (_) {
                  loot = [];
                }
                ctx.corpses.push({
                  x: n.x,
                  y: n.y,
                  kind: n.isGuard ? "guard_corpse" : "corpse",
                  loot,
                  looted: loot.length === 0,
                  meta: null,
                });
              }
            }
          } catch (_) {}

          ctx.npcs.splice(i, 1);
          changed = true;
        }
      }
      if (changed) {
        try {
          const OF = ctx.OccupancyFacade || (typeof window !== "undefined" ? window.OccupancyFacade : null);
          if (OF && typeof OF.rebuild === "function") OF.rebuild(ctx);
        } catch (_) {}
      }
    }

    // Ensure home bed assignments are unique per building before acting.
    dedupeHomeBeds(ctx);

    // Runtime occupancy (used for actual movement)
    const occ = new Set();
    occ.add(`${player.x},${player.y}`);
    for (const n of npcs) occ.add(`${n.x},${n.y}`);
    if (Array.isArray(townProps)) {
      for (const p of townProps) {
        // Only blocking furniture contributes to occupancy; signs/rugs are walkable
        if (propBlocks(p.type)) occ.add(`${p.x},${p.y}`);
      }
    }
    // Reserve shop door tiles to avoid door blocking by non-shopkeepers.
    // For inns, also reserve both tiles of the double door when present.
    const reservedDoors = new Set();
    try {
      const shops = Array.isArray(ctx.shops) ? ctx.shops : [];
      const rows = ctx.map.length, cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
      function inB(x, y) { return x >= 0 && y >= 0 && x < cols && y < rows; }
      for (const s of shops) {
        const key = `${s.x},${s.y}`;
        reservedDoors.add(key);
        occ.add(key); // treat as blocked by default
        // Inn: reserve adjacent DOOR tile to create an unobstructed double-door entry
        if (String(s.type || "").toLowerCase() === "inn") {
          const neigh = [
            { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
            { dx: 0, dy: 1 }, { dx: 0, dy: -1 }
          ];
          for (const d of neigh) {
            const nx = s.x + d.dx, ny = s.y + d.dy;
            if (!inB(nx, ny)) continue;
            if (ctx.map[ny][nx] === ctx.TILES.DOOR) {
              const k2 = `${nx},${ny}`;
              reservedDoors.add(k2);
              occ.add(k2);
              break; // only need one adjacent door to complete the pair
            }
          }
        }
      }
    } catch (_) {}
    ctx._reservedShopDoors = reservedDoors;

    // Expose fast occupancy to helpers for this tick
    ctx._occ = occ;

    // Bound-building hard clamp: ensure NPCs marked with _boundToBuilding stay inside their building.
    // If found outside for any reason (spawn collision, pathing jitter), snap them to a free interior tile.
    try {
      for (let i = 0; i < npcs.length; i++) {
        const n = npcs[i];
        if (!n || !n._boundToBuilding) continue;
        const B = n._boundToBuilding;
        const insideNow = insideBuilding(B, n.x, n.y);
        if (insideNow) continue;
        // Temporarily release this NPC's current tile from occupancy while searching a free interior
        const prevKey = `${n.x},${n.y}`;
        if (occ.has(prevKey)) occ.delete(prevKey);
        // Preferred interior target: shop.inside when available, then adjacent to door, then first free interior, then center
        let target = null;
        const prefer = (n._workInside ? { x: n._workInside.x, y: n._workInside.y } : null);
        if (prefer && insideBuilding(B, prefer.x, prefer.y) && isFreeTile(ctx, prefer.x, prefer.y)) {
          target = prefer;
        } else {
          const door = (B && B.door) ? { x: B.door.x, y: B.door.y } : null;
          const nearDoor = door ? nearestFreeAdjacent(ctx, door.x, door.y, B) : null;
          target = nearDoor || firstFreeInteriorTile(ctx, B) || { x: Math.max(B.x + 1, Math.min(B.x + B.w - 2, (B.x + ((B.w / 2) | 0)))), y: Math.max(B.y + 1, Math.min(B.y + B.h - 2, (B.y + ((B.h / 2) | 0)))) };
        }
        // Snap inside and mark downstairs
        const newKey = `${target.x},${target.y}`;
        n.x = target.x; n.y = target.y; n._floor = "ground";
        occ.add(newKey);
      }
    } catch (_) {}

    // Initialize per-tick pathfinding budget to avoid heavy recomputation (lowered)
    initPathBudget(ctx, npcs.length);

    const t = ctx.time;
    const minutes = t ? (t.hours * 60 + t.minutes) : 12 * 60;
    const phase = (t && t.phase === "night") ? "evening"
                : (t && t.phase === "dawn") ? "morning"
                : (t && t.phase === "dusk") ? "evening"
                : "day";

    // Weather snapshot for this tick (non-gameplay visual by default).
    // Town AI uses it only as a soft influence on behavior (rain -> more indoor preferences).
    let weather = null;
    try {
      if (ctx.weather) {
        weather = ctx.weather;
      } else if (typeof window !== "undefined" &&
                 window.TimeWeatherFacade &&
                 typeof window.TimeWeatherFacade.getWeatherSnapshot === "function") {
        weather = window.TimeWeatherFacade.getWeatherSnapshot(t || null);
      }
    } catch (_) {}
    let isRainy = false;
    let isHeavyRain = false;
    if (weather && typeof weather.intensity === "number") {
      const intensity = Math.max(0, Math.min(1, Number(weather.intensity)));
      isRainy = intensity >= 0.35;
      isHeavyRain = intensity >= 0.75;
    }

    // Late night window: 02:00–05:00
    const LATE_START = 2 * 60, LATE_END = 5 * 60;
    const inLateWindow = minutes >= LATE_START && minutes < LATE_END;

    // Debug helper: ensure at least one generic roamer is forced to sleep upstairs at the Inn
    function assignDebugUpstairsRoamer(ctx, npcs) {
      try {
        if (ctx._debugUpstairsRoamerAssigned) return;
        for (const n of npcs) {
          if (n && !n.isResident && !n.isShopkeeper && !n.isPet && !n.greeter && !n.isGuard) {
            n._forceInnSleepUpstairs = true;
            // Ensure the roamer acts every tick for reliable routing
            n._stride = 1;
            n._strideOffset = 0;
            ctx._debugUpstairsRoamerAssigned = true;
            break;
          }
        }
      } catch (_) {}
    }
    assignDebugUpstairsRoamer(ctx, npcs);

    // Evening return window: boost pathfinding budget to smooth mass routing (18:00–21:00),
    // but keep it within the global min/max clamp to avoid very heavy turns in huge towns.
    try {
      const EVENING_START = 18 * 60, EVENING_END = 21 * 60;
      if (minutes >= EVENING_START && minutes < EVENING_END) {
        const current = (typeof ctx._townPathBudgetRemaining === "number")
          ? ctx._townPathBudgetRemaining
          : 0;
        const desired = Math.floor(npcs.length * 0.35);
        const boostedRaw = Math.max(current, desired);
        const maxBudget = (typeof PATH_BUDGET_MAX === "number" && PATH_BUDGET_MAX > 0)
          ? PATH_BUDGET_MAX
          : 32;
        const minBudget = (typeof PATH_BUDGET_MIN === "number" && PATH_BUDGET_MIN > 0)
          ? PATH_BUDGET_MIN
          : 1;
        ctx._townPathBudgetRemaining = Math.max(
          minBudget,
          Math.min(maxBudget, boostedRaw)
        );
      }
    } catch (_) {}

    // Inn seating cap to prevent overcrowding; computed per tick
    const innBForCap = (ctx.tavern && ctx.tavern.building) ? ctx.tavern.building : null;
    let _innSeatCap = 0;
    let _innSeatersNow = 0;
    if (innBForCap) {
      try {
        const seatsCount = innSeatSpots(ctx).length;
        _innSeatCap = Math.max(2, Math.min(6, Math.floor((seatsCount || 0) * 0.5) || 2));
        for (const x of npcs) {
          if ((x._innSeatGoal) || (x._innStayTurns && x._innStayTurns > 0)) _innSeatersNow++;
        }
      } catch (_) {
        _innSeatCap = 4;
      }
    }

    // Helper: pick a target inside the Inn (prefer a bed, fallback to a free interior near door)
    function innBedSpots(ctx) {
      const innB = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
      if (!innB) return [];
      const beds = (ctx.townProps || []).filter(p =>
        p.type === "bed" &&
        p.x > innB.x && p.x < innB.x + innB.w - 1 &&
        p.y > innB.y && p.y < innB.y + innB.h - 1
      );
      return beds;
    }
    

    // Inn seating: pick floor tiles adjacent to chairs/tables inside the Inn (ground)
    function innSeatSpots(ctx) {
      const innB = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
      if (!innB) return [];
      const props = Array.isArray(ctx.townProps) ? ctx.townProps : [];
      const seats = [];
      for (const p of props) {
        if (p.type !== "chair" && p.type !== "table") continue;
        if (!(p.x > innB.x && p.x < innB.x + innB.w - 1 && p.y > innB.y && p.y < innB.y + innB.h - 1)) continue;
        const adj = nearestFreeAdjacent(ctx, p.x, p.y, innB);
        if (adj) seats.push(adj);
      }
      return seats;
    }
    function chooseInnSeat(ctx) {
      const seats = innSeatSpots(ctx);
      if (!seats.length) return chooseInnTarget(ctx);
      return seats[randInt(ctx, 0, seats.length - 1)];
    }

    // Upstairs-aware Inn target (prefer upstairs bed at night if available)
    function chooseInnTarget(ctx) {
      const upBed = chooseInnUpstairsBed(ctx);
      if (upBed) return { x: upBed.x, y: upBed.y };
      const innB = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
      if (!innB) return null;
      // Fallback to a free interior tile near the door
      const door = ctx.tavern.door || { x: innB.x + ((innB.w / 2) | 0), y: innB.y + ((innB.h / 2) | 0) };
      const inSpot = nearestFreeAdjacent(ctx, door.x, door.y, innB);
      return inSpot || { x: door.x, y: door.y };
    }

    // Bench seating near plaza or first available bench
    function chooseBenchSeat(ctx) {
      const benches = Array.isArray(ctx.townProps) ? ctx.townProps.filter(p => p.type === "bench") : [];
      if (!benches.length) return null;
      let b = benches[0];
      if (ctx.townPlaza) {
        const cx = ctx.townPlaza.x, cy = ctx.townPlaza.y;
        b = benches.slice().sort((a, bb) =>
          manhattan(a.x, a.y, cx, cy) - manhattan(bb.x, bb.y, cx, cy)
        )[0] || benches[0];
      }
      const seat = nearestFreeAdjacent(ctx, b.x, b.y, null);
      return seat ? seat : { x: b.x, y: b.y };
    }

    // First free interior tile in a building
    function firstFreeInteriorTile(ctx, b) {
      const { map, TILES } = ctx;
      for (let y = b.y + 1; y < b.y + b.h - 1; y++) {
        for (let x = b.x + 1; x < b.x + b.w - 1; x++) {
          if (map[y][x] !== TILES.FLOOR) continue;
          if ((ctx.townProps || []).some(p => p.x === x && p.y === y && p.type && p.type !== "sign" && p.type !== "rug")) continue;
          if ((ctx.npcs || []).some(n => n.x === x && n.y === y)) continue;
          return { x, y };
        }
      }
      return null;
    }

    // Home seating: adjacent to chairs/tables inside the building, fallback to free interior
    function chooseHomeSeat(ctx, building) {
      if (!building) return null;
      const props = Array.isArray(ctx.townProps) ? ctx.townProps : [];
      const seats = [];
      for (const p of props) {
        if (p.type !== "chair" && p.type !== "table") continue;
        if (!(p.x > building.x && p.x < building.x + building.w - 1 && p.y > building.y && p.y < building.y + building.h - 1)) continue;
        const adj = nearestFreeAdjacent(ctx, p.x, p.y, building);
        if (adj) seats.push(adj);
      }
      if (seats.length) return seats[randInt(ctx, 0, seats.length - 1)];
      return firstFreeInteriorTile(ctx, building);
    }

    // Seat tiles inside a building (chair/bench props positions themselves)
    function homeSeatTiles(ctx, building) {
      if (!building) return [];
      const props = Array.isArray(ctx.townProps) ? ctx.townProps : [];
      const out = [];
      for (const p of props) {
        const t = String(p.type || "").toLowerCase();
        if (t !== "chair" && t !== "bench") continue;
        if (p.x > building.x && p.x < building.x + building.w - 1 && p.y > building.y && p.y < building.y + building.h - 1) {
          out.push({ x: p.x, y: p.y });
        }
      }
      return out;
    }

    // Lightweight per-NPC rate limiting: each NPC only acts every N ticks.
    // Defaults: residents/shopkeepers every 2 ticks, pets every 3 ticks, generic 2.
    const tickMod = ((t && typeof t.turnCounter === "number") ? t.turnCounter : 0) | 0;
    function shouldSkipThisTick(n, idx) {
      // Guards: always act every tick to keep patrols visible.
      if (n.isGuard) return false;

      // Shopkeepers: during arrive-to-leave window, act every tick (no stride skip)
      if (n.isShopkeeper && n._shopRef) {
        const o = (typeof n._shopRef.openMin === "number") ? n._shopRef.openMin : 8 * 60;
        const c = (typeof n._shopRef.closeMin === "number") ? n._shopRef.closeMin : 18 * 60;
        const arriveStart = (o - 120 + 1440) % 1440; // same window as work intent
        const leaveEnd = (c + 10) % 1440;
        if (inWindow(arriveStart, leaveEnd, minutes, 1440)) return false;
      }
      if (typeof n._stride !== "number") {
        // Pets act less often, shopkeepers at a moderate rate, residents/generic every tick
        n._stride = n.isPet ? 3 : (n.isShopkeeper ? 2 : 1);
      }
      if (typeof n._strideOffset !== "number") {
        // Deterministic offset from initial index to evenly stagger across the stride
        n._strideOffset = idx % n._stride;
      }

      // Base stride scheduling
      if ((tickMod % n._stride) !== n._strideOffset) return true;

      // Additional throttling for far-off NPCs: those far from the player act at half the
      // stride frequency on top of the normal schedule. This keeps distant crowds cheap
      // while preserving smooth motion near the player.
      try {
        if (player && typeof player.x === "number" && typeof player.y === "number") {
          const d = Math.abs(n.x - player.x) + Math.abs(n.y - player.y);
          if (d > 24) {
            // Use tickMod+idx so different NPCs de-phase relative to each other.
            if (((tickMod + idx) & 1) === 1) return true;
          }
        }
      } catch (_) {}

      return false;
    }

    // Staggered home-start window (18:00–21:00)
    function ensureHomeStart(n) {
      if (typeof n._homeStartMin !== "number") {
        const base = 18 * 60;
        const spread = 3 * 60; // 3 hours
        n._homeStartMin = base + Math.floor(ctx.rng() * spread);
      }
    }

    // Build a relaxed occupancy for debug visualization:
    // - Ignore other NPCs and the player so we show the "theoretical" full path
    // - Keep blocking furniture and map boundaries
    function makeRelaxedOcc() {
      const r = new Set();
      if (Array.isArray(townProps)) {
        for (const p of townProps) {
          if (propBlocks(p.type)) r.add(`${p.x},${p.y}`);
        }
      }
      return r;
    }

    function concatPaths(a, b) {
      if (!a || !b) return a || b || null;
      if (a.length === 0) return b.slice(0);
      if (b.length === 0) return a.slice(0);
      // Avoid duplicating the connecting node
      const res = a.slice(0);
      const firstB = b[0];
      const lastA = a[a.length - 1];
      const skipFirst = (firstB.x === lastA.x && firstB.y === lastA.y);
      for (let i = skipFirst ? 1 : 0; i < b.length; i++) res.push(b[i]);
      return res;
    }

    // Compute a two-stage home path for visualization (relaxed occupancy)
    function computeHomePath(ctx, n) {
      if (!n._home || !n._home.building) return null;
      const B = n._home.building;
      const relaxedOcc = makeRelaxedOcc();

      // Adjust target inside the building to a free interior tile
      let targetInside = n._home.bed ? { x: n._home.bed.x, y: n._home.bed.y } : { x: n._home.x, y: n._home.y };
      targetInside = adjustInteriorTarget(ctx, B, targetInside);

      const insideNow = insideBuilding(B, n.x, n.y);
      let path = null;

      if (!insideNow) {
        const door = B.door || nearestFreeAdjacent(ctx, B.x + ((B.w / 2) | 0), B.y, null);
        if (!door) return null;

        // Stage 1: path to door (outside)
        const p1 = computePath(ctx, relaxedOcc, n.x, n.y, door.x, door.y, { ignorePlayer: true });

        // Stage 2: step just inside, then path to targetInterior
        let inSpot = nearestFreeAdjacent(ctx, door.x, door.y, B);
        if (!inSpot) {
          // Deterministic fallback: use first free interior spot
          inSpot = (function firstFreeInteriorSpot() {
            for (let y = B.y + 1; y < B.y + B.h - 1; y++) {
              for (let x = B.x + 1; x < B.x + B.w - 1; x++) {
                if (ctx.map[y][x] !== ctx.TILES.FLOOR) continue;
                if ((ctx.townProps || []).some(p => p.x === x && p.y === y && p.type && p.type !== "sign" && p.type !== "rug")) continue;
                return { x, y };
              }
            }
            return null;
          })();
        }
        inSpot = inSpot || targetInside || { x: door.x, y: door.y };
        const p2 = computePath(ctx, relaxedOcc, inSpot.x, inSpot.y, targetInside.x, targetInside.y, { ignorePlayer: true });

        // Combine; if p1 missing, still try to show interior path
        path = concatPaths(p1, p2);
      } else {
        // Already inside: direct interior path
        path = computePath(ctx, relaxedOcc, n.x, n.y, targetInside.x, targetInside.y, { ignorePlayer: true });
      }
      // Treat a 1-node path as "already at home"
      return (path && path.length >= 1) ? path : null;
    }

    // Movement path to home with runtime occupancy; NPC will follow this plan strictly and wait if blocked.
    function ensureHomePlan(ctx, occ, n) {
      if (!n._home || !n._home.building) { n._homePlan = null; n._homePlanGoal = null; return; }

      // Throttle recomputation if we've recently failed or just recomputed
      if (n._homePlanCooldown && n._homePlanCooldown > 0) {
        return;
      }

      const B = n._home.building;
      let targetInside = n._home.bed ? { x: n._home.bed.x, y: n._home.bed.y } : { x: n._home.x, y: n._home.y };
      targetInside = adjustInteriorTarget(ctx, B, targetInside);

      // If we already have a plan to the same goal, keep it
      if (n._homePlan && n._homePlanGoal &&
          n._homePlanGoal.x === targetInside.x && n._homePlanGoal.y === targetInside.y) {
        return;
      }

      const insideNow = insideBuilding(B, n.x, n.y);
      let plan = null;

      if (!insideNow) {
        // Prefer memoized door if present
        const doorCandidate = (n._homeDoor && typeof n._homeDoor.x === "number") ? n._homeDoor
                             : (B.door || nearestFreeAdjacent(ctx, B.x + ((B.w / 2) | 0), B.y, null));
        const door = doorCandidate || null;
        if (!door) { n._homePlan = null; n._homePlanGoal = null; n._homePlanCooldown = 6; return; }
        // Memoize door for future calls
        n._homeDoor = { x: door.x, y: door.y };

        const p1 = computePathBudgeted(ctx, occ, n.x, n.y, door.x, door.y);
        const inSpot = nearestFreeAdjacent(ctx, door.x, door.y, B) || targetInside || { x: door.x, y: door.y };
        const p2 = computePathBudgeted(ctx, occ, inSpot.x, inSpot.y, targetInside.x, targetInside.y);
        plan = concatPaths(p1, p2);
      } else {
        plan = computePathBudgeted(ctx, occ, n.x, n.y, targetInside.x, targetInside.y);
      }

      if (plan && plan.length >= 2) {
        n._homePlan = plan.slice(0);
        n._homePlanGoal = { x: targetInside.x, y: targetInside.y };
        n._homeWait = 0;
        n._homePlanCooldown = 5; // small cooldown after computing a plan
      } else {
        n._homePlan = null;
        n._homePlanGoal = null;
        n._homePlanCooldown = 8; // backoff when failing to compute
      }
    }

    function followHomePlan(ctx, occ, n) {
      if (!n._homePlan || n._homePlan.length < 2) return false;
      // Re-sync plan to current position
      if (n._homePlan[0].x !== n.x || n._homePlan[0].y !== n.y) {
        const idx = n._homePlan.findIndex(p => p.x === n.x && p.y === n.y);
        if (idx >= 0) {
          n._homePlan = n._homePlan.slice(idx);
        } else {
          // Lost the plan; recompute once (throttled)
          ensureHomePlan(ctx, occ, n);
        }
      }
      if (!n._homePlan || n._homePlan.length < 2) return false;
      const next = n._homePlan[1];
      const keyNext = `${next.x},${next.y}`;
      // If next step blocked, wait a bit, then recompute (throttled)
      if (occ.has(keyNext) || !isWalkTown(ctx, next.x, next.y)) {
        n._homeWait = (n._homeWait || 0) + 1;
        if (n._homeWait >= 3) {
          // Set a cooldown so we don't thrash on recomputation
          n._homePlanCooldown = Math.max(n._homePlanCooldown || 0, 4);
          ensureHomePlan(ctx, occ, n);
        }
        // Do not move this turn
        return true; // consumed intent by waiting
      }
      // Take the step
      occ.delete(`${n.x},${n.y}`); n.x = next.x; n.y = next.y; occ.add(`${n.x},${n.y}`);
      n._homePlan = n._homePlan.slice(1);
      n._homeWait = 0;
      return true;
    }

    // Precompute debug home paths when enabled (non-destructive to behavior)
    if (typeof window !== "undefined" && window.DEBUG_TOWN_HOME_PATHS) {
      try {
        for (const n of npcs) {
          const path = computeHomePath(ctx, n);
          // Consider a 1-node path as "already at home" (reachable)
          n._homeDebugPath = (path && path.length >= 1) ? path.slice(0) : null;
        }
      } catch (_) {}
    } else {
      // Clear any previous debug data when disabled
      for (const n of npcs) { n._homeDebugPath = null; }
    }

    // Precompute current-destination route debug paths when enabled
    if (typeof window !== "undefined" && window.DEBUG_TOWN_ROUTE_PATHS) {
      try {
        const relaxedOcc = makeRelaxedOcc();
        function currentTargetFor(n) {
          const minutesNow = minutes;
          const phaseNow = phase;
          if (n.isShopkeeper) {
            const shop = n._shopRef || null;
            const o = shop ? shop.openMin : 8 * 60;
            const c = shop ? shop.closeMin : 18 * 60;
            const arriveStart = (o - 60 + 1440) % 1440;
            const leaveEnd = (c + 30) % 1440;
            const shouldBeAtWorkZone = inWindow(arriveStart, leaveEnd, minutesNow, 1440);
            const openNow = isOpenAt(shop, minutesNow, 1440);
            if (shouldBeAtWorkZone) {
              if (openNow && n._workInside && shop && shop.building) {
                return n._workInside;
              } else if (n._work) {
                return n._work;
              }
            } else if (n._home) {
              return n._home.bed ? n._home.bed : { x: n._home.x, y: n._home.y };
            }
            return null;
          } else if (n.isResident) {
            if (phaseNow === "evening") {
              return n._home ? (n._home.bed ? n._home.bed : { x: n._home.x, y: n._home.y }) : null;
            } else if (phaseNow === "day") {
              return n._work || (ctx.townPlaza ? { x: ctx.townPlaza.x, y: ctx.townPlaza.y } : null);
            } else if (phaseNow === "morning") {
              return n._home ? { x: n._home.x, y: n._home.y } : null;
            } else {
              return n._home ? { x: n._home.x, y: n._home.y } : null;
            }
          } else {
            if (phaseNow === "morning") return n._home ? { x: n._home.x, y: n._home.y } : null;
            else if (phaseNow === "day") return (n._work || ctx.townPlaza);
            else return n._home ? { x: n._home.x, y: n._home.y } : null;
          }
        }
        for (const n of npcs) {
          const target = currentTargetFor(n);
          if (!target) { n._routeDebugPath = null; continue; }
          const path = computePath(ctx, relaxedOcc, n.x, n.y, target.x, target.y, { ignorePlayer: true });
          n._routeDebugPath = (path && path.length >= 2) ? path.slice(0) : null;
        }
      } catch (_) {}
    } else {
      for (const n of npcs) { n._routeDebugPath = null; }
    }

    // Shuffle iteration
    const order = npcs.map((_, i) => i);
    {
      const rnd = rngFor(ctx);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const tmp = order[i];
        order[i] = order[j];
        order[j] = tmp;
      }
    }

    // Global per-tick cap: only let a subset of NPCs run full behavior each town tick.
    // This keeps pathfinding and scheduling from blowing up in large towns.
    const npcCount = npcs.length;
    const maxActiveThisTick = (typeof ctx.townMaxActiveNPCs === "number")
      ? Math.max(8, ctx.townMaxActiveNPCs | 0)
      : Math.max(12, Math.floor(npcCount * 0.6));
    let activeSoFar = 0;

    function routeIntoBuilding(ctx, occ, n, building, targetInside) {
      // Adjust unreachable interior targets (like beds) to a free adjacent tile
      const adjTarget = targetInside ? adjustInteriorTarget(ctx, building, targetInside) : null;

      // If outside the building, aim for the door first
      const insideNow = insideBuilding(building, n.x, n.y);
      if (!insideNow) {
        // Prefer building.door; otherwise choose a reasonable perimeter tile near center
        const candidate = building.door || nearestFreeAdjacent(ctx, building.x + ((building.w / 2) | 0), building.y, null);
        if (candidate) {
          const door = { x: candidate.x, y: candidate.y };
          if (n.x === door.x && n.y === door.y) {
            // Step just inside to a free interior tile (planned)
            const inSpot = nearestFreeAdjacent(ctx, door.x, door.y, building) || adjTarget || { x: door.x, y: door.y };
            stepTowards(ctx, occ, n, inSpot.x, inSpot.y, { urgent: !!n.isShopkeeper });
            return true;
          }
          // Plan/step toward the door, persist plan across turns
          stepTowards(ctx, occ, n, door.x, door.y, { urgent: !!n.isShopkeeper });
          return true;
        }
      } else {
        // Already inside: go to targetInside or nearest free interior tile
        // If already at the adjusted target, treat as handled and stay put
        if (adjTarget && n.x === adjTarget.x && n.y === adjTarget.y) {
          return true;
        }
        const inSpot = (adjTarget && isFreeTile(ctx, adjTarget.x, adjTarget.y))
          ? adjTarget
          : nearestFreeAdjacent(ctx, adjTarget ? adjTarget.x : n.x, adjTarget ? adjTarget.y : n.y, building);
        if (inSpot) {
          // If already at the chosen spot, stay put
          if (n.x === inSpot.x && n.y === inSpot.y) return true;
          stepTowards(ctx, occ, n, inSpot.x, inSpot.y);
          return true;
        }
        // No viable interior target: staying inside is acceptable
        return true;
      }
      return false;
    }

    for (const idx of order) {
      const n = npcs[idx];
      ensureHome(ctx, n);

      // Per-NPC tick rate limiting (skip some NPCs this tick to reduce CPU)
      if (shouldSkipThisTick(n, idx)) continue;

      // Global cap: once we've let enough NPCs act this tick, stop processing.
      if (activeSoFar >= maxActiveThisTick) break;
      activeSoFar++;

      // Daily scheduling: reset stagger assignment at dawn, assign in morning if missing
      if (t && t.phase === "dawn") {
        n._departAssignedForDay = false;
        // Pre-home Inn visit plan: on some days residents who like the Inn will stop by before going home
        if (n.isResident) {
          n._innPreHomeDone = false;
          n._goInnToday = !!n._likesInn && (ctx.rng() < 0.33); // ~33% of days
        }
      }
      if (t && t.phase === "morning" && !n._departAssignedForDay) {
        n._homeDepartMin = randInt(ctx, 18 * 60, 21 * 60); // 18:00..21:00
        n._departAssignedForDay = true;
      }

      // Decay any per-NPC cooldown counters each turn
      if (n._homePlanCooldown && n._homePlanCooldown > 0) {
        n._homePlanCooldown--;
      }

      // Pets
      if (n.isPet) {
        if (ctx.rng() < 0.6) continue;
        stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
        continue;
      }

      // Town guards: patrol towns/cities, but use the guard barracks as their home for sleep/off-duty rest.
      if (n.isGuard) {
        // During a bandit event, guards prioritize fighting bandits near the gate.
        if (banditEvent && anyBandit) {
          const target = nearestBandit(ctx, n);
          if (target) {
            const d = dist1(n.x, n.y, target.x, target.y);
            if (d === 1) {
              // Use simpler town hit logic for guard vs bandit to keep deaths fast and reliable.
              applyHit(n, target, 4, 8);
              continue;
            }
            stepTowards(ctx, occ, n, target.x, target.y, { urgent: true });
            continue;
          }
        }

        const home = n._home && n._home.building ? n._home.building : null;
        const isBarracks = !!(home && home.prefabId && String(home.prefabId).toLowerCase().includes("guard_barracks"));

        // Night rest window (22:00–06:00 local time)
        const GUARD_REST_START = 22 * 60;
        const GUARD_REST_END = 6 * 60;
        const wantsRest = isBarracks && inWindow(GUARD_REST_START, GUARD_REST_END, minutes, 1440);

        // Wake sleeping guards outside rest window or in the morning
        if (n._sleeping) {
          if (!wantsRest || phase === "morning") {
            n._sleeping = false;
          } else {
            // Stay asleep during the rest window
            continue;
          }
        }

        // Assign a stable rest/duty role per guard so some stay on duty while others use the barracks.
        if (typeof n._guardRestRole !== "string") {
          // Roughly half of guards rest at night; others stay on duty
          n._guardRestRole = (ctx.rng() < 0.5) ? "rest" : "duty";
        }

        // Off-duty behavior: go to barracks and sleep on a bed during rest window
        if (wantsRest && n._guardRestRole === "rest" && home) {
          // Preferred rest target: guard's assigned home bed (unique per building), else home coords, else any barracks bed.
          let target = null;
          try {
            if (n._home && n._home.bed) {
              target = { x: n._home.bed.x, y: n._home.bed.y };
            } else if (n._home && typeof n._home.x === "number" && typeof n._home.y === "number") {
              target = { x: n._home.x, y: n._home.y };
            } else {
              const bedList = bedsFor(ctx, home);
              if (bedList.length) {
                const b0 = bedList[0];
                target = { x: b0.x, y: b0.y };
              }
            }
          } catch (_) {}

          // Already at target or exactly on a bed tile: go to sleep
          if (target) {
            const atTarget = (n.x === target.x && n.y === target.y);
            let onBed = false;
            try {
              const bedList = bedsFor(ctx, home);
              for (let i = 0; i < bedList.length && !onBed; i++) {
                const b = bedList[i];
                if (n.x === b.x && n.y === b.y) onBed = true;
              }
            } catch (_) {}
            if (atTarget || onBed) {
              n._sleeping = true;
              continue;
            }
          }

          if (target && routeIntoBuilding(ctx, occ, n, home, target)) {
            continue;
          }
          if (target) {
            stepTowards(ctx, occ, n, target.x, target.y, { urgent: true });
            continue;
          }
          // If we somehow have no usable target, fall through to patrol logic.
        }

        // On-duty behavior (or no barracks): patrol as before
        const sizeKey = ctx.townSize || "big";
        let patrolRadius = 8;
        if (sizeKey === "small") patrolRadius = 6;
        else if (sizeKey === "city") patrolRadius = 10;

        // Stable guard post as patrol center
        if (!n._guardPost || typeof n._guardPost.x !== "number" || typeof n._guardPost.y !== "number") {
          n._guardPost = { x: n.x, y: n.y };
        }
        const post = n._guardPost;
        const distFromPost = manhattan(n.x, n.y, post.x, post.y);

        // If somehow very far from post (e.g. teleported), head back first
        if (distFromPost > patrolRadius + 2) {
          stepTowards(ctx, occ, n, post.x, post.y, { urgent: true });
          continue;
        }

        // Reached current patrol goal: linger briefly, then pick a new one
        if (n._guardPatrolGoal && n.x === n._guardPatrolGoal.x && n.y === n._guardPatrolGoal.y) {
          n._guardPatrolWait = randInt(ctx, 4, 10);
          n._guardPatrolGoal = null;
        }

        if (n._guardPatrolWait && n._guardPatrolWait > 0) {
          n._guardPatrolWait--;
          if (ctx.rng() < 0.10) {
            stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
          }
          continue;
        }

        if (!n._guardPatrolGoal) {
          const centerX = post.x;
          const centerY = post.y;
          const rows = ctx.map.length;
          const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
          const roadTiles = [];
          const floorTiles = [];

          // Sample candidate patrol tiles around the post, preferring roads
          for (let t = 0; t < 40; t++) {
            const dx = randInt(ctx, -patrolRadius, patrolRadius);
            const dy = randInt(ctx, -patrolRadius, patrolRadius);
            const tx = centerX + dx;
            const ty = centerY + dy;
            if (tx < 1 || ty < 1 || ty >= rows - 1 || tx >= cols - 1) continue;
            if (!isWalkTown(ctx, tx, ty)) continue;
            if (ctx.player.x === tx && ctx.player.y === ty) continue;
            const tile = ctx.map[ty][tx];
            if (tile === ctx.TILES.ROAD) roadTiles.push({ x: tx, y: ty });
            else floorTiles.push({ x: tx, y: ty });
          }

          let goal = null;
          if (roadTiles.length) {
            goal = roadTiles[randInt(ctx, 0, roadTiles.length - 1)];
          } else if (floorTiles.length) {
            goal = floorTiles[randInt(ctx, 0, floorTiles.length - 1)];
          } else {
            goal = { x: post.x, y: post.y };
          }

          // Occasionally bias guards toward watching the gate or plaza if nearby
          try {
            const gx = ctx.townExitAt ? ctx.townExitAt.x : null;
            const gy = ctx.townExitAt ? ctx.townExitAt.y : null;
            if (gx != null && gy != null && ctx.rng() < 0.35) {
              const dGate = manhattan(post.x, post.y, gx, gy);
              if (dGate <= patrolRadius * 2) {
                goal = { x: gx, y: gy };
              }
            } else if (ctx.townPlaza && ctx.rng() < 0.35) {
              goal = { x: ctx.townPlaza.x, y: ctx.townPlaza.y };
            }
          } catch (_) {}

          n._guardPatrolGoal = goal;
        }

        if (n._guardPatrolGoal) {
          stepTowards(ctx, occ, n, n._guardPatrolGoal.x, n._guardPatrolGoal.y, { urgent: true });
        } else {
          stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
        }
        continue;
      }

      // Corpse cleaners: remove corpses when present in town.
      if (n.isCorpseCleaner && Array.isArray(ctx.corpses) && ctx.corpses.length) {
        const corpses = ctx.corpses;
        let best = null;
        let bestD = Infinity;
        for (const c of corpses) {
          if (!c) continue;
          const d = dist1(n.x, n.y, c.x, c.y);
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
        if (best) {
          if (bestD === 0) {
            // Remove this corpse from town.
            try {
              ctx.corpses = corpses.filter(
                c => !(c && c.x === best.x && c.y === best.y)
              );
              if (ctx.log) {
                ctx.log(
                  `${n.name || "Caretaker"} removes a body from the street.`,
                  "info"
                );
              }
            } catch (_) {}
            continue;
          } else {
            stepTowards(ctx, occ, n, best.x, best.y, { urgent: true });
            continue;
          }
        }
      }

      // Shopkeepers with schedule
      if (n.isShopkeeper) {
        const shop = n._shopRef || null;
        const isInnKeeper = shop && String(shop.type || "").toLowerCase() === "inn";
        if (isInnKeeper && shop && shop.building) {
          // Innkeeper: always inside the Inn, and patrol within it
          n._atWork = true;
          const innB = shop.building;
          const insideNow = insideBuilding(innB, n.x, n.y);
          if (!insideNow) {
            const targetInside = n._workInside || shop.inside || { x: shop.x, y: shop.y };
            routeIntoBuilding(ctx, occ, n, innB, targetInside);
            continue;
          }
          // Inside: patrol between interior spots (chairs/tables or free interior) on the ground floor only
          // Force ground floor for innkeeper
          n._floor = "ground";
          // Arrived at patrol goal?
          if (n._patrolGoal && n.x === n._patrolGoal.x && n.y === n._patrolGoal.y) {
            n._patrolStayTurns = randInt(ctx, 8, 14);
            n._patrolGoal = null;
          }
          if (n._patrolStayTurns && n._patrolStayTurns > 0) {
            n._patrolStayTurns--;
            // slight fidget to look alive (stay inside)
            if (ctx.rng() < 0.08) stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
            continue;
          }
          if (!n._patrolGoal) {
            // Ground-only patrol target: choose a seat or free interior tile
            const seat = chooseInnSeat(ctx);
            const next = seat || firstFreeInteriorTile(ctx, innB) || (function () {
              try { return randomInteriorSpot(ctx, innB); } catch (_) { return null; }
            })() || null;
            if (next && !(next.x === n.x && next.y === n.y)) {
              n._patrolGoal = { x: next.x, y: next.y };
            }
            // Clear any stale upstairs goal
            n._patrolGoalUp = null;
          }
          if (n._patrolGoal) {
            stepTowards(ctx, occ, n, n._patrolGoal.x, n._patrolGoal.y, { urgent: true });
            continue;
          }
          // As a last resort, small idle move
          stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
          continue;
        }

        const o = shop ? shop.openMin : 8 * 60;
        const c = shop ? shop.closeMin : 18 * 60;
        // Arrive earlier and leave shortly after close to avoid lingering
        const arriveStart = (o - 120 + 1440) % 1440; // 2 hours before open
        const leaveEnd = (c + 10) % 1440;           // 10 minutes after close
        const shouldBeAtWorkZone = inWindow(arriveStart, leaveEnd, minutes, 1440);
        const openNow = isOpenAt(shop, minutes, 1440);

        let handled = false;
        if (shouldBeAtWorkZone) {
          // Mark working state for diagnostics/UI
          n._atWork = !!openNow;
          if (openNow && n._workInside && shop && shop.building) {
            handled = routeIntoBuilding(ctx, occ, n, shop.building, n._workInside);
          } else if (n._work) {
            handled = stepTowards(ctx, occ, n, n._work.x, n._work.y, { urgent: true });
          }
        } else {
          n._atWork = false;
        }

        if (!handled && !shouldBeAtWorkZone && n._home && n._home.building) {
          // Off hours: stagger departure between 18:00-21:00
          const departReady = typeof n._homeDepartMin === "number" ? (minutes >= n._homeDepartMin) : true;

          // If it's very late and the NPC is not inside home, seek Inn as fallback shelter.
          // Prefer upstairs beds when available.
          if (inLateWindow && !(insideBuilding(n._home.building, n.x, n.y))) {
            const innB = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
            if (innB) {
              const upBed = chooseInnUpstairsBed(ctx);
              if (upBed && routeIntoInnUpstairs(ctx, occ, n, upBed)) {
                handled = true;
              } else {
                const innTarget = chooseInnTarget(ctx);
                handled = routeIntoBuilding(ctx, occ, n, innB, innTarget);
              }
            }
          }

          // Pre-home Inn stop on some days for residents who like the Inn:
          // Occurs before the personal home departure minute, early evening window.
          if (!handled) {
            const innB0 = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
            const preHomeWindowEnd = (typeof n._homeDepartMin === "number") ? n._homeDepartMin : (20 * 60);
            if (innB0 && n._goInnToday && !n._innPreHomeDone && minutes < preHomeWindowEnd) {
              // Arrived at seat?
              if (n._innSeatGoal && insideBuilding(innB0, n.x, n.y) &&
                  n.x === n._innSeatGoal.x && n.y === n._innSeatGoal.y) {
                n._innStayTurns = randInt(ctx, 4, 10); // ~16–40 minutes
                n._innSeatGoal = null;
                n._innPreHomeDone = true;
                handled = true;
              } else if (n._innStayTurns && n._innStayTurns > 0) {
                n._innStayTurns--;
                if (ctx.rng() < 0.15) stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
                handled = true;
              } else if (!n._innSeatGoal && (_innSeatersNow < _innSeatCap)) {
                const seatPH = chooseInnSeat(ctx);
                if (seatPH && routeIntoBuilding(ctx, occ, n, innB0, seatPH)) {
                  n._innSeatGoal = { x: seatPH.x, y: seatPH.y };
                  _innSeatersNow++;
                  handled = true;
                }
              }
            }
          }

          if (!handled && !departReady) {
            // Not yet time: linger briefly near the plaza (avoid lingering at shop door)
            const linger = (ctx.townPlaza ? { x: ctx.townPlaza.x, y: ctx.townPlaza.y } : null);
            if (linger) {
              if (n.x === linger.x && n.y === linger.y) {
                if (ctx.rng() < 0.7) continue; // reduce idle chance to avoid long lingering
                stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
              } else {
                stepTowards(ctx, occ, n, linger.x, linger.y);
              }
              handled = true;
            }
          } else if (!handled) {
            // Go home strictly along a planned path; wait if blocked
            const sleepTarget = n._home.bed ? { x: n._home.bed.x, y: n._home.bed.y } : { x: n._home.x, y: n._home.y };
            if (!n._homePlan || !n._homePlanGoal) {
              ensureHomePlan(ctx, occ, n);
            }
            handled = followHomePlan(ctx, occ, n);
            if (!handled) {
              // Fallback: route via door
              handled = routeIntoBuilding(ctx, occ, n, n._home.building, sleepTarget);
            }
          }
        }

        if (handled) continue;

        // idle jiggle: occasionally take a small step to avoid total idling
        if (ctx.rng() < 0.15) {
          stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
        }
        continue;
      }

      // Bandits in town: combat AI during bandit event (can attack player and NPCs)
      if (n.isBandit && banditEvent) {
        if (n._dead) { continue; }

        // Prefer to attack the player if adjacent
        if (dist1(n.x, n.y, player.x, player.y) === 1) {
          banditAttackPlayer(n);
          continue;
        }

        // Otherwise attack adjacent guard or civilian if possible
        let target = null;
        const list = ctx.npcs || [];
        for (const m of list) {
          if (!m || m._dead) continue;
          if (m === n) continue;
          if (dist1(n.x, n.y, m.x, m.y) !== 1) continue;
          if (m.isGuard || (!m.isPet && !m.isBandit)) {
            target = m;
            break;
          }
        }
        if (target) {
          // Use simpler town hit logic for bandit vs guard/civilian to ensure deaths resolve cleanly.
          applyHit(n, target, 3, 7);
          continue;
        }

        // Otherwise move toward nearest civilian; fallback to nearest guard
        let civ = nearestCivilian(ctx, n);
        if (!civ) civ = nearestBandit(ctx, n); // will be another bandit; minimal fallback
        if (civ) {
          stepTowards(ctx, occ, n, civ.x, civ.y, { urgent: true });
          continue;
        }
        // If no one found, jitter
        stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
        continue;
      }

      // Residents: sleep system
      if (n.isResident) {
        const eveKickIn = minutes >= 17 * 60 + 30; // start pushing home a bit before dusk
        if (n._sleeping) {
          if (phase === "morning") n._sleeping = false;
          else continue;
        }
        if (phase === "evening" || eveKickIn) {
          // Stagger: only start going home after personal departure minute (18:00..21:00)
          const departReady = typeof n._homeDepartMin === "number" ? (minutes >= n._homeDepartMin) : true;

          // Late-night shelter fallback: if very late and not inside home, go to Inn (prefer upstairs beds)
          if (inLateWindow && n._home && n._home.building && !insideBuilding(n._home.building, n.x, n.y)) {
            const innB = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
            if (innB) {
              const upBed = chooseInnUpstairsBed(ctx);
              if (upBed && routeIntoInnUpstairs(ctx, occ, n, upBed)) {
                continue;
              } else {
                const innTarget = chooseInnTarget(ctx);
                if (routeIntoBuilding(ctx, occ, n, innB, innTarget)) continue;
              }
            }
          }

          if (!departReady) {
            // Not yet time to head home: keep day behavior (work/plaza/idle)
            const targetLate = n._work || (ctx.townPlaza ? { x: ctx.townPlaza.x, y: ctx.townPlaza.y } : null);
            if (targetLate) {
              if (n.x === targetLate.x && n.y === targetLate.y) {
                if (ctx.rng() < 0.95) continue;
                stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
                continue;
              }
              stepTowards(ctx, occ, n, targetLate.x, targetLate.y);
              continue;
            }
            // gentle idle
            if (ctx.rng() < 0.90) continue;
          } else if (n._home && n._home.building) {
            // Preferred target: bed if present and free; else a chair/bench tile inside home; else fallback to home coords
            const bedSpot = n._home.bed ? { x: n._home.bed.x, y: n._home.bed.y } : null;
            let sleepTarget = null;
            if (bedSpot && isFreeTile(ctx, bedSpot.x, bedSpot.y)) {
              sleepTarget = bedSpot;
            } else {
              const seats = homeSeatTiles(ctx, n._home.building);
              if (seats.length) {
                // pick closest seat to NPC to reduce wandering
                let pick = seats[0], bd2 = manhattan(n.x, n.y, pick.x, pick.y);
                for (let i = 1; i < seats.length; i++) {
                  const s = seats[i];
                  const d2 = manhattan(n.x, n.y, s.x, s.y);
                  if (d2 < bd2) { bd2 = d2; pick = s; }
                }
                sleepTarget = pick;
              } else {
                sleepTarget = { x: n._home.x, y: n._home.y };
              }
            }
            const atExact = (sleepTarget && n.x === sleepTarget.x && n.y === sleepTarget.y);
            // Sleep only when exactly on the chosen sleep target (bed or fallback spot)
            if (atExact) {
              n._sleeping = true;
              continue;
            }
            // Upstairs inn sleeping: if inside inn upstairs and near an upstairs bed during late night
            if (inLateWindow && ctx.tavern && ctx.tavern.building && n._floor === "upstairs" && inUpstairsInterior(ctx, n.x, n.y)) {
              const bedsUp = innUpstairsBeds(ctx);
              for (let i = 0; i < bedsUp.length; i++) {
                const b = bedsUp[i];
                if (manhattan(n.x, n.y, b.x, b.y) === 0) { n._sleeping = true; break; }
              }
              if (n._sleeping) continue;
            }
            // Ensure and follow a deterministic home plan; if blocked, wait and retry
            if (!n._homePlan || !n._homePlanGoal) {
              // Plan toward chosen sleepTarget
              n._homePlan = null; n._homePlanGoal = null;
            }
            // If inside building and we have a seat/bed target, step toward it; else use general home plan
            if (sleepTarget && insideBuilding(n._home.building, n.x, n.y)) {
              if (stepTowards(ctx, occ, n, sleepTarget.x, sleepTarget.y)) continue;
            }
            if (!n._homePlan || !n._homePlanGoal) {
              ensureHomePlan(ctx, occ, n);
            }
            if (followHomePlan(ctx, occ, n)) continue;
            // Fallback: attempt routing via door if plan absent
            if (routeIntoBuilding(ctx, occ, n, n._home.building, sleepTarget || { x: n._home.x, y: n._home.y })) continue;

            // If still not able to go home and it's very late, seek Inn
            if (inLateWindow) {
              const innB = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
              if (innB) {
                const innTarget = chooseInnTarget(ctx);
                if (routeIntoBuilding(ctx, occ, n, innB, innTarget)) continue;
              }
            }
          }
          // If no home data for some reason, stop wandering at evening
          continue;
        } else if (phase === "day") {
          // Daytime Inn visit behavior: sit for a short while if at a seat
          const innB = (ctx.tavern && ctx.tavern.building) ? ctx.tavern.building : null;
          if (innB) {
            if (n._innSeatGoal && insideBuilding(innB, n.x, n.y) &&
                n.x === n._innSeatGoal.x && n.y === n._innSeatGoal.y) {
              // Arrived at seat: sit for a few turns
              n._innStayTurns = randInt(ctx, 10, 20);
              n._innSeatGoal = null;
            }
            if (n._innStayTurns && n._innStayTurns > 0) {
              n._innStayTurns--;
              // Occasionally fidget while seated
              if (ctx.rng() < 0.08) stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
              continue;
            }
          }
          // Occasionally visit the tavern (Inn) to sit; plus bench/home sitting options.
          // Rain makes the inn more attractive compared to standing outside.
          if (innB) {
            let baseChance = n._likesInn ? 0.20 : 0.06;
            if (isRainy) baseChance *= 1.5;
            if (isHeavyRain) baseChance *= 1.4;
            if (baseChance > 0.6) baseChance = 0.6;
            const wantTavern = ctx.rng() < baseChance;
            if (wantTavern && !n._innSeatGoal && !n._benchSeatGoal && !n._homeSitGoal && (_innSeatersNow < _innSeatCap)) {
              // 50% chance to target upstairs seating when available
              let targeted = false;
              if (ctx.innUpstairs && ctx.rng() < 0.5) {
                const seatUp = chooseInnUpstairsSeat(ctx);
                if (seatUp) {
                  targeted = routeIntoInnUpstairs(ctx, occ, n, seatUp);
                  if (targeted) { n._innSeatGoal = { x: seatUp.x, y: seatUp.y }; _innSeatersNow++; continue; }
                }
              }
              const seat = chooseInnSeat(ctx);
              if (seat) {
                n._innSeatGoal = { x: seat.x, y: seat.y };
                if (routeIntoBuilding(ctx, occ, n, innB, seat)) { _innSeatersNow++; continue; }
              }
            }
          }
          
          // Home sitting: arrive/stay and occasional
          if (n._homeSitGoal && n.x === n._homeSitGoal.x && n.y === n._homeSitGoal.y) {
            n._homeSitTurns = randInt(ctx, 16, 32); // longer seated time at home
            n._homeSitGoal = null;
          }
          if (n._homeSitTurns && n._homeSitTurns > 0) {
            n._homeSitTurns--;
            if (ctx.rng() < 0.06) stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
            continue;
          }
          if (n._home && n._home.building && !n._homeSitGoal && !n._tavernSeatGoal && !n._benchSeatGoal) {
            const wantHomeSit = ctx.rng() < 0.15;
            if (wantHomeSit) {
              const seatH = chooseHomeSeat(ctx, n._home.building);
              if (seatH) {
                n._homeSitGoal = { x: seatH.x, y: seatH.y };
                stepTowards(ctx, occ, n, seatH.x, seatH.y);
                continue;
              }
            }
          }
          // In heavy rain, some residents prefer to head home instead of lingering outdoors.
          if (isHeavyRain && n._home && n._home.building && !insideBuilding(n._home.building, n.x, n.y)) {
            if (ctx.rng() < 0.6) {
              const homeTarget = n._home.bed ? { x: n._home.bed.x, y: n._home.bed.y } : { x: n._home.x, y: n._home.y };
              if (routeIntoBuilding(ctx, occ, n, n._home.building, homeTarget)) {
                continue;
              }
            }
          }
          // Default day behavior with limited shop-door lingering
          const target = n._work || (ctx.townPlaza ? { x: ctx.townPlaza.x, y: ctx.townPlaza.y } : null);
          if (target) {
            if (n.x === target.x && n.y === target.y) {
              if (n._workIsShopDoor) {
                if (typeof n._errandStayTurns !== "number" || n._errandStayTurns <= 0) {
                  n._errandStayTurns = randInt(ctx, 12, 20); // ~1 hour stay at shop door
                }
                n._errandStayTurns--;
                if (n._errandStayTurns <= 0) {
                  // Move on: clear errand and pick a bench near plaza if available
                  n._work = null; n._workIsShopDoor = false;
                  // Choose a bench seat near the plaza center
                  let seat = null;
                  try { seat = chooseBenchSeat(ctx); } catch (_) {}
                  if (seat) {
                    stepTowards(ctx, occ, n, seat.x, seat.y);
                  } else {
                    stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
                  }
                  continue;
                } else {
                  // brief fidget while waiting
                  if (ctx.rng() < 0.10) stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
                  continue;
                }
              } else {
                // Non-shop errand: reduced idle lingering
                if (ctx.rng() < 0.75) continue;
                stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
                continue;
              }
            }
            stepTowards(ctx, occ, n, target.x, target.y);
            continue;
          }
        } else if (phase === "morning") {
          if (n._home && n._home.building) {
            const homeTarget = { x: n._home.x, y: n._home.y };
            if (!n._homePlan || !n._homePlanGoal) {
              ensureHomePlan(ctx, occ, n);
            }
            if (followHomePlan(ctx, occ, n)) continue;
            if (routeIntoBuilding(ctx, occ, n, n._home.building, homeTarget)) continue;
          }
        }
        stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
        continue;
      }

      // Generic NPCs
      // Sleep handling for generic roamers
      if (n._sleeping) {
        if (phase === "morning") n._sleeping = false;
        else {
          if (ctx.rng() < 0.10) stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
          continue;
        }
      }

      // Debug: force one roamer to go sleep in Inn upstairs during late night
      if (n._forceInnSleepUpstairs && inLateWindow && ctx.tavern && ctx.innUpstairs && !n._sleeping) {
        // If already upstairs and exactly on a bed tile, sleep
        if (n._floor === "upstairs" && inUpstairsInterior(ctx, n.x, n.y)) {
          const bedsUpList = innUpstairsBeds(ctx);
          for (let i = 0; i < bedsUpList.length; i++) {
            const b = bedsUpList[i];
            if (manhattan(n.x, n.y, b.x, b.y) === 0) { n._sleeping = true; break; }
          }
          if (n._sleeping) continue;
        }
        const bedTarget = chooseInnUpstairsBed(ctx);
        if (bedTarget && routeIntoInnUpstairs(ctx, occ, n, bedTarget)) {
          continue;
        }
      }

      if (ctx.rng() < 0.35) continue;

      // Occasional tavern visit during the day for roamers who like the tavern
      if (phase === "day" && ctx.tavern && (n._likesInn || n._likesTavern)) {
        const innB2 = ctx.tavern.building;
        // If already at an Inn seat, sit for a few turns
        if (n._innSeatGoal && innB2 && insideBuilding(innB2, n.x, n.y) &&
            n.x === n._innSeatGoal.x && n.y === n._innSeatGoal.y) {
          n._innStayTurns = randInt(ctx, 8, 14);
          n._innSeatGoal = null;
        }
        if (n._innStayTurns && n._innStayTurns > 0) {
          n._innStayTurns--;
          if (ctx.rng() < 0.08) stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
          continue;
        }
        const seat2 = chooseInnSeat(ctx);
        if (innB2 && seat2 && (_innSeatersNow < _innSeatCap)) {
          if (routeIntoBuilding(ctx, occ, n, innB2, seat2)) {
            n._innSeatGoal = { x: seat2.x, y: seat2.y };
            _innSeatersNow++;
            continue;
          }
        }
      }
      // Night/evening bench sit/sleep chance
      if ((phase === "evening" || phase === "night") && !n._benchSeatGoal) {
        let baseBenchChance = inLateWindow ? 0.12 : 0.20;
        if (isRainy) baseBenchChance *= 0.4;
        if (isHeavyRain) baseBenchChance *= 0.4;
        if (baseBenchChance > 0 && ctx.rng() < baseBenchChance) {
          const seatB = chooseBenchSeat(ctx);
          if (seatB) {
            n._benchSeatGoal = { x: seatB.x, y: seatB.y };
            stepTowards(ctx, occ, n, seatB.x, seatB.y);
            continue;
          }
        }
      }
      // Arrived at bench seat
      if (n._benchSeatGoal && n.x === n._benchSeatGoal.x && n.y === n._benchSeatGoal.y) {
        if (inLateWindow) {
          if (ctx.rng() < 0.5) {
            n._sleeping = true;
            n._benchSeatGoal = null;
            continue;
          }
        }
        n._benchStayTurns = randInt(ctx, 12, 24);
        n._benchSeatGoal = null;
      }
      if (n._benchStayTurns && n._benchStayTurns > 0) {
        n._benchStayTurns--;
        if (ctx.rng() < 0.06) stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
        continue;
      }

      let target = null;
      if (phase === "morning") target = n._home ? { x: n._home.x, y: n._home.y } : null;
      else if (phase === "day") target = (n._work || ctx.townPlaza);
      else target = (ctx.tavern && (n._likesInn || n._likesTavern)) ? { x: ctx.tavern.door.x, y: ctx.tavern.door.y }
                                                   : (n._home ? { x: n._home.x, y: n._home.y } : null);

      // Very late at night: prefer shelter (Inn/tavern) if not at home
      if (inLateWindow && ctx.tavern && ctx.tavern.building && (!n._home || !insideBuilding(n._home.building, n.x, n.y))) {
        // Prefer upstairs beds in the Inn; else ground seating/door
        const upBed2 = chooseInnUpstairsBed(ctx);
        if (upBed2 && routeIntoInnUpstairs(ctx, occ, n, upBed2)) {
          continue;
        }
        const innB3 = ctx.tavern.building;
        const seatG = chooseInnSeat(ctx);
        if (innB3 && seatG && routeIntoBuilding(ctx, occ, n, innB3, seatG)) {
          continue;
        }
        const doorFallback = { x: ctx.tavern.door.x, y: ctx.tavern.door.y };
        stepTowards(ctx, occ, n, doorFallback.x, doorFallback.y);
        continue;
      }
      // If inside the Inn near a bed during late night, sleep until morning
      {
        const tavB = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
        if (inLateWindow && tavB && n._floor === "upstairs" && inUpstairsInterior(ctx, n.x, n.y)) {
          const bedsUpList = innUpstairsBeds(ctx);
          for (let i = 0; i < bedsUpList.length; i++) {
            const b = bedsUpList[i];
            if (manhattan(n.x, n.y, b.x, b.y) === 0) { n._sleeping = true; break; }
          }
          // If no bed directly underfoot, allow sleeping on a chair upstairs
          if (!n._sleeping) {
            try {
              const up = ctx.innUpstairs;
              const props = Array.isArray(up && up.props) ? up.props : [];
              for (const p of props) {
                if (String(p.type || "").toLowerCase() !== "chair") continue;
                if (manhattan(n.x, n.y, p.x, p.y) === 0) { n._sleeping = true; break; }
              }
            } catch (_) {}
          }
        }
      }

      if (!target) {
        stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
        continue;
      }
      stepTowards(ctx, occ, n, target.x, target.y);
    }
    // Remove any town NPCs marked as dead during this tick and rebuild occupancy once.
    try {
      removeDeadNPCs(ctx);
    } catch (_) {}
    // Clear fast occupancy handle after processing to avoid leaking into other modules
    ctx._occ = null;
  }

  function checkHomeRoutes(ctx, opts = {}) {
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
    const inLateWindow = minutes >= LATE_START && minutes < LATE_END;
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
          for (let y = B.y + 1; y < B.y + B.h - 1 && !inSpot; y++) {
            for (let x = B.x + 1; x < B.x + B.w - 1 && !inSpot; x++) {
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
          for (let i = skipFirst ? 1 : 0; i < b.length; i++) res0.push(b[i]);
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

    for (let i = 0; i < npcs.length; i++) {
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
            x: n.x, y: n.y
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
            x: n.x, y: n.y
          });
        }
      }

      if (shouldSkip(n)) {
        res.skipped++;
        continue;
      }

      // Ensure each NPC has a home before checking
      try { ensureHome(ctx, n); } catch (_) {}

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
      roamersTotal
    };

    return res;
  }

  // Back-compat: attach to window and export for ESM
  export { populateTown, townNPCsAct, checkHomeRoutes };
  if (typeof window !== "undefined") {
    window.TownAI = {
      populateTown,
      townNPCsAct,
      checkHomeRoutes,
    };
  }