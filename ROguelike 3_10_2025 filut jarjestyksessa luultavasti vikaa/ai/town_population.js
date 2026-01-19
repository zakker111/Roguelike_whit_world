/**
 * Town population helpers:
 *  - populateTown(ctx): spawn shopkeepers, residents, pets, corpse cleaners
 *  - ensureHome(ctx, n): assign a reasonable home/work to NPCs without one
 *  - dedupeHomeBeds(ctx): ensure at most one NPC per bed tile per building
 *
 * This module is imported by town_ai.js and does not depend on the runtime
 * turn loop, so it stays out of the hot path.
 */

import { getGameData } from "../utils/access.js";

// Minimal helpers shared with town_ai.js

function randInt(ctx, a, b) {
  return Math.floor(ctx.rng() * (b - a + 1)) + a;
}

function isWalkTown(ctx, x, y) {
  const { map, TILES } = ctx;
  if (y < 0 || y >= map.length) return false;
  if (x < 0 || x >= (map[0] ? map[0].length : 0)) return false;
  const t = map[y][x];
  return t === TILES.FLOOR || t === TILES.DOOR || t === TILES.ROAD;
}

function isFreeTownFloor(ctx, x, y) {
  const { map, TILES, player, npcs, townProps } = ctx;
  if (y < 0 || y >= map.length) return false;
  if (x < 0 || x >= (map[0] ? map[0].length : 0)) return false;
  const t = map[y][x];
  if (t !== TILES.FLOOR && t !== TILES.DOOR && t !== TILES.ROAD) return false;
  if (player && x === player.x && y === player.y) return false;
  const occ = ctx._occ;
  if (occ ? occ.has(`${x},${y}`) : (Array.isArray(npcs) && npcs.some(n => n && n.x === x && n.y === y))) return false;
  if (Array.isArray(townProps) && townProps.some(p => p && p.x === x && p.y === y)) return false;
  return true;
}

function randomInteriorSpot(ctx, b) {
  const { map, townProps } = ctx;
  const props = Array.isArray(townProps) ? townProps : [];
  const spots = [];
  for (let y = b.y + 1; y < b.y + b.h - 1; y++) {
    for (let x = b.x + 1; x < b.x + b.w - 1; x++) {
      if (map[y][x] !== ctx.TILES.FLOOR) continue;
      if (props.some(p => p && p.x === x && p.y === y)) continue;
      spots.push({ x, y });
    }
  }
  if (!spots.length) return null;
  const rnd = typeof ctx.rng === "function" ? ctx.rng() : Math.random();
  return spots[Math.floor(rnd * spots.length)];
}

function addProp(ctx, x, y, type, name) {
  const { map, townProps, TILES } = ctx;
  if (x <= 0 || y <= 0 || y >= map.length - 1 || x >= (map[0] ? map[0].length : 0) - 1) return false;
  if (map[y][x] !== TILES.FLOOR) return false;
  if (Array.isArray(townProps) && townProps.some(p => p && p.x === x && p.y === y)) return false;
  ctx.townProps.push({ x, y, type, name });
  return true;
}

function bedsFor(ctx, building) {
  return (ctx.townProps || []).filter(p =>
    p.type === "bed" &&
    p.x > building.x && p.x < building.x + building.w - 1 &&
    p.y > building.y && p.y < building.y + building.h - 1
  );
}

// --- Main population entry point ---

function populateTown(ctx) {
  const { shops, npcs, townBuildings, townPlaza, rng } = ctx;

  // Shopkeepers with homes and signs
  (function spawnShopkeepers() {
    if (!Array.isArray(shops) || shops.length === 0) return;
    const GD = getGameData(ctx);
    const ND = GD && GD.npcs ? GD.npcs : null;
    const keeperLines = (ND && Array.isArray(ND.shopkeeperLines) && ND.shopkeeperLines.length)
      ? ND.shopkeeperLines
      : ["We open on schedule.", "Welcome in!", "Back soon."];
    const keeperNames = (ND && Array.isArray(ND.shopkeeperNames) && ND.shopkeeperNames.length)
      ? ND.shopkeeperNames
      : ["Shopkeeper", "Trader", "Smith"];
    const caravanLines = [
      "Fresh goods from the road.",
      "We stay only while the caravan is in town.",
      "Have a look before we move on.",
    ];
    for (const s of shops) {
      // Shop signs are placed during town generation (worldgen/town_gen.js) with outward placement.
      // Avoid duplicating signs here to prevent incorrect sign placement inside buildings like the Inn.
      const isInn = String(s.type || "").toLowerCase() === "inn";
      const isCaravanShop = String(s.type || "").toLowerCase() === "caravan";
      let spot = null;
      if (isInn && s.inside) {
        spot = { x: s.inside.x, y: s.inside.y };
      } else {
        const neigh = [
          { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
          { dx: 1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 },
        ];
        for (const d of neigh) {
          const nx = s.x + d.dx;
          const ny = s.y + d.dy;
          if (isFreeTownFloor(ctx, nx, ny)) {
            spot = { x: nx, y: ny };
            break;
          }
        }
        if (!spot) {
          spot = { x: s.x, y: s.y };
        }
      }
      if (npcs.some(n => n && n.x === spot.x && n.y === spot.y)) continue;

      const size = ctx.townSize || "big";
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
      if (isInn && s.building && !home) {
        const h2 = randomInteriorSpot(ctx, s.building) || s.inside || { x: s.x, y: s.y };
        home = { building: s.building, x: h2.x, y: h2.y, door: { x: s.x, y: s.y } };
      }

      const shopBase = s.name ? `${s.name} ` : "";
      let keeperName;
      if (isCaravanShop) {
        keeperName = "Caravan master";
      } else {
        keeperName =
          shopBase
            ? `${shopBase}Keeper`
            : (keeperNames[Math.floor(rng() * keeperNames.length)] || "Shopkeeper");
      }
      const linesForKeeper = isCaravanShop ? caravanLines : keeperLines;

      npcs.push({
        x: spot.x,
        y: spot.y,
        name: keeperName,
        lines: linesForKeeper,
        isShopkeeper: true,
        _work: { x: s.x, y: s.y },
        _workInside: s.inside || { x: s.x, y: s.y },
        _shopRef: s,
        _home: home,
        _livesAtShop: !!livesInShop,
        _boundToBuilding: isInn ? s.building : null,
      });
    }
  })();

  // Residents
  (function spawnResidents() {
    if (!Array.isArray(townBuildings) || townBuildings.length === 0) return;

    const buildingsForResidents = townBuildings.filter(b => {
      const id = b && b.prefabId ? String(b.prefabId).toLowerCase() : "";
      const tags = Array.isArray(b.prefabTags) ? b.prefabTags.map(t => String(t).toLowerCase()) : [];
      const isGuardBarracks = id.includes("guard_barracks") || tags.includes("guard_barracks") || tags.includes("barracks");
      // Do not spawn generic residents inside guard barracks; allow other buildings including future harbor warehouses.
      return !isGuardBarracks;
    });
    if (!buildingsForResidents.length) return;

    function firstFreeInteriorSpot(ctx, b) {
      for (let y = b.y + 1; y < b.y + b.h - 1; y++) {
        for (let x = b.x + 1; x < b.x + b.w - 1; x++) {
          if (ctx.map[y][x] !== ctx.TILES.FLOOR) continue;
          if ((ctx.townProps || []).some(p => p && p.x === x && p.y === y && p.type && p.type !== "sign" && p.type !== "rug")) continue;
          if ((ctx.npcs || []).some(n => n && n.x === x && n.y === y)) continue;
          return { x, y };
        }
      }
      return null;
    }

    const GD = getGameData(ctx);
    const ND = GD && GD.npcs ? GD.npcs : null;
    const linesHome = (ND && Array.isArray(ND.residentLines) && ND.residentLines.length)
      ? ND.residentLines
      : ["Home sweet home.", "A quiet day indoors.", "Just tidying up."];
    const residentNames = (ND && Array.isArray(ND.residentNames) && ND.residentNames.length)
      ? ND.residentNames
      : ["Resident", "Villager"];

    let wHomebody = 0.30;
    let wPlazaShop = 0.30;
    let wInnGoer = 0.20;
    let wWanderer = 0.20;
    try {
      const cfg = GD && GD.config && GD.config.townAI && GD.config.townAI.residentRoles;
      if (cfg && typeof cfg === "object") {
        const vH = Number(cfg.homebody);
        const vP = Number(cfg.plazaShop);
        const vI = Number(cfg.innGoer);
        const vW = Number(cfg.wanderer);
        if (Number.isFinite(vH)) wHomebody = Math.max(0, vH);
        if (Number.isFinite(vP)) wPlazaShop = Math.max(0, vP);
        if (Number.isFinite(vI)) wInnGoer = Math.max(0, vI);
        if (Number.isFinite(vW)) wWanderer = Math.max(0, vW);
      }
    } catch (_) {}
    let wSum = wHomebody + wPlazaShop + wInnGoer + wWanderer;
    if (!(wSum > 0)) {
      wHomebody = 0.30;
      wPlazaShop = 0.30;
      wInnGoer = 0.20;
      wWanderer = 0.20;
      wSum = 1.0;
    }
    wHomebody /= wSum;
    wPlazaShop /= wSum;
    wInnGoer /= wSum;
    wWanderer /= wSum;
    const roleThresholdHome = wHomebody;
    const roleThresholdPlaza = wHomebody + wPlazaShop;
    const roleThresholdInn = roleThresholdPlaza + wInnGoer;

    const benches = (ctx.townProps || []).filter(p => p.type === "bench");
    const pickBenchNearPlaza = () => {
      if (!benches.length || !townPlaza) return null;
      const candidates = benches
        .slice()
        .sort(
          (a, b) =>
            (Math.abs(a.x - townPlaza.x) + Math.abs(a.y - townPlaza.y)) -
            (Math.abs(b.x - townPlaza.x) + Math.abs(b.y - townPlaza.y))
        );
      const b = candidates[0] || null;
      if (!b) return null;
      const seat = (function nearestSeat() {
        const dirs = [
          { dx: 0, dy: 0 },
          { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
          { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
        ];
        for (const d of dirs) {
          const sx = b.x + d.dx;
          const sy = b.y + d.dy;
          if (isWalkTown(ctx, sx, sy) && isFreeTownFloor(ctx, sx, sy)) return { x: sx, y: sy };
        }
        return null;
      })();
      return seat ? { x: seat.x, y: seat.y } : { x: b.x, y: b.y };
    };
    const pickRandomShopDoor = () => {
      if (!shops || !shops.length) return null;
      const s = shops[randInt(ctx, 0, shops.length - 1)];
      const dirs = [
        { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
        { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
      ];
      for (const d of dirs) {
        const nx = s.x + d.dx;
        const ny = s.y + d.dy;
        if (isFreeTownFloor(ctx, nx, ny)) return { x: nx, y: ny };
      }
      return { x: s.x, y: s.y };
    };
    function pickRandomTownWanderTarget() {
      const rows = ctx.map.length;
      const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
      if (!rows || !cols) return null;
      for (let t = 0; t < 80; t++) {
        const x = randInt(ctx, 2, cols - 3);
        const y = randInt(ctx, 2, rows - 3);
        if (!isFreeTownFloor(ctx, x, y)) continue;
        if (townPlaza && (Math.abs(x - townPlaza.x) + Math.abs(y - townPlaza.y)) <= 4) continue;
        return { x, y };
      }
      return null;
    }

    for (const b of buildingsForResidents) {
      const area = b.w * b.h;
      const baseCount = Math.max(1, Math.min(3, Math.floor(area / 30)));
      const residentCount = baseCount + (rng() < 0.4 ? 1 : 0);
      const bedList = bedsFor(ctx, b);
      let created = 0;
      let tries = 0;
      while (created < residentCount && tries++ < 200) {
        const pos =
          randomInteriorSpot(ctx, b) ||
          firstFreeInteriorSpot(ctx, b) || {
            x: Math.max(b.x + 1, Math.min(b.x + b.w - 2, Math.floor(b.x + b.w / 2))),
            y: Math.max(b.y + 1, Math.min(b.y + b.h - 2, Math.floor(b.y + b.h / 2))),
          };
        if (!pos) break;
        if (npcs.some(n => n && n.x === pos.x && n.y === pos.y)) continue;

        let errand = null;
        let errandIsShopDoor = false;
        const hasInn = !!(ctx.tavern && ctx.tavern.building);
        const roleRoll = rng();

        if (roleRoll < roleThresholdHome) {
          const homeSpot = firstFreeInteriorSpot(ctx, b) || { x: pos.x, y: pos.y };
          errand = { x: homeSpot.x, y: homeSpot.y };
        } else if (roleRoll < roleThresholdPlaza) {
          if (rng() < 0.5) {
            const pb = pickBenchNearPlaza();
            if (pb) {
              errand = { x: pb.x, y: pb.y };
              errandIsShopDoor = false;
            }
          } else {
            const sd = pickRandomShopDoor();
            if (sd) {
              errand = sd;
              errandIsShopDoor = true;
            }
          }
        } else if (hasInn && roleRoll < roleThresholdInn) {
          const tavB = ctx.tavern.building;
          const door =
            ctx.tavern.door &&
            typeof ctx.tavern.door.x === "number" &&
            typeof ctx.tavern.door.y === "number"
              ? ctx.tavern.door
              : {
                  x: tavB.x + ((tavB.w / 2) | 0),
                  y: tavB.y + ((tavB.h / 2) | 0),
                };
          errand = { x: door.x, y: door.y };
        } else {
          const wander = pickRandomTownWanderTarget();
          if (wander) errand = wander;
        }

        let sleepSpot = null;
        if (bedList.length) {
          const bidx = randInt(ctx, 0, bedList.length - 1);
          sleepSpot = { x: bedList[bidx].x, y: bedList[bidx].y };
        }
        const rname = residentNames[Math.floor(rng() * residentNames.length)] || "Resident";
        const isInnRole = hasInn && roleRoll >= roleThresholdPlaza && roleRoll < roleThresholdInn;
        const likesInn = ctx.rng() < 0.45 || isInnRole;
        npcs.push({
          x: pos.x,
          y: pos.y,
          name: rng() < 0.2 ? `Child` : rname,
          lines: linesHome,
          isResident: true,
          _home: {
            building: b,
            x: pos.x,
            y: pos.y,
            door: { x: b.door.x, y: b.door.y },
            bed: sleepSpot,
          },
          _work: errand,
          _workIsShopDoor: !!errandIsShopDoor,
          _likesInn: !!likesInn,
        });
        created++;
      }

      if (created === 0) {
        const pos = firstFreeInteriorSpot(ctx, b) || { x: b.door.x, y: b.door.y };
        const rname = residentNames[Math.floor(rng() * residentNames.length)] || "Resident";
        const workToShop = rng() < 0.5 && shops && shops.length;
        const workTarget = workToShop
          ? { x: shops[0].x, y: shops[0].y }
          : townPlaza
          ? { x: townPlaza.x, y: townPlaza.y }
          : null;
        npcs.push({
          x: pos.x,
          y: pos.y,
          name: rname,
          lines: linesHome,
          isResident: true,
          _home: {
            building: b,
            x: pos.x,
            y: pos.y,
            door: { x: b.door.x, y: b.door.y },
            bed: null,
          },
          _work: workTarget,
          _workIsShopDoor: !!workToShop,
          _likesInn: ctx.rng() < 0.45,
        });
      }
    }
  })();

  // Pets
  (function spawnPets() {
    const maxCats = 2;
    const maxDogs = 2;
    const GD = getGameData(ctx);
    const ND = GD && GD.npcs ? GD.npcs : null;
    const namesCat =
      ND && Array.isArray(ND.petCats) && ND.petCats.length
        ? ND.petCats
        : ["Cat", "Mittens", "Whiskers"];
    const namesDog =
      ND && Array.isArray(ND.petDogs) && ND.petDogs.length
        ? ND.petDogs
        : ["Dog", "Rover", "Buddy"];
    function placeFree() {
      for (let t = 0; t < 200; t++) {
        const x = randInt(ctx, 2, ctx.map[0].length - 3);
        const y = randInt(ctx, 2, ctx.map.length - 3);
        if (isFreeTownFloor(ctx, x, y)) return { x, y };
      }
      return null;
    }
    for (let i = 0; i < maxCats; i++) {
      const spot = placeFree();
      if (!spot) break;
      ctx.npcs.push({
        x: spot.x,
        y: spot.y,
        name: namesCat[i % namesCat.length],
        lines: ["Meow."],
        isPet: true,
        kind: "cat",
      });
    }
    for (let i = 0; i < maxDogs; i++) {
      const spot = placeFree();
      if (!spot) break;
      ctx.npcs.push({
        x: spot.x,
        y: spot.y,
        name: namesDog[i % namesDog.length],
        lines: ["Woof."],
        isPet: true,
        kind: "dog",
      });
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
        : ["I'll see these bodies to rest.", "Can't leave the dead in the streets."];

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
  if (typeof n._homeDepartMin !== "number") {
    n._homeDepartMin = randInt(ctx, 18 * 60, 21 * 60);
  }
}

// Ensure that at most one NPC per building uses a given bed tile.
function dedupeHomeBeds(ctx) {
  const npcs = Array.isArray(ctx.npcs) ? ctx.npcs : [];
  const townBuildings = Array.isArray(ctx.townBuildings) ? ctx.townBuildings : [];
  const townProps = Array.isArray(ctx.townProps) ? ctx.townProps : [];
  if (!npcs.length || !townBuildings.length || !townProps.some(p => p.type === "bed")) return;

  const bedsByBuilding = new Map();
  const usedByBuilding = new Map();
  const bKey = b => `${b.x},${b.y},${b.w},${b.h}`;

  function bedsForBuilding(b) {
    const key = bKey(b);
    if (bedsByBuilding.has(key)) return bedsByBuilding.get(key);
    const list = bedsFor(ctx, b) || [];
    bedsByBuilding.set(key, list);
    return list;
  }

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
        n._home.bed = null;
        continue;
      }
      const kBed = `${bed.x},${bed.y}`;
      if (used.has(kBed)) {
        n._home.bed = null;
      } else {
        used.add(kBed);
      }
    }
  }

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

export { populateTown, ensureHome, dedupeHomeBeds };