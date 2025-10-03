/**
 * TownAI: handles town NPC population and behavior.
 * Exports (window.TownAI):
 *  - populateTown(ctx): spawn shopkeepers, residents, pets, greeters
 *  - townNPCsAct(ctx): per-turn movement and routines
 */
(function () {
  function randInt(ctx, a, b) { return Math.floor(ctx.rng() * (b - a + 1)) + a; }
  function manhattan(ax, ay, bx, by) { return Math.abs(ax - bx) + Math.abs(ay - by); }

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
    return t === TILES.FLOOR || t === TILES.DOOR;
  }

  function insideBuilding(b, x, y) {
    return x > b.x && x < b.x + b.w - 1 && y > b.y && y < b.y + b.h - 1;
  }

  function propBlocks(type) {
    // Signs should be walkable; rugs are decorative and don't block.
    // All other furniture/props block movement.
    return !(type === "sign" || type === "rug");
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

  // Pre-planning A* used for path debug and stable routing
  function computePath(ctx, occ, sx, sy, tx, ty, opts = {}) {
    const { map } = ctx;
    const rows = map.length, cols = map[0] ? map[0].length : 0;
    const inB = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
    const dirs4 = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
    const startKey = (x, y) => `${x},${y}`;
    const h = (x, y) => Math.abs(x - tx) + Math.abs(y - ty);

    const open = []; // min-heap substitute: small graphs, array+sort is fine
    const gScore = new Map();
    const fScore = new Map();
    const cameFrom = new Map();
    const startK = startKey(sx, sy);
    gScore.set(startK, 0);
    fScore.set(startK, h(sx, sy));
    open.push({ x: sx, y: sy, f: fScore.get(startK) });

    // Lower visit cap to reduce worst-case CPU in dense towns
    const MAX_VISITS = 6000;
    const visited = new Set();

    function pushOpen(x, y, f) {
      open.push({ x, y, f });
    }

    function popOpen() {
      // Avoid heavy sorts by only partially ordering when queue grows large
      if (open.length > 24) {
        open.sort((a, b) => a.f - b.f || h(a.x, a.y) - h(b.x, b.y));
      }
      return open.shift();
    }

    let found = null;
    while (open.length && visited.size < MAX_VISITS) {
      const cur = popOpen();
      const ck = startKey(cur.x, cur.y);
      if (visited.has(ck)) continue;
      visited.add(ck);
      if (cur.x === tx && cur.y === ty) { found = cur; break; }

      for (const d of dirs4) {
        const nx = cur.x + d.dx, ny = cur.y + d.dy;
        if (!inB(nx, ny)) continue;
        if (!isWalkTown(ctx, nx, ny)) continue;

        const nk = startKey(nx, ny);
        // Allow goal even if currently occupied; otherwise avoid occupied nodes
        if (occ.has(nk) && !(nx === tx && ny === ty)) continue;

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

    // Reconstruct path
    const path = [];
    let cur = { x: found.x, y: found.y };
    while (cur) {
      path.push({ x: cur.x, y: cur.y });
      const prev = cameFrom.get(startKey(cur.x, cur.y));
      cur = prev ? { x: prev.x, y: prev.y } : null;
    }
    path.reverse();
    return path;
  }

  // ---- Pathfinding budget/throttling ----
  // Limit the number of A* computations per tick to avoid CPU spikes in dense towns.
  function initPathBudget(ctx, npcCount) {
    const defaultBudget = Math.max(1, Math.floor(npcCount * 0.2)); // ~20% of NPCs may compute a new path per tick
    ctx._townPathBudgetRemaining = (typeof ctx.townPathBudget === "number")
      ? Math.max(0, ctx.townPathBudget)
      : defaultBudget;
  }

  function computePathBudgeted(ctx, occ, sx, sy, tx, ty, opts = {}) {
    if (typeof ctx._townPathBudgetRemaining !== "number") {
      // If not initialized, allow one and initialize lazily to a conservative value
      ctx._townPathBudgetRemaining = 1;
    }
    if (ctx._townPathBudgetRemaining <= 0) return null;
    ctx._townPathBudgetRemaining--;
    return computePath(ctx, occ, sx, sy, tx, ty, opts);
  }

  function stepTowards(ctx, occ, n, tx, ty) {
    if (typeof tx !== "number" || typeof ty !== "number") return false;

    // Consume existing plan if valid and targeted to the same goal
    if (n._plan && n._planGoal && n._planGoal.x === tx && n._planGoal.y === ty) {
      // Ensure current position matches first node
      if (n._plan.length && (n._plan[0].x !== n.x || n._plan[0].y !== n.y)) {
        // Resync by searching for current position within plan
        const idx = n._plan.findIndex(p => p.x === n.x && p.y === n.y);
        if (idx >= 0) {
          n._plan = n._plan.slice(idx);
          // Keep full path intact for visualization
        } else {
          n._plan = null;
          n._fullPlan = null;
          n._fullPlanGoal = null;
        }
      }
      if (n._plan && n._plan.length >= 2) {
        const next = n._plan[1];
        const keyNext = `${next.x},${next.y}`;
        if (isWalkTown(ctx, next.x, next.y) && !occ.has(keyNext) && !(ctx.player.x === next.x && ctx.player.y === next.y)) {
          if (typeof window !== "undefined" && window.DEBUG_TOWN_PATHS) {
            // Show entire planned route, not just remaining slice
            n._debugPath = (Array.isArray(n._fullPlan) ? n._fullPlan.slice(0) : n._plan.slice(0));
          } else {
            n._debugPath = null;
          }
          occ.delete(`${n.x},${n.y}`); n.x = next.x; n.y = next.y; occ.add(`${n.x},${n.y}`);
          return true;
        } else {
          // Blocked: force replan below
          n._plan = null;
          n._fullPlan = null;
          n._fullPlanGoal = null;
        }
      } else if (n._plan && n._plan.length === 1) {
        // Already at goal
        if (typeof window !== "undefined" && window.DEBUG_TOWN_PATHS) {
          n._debugPath = (Array.isArray(n._fullPlan) ? n._fullPlan.slice(0) : n._plan.slice(0));
        }
        return false;
      }
    }

    // No valid plan; compute new plan (budgeted)
    const full = computePathBudgeted(ctx, occ, n.x, n.y, tx, ty);
    if (full && full.length >= 2) {
      n._plan = full.slice(0);
      n._planGoal = { x: tx, y: ty };
      // Store full path for visualization
      n._fullPlan = full.slice(0);
      n._fullPlanGoal = { x: tx, y: ty };
      if (typeof window !== "undefined" && window.DEBUG_TOWN_PATHS) n._debugPath = full.slice(0);
      const next = full[1];
      const keyNext = `${next.x},${next.y}`;
      if (isWalkTown(ctx, next.x, next.y) && !occ.has(keyNext) && !(ctx.player.x === next.x && ctx.player.y === next.y)) {
        occ.delete(`${n.x},${n.y}`); n.x = next.x; n.y = next.y; occ.add(`${n.x},${n.y}`);
        return true;
      }
      // If first step blocked right away, drop plan and try nudge
      n._plan = null; n._planGoal = null;
      n._fullPlan = null; n._fullPlanGoal = null;
    }

    // Fallback: greedy nudge step
    const dirs4 = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
    const dirs = dirs4.slice().sort((a, b) =>
      (Math.abs((n.x + a.dx) - tx) + Math.abs((n.y + a.dy) - ty)) -
      (Math.abs((n.x + b.dx) - tx) + Math.abs((n.y + b.dy) - ty))
    );
    for (const d of dirs) {
      const nx = n.x + d.dx, ny = n.y + d.dy;
      if (!isWalkTown(ctx, nx, ny)) continue;
      if (ctx.player.x === nx && ctx.player.y === ny) continue;
      if (occ.has(`${nx},${ny}`)) continue;
      if (typeof window !== "undefined" && window.DEBUG_TOWN_PATHS) {
        // Single-step nudge visualization
        n._debugPath = [{ x: n.x, y: n.y }, { x: nx, y: ny }];
      } else {
        n._debugPath = null;
      }
      n._plan = null; n._planGoal = null;
      n._fullPlan = null; n._fullPlanGoal = null;
      occ.delete(`${n.x},${n.y}`); n.x = nx; n.y = ny; occ.add(`${nx},${ny}`);
      return true;
    }
    n._debugPath = null;
    n._plan = null; n._planGoal = null;
    n._fullPlan = null; n._fullPlanGoal = null;
    return false;
  }

  // ---- Populate helpers ----
  function isFreeTownFloor(ctx, x, y) {
    const { map, TILES, player, npcs, townProps } = ctx;
    if (y < 0 || y >= map.length) return false;
    if (x < 0 || x >= (map[0] ? map[0].length : 0)) return false;
    if (map[y][x] !== TILES.FLOOR && map[y][x] !== TILES.DOOR) return false;
    if (x === player.x && y === player.y) return false;
    const occ = ctx._occ;
    if (occ ? occ.has(`${x},${y}`) : (Array.isArray(npcs) && npcs.some(n => n.x === x && n.y === y))) return false;
    if (Array.isArray(townProps) && townProps.some(p => p.x === x && p.y === y)) return false;
    return true;
  }

  function randomInteriorSpot(ctx, b) {
    const { map, townProps, rng } = ctx;
    const spots = [];
    for (let y = b.y + 1; y < b.y + b.h - 1; y++) {
      for (let x = b.x + 1; x < b.x + b.w - 1; x++) {
        if (map[y][x] !== ctx.TILES.FLOOR) continue;
        if (townProps.some(p => p.x === x && p.y === y)) continue;
        spots.push({ x, y });
      }
    }
    if (!spots.length) return null;
    return spots[Math.floor(rng() * spots.length)];
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
      const keeperLines = ["We open on schedule.","Welcome in!","Back soon."];
      for (const s of shops) {
        addSignNear(ctx, s.x, s.y, s.name || "Shop");
        // choose spawn near door
        let spot = { x: s.x, y: s.y };
        const neigh = [
          { dx: 0, dy: 0 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
          { dx: 1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 },
        ];
        for (const d of neigh) {
          const nx = s.x + d.dx, ny = s.y + d.dy;
          if (isFreeTownFloor(ctx, nx, ny)) { spot = { x: nx, y: ny }; break; }
        }
        if (npcs.some(n => n.x === spot.x && n.y === spot.y)) continue;

        const livesInShop = rng() < 0.4 && s.building;
        let home = null;
        if (livesInShop && s.building) {
          const h = randomInteriorSpot(ctx, s.building) || s.inside || { x: s.x, y: s.y };
          home = { building: s.building, x: h.x, y: h.y, door: { x: s.x, y: s.y } };
        } else if (Array.isArray(townBuildings) && townBuildings.length) {
          const b = townBuildings[randInt(ctx, 0, townBuildings.length - 1)];
          const pos = randomInteriorSpot(ctx, b) || { x: b.door.x, y: b.door.y };
          home = { building: b, x: pos.x, y: pos.y, door: { x: b.door.x, y: b.door.y } };
        }

        npcs.push({
          x: spot.x, y: spot.y,
          name: s.name ? `${s.name} Keeper` : "Shopkeeper",
          lines: keeperLines,
          isShopkeeper: true,
          _work: { x: s.x, y: s.y },
          _workInside: s.inside || { x: s.x, y: s.y },
          _shopRef: s,
          _home: home,
          _livesAtShop: !!livesInShop,
        });
      }
    })();

    // Residents
    (function spawnResidents() {
      if (!Array.isArray(townBuildings) || townBuildings.length === 0) return;

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

      const linesHome = ["Home sweet home.","A quiet day indoors.","Just tidying up."];

      const benches = (ctx.townProps || []).filter(p => p.type === "bench");
      const pickBenchNearPlaza = () => {
        if (!benches.length) return null;
        const candidates = benches.slice().sort((a, b) =>
          manhattan(a.x, a.y, townPlaza.x, townPlaza.y) - manhattan(b.x, b.y, townPlaza.x, townPlaza.y));
        return candidates[0] || null;
      };
      const pickRandomShopDoor = () => {
        if (!shops || !shops.length) return null;
        const s = shops[randInt(ctx, 0, shops.length - 1)];
        return { x: s.x, y: s.y };
      };

      // Ensure every building has occupants (at least one), scaled by area
      for (const b of townBuildings) {
        const area = b.w * b.h;
        const baseCount = Math.max(1, Math.min(3, Math.floor(area / 30)));
        const residentCount = baseCount + (rng() < 0.4 ? 1 : 0);
        const bedList = bedsFor(ctx, b);
        let created = 0;
        let tries = 0;
        while (created < residentCount && tries++ < 200) {
          const pos = randomInteriorSpot(ctx, b) || firstFreeInteriorSpot(ctx, b) || { x: b.door.x, y: b.door.y };
          if (!pos) break;
          if (npcs.some(n => n.x === pos.x && n.y === pos.y)) continue;
          let errand = null;
          if (rng() < 0.5) {
            const pb = pickBenchNearPlaza();
            if (pb) errand = { x: pb.x, y: pb.y };
          } else {
            const sd = pickRandomShopDoor();
            if (sd) errand = sd;
          }
          let sleepSpot = null;
          if (bedList.length) {
            const bidx = randInt(ctx, 0, bedList.length - 1);
            sleepSpot = { x: bedList[bidx].x, y: bedList[bidx].y };
          }
          npcs.push({
            x: pos.x, y: pos.y,
            name: rng() < 0.2 ? `Child` : `Resident`,
            lines: linesHome,
            isResident: true,
            _home: { building: b, x: pos.x, y: pos.y, door: { x: b.door.x, y: b.door.y }, bed: sleepSpot },
            _work: errand,
          });
          created++;
        }
        // Guarantee at least one occupant
        if (created === 0) {
          const pos = firstFreeInteriorSpot(ctx, b) || { x: b.door.x, y: b.door.y };
          npcs.push({
            x: pos.x, y: pos.y,
            name: `Resident`,
            lines: linesHome,
            isResident: true,
            _home: { building: b, x: pos.x, y: pos.y, door: { x: b.door.x, y: b.door.y }, bed: null },
            _work: (rng() < 0.5 && shops && shops.length) ? { x: shops[0].x, y: shops[0].y }
                  : (townPlaza ? { x: townPlaza.x, y: townPlaza.y } : null),
          });
        }
      }
    })();

    // Pets
    (function spawnPets() {
      const maxCats = 2, maxDogs = 2;
      const namesCat = ["Cat","Mittens","Whiskers"];
      const namesDog = ["Dog","Rover","Buddy"];
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

  function townNPCsAct(ctx) {
    const { npcs, player, townProps } = ctx;
    if (!Array.isArray(npcs) || npcs.length === 0) return;

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

    // Expose fast occupancy to helpers for this tick
    ctx._occ = occ;

    // Initialize per-tick pathfinding budget to avoid heavy recomputation (lowered)
    initPathBudget(ctx, npcs.length);

    const t = ctx.time;
    const minutes = t ? (t.hours * 60 + t.minutes) : 12 * 60;
    const phase = (t && t.phase === "night") ? "evening"
                : (t && t.phase === "dawn") ? "morning"
                : (t && t.phase === "dusk") ? "evening"
                : "day";
    // Late night window: 02:00–05:00
    const LATE_START = 2 * 60, LATE_END = 5 * 60;
    const inLateWindow = minutes >= LATE_START && minutes < LATE_END;

    // Helper: pick a target inside the tavern (prefer a bed, fallback to a free interior near door)
    function tavernBedSpots(ctx) {
      const tv = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
      if (!tv) return [];
      const beds = (ctx.townProps || []).filter(p =>
        p.type === "bed" &&
        p.x > tv.x && p.x < tv.x + tv.w - 1 &&
        p.y > tv.y && p.y < tv.y + tv.h - 1
      );
      return beds;
    }
    function chooseTavernTarget(ctx) {
      const tv = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
      if (!tv) return null;
      const beds = tavernBedSpots(ctx);
      if (beds.length) {
        const b = beds[randInt(ctx, 0, beds.length - 1)];
        return { x: b.x, y: b.y };
      }
      // Fallback to a free interior tile near the door
      const door = ctx.tavern.door || { x: tv.x + ((tv.w / 2) | 0), y: tv.y + ((tv.h / 2) | 0) };
      const inSpot = nearestFreeAdjacent(ctx, door.x, door.y, tv);
      return inSpot || { x: door.x, y: door.y };
    }

    // Lightweight per-NPC rate limiting: each NPC only acts every N ticks.
    // Defaults: residents/shopkeepers every 2 ticks, pets every 3 ticks, generic 2.
    const tickMod = ((t && typeof t.turnCounter === "number") ? t.turnCounter : 0) | 0;
    function shouldSkipThisTick(n, idx) {
      if (typeof n._stride !== "number") {
        n._stride = n.isPet ? 3 : 2;
      }
      if (typeof n._strideOffset !== "number") {
        // Deterministic offset from index to evenly stagger across the stride
        n._strideOffset = idx % n._stride;
      }
      return (tickMod % n._stride) !== n._strideOffset;
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
      return (path && path.length >= 2) ? path : null;
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
          n._homeDebugPath = (path && path.length >= 2) ? path.slice(0) : null;
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
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.rng() * (i + 1));
      const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
    }

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
            stepTowards(ctx, occ, n, inSpot.x, inSpot.y);
            return true;
          }
          // Plan/step toward the door, persist plan across turns
          stepTowards(ctx, occ, n, door.x, door.y);
          return true;
        }
      } else {
        // Already inside: go to targetInside or nearest free interior tile
        const inSpot = (adjTarget && isFreeTile(ctx, adjTarget.x, adjTarget.y))
          ? adjTarget
          : nearestFreeAdjacent(ctx, adjTarget ? adjTarget.x : n.x, adjTarget ? adjTarget.y : n.y, building);
        if (inSpot) {
          stepTowards(ctx, occ, n, inSpot.x, inSpot.y);
          return true;
        }
      }
      return false;
    }

    for (const idx of order) {
      const n = npcs[idx];
      ensureHome(ctx, n);

      // Per-NPC tick rate limiting (skip some NPCs this tick to reduce CPU)
      if (shouldSkipThisTick(n, idx)) continue;

      // Daily scheduling: reset stagger assignment at dawn, assign in morning if missing
      if (t && t.phase === "dawn") {
        n._departAssignedForDay = false;
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

      // Shopkeepers with schedule
      if (n.isShopkeeper) {
        const shop = n._shopRef || null;
        const o = shop ? shop.openMin : 8 * 60;
        const c = shop ? shop.closeMin : 18 * 60;
        const arriveStart = (o - 60 + 1440) % 1440;
        const leaveEnd = (c + 30) % 1440;
        const shouldBeAtWorkZone = inWindow(arriveStart, leaveEnd, minutes, 1440);
        const openNow = isOpenAt(shop, minutes, 1440);

        let handled = false;
        if (shouldBeAtWorkZone) {
          if (openNow && n._workInside && shop && shop.building) {
            handled = routeIntoBuilding(ctx, occ, n, shop.building, n._workInside);
          } else if (n._work) {
            handled = stepTowards(ctx, occ, n, n._work.x, n._work.y);
          }
        } else if (n._home && n._home.building) {
          // Off hours: stagger departure between 18:00-21:00
          const departReady = typeof n._homeDepartMin === "number" ? (minutes >= n._homeDepartMin) : true;

          // If it's very late and the NPC is not inside home, seek tavern as fallback shelter
          if (inLateWindow && !(insideBuilding(n._home.building, n.x, n.y))) {
            const tv = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
            if (tv) {
              const tvTarget = chooseTavernTarget(ctx);
              handled = routeIntoBuilding(ctx, occ, n, tv, tvTarget);
            }
          }

          if (!handled && !departReady) {
            // Not yet time: linger around shop door or nearby plaza
            const linger = n._work || (ctx.townPlaza ? { x: ctx.townPlaza.x, y: ctx.townPlaza.y } : null);
            if (linger) {
              if (n.x === linger.x && n.y === linger.y) {
                if (ctx.rng() < 0.9) continue;
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

        // idle jiggle
        if (ctx.rng() < 0.9) continue;
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

          // Late-night shelter fallback: if very late and not inside home, go to tavern
          if (inLateWindow && n._home && n._home.building && !insideBuilding(n._home.building, n.x, n.y)) {
            const tv = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
            if (tv) {
              const tvTarget = chooseTavernTarget(ctx);
              if (routeIntoBuilding(ctx, occ, n, tv, tvTarget)) continue;
            }
          }

          if (!departReady) {
            // Not yet time to head home: keep day behavior (work/plaza/idle)
            const targetLate = n._work || (ctx.townPlaza ? { x: ctx.townPlaza.x, y: ctx.townPlaza.y } : null);
            if (targetLate) {
              if (n.x === targetLate.x && n.y === targetLate.y) {
                if (ctx.rng() < 0.9) continue;
                stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
                continue;
              }
              stepTowards(ctx, occ, n, targetLate.x, targetLate.y);
              continue;
            }
            // gentle idle
            if (ctx.rng() < 0.8) continue;
          } else if (n._home && n._home.building) {
            const bedSpot = n._home.bed ? { x: n._home.bed.x, y: n._home.bed.y } : null;
            const sleepTarget = bedSpot ? bedSpot : { x: n._home.x, y: n._home.y };
            // If at, or adjacent to, the bed spot (or home spot if no bed), go to sleep
            const atExact = (n.x === sleepTarget.x && n.y === sleepTarget.y);
            const nearBed = bedSpot ? (manhattan(n.x, n.y, bedSpot.x, bedSpot.y) === 1) : false;
            if (atExact || nearBed) {
              n._sleeping = true;
              continue;
            }
            // Ensure and follow a deterministic home plan; if blocked, wait and retry
            if (!n._homePlan || !n._homePlanGoal) {
              ensureHomePlan(ctx, occ, n);
            }
            if (followHomePlan(ctx, occ, n)) continue;
            // Fallback: attempt routing via door if plan absent
            if (routeIntoBuilding(ctx, occ, n, n._home.building, sleepTarget)) continue;

            // If still not able to go home and it's very late, seek tavern
            if (inLateWindow) {
              const tv = ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
              if (tv) {
                const tvTarget = chooseTavernTarget(ctx);
                if (routeIntoBuilding(ctx, occ, n, tv, tvTarget)) continue;
              }
            }
          }
          // If no home data for some reason, stop wandering at evening
          continue;
        } else if (phase === "day") {
          const target = n._work || (ctx.townPlaza ? { x: ctx.townPlaza.x, y: ctx.townPlaza.y } : null);
          if (target) {
            if (n.x === target.x && n.y === target.y) {
              if (ctx.rng() < 0.9) continue;
              stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
              continue;
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
      if (ctx.rng() < 0.25) continue;
      let target = null;
      if (phase === "morning") target = n._home ? { x: n._home.x, y: n._home.y } : null;
      else if (phase === "day") target = (n._work || ctx.townPlaza);
      else target = (ctx.tavern && n._likesTavern) ? { x: ctx.tavern.door.x, y: ctx.tavern.door.y }
                                                   : (n._home ? { x: n._home.x, y: n._home.y } : null);

      // Very late at night: prefer shelter (tavern) if not at home
      if (inLateWindow && ctx.tavern && ctx.tavern.building && (!n._home || !insideBuilding(n._home.building, n.x, n.y))) {
        const tvTarget = chooseTavernTarget(ctx) || { x: ctx.tavern.door.x, y: ctx.tavern.door.y };
        target = tvTarget;
      }

      if (!target) {
        stepTowards(ctx, occ, n, n.x + randInt(ctx, -1, 1), n.y + randInt(ctx, -1, 1));
        continue;
      }
      stepTowards(ctx, occ, n, target.x, target.y);
    }
    // Clear fast occupancy handle after processing to avoid leaking into other modules
    ctx._occ = null;
  }

  function checkHomeRoutes(ctx, opts = {}) {
    const res = { total: 0, reachable: 0, unreachable: 0, skipped: 0, details: [] };
    const npcs = Array.isArray(ctx.npcs) ? ctx.npcs : [];

    // Track resident presence
    let residentsTotal = 0, residentsAtHome = 0, residentsAtTavern = 0;
    const tavernB = (ctx.tavern && ctx.tavern.building) ? ctx.tavern.building : null;

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
        return (path && path.length >= 2) ? path : null;
      } else {
        const path = computePath(ctx, emptyOcc, n.x, n.y, targetInside.x, targetInside.y);
        return (path && path.length >= 2) ? path : null;
      }
    }

    for (let i = 0; i < npcs.length; i++) {
      const n = npcs[i];

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
      if (path && path.length >= 2) {
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
    return res;
  }

  window.TownAI = {
    populateTown,
    townNPCsAct,
    checkHomeRoutes,
  };
})();