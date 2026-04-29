import {
  randInt,
  manhattan,
  nearestFreeAdjacent,
} from "./town_helpers.js";
import { chooseInnUpstairsBed } from "./town_inn_upstairs.js";

/**
 * Inn and home seating/bed helpers extracted from town_runtime.
 * Shared by town NPC behavior for guards, residents, and visitors.
 */

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

function chooseInnTarget(ctx) {
  const upBed = chooseInnUpstairsBed(ctx);
  if (upBed) return { x: upBed.x, y: upBed.y };
  const innB = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
  if (!innB) return null;
  const door = ctx.tavern.door || { x: innB.x + ((innB.w / 2) | 0), y: innB.y + ((innB.h / 2) | 0) };
  const inSpot = nearestFreeAdjacent(ctx, door.x, door.y, innB);
  return inSpot || { x: door.x, y: door.y };
}

function chooseInnSeat(ctx) {
  const seats = innSeatSpots(ctx);
  if (!seats.length) return chooseInnTarget(ctx);
  return seats[randInt(ctx, 0, seats.length - 1)];
}

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

function firstFreeInteriorTile(ctx, building) {
  const { map, TILES } = ctx;
  for (let y = building.y + 1; y < building.y + building.h - 1; y++) {
    for (let x = building.x + 1; x < building.x + building.w - 1; x++) {
      if (map[y][x] !== TILES.FLOOR) continue;
      if ((ctx.townProps || []).some(p => p.x === x && p.y === y && p.type && p.type !== "sign" && p.type !== "rug")) continue;
      if ((ctx.npcs || []).some(n => n.x === x && n.y === y)) continue;
      return { x, y };
    }
  }
  return null;
}

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

function homeSeatTiles(ctx, building) {
  if (!building) return [];
  const props = Array.isArray(ctx.townProps) ? ctx.townProps : [];
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

export {
  innBedSpots,
  chooseInnSeat,
  chooseInnTarget,
  chooseBenchSeat,
  chooseHomeSeat,
  homeSeatTiles,
};