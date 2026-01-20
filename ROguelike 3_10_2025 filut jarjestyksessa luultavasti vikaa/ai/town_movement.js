import { computePath, computePathBudgeted } from "./pathfinding.js";
import {
  isWalkTown,
  insideBuilding,
  propBlocks,
  isFreeTile,
  nearestFreeAdjacent,
  adjustInteriorTarget,
} from "./town_helpers.js";
import { routeIntoInnUpstairs as routeIntoInnUpstairsCore } from "./town_inn_upstairs.js";

// Pathfinding helpers (budget + stepTowards) shared across town AI modules.
// Extracted from town_runtime.js to avoid circular imports and keep behavior focused.

const PATH_BUDGET_MIN = 6;
const PATH_BUDGET_MAX = 32;

function initPathBudget(ctx, npcCount) {
  const phaseNow = (ctx && ctx.time && ctx.time.phase) ? String(ctx.time.phase) : "day";
  const size = (ctx && typeof ctx.townSize === "string") ? ctx.townSize : "big";

  // Base fraction scales with town size and is slightly adjusted by time of day.
  let baseFrac;
  if (size === "small") baseFrac = 0.20;
  else if (size === "city") baseFrac = 0.30;
  else baseFrac = 0.26;

  if (phaseNow === "night") {
    baseFrac *= 0.8;
  } else if (phaseNow === "dusk") {
    baseFrac *= 1.1;
  } else if (phaseNow === "dawn") {
    baseFrac *= 0.9;
  }

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

  if (n._plan && n._planGoal && n._planGoal.x === tx && n._planGoal.y === ty) {
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

  const dirs4 = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];
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

function routeIntoInnUpstairs(ctx, occGround, n, targetUp) {
  return routeIntoInnUpstairsCore(ctx, occGround, n, targetUp, stepTowards);
}

// Build a relaxed occupancy set that includes only blocking town props (no NPCs/player).
function makeRelaxedOcc(ctxLocal) {
  const r = new Set();
  const townProps = Array.isArray(ctxLocal.townProps) ? ctxLocal.townProps : [];
  for (const p of townProps) {
    if (propBlocks(p.type)) r.add(`${p.x},${p.y}`);
  }
  return r;
}

// Concatenate two paths, avoiding duplicate first/last tile.
function concatPaths(a, b) {
  if (!a || !b) return a || b || null;
  if (a.length === 0) return b.slice(0);
  if (b.length === 0) return a.slice(0);
  const res = a.slice(0);
  const firstB = b[0];
  const lastA = a[a.length - 1];
  const skipFirst = (firstB.x === lastA.x && firstB.y === lastA.y);
  for (let i = skipFirst ? 1 : 0; i < b.length; i++) res.push(b[i]);
  return res;
}

// Compute a full path from NPC to its home interior target, using relaxed occupancy.
function computeHomePath(ctxLocal, n) {
  if (!n._home || !n._home.building) return null;
  const B = n._home.building;
  const relaxedOcc = makeRelaxedOcc(ctxLocal);

  let targetInside = n._home.bed ? { x: n._home.bed.x, y: n._home.bed.y } : { x: n._home.x, y: n._home.y };
  targetInside = adjustInteriorTarget(ctxLocal, B, targetInside);

  const insideNow = insideBuilding(B, n.x, n.y);
  let path = null;

  if (!insideNow) {
    const door = B.door || nearestFreeAdjacent(ctxLocal, B.x + ((B.w / 2) | 0), B.y, null);
    if (!door) return null;

    const p1 = computePath(ctxLocal, relaxedOcc, n.x, n.y, door.x, door.y, { ignorePlayer: true });

    let inSpot = nearestFreeAdjacent(ctxLocal, door.x, door.y, B);
    if (!inSpot) {
      inSpot = (function firstFreeInteriorSpot() {
        for (let y = B.y + 1; y < B.y + B.h - 1; y++) {
          for (let x = B.x + 1; x < B.x + B.w - 1; x++) {
            if (ctxLocal.map[y][x] !== ctxLocal.TILES.FLOOR) continue;
            if ((ctxLocal.townProps || []).some(p => p.x === x && p.y === y && p.type && p.type !== "sign" && p.type !== "rug")) continue;
            return { x, y };
          }
        }
        return null;
      })();
    }
    inSpot = inSpot || targetInside || { x: door.x, y: door.y };
    const p2 = computePath(ctxLocal, relaxedOcc, inSpot.x, inSpot.y, targetInside.x, targetInside.y, { ignorePlayer: true });

    path = concatPaths(p1, p2);
  } else {
    path = computePath(ctxLocal, relaxedOcc, n.x, n.y, targetInside.x, targetInside.y, { ignorePlayer: true });
  }
  return (path && path.length >= 1) ? path : null;
}

// Ensure or recompute a budgeted home plan for an NPC using the shared path budget.
function ensureHomePlan(ctxLocal, occLocal, n) {
  if (!n._home || !n._home.building) { n._homePlan = null; n._homePlanGoal = null; return; }

  if (n._homePlanCooldown && n._homePlanCooldown > 0) {
    return;
  }

  const B = n._home.building;
  let targetInside = n._home.bed ? { x: n._home.bed.x, y: n._home.bed.y } : { x: n._home.x, y: n._home.y };
  targetInside = adjustInteriorTarget(ctxLocal, B, targetInside);

  if (n._homePlan && n._homePlanGoal &&
      n._homePlanGoal.x === targetInside.x && n._homePlanGoal.y === targetInside.y) {
    return;
  }

  const insideNow = insideBuilding(B, n.x, n.y);
  let plan = null;

  if (!insideNow) {
    const doorCandidate = (n._homeDoor && typeof n._homeDoor.x === "number") ? n._homeDoor
                         : (B.door || nearestFreeAdjacent(ctxLocal, B.x + ((B.w / 2) | 0), B.y, null));
    const door = doorCandidate || null;
    if (!door) { n._homePlan = null; n._homePlanGoal = null; n._homePlanCooldown = 6; return; }
    n._homeDoor = { x: door.x, y: door.y };

    const p1 = computePathBudgeted(ctxLocal, occLocal, n.x, n.y, door.x, door.y);
    const inSpot = nearestFreeAdjacent(ctxLocal, door.x, door.y, B) || targetInside || { x: door.x, y: door.y };
    const p2 = computePathBudgeted(ctxLocal, occLocal, inSpot.x, inSpot.y, targetInside.x, targetInside.y);
    plan = concatPaths(p1, p2);
  } else {
    plan = computePathBudgeted(ctxLocal, occLocal, n.x, n.y, targetInside.x, targetInside.y);
  }

  if (plan && plan.length >= 2) {
    n._homePlan = plan.slice(0);
    n._homePlanGoal = { x: targetInside.x, y: targetInside.y };
    n._homeWait = 0;
    n._homePlanCooldown = 5;
  } else {
    n._homePlan = null;
    n._homePlanGoal = null;
    n._homePlanCooldown = 8;
  }
}

// Follow an existing home plan, recomputing when blocked.
function followHomePlan(ctxLocal, occLocal, n) {
  if (!n._homePlan || n._homePlan.length < 2) return false;
  if (n._homePlan[0].x !== n.x || n._homePlan[0].y !== n.y) {
    const idx = n._homePlan.findIndex(p => p.x === n.x && p.y === n.y);
    if (idx >= 0) {
      n._homePlan = n._homePlan.slice(idx);
    } else {
      ensureHomePlan(ctxLocal, occLocal, n);
    }
  }
  if (!n._homePlan || n._homePlan.length < 2) return false;
  const next = n._homePlan[1];
  const keyNext = `${next.x},${next.y}`;
  if (occLocal.has(keyNext) || !isWalkTown(ctxLocal, next.x, next.y)) {
    n._homeWait = (n._homeWait || 0) + 1;
    if (n._homeWait >= 3) {
      n._homePlanCooldown = Math.max(n._homePlanCooldown || 0, 4);
      ensureHomePlan(ctxLocal, occLocal, n);
    }
    return true;
  }
  occLocal.delete(`${n.x},${n.y}`); n.x = next.x; n.y = next.y; occLocal.add(`${n.x},${n.y}`);
  n._homePlan = n._homePlan.slice(1);
  n._homeWait = 0;
  return true;
}

export {
  PATH_BUDGET_MIN,
  PATH_BUDGET_MAX,
  initPathBudget,
  stepTowards,
  routeIntoInnUpstairs,
  makeRelaxedOcc,
  concatPaths,
  computeHomePath,
  ensureHomePlan,
  followHomePlan,
};