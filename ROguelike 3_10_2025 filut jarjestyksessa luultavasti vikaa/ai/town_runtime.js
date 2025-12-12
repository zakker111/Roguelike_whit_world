import { computePath, computePathBudgeted } from "./pathfinding.js";
import {
  randInt,
  manhattan,
  rngFor,
  inWindow,
  isOpenAt,
  isWalkTown,
  insideBuilding,
  propBlocks,
  isFreeTile,
  nearestFreeAdjacent,
  adjustInteriorTarget,
} from "./town_helpers.js";
import {
  dist1,
  nearestBandit,
  nearestCivilian,
  applyHit,
  townNpcAttack,
  banditAttackPlayer,
  removeDeadNPCs,
} from "./town_combat.js";
import {
  inUpstairsInterior,
  innUpstairsBeds,
  chooseInnUpstairsBed,
  chooseInnUpstairsSeat,
} from "./town_inn_upstairs.js";
import { dedupeHomeBeds, ensureHome } from "./town_population.js";
import {
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
} from "./town_movement.js";

// Pathfinding helpers (budget + stepTowards, home plans, inn upstairs routing)
// are centralized in ai/town_movement.js. This module focuses on the townNPCsAct loop.

function townNPCsAct(ctx) {
  const { npcs, player, townProps } = ctx;
  if (!Array.isArray(npcs) || npcs.length === 0) return;

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

  dedupeHomeBeds(ctx);

  const occ = new Set();
  occ.add(`${player.x},${player.y}`);
  for (const n of npcs) occ.add(`${n.x},${n.y}`);
  if (Array.isArray(townProps)) {
    for (const p of townProps) {
      if (propBlocks(p.type)) occ.add(`${p.x},${p.y}`);
    }
  }

  const reservedDoors = new Set();
  try {
    const shops = Array.isArray(ctx.shops) ? ctx.shops : [];
    const rows = ctx.map.length, cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
    function inB(x, y) { return x >= 0 && y >= 0 && x < cols && y < rows; }
    for (const s of shops) {
      const key = `${s.x},${s.y}`;
      reservedDoors.add(key);
      occ.add(key);
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
            break;
          }
        }
      }
    }
  } catch (_) {}
  ctx._reservedShopDoors = reservedDoors;

  ctx._occ = occ;

  try {
    for (let i = 0; i < npcs.length; i++) {
      const n = npcs[i];
      if (!n || !n._boundToBuilding) continue;
      const B = n._boundToBuilding;
      const insideNow = insideBuilding(B, n.x, n.y);
      if (insideNow) continue;
      const prevKey = `${n.x},${n.y}`;
      if (occ.has(prevKey)) occ.delete(prevKey);
      let target = null;
      const prefer = (n._workInside ? { x: n._workInside.x, y: n._workInside.y } : null);
      if (prefer && insideBuilding(B, prefer.x, prefer.y) && isFreeTile(ctx, prefer.x, prefer.y)) {
        target = prefer;
      } else {
        const door = (B && B.door) ? { x: B.door.x, y: B.door.y } : null;
        const nearDoor = door ? nearestFreeAdjacent(ctx, door.x, door.y, B) : null;
        target = nearDoor || (() => {
          for (let y = B.y + 1; y < B.y + B.h - 1; y++) {
            for (let x = B.x + 1; x < B.x + B.w - 1; x++) {
              if (ctx.map[y][x] !== ctx.TILES.FLOOR) continue;
              if ((ctx.townProps || []).some(p => p.x === x && p.y === y && p.type && p.type !== "sign" && p.type !== "rug")) continue;
              if ((ctx.npcs || []).some(n2 => n2 && n2.x === x && n2.y === y)) continue;
              return { x, y };
            }
          }
          return { x: Math.max(B.x + 1, Math.min(B.x + B.w - 2, (B.x + ((B.w / 2) | 0)))), y: Math.max(B.y + 1, Math.min(B.y + B.h - 2, (B.y + ((B.h / 2) | 0)))) };
        })();
      }
      const newKey = `${target.x},${target.y}`;
      n.x = target.x; n.y = target.y; n._floor = "ground";
      occ.add(newKey);
    }
  } catch (_) {}

  initPathBudget(ctx, npcs.length);

  const t = ctx.time;
  const minutes = t ? (t.hours * 60 + t.minutes) : 12 * 60;
  const phase = (t && t.phase === "night") ? "evening"
              : (t && t.phase === "dawn") ? "morning"
              : (t && t.phase === "dusk") ? "evening"
              : "day";

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

  const LATE_START = 2 * 60, LATE_END = 5 * 60;
  const inLateWindow = minutes >= LATE_START && minutes < LATE_END;

  function assignDebugUpstairsRoamer(ctxLocal, npcsLocal) {
    try {
      if (ctxLocal._debugUpstairsRoamerAssigned) return;
      for (const n of npcsLocal) {
        if (n && !n.isResident && !n.isShopkeeper && !n.isPet && !n.greeter && !n.isGuard) {
          n._forceInnSleepUpstairs = true;
          n._stride = 1;
          n._strideOffset = 0;
          ctxLocal._debugUpstairsRoamerAssigned = true;
          break;
        }
      }
    } catch (_) {}
  }
  assignDebugUpstairsRoamer(ctx, npcs);

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

  const innBForCap = (ctx.tavern && ctx.tavern.building) ? ctx.tavern.building : null;
  let _innSeatCap = 0;
  let _innSeatersNow = 0;
  if (innBForCap) {
    try {
      const seatsCount = (() => {
        const innB = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
        if (!innB) return 0;
        const props = Array.isArray(ctx.townProps) ? ctx.townProps : [];
        let count = 0;
        for (const p of props) {
          if (p.type !== "chair" && p.type !== "table") continue;
          if (!(p.x > innB.x && p.x < innB.x + innB.w - 1 && p.y > innB.y && p.y < innB.y + innB.h - 1)) continue;
          const adj = nearestFreeAdjacent(ctx, p.x, p.y, innB);
          if (adj) count++;
        }
        return count;
      })();
      _innSeatCap = Math.max(2, Math.min(6, Math.floor((seatsCount || 0) * 0.5) || 2));
      for (const x of npcs) {
        if ((x._innSeatGoal) || (x._innStayTurns && x._innStayTurns > 0)) _innSeatersNow++;
      }
    } catch (_) {
      _innSeatCap = 4;
    }
  }

  function innBedSpots(ctxLocal) {
    const innB = ctxLocal.tavern && ctxLocal.tavern.building ? ctxLocal.tavern.building : null;
    if (!innB) return [];
    const beds = (ctxLocal.townProps || []).filter(p =>
      p.type === "bed" &&
      p.x > innB.x && p.x < innB.x + innB.w - 1 &&
      p.y > innB.y && p.y < innB.y + innB.h - 1
    );
    return beds;
  }

  function innSeatSpots(ctxLocal) {
    const innB = ctxLocal.tavern && ctxLocal.tavern.building ? ctxLocal.tavern.building : null;
    if (!innB) return [];
    const props = Array.isArray(ctxLocal.townProps) ? ctxLocal.townProps : [];
    const seats = [];
    for (const p of props) {
      if (p.type !== "chair" && p.type !== "table") continue;
      if (!(p.x > innB.x && p.x < innB.x + innB.w - 1 && p.y > innB.y && p.y < innB.y + innB.h - 1)) continue;
      const adj = nearestFreeAdjacent(ctxLocal, p.x, p.y, innB);
      if (adj) seats.push(adj);
    }
    return seats;
  }
  function chooseInnSeat(ctxLocal) {
    const seats = innSeatSpots(ctxLocal);
    if (!seats.length) return chooseInnTarget(ctxLocal);
    return seats[randInt(ctxLocal, 0, seats.length - 1)];
  }

  function chooseInnTarget(ctxLocal) {
    const upBed = chooseInnUpstairsBed(ctxLocal);
    if (upBed) return { x: upBed.x, y: upBed.y };
    const innB = ctxLocal.tavern && ctxLocal.tavern.building ? ctxLocal.tavern.building : null;
    if (!innB) return null;
    const door = ctxLocal.tavern.door || { x: innB.x + ((innB.w / 2) | 0), y: innB.y + ((innB.h / 2) | 0) };
    const inSpot = nearestFreeAdjacent(ctxLocal, door.x, door.y, innB);
    return inSpot || { x: door.x, y: door.y };
  }

  function chooseBenchSeat(ctxLocal) {
    const benches = Array.isArray(ctxLocal.townProps) ? ctxLocal.townProps.filter(p => p.type === "bench") : [];
    if (!benches.length) return null;
    let b = benches[0];
    if (ctxLocal.townPlaza) {
      const cx = ctxLocal.townPlaza.x, cy = ctxLocal.townPlaza.y;
      b = benches.slice().sort((a, bb) =>
        manhattan(a.x, a.y, cx, cy) - manhattan(bb.x, bb.y, cx, cy)
      )[0] || benches[0];
    }
    const seat = nearestFreeAdjacent(ctxLocal, b.x, b.y, null);
    return seat ? seat : { x: b.x, y: b.y };
  }

  function firstFreeInteriorTile(ctxLocal, b) {
    const { map, TILES } = ctxLocal;
    for (let y = b.y + 1; y < b.y + b.h - 1; y++) {
      for (let x = b.x + 1; x < b.x + b.w - 1; x++) {
        if (map[y][x] !== TILES.FLOOR) continue;
        if ((ctxLocal.townProps || []).some(p => p.x === x && p.y === y && p.type && p.type !== "sign" && p.type !== "rug")) continue;
        if ((ctxLocal.npcs || []).some(n => n.x === x && n.y === y)) continue;
        return { x, y };
      }
    }
    return null;
  }

  function chooseHomeSeat(ctxLocal, building) {
    if (!building) return null;
    const props = Array.isArray(ctxLocal.townProps) ? ctxLocal.townProps : [];
    const seats = [];
    for (const p of props) {
      if (p.type !== "chair" && p.type !== "table") continue;
      if (!(p.x > building.x && p.x < building.x + building.w - 1 && p.y > building.y && p.y < building.y + building.h - 1)) continue;
      const adj = nearestFreeAdjacent(ctxLocal, p.x, p.y, building);
      if (adj) seats.push(adj);
    }
    if (seats.length) return seats[randInt(ctxLocal, 0, seats.length - 1)];
    return firstFreeInteriorTile(ctxLocal, building);
  }

  function homeSeatTiles(ctxLocal, building) {
    if (!building) return [];
    const props = Array.isArray(ctxLocal.townProps) ? ctxLocal.townProps : [];
    const out = [];
    for (const p of props) {
      const tType = String(p.type || "").toLowerCase();
      if (tType !== "chair" && tType !== "bench") continue;
      if (p.x > building.x && p.x < building.x + building.w - 1 && p.y > building.y && p.y < building.y + building.h - 1) {
        out.push({ x: p.x, y: p.y });
      }
    }
    return out;
  }

  const tickMod = ((t && typeof t.turnCounter === "number") ? t.turnCounter : 0) | 0;
  function shouldSkipThisTick(n, idx) {
    if (n.isGuard) return false;

    if (n.isShopkeeper && n._shopRef) {
      const o = (typeof n._shopRef.openMin === "number") ? n._shopRef.openMin : 8 * 60;
      const c = (typeof n._shopRef.closeMin === "number") ? n._shopRef.closeMin : 18 * 60;
      const arriveStart = (o - 120 + 1440) % 1440;
      const leaveEnd = (c + 10) % 1440;
      if (inWindow(arriveStart, leaveEnd, minutes, 1440)) return false;
    }
    if (typeof n._stride !== "number") {
      n._stride = n.isPet ? 3 : (n.isShopkeeper ? 2 : 1);
    }
    if (typeof n._strideOffset !== "number") {
      n._strideOffset = idx % n._stride;
    }

    if ((tickMod % n._stride) !== n._strideOffset) return true;

    try {
      if (player && typeof player.x === "number" && typeof player.y === "number") {
        const d = Math.abs(n.x - player.x) + Math.abs(n.y - player.y);
        if (d > 24) {
          if (((tickMod + idx) & 1) === 1) return true;
        }
      }
    } catch (_) {}

    return false;
  }

  function ensureHomeStart(n) {
    if (typeof n._homeStartMin !== "number") {
      const base = 18 * 60;
      const spread = 3 * 60;
      n._homeStartMin = base + Math.floor(ctx.rng() * spread);
    }
  }

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
    const res = a.slice(0);
    const firstB = b[0];
    const lastA = a[a.length - 1];
    const skipFirst = (firstB.x === lastA.x && firstB.y === lastA.y);
    for (let i = skipFirst ? 1 : 0; i < b.length; i++) res.push(b[i]);
    return res;
  }

  function computeHomePath(ctxLocal, n) {
    if (!n._home || !n._home.building) return null;
    const B = n._home.building;
    const relaxedOcc = makeRelaxedOcc();

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

  if (typeof window !== "undefined" && window.DEBUG_TOWN_HOME_PATHS) {
    try {
      for (const n of npcs) {
        const path = computeHomePath(ctx, n);
        n._homeDebugPath = (path && path.length >= 1) ? path.slice(0) : null;
      }
    } catch (_) {}
  } else {
    for (const n of npcs) { n._homeDebugPath = null; }
  }

  if (typeof window !== "undefined" && window.DEBUG_TOWN_ROUTE_PATHS) {
    try {
      const relaxedOcc = makeRelaxedOcc(ctx);
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

  const npcCount = npcs.length;
  const maxActiveThisTick = (typeof ctx.townMaxActiveNPCs === "number")
    ? Math.max(8, ctx.townMaxActiveNPCs | 0)
    : Math.max(12, Math.floor(npcCount * 0.6));
  let activeSoFar = 0;

  function routeIntoBuilding(ctxLocal, occLocal, n, building, targetInside) {
    const adjTarget = targetInside ? adjustInteriorTarget(ctxLocal, building, targetInside) : null;

    const insideNow = insideBuilding(building, n.x, n.y);
    if (!insideNow) {
      const candidate = building.door || nearestFreeAdjacent(ctxLocal, building.x + ((building.w / 2) | 0), building.y, null);
      if (candidate) {
        const door = { x: candidate.x, y: candidate.y };
        if (n.x === door.x && n.y === door.y) {
          const inSpot = nearestFreeAdjacent(ctxLocal, door.x, door.y, building) || adjTarget || { x: door.x, y: door.y };
          stepTowards(ctxLocal, occLocal, n, inSpot.x, inSpot.y, { urgent: !!n.isShopkeeper });
          return true;
        }
        stepTowards(ctxLocal, occLocal, n, door.x, door.y, { urgent: !!n.isShopkeeper });
        return true;
      }
    } else {
      if (adjTarget && n.x === adjTarget.x && n.y === adjTarget.y) {
        return true;
      }
      const inSpot = (adjTarget && isFreeTile(ctxLocal, adjTarget.x, adjTarget.y))
        ? adjTarget
        : nearestFreeAdjacent(ctxLocal, adjTarget ? adjTarget.x : n.x, adjTarget ? adjTarget.y : n.y, building);
      if (inSpot) {
        if (n.x === inSpot.x && n.y === inSpot.y) return true;
        stepTowards(ctxLocal, occLocal, n, inSpot.x, inSpot.y);
        return true;
      }
      return true;
    }
    return false;
  }

  for (const idx of order) {
    const n = npcs[idx];
    ensureHome(ctx, n);

    if (shouldSkipThisTick(n, idx)) continue;

    if (activeSoFar >= maxActiveThisTick) break;
    activeSoFar++;

    if (t && t.phase === "dawn") {
      n._departAssignedForDay = false;
      if (n.isResident) {
        n._innPreHomeDone = false;
        n._goInnToday = !!n._likesInn && (ctx.rng() < 0.33);
      }
    }
    if (t && t.phase === "morning" && !n._departAssignedForDay) {
      n._homeDepartMin = randInt(ctx, 18 * 60, 21 * 60);
      n._departAssignedForDay = true;
    }

    if (n._homePlanCooldown && n._homePlanCooldown > 0) {
      n._homePlanCooldown--;
    }

    if (n.isPet) {
      if (ctx.rng() < 0.6) continue;
      stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
      continue;
    }

    if (n.isGuard) {
      if (banditEvent && anyBandit) {
        const target = nearestBandit(ctx, n);
        if (target) {
          const d = dist1(n.x, n.y, target.x, target.y);
          if (d === 1) {
            applyHit(ctx, n, target, 4, 8);
            continue;
          }
          stepTowards(ctx, occ, n, target.x, target.y, { urgent: true });
          continue;
        }
      }

      const home = n._home && n._home.building ? n._home.building : null;
      const isBarracks = !!(home && home.prefabId && String(home.prefabId).toLowerCase().includes("guard_barracks"));

      const GUARD_REST_START = 22 * 60;
      const GUARD_REST_END = 6 * 60;
      const wantsRest = isBarracks && inWindow(GUARD_REST_START, GUARD_REST_END, minutes, 1440);

      if (n._sleeping) {
        if (!wantsRest || phase === "morning") {
          n._sleeping = false;
        } else {
          continue;
        }
      }

      if (typeof n._guardRestRole !== "string") {
        n._guardRestRole = (ctx.rng() < 0.5) ? "rest" : "duty";
      }

      if (wantsRest && n._guardRestRole === "rest" && home) {
        let target = null;
        try {
          if (n._home && n._home.bed) {
            target = { x: n._home.bed.x, y: n._home.bed.y };
          } else if (n._home && typeof n._home.x === "number" && typeof n._home.y === "number") {
            target = { x: n._home.x, y: n._home.y };
          } else {
            const bedList = innBedSpots(ctx);
            if (bedList.length) {
              const b0 = bedList[0];
              target = { x: b0.x, y: b0.y };
            }
          }
        } catch (_) {}

        if (target) {
          const atTarget = (n.x === target.x && n.y === target.y);
          let onBed = false;
          try {
            const bedList = innBedSpots(ctx);
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
      }

      const sizeKey = ctx.townSize || "big";
      let patrolRadius = 8;
      if (sizeKey === "small") patrolRadius = 6;
      else if (sizeKey === "city") patrolRadius = 10;

      if (!n._guardPost || typeof n._guardPost.x !== "number" || typeof n._guardPost.y !== "number") {
        n._guardPost = { x: n.x, y: n.y };
      }
      const post = n._guardPost;
      const distFromPost = manhattan(n.x, n.y, post.x, post.y);

      if (distFromPost > patrolRadius + 2) {
        stepTowards(ctx, occ, n, post.x, post.y, { urgent: true });
        continue;
      }

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

        for (let tSample = 0; tSample < 40; tSample++) {
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
          // Clean the corpse immediately, then move away rather than lingering.
          try {
            ctx.corpses = corpses.filter(
              c => !(c && c.x === best.x && c.y === best.y)
            );
            if (ctx.log) {
              const cleanerName = n.name || "Caretaker";
              ctx.log(
                `${cleanerName} removes a body from the street.`,
                "info"
              );
            }
          } catch (_) {}

          // After cleaning, either head toward home or wander away so the cleaner
          // doesn't stand on the same tile for many turns.
          if (n._home && typeof n._home.x === "number" && typeof n._home.y === "number") {
            stepTowards(ctx, occ, n, n._home.x, n._home.y);
          } else {
            stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
          }
          continue;
        } else {
          // Walk toward the nearest corpse with high urgency so bodies get cleared quickly.
          stepTowards(ctx, occ, n, best.x, best.y, { urgent: true });
          continue;
        }
      }
    }

    if (n.isShopkeeper) {
      const shop = n._shopRef || null;
      const isInnKeeper = shop && String(shop.type || "").toLowerCase() === "inn";
      if (isInnKeeper && shop && shop.building) {
        n._atWork = true;
        const innB = shop.building;
        const insideNow = insideBuilding(innB, n.x, n.y);
        if (!insideNow) {
          const targetInside = n._workInside || shop.inside || { x: shop.x, y: shop.y };
          routeIntoBuilding(ctx, occ, n, innB, targetInside);
          continue;
        }
        n._floor = "ground";
        if (n._patrolGoal && n.x === n._patrolGoal.x && n.y === n._patrolGoal.y) {
          n._patrolStayTurns = randInt(ctx, 8, 14);
          n._patrolGoal = null;
        }
        if (n._patrolStayTurns && n._patrolStayTurns > 0) {
          n._patrolStayTurns--;
          if (ctx.rng() < 0.08) stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
          continue;
        }
        if (!n._patrolGoal) {
          const seat = chooseInnSeat(ctx);
          const next = seat || firstFreeInteriorTile(ctx, innB) || null;
          if (next && !(next.x === n.x && next.y === n.y)) {
            n._patrolGoal = { x: next.x, y: next.y };
          }
          n._patrolGoalUp = null;
        }
        if (n._patrolGoal) {
          stepTowards(ctx, occ, n, n._patrolGoal.x, n._patrolGoal.y, { urgent: true });
          continue;
        }
        stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
        continue;
      }

      const o = shop ? shop.openMin : 8 * 60;
      const c = shop ? shop.closeMin : 18 * 60;
      const arriveStart = (o - 120 + 1440) % 1440;
      const leaveEnd = (c + 10) % 1440;
      const shouldBeAtWorkZone = inWindow(arriveStart, leaveEnd, minutes, 1440);
      const openNow = isOpenAt(shop, minutes, 1440);

      let handled = false;
      if (shouldBeAtWorkZone) {
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
        const departReady = typeof n._homeDepartMin === "number" ? (minutes >= n._homeDepartMin) : true;

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

        if (!handled) {
          const innB0 = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
          const preHomeWindowEnd = (typeof n._homeDepartMin === "number") ? n._homeDepartMin : (20 * 60);
          if (innB0 && n._goInnToday && !n._innPreHomeDone && minutes < preHomeWindowEnd) {
            if (n._innSeatGoal && insideBuilding(innB0, n.x, n.y) &&
                n.x === n._innSeatGoal.x && n.y === n._innSeatGoal.y) {
              n._innStayTurns = randInt(ctx, 4, 10);
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
          const linger = (ctx.townPlaza ? { x: ctx.townPlaza.x, y: ctx.townPlaza.y } : null);
          if (linger) {
            if (n.x === linger.x && n.y === linger.y) {
              if (ctx.rng() < 0.7) continue;
              stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
            } else {
              stepTowards(ctx, occ, n, linger.x, linger.y);
            }
            handled = true;
          }
        } else if (!handled) {
          const sleepTarget = n._home.bed ? { x: n._home.bed.x, y: n._home.bed.y } : { x: n._home.x, y: n._home.y };
          if (!n._homePlan || !n._homePlanGoal) {
            ensureHomePlan(ctx, occ, n);
          }
          handled = followHomePlan(ctx, occ, n);
          if (!handled) {
            handled = routeIntoBuilding(ctx, occ, n, n._home.building, sleepTarget);
          }
        }
      }

      if (handled) continue;

      if (ctx.rng() < 0.15) {
        stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
      }
      continue;
    }

    if (n.isBandit && banditEvent) {
      if (n._dead) { continue; }

      if (dist1(n.x, n.y, player.x, player.y) === 1) {
        banditAttackPlayer(ctx, n);
        continue;
      }

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
        applyHit(ctx, n, target, 3, 7);
        continue;
      }

      let civ = nearestCivilian(ctx, n);
      if (!civ) civ = nearestBandit(ctx, n);
      if (civ) {
        stepTowards(ctx, occ, n, civ.x, civ.y, { urgent: true });
        continue;
      }
      stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
      continue;
    }

    if (n.isResident) {
      const eveKickIn = minutes >= 17 * 60 + 30;
      if (n._sleeping) {
        if (phase === "morning") n._sleeping = false;
        else continue;
      }
      if (phase === "evening" || eveKickIn) {
        const departReady = typeof n._homeDepartMin === "number" ? (minutes >= n._homeDepartMin) : true;

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
          if (ctx.rng() < 0.90) continue;
        } else if (n._home && n._home.building) {
          const bedSpot = n._home.bed ? { x: n._home.bed.x, y: n._home.bed.y } : null;
          let sleepTarget = null;
          if (bedSpot && isFreeTile(ctx, bedSpot.x, bedSpot.y)) {
            sleepTarget = bedSpot;
          } else {
            const seats = homeSeatTiles(ctx, n._home.building);
            if (seats.length) {
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
          if (atExact) {
            n._sleeping = true;
            continue;
          }
          if (inLateWindow && ctx.tavern && ctx.tavern.building && n._floor === "upstairs" && inUpstairsInterior(ctx, n.x, n.y)) {
            const bedsUp = innUpstairsBeds(ctx);
            for (let i = 0; i < bedsUp.length; i++) {
              const b = bedsUp[i];
              if (manhattan(n.x, n.y, b.x, b.y) === 0) { n._sleeping = true; break; }
            }
            if (n._sleeping) continue;
          }
          if (!n._homePlan || !n._homePlanGoal) {
            n._homePlan = null; n._homePlanGoal = null;
          }
          if (sleepTarget && insideBuilding(n._home.building, n.x, n.y)) {
            if (stepTowards(ctx, occ, n, sleepTarget.x, sleepTarget.y)) continue;
          }
          if (!n._homePlan || !n._homePlanGoal) {
            ensureHomePlan(ctx, occ, n);
          }
          if (followHomePlan(ctx, occ, n)) continue;
          if (routeIntoBuilding(ctx, occ, n, n._home.building, sleepTarget || { x: n._home.x, y: n._home.y })) continue;

          if (inLateWindow) {
            const innB = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
            if (innB) {
              const innTarget = chooseInnTarget(ctx);
              if (routeIntoBuilding(ctx, occ, n, innB, innTarget)) continue;
            }
          }
        }
        continue;
      } else if (phase === "day") {
        const innB = (ctx.tavern && ctx.tavern.building) ? ctx.tavern.building : null;
        if (innB) {
          if (n._innSeatGoal && insideBuilding(innB, n.x, n.y) &&
              n.x === n._innSeatGoal.x && n.y === n._innSeatGoal.y) {
            n._innStayTurns = randInt(ctx, 10, 20);
            n._innSeatGoal = null;
          }
          if (n._innStayTurns && n._innStayTurns > 0) {
            n._innStayTurns--;
            if (ctx.rng() < 0.08) stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
            continue;
          }
        }
        if (innB) {
          let baseChance = n._likesInn ? 0.20 : 0.06;
          if (isRainy) baseChance *= 1.5;
          if (isHeavyRain) baseChance *= 1.4;
          if (baseChance > 0.6) baseChance = 0.6;
          const wantTavern = ctx.rng() < baseChance;
          if (wantTavern && !n._innSeatGoal && !n._benchSeatGoal && !n._homeSitGoal && (_innSeatersNow < _innSeatCap)) {
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

        if (n._homeSitGoal && n.x === n._homeSitGoal.x && n.y === n._homeSitGoal.y) {
          n._homeSitTurns = randInt(ctx, 16, 32);
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
        if (isHeavyRain && n._home && n._home.building && !insideBuilding(n._home.building, n.x, n.y)) {
          if (ctx.rng() < 0.6) {
            const homeTarget = n._home.bed ? { x: n._home.bed.x, y: n._home.bed.y } : { x: n._home.x, y: n._home.y };
            if (routeIntoBuilding(ctx, occ, n, n._home.building, homeTarget)) {
              continue;
            }
          }
        }
        const target = n._work || (ctx.townPlaza ? { x: ctx.townPlaza.x, y: ctx.townPlaza.y } : null);
        if (target) {
          if (n.x === target.x && n.y === target.y) {
            if (n._workIsShopDoor) {
              if (typeof n._errandStayTurns !== "number" || n._errandStayTurns <= 0) {
                n._errandStayTurns = randInt(ctx, 12, 20);
              }
              n._errandStayTurns--;
              if (n._errandStayTurns <= 0) {
                n._work = null; n._workIsShopDoor = false;
                let seat = null;
                try { seat = chooseBenchSeat(ctx); } catch (_) {}
                if (seat) {
                  stepTowards(ctx, occ, n, seat.x, seat.y);
                } else {
                  stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
                }
                continue;
              } else {
                if (ctx.rng() < 0.10) stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
                continue;
              }
            } else {
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

    if (n._sleeping) {
      if (phase === "morning") n._sleeping = false;
      else {
        if (ctx.rng() < 0.10) stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
        continue;
      }
    }

    if (n._forceInnSleepUpstairs && inLateWindow && ctx.tavern && ctx.innUpstairs && !n._sleeping) {
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

    if (phase === "day" && ctx.tavern && (n._likesInn || n._likesTavern)) {
      const innB2 = ctx.tavern.building;
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

    if (inLateWindow && ctx.tavern && ctx.tavern.building && (!n._home || !insideBuilding(n._home.building, n.x, n.y))) {
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
    {
      const tavB = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
      if (inLateWindow && tavB && n._floor === "upstairs" && inUpstairsInterior(ctx, n.x, n.y)) {
        const bedsUpList = innUpstairsBeds(ctx);
        for (let i = 0; i < bedsUpList.length; i++) {
          const b = bedsUpList[i];
          if (manhattan(n.x, n.y, b.x, b.y) === 0) { n._sleeping = true; break; }
        }
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

  try {
    removeDeadNPCs(ctx);
  } catch (_) {}
  ctx._occ = null;
}

export { townNPCsAct, stepTowards, initPathBudget };