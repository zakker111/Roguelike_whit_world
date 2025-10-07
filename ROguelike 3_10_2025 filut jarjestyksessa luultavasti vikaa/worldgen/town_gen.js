/**
 * Town
 * Compact town generation and helpers used by the game and TownAI.
 *
 * API:
 *   Town.generate(ctx) -> handled:boolean (true if it generated town and mutated ctx)
 *   Town.ensureSpawnClear(ctx) -> handled:boolean
 *   Town.spawnGateGreeters(ctx, count) -> handled:boolean
 *   Town.interactProps(ctx) -> handled:boolean
 *
 * Layout overview
 * - Walls and a gate near the player (fast travel into town).
 * - Plaza at center with lamps/benches/market decor.
 * - Roads in a grid connecting gate and plaza.
 * - Buildings: hollow rectangles with doors placed on accessible sides.
 * - Shops near plaza: door + interior reference, plus a sign and schedule.
 * - Props placed inside buildings (beds, tables, chairs, fireplace, storage, shelves, plants, rugs).
 *
 * Notes
 * - Window tiles on building perimeters allow light but block movement.
 * - Visibility and enemies are reset for town mode; TownAI populates NPCs after layout.
 * - Interactions (signs, well, benches) give quick flavor and small resting options.
 */
(function () {
  function inBounds(ctx, x, y) {
    try {
      if (window.Utils && typeof Utils.inBounds === "function") return Utils.inBounds(ctx, x, y);
    } catch (_) {}
    const rows = ctx.map.length, cols = ctx.map[0] ? ctx.map[0].length : 0;
    return x >= 0 && y >= 0 && x < cols && y < rows;
  }

  function _manhattan(ctx, ax, ay, bx, by) {
    if (window.Utils && typeof Utils.manhattan === "function") return Utils.manhattan(ax, ay, bx, by);
    return Math.abs(ax - bx) + Math.abs(ay - by);
  }

  function _isFreeTownFloor(ctx, x, y) {
    if (window.Utils && typeof Utils.isFreeTownFloor === "function") return Utils.isFreeTownFloor(ctx, x, y);
    if (!inBounds(ctx, x, y)) return false;
    const t = ctx.map[y][x];
    if (t !== ctx.TILES.FLOOR && t !== ctx.TILES.DOOR) return false;
    if (ctx.player.x === x && ctx.player.y === y) return false;
    if (Array.isArray(ctx.npcs) && ctx.npcs.some(n => n.x === x && n.y === y)) return false;
    if (Array.isArray(ctx.townProps) && ctx.townProps.some(p => p.x === x && p.y === y)) return false;
    return true;
  }

  // ---- Interactions ----
  function interactProps(ctx) {
    if (ctx.mode !== "town") return false;
    const candidates = [];
    const coords = [
      { x: ctx.player.x, y: ctx.player.y },
      { x: ctx.player.x + 1, y: ctx.player.y },
      { x: ctx.player.x - 1, y: ctx.player.y },
      { x: ctx.player.x, y: ctx.player.y + 1 },
      { x: ctx.player.x, y: ctx.player.y - 1 },
    ];
    for (const c of coords) {
      const p = ctx.townProps.find(p => p.x === c.x && p.y === c.y);
      if (p) candidates.push(p);
    }
    if (!candidates.length) return false;
    const p = candidates[0];
    switch (p.type) {
      case "well":
        ctx.log("You draw some cool water from the well. Refreshing.", "good");
        break;
      case "fountain":
        ctx.log("You watch the fountain for a moment. You feel calmer.", "info");
        break;
      case "bench": {
        const phase = (ctx.time && ctx.time.phase) || "day";
        if (phase !== "day") {
          ctx.log("You relax on the bench and drift to sleep...", "info");
          if (typeof ctx.advanceTimeMinutes === "function") {
            // rest until 06:00 with light heal
            const TS = (window.TimeService && typeof TimeService.create === "function")
              ? TimeService.create({ dayMinutes: 24 * 60, cycleTurns: 360 })
              : null;
            const clock = ctx.time;
            const curMin = clock ? (clock.hours * 60 + clock.minutes) : 0;
            const goalMin = 6 * 60;
            let delta = goalMin - curMin; if (delta <= 0) delta += 24 * 60;
            ctx.advanceTimeMinutes(delta);
          }
          const heal = Math.max(1, Math.floor(ctx.player.maxHp * 0.25));
          const prev = ctx.player.hp;
          ctx.player.hp = Math.min(ctx.player.maxHp, ctx.player.hp + heal);
          ctx.log(`You rest until morning (${(ctx.time && ctx.time.hhmm) || "06:00"}). HP ${prev.toFixed(1)} -> ${ctx.player.hp.toFixed(1)}.`, "good");
        } else {
          ctx.log("You sit on the bench and rest a moment.", "info");
        }
        break;
      }
      case "lamp":
        ctx.log("The lamp flickers warmly.", "info");
        break;
      case "stall":
        ctx.log("A vendor waves: 'Fresh wares soon!'", "notice");
        break;
      case "tree":
        ctx.log("A leafy tree offers a bit of shade.", "info");
        break;
      case "fireplace":
        ctx.log("You warm your hands by the fireplace.", "info");
        break;
      case "table":
        ctx.log("A sturdy wooden table. Nothing of note on it.", "info");
        break;
      case "chair":
        ctx.log("A simple wooden chair.", "info");
        break;
      case "bed":
        ctx.log("Looks comfy. Residents sleep here at night.", "info");
        break;
      case "chest":
        ctx.log("The chest is locked.", "warn");
        break;
      case "crate":
        ctx.log("A wooden crate. Might hold supplies.", "info");
        break;
      case "barrel":
        ctx.log("A barrel. Smells of ale.", "info");
        break;
      case "shelf":
        ctx.log("A shelf with assorted goods.", "info");
        break;
      case "plant":
        ctx.log("A potted plant adds some life.", "info");
        break;
      case "rug":
        ctx.log("A cozy rug warms the floor.", "info");
        break;
      case "sign": {
        const title = p.name || "Sign";
        // If this sign is next to a shop door, show its schedule
        const near = [
          { x: p.x, y: p.y },
          { x: p.x + 1, y: p.y },
          { x: p.x - 1, y: p.y },
          { x: p.x, y: p.y + 1 },
          { x: p.x, y: p.y - 1 },
        ];
        let shop = null;
        for (const c of near) {
          const s = shopAt(ctx, c.x, c.y);
          if (s) { shop = s; break; }
        }
        if (shop) {
          const openNow = isShopOpenNow(ctx, shop);
          const sched = shopScheduleStr(ctx, shop);
          ctx.log(`Sign: ${title}. ${sched} — ${openNow ? "Open now." : "Closed now."}`, openNow ? "good" : "warn");
        } else {
          ctx.log(`Sign: ${title}`, "info");
        }
        break;
      }
      default:
        ctx.log("There's nothing special here.");
    }
    ctx.requestDraw();
    return true;
  }

  // ---- Spawn helpers ----
  function ensureSpawnClear(ctx) {
    // Make sure the player isn't inside a building (WALL).
    // If current tile is not walkable, move to the nearest FLOOR/DOOR tile.
    const H = ctx.map.length;
    const W = ctx.map[0] ? ctx.map[0].length : 0;
    const isWalk = (x, y) => x >= 0 && y >= 0 && x < W && y < H && (ctx.map[y][x] === ctx.TILES.FLOOR || ctx.map[y][x] === ctx.TILES.DOOR);
    if (isWalk(ctx.player.x, ctx.player.y)) return true;

    // BFS from current position to nearest walkable
    const q = [];
    const seenB = new Set();
    q.push({ x: ctx.player.x, y: ctx.player.y, d: 0 });
    seenB.add(`${ctx.player.x},${ctx.player.y}`);
    const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
    while (q.length) {
      const cur = q.shift();
      for (const d of dirs) {
        const nx = cur.x + d.dx, ny = cur.y + d.dy;
        const key = `${nx},${ny}`;
        if (seenB.has(key)) continue;
        seenB.add(key);
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (isWalk(nx, ny)) {
          ctx.player.x = nx; ctx.player.y = ny;
          return true;
        }
        // expand through walls minimally to escape building
        q.push({ x: nx, y: ny, d: cur.d + 1 });
      }
    }
    // Fallback to center
    ctx.player.x = (W / 2) | 0;
    ctx.player.y = (H / 2) | 0;
    return true;
  }

  function spawnGateGreeters(ctx, count = 4) {
    if (!ctx.townExitAt) return false;
    const dirs = [
      { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
      { dx: 1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 }
    ];
    const names = ["Ava", "Borin", "Cora", "Darin", "Eda", "Finn", "Goro", "Hana"];
    const lines = [
      `Welcome to ${ctx.townName || "our town"}.`,
      "Shops are marked with S.",
      "Stay as long as you like.",
      "The plaza is at the center.",
    ];
    let placed = 0;
    // two rings around the gate
    for (let ring = 1; ring <= 2 && placed < count; ring++) {
      for (const d of dirs) {
        const x = ctx.townExitAt.x + d.dx * ring;
        const y = ctx.townExitAt.y + d.dy * ring;
        if (_isFreeTownFloor(ctx, x, y) && _manhattan(ctx, ctx.player.x, ctx.player.y, x, y) > 1) {
          const name = names[(Math.floor(ctx.rng() * names.length)) % names.length];
          ctx.npcs.push({ x, y, name, lines });
          placed++;
          if (placed >= count) break;
        }
      }
    }
    clearAdjacentNPCsAroundPlayer(ctx);
    return true;
  }

  function clearAdjacentNPCsAroundPlayer(ctx) {
    // Ensure the four cardinal neighbors around the player are not all occupied by NPCs
    const neighbors = [
      { x: ctx.player.x + 1, y: ctx.player.y },
      { x: ctx.player.x - 1, y: ctx.player.y },
      { x: ctx.player.x, y: ctx.player.y + 1 },
      { x: ctx.player.x, y: ctx.player.y - 1 },
    ];
    // If any neighbor has an NPC, remove up to two to keep space
    for (const pos of neighbors) {
      const idx = ctx.npcs.findIndex(n => n.x === pos.x && n.y === pos.y);
      if (idx !== -1) {
        ctx.npcs.splice(idx, 1);
      }
    }
  }

  // ---- Generation (compact version; retains core behavior and mutations) ----
  function generate(ctx) {
    // Determine current town size from overworld (default 'big')
    let townSize = "big";
    try {
      if (ctx.world && Array.isArray(ctx.world.towns)) {
        const wx = (ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number") ? ctx.worldReturnPos.x : ctx.player.x;
        const wy = (ctx.worldReturnPos && typeof ctx.worldReturnPos.y === "number") ? ctx.worldReturnPos.y : ctx.player.y;
        const info = ctx.world.towns.find(t => t.x === wx && t.y === wy);
        if (info && info.size) townSize = info.size;
      }
    } catch (_) {}

    // Size the town map from data/town.json (fallback to previous values)
    const TOWNCFG = (window.GameData && GameData.town) || null;
    function cfgSize(sizeKey) {
      const d = (TOWNCFG && TOWNCFG.sizes && TOWNCFG.sizes[sizeKey]) || null;
      if (d) return { W: Math.min(ctx.MAP_COLS, d.W | 0), H: Math.min(ctx.MAP_ROWS, d.H | 0) };
      if (sizeKey === "small") return { W: Math.min(ctx.MAP_COLS, 60), H: Math.min(ctx.MAP_ROWS, 40) };
      if (sizeKey === "city")  return { W: Math.min(ctx.MAP_COLS, 120), H: Math.min(ctx.MAP_ROWS, 80) };
      return { W: Math.min(ctx.MAP_COLS, 90), H: Math.min(ctx.MAP_ROWS, 60) };
    }
    const dims = cfgSize(townSize);
    const W = dims.W, H = dims.H;
    ctx.map = Array.from({ length: H }, () => Array(W).fill(ctx.TILES.FLOOR));

    // Outer walls
    for (let x = 0; x < W; x++) { ctx.map[0][x] = ctx.TILES.WALL; ctx.map[H - 1][x] = ctx.TILES.WALL; }
    for (let y = 0; y < H; y++) { ctx.map[y][0] = ctx.TILES.WALL; ctx.map[y][W - 1] = ctx.TILES.WALL; }

    // Gate nearest to player
    const clampXY = (x, y) => ({ x: Math.max(1, Math.min(W - 2, x)), y: Math.max(1, Math.min(H - 2, y)) });
    const targets = [
      { x: 1, y: ctx.player.y },                // west
      { x: W - 2, y: ctx.player.y },            // east
      { x: ctx.player.x, y: 1 },                // north
      { x: ctx.player.x, y: H - 2 },            // south
    ].map(p => clampXY(p.x, p.y));
    let best = targets[0], bd = Infinity;
    for (const t of targets) {
      const d = Math.abs(t.x - ctx.player.x) + Math.abs(t.y - ctx.player.y);
      if (d < bd) { bd = d; best = t; }
    }
    const gate = best;
    // Carve gate
    if (gate.x === 1) ctx.map[gate.y][0] = ctx.TILES.DOOR;
    else if (gate.x === W - 2) ctx.map[gate.y][W - 1] = ctx.TILES.DOOR;
    else if (gate.y === 1) ctx.map[0][gate.x] = ctx.TILES.DOOR;
    else if (gate.y === H - 2) ctx.map[H - 1][gate.x] = ctx.TILES.DOOR;

    ctx.map[gate.y][gate.x] = ctx.TILES.FLOOR;
    ctx.player.x = gate.x; ctx.player.y = gate.y;
    ctx.townExitAt = { x: gate.x, y: gate.y };

    // Name
    const prefixes = ["Oak", "Ash", "Pine", "River", "Stone", "Iron", "Silver", "Gold", "Wolf", "Fox", "Moon", "Star", "Red", "White", "Black", "Green"];
    const suffixes = ["dale", "ford", "field", "burg", "ton", "stead", "haven", "fall", "gate", "port", "wick", "shire", "crest", "view", "reach"];
    const mid = ["", "wood", "water", "brook", "hill", "rock", "ridge"];
    const p = prefixes[(Math.floor(ctx.rng() * prefixes.length)) % prefixes.length];
    const m = mid[(Math.floor(ctx.rng() * mid.length)) % mid.length];
    const s = suffixes[(Math.floor(ctx.rng() * suffixes.length)) % suffixes.length];
    ctx.townName = [p, m, s].filter(Boolean).join("");

    // Plaza
    const plaza = { x: (W / 2) | 0, y: (H / 2) | 0 };
    ctx.townPlaza = { x: plaza.x, y: plaza.y };
    function cfgPlaza(sizeKey) {
      const d = (TOWNCFG && TOWNCFG.plaza && TOWNCFG.plaza[sizeKey]) || null;
      if (d) return { w: d.w | 0, h: d.h | 0 };
      if (sizeKey === "small") return { w: 10, h: 8 };
      if (sizeKey === "city") return { w: 18, h: 14 };
      return { w: 14, h: 12 };
    }
    const plazaDims = cfgPlaza(townSize);
    const plazaW = plazaDims.w, plazaH = plazaDims.h;
    for (let yy = (plaza.y - (plazaH / 2)) | 0; yy <= (plaza.y + (plazaH / 2)) | 0; yy++) {
      for (let xx = (plaza.x - (plazaW / 2)) | 0; xx <= (plaza.x + (plazaW / 2)) | 0; xx++) {
        if (yy <= 0 || xx <= 0 || yy >= H - 1 || xx >= W - 1) continue;
        ctx.map[yy][xx] = ctx.TILES.FLOOR;
      }
    }

    // Roads
    const carveRoad = (x1, y1, x2, y2) => {
      let x = x1, y = y1;
      while (x !== x2) { ctx.map[y][x] = ctx.TILES.FLOOR; x += Math.sign(x2 - x); }
      while (y !== y2) { ctx.map[y][x] = ctx.TILES.FLOOR; y += Math.sign(y2 - y); }
      ctx.map[y][x] = ctx.TILES.FLOOR;
    };
    carveRoad(gate.x, gate.y, plaza.x, gate.y);
    carveRoad(plaza.x, gate.y, plaza.x, plaza.y);
    const roadYStride = (TOWNCFG && TOWNCFG.roads && (TOWNCFG.roads.yStride | 0)) || 8;
    const roadXStride = (TOWNCFG && TOWNCFG.roads && (TOWNCFG.roads.xStride | 0)) || 10;
    for (let y = 6; y < H - 6; y += Math.max(2, roadYStride)) for (let x = 1; x < W - 1; x++) ctx.map[y][x] = ctx.TILES.FLOOR;
    for (let x = 6; x < W - 6; x += Math.max(2, roadXStride)) for (let y = 1; y < H - 1; y++) ctx.map[y][x] = ctx.TILES.FLOOR;

    // Buildings (simplified: hollow rectangles aligned to blocks)
    const buildings = [];
    const placeBuilding = (bx, by, bw, bh) => {
      for (let yy = by; yy < by + bh; yy++) {
        for (let xx = bx; xx < bx + bw; xx++) {
          if (yy <= 0 || xx <= 0 || yy >= H - 1 || xx >= W - 1) continue;
          const isBorder = (yy === by || yy === by + bh - 1 || xx === bx || xx === bx + bw - 1);
          ctx.map[yy][xx] = isBorder ? ctx.TILES.WALL : ctx.TILES.FLOOR;
        }
      }
      buildings.push({ x: bx, y: by, w: bw, h: bh });
    };
    const cfgB = (TOWNCFG && TOWNCFG.buildings) || {};
    const maxBuildings = Math.max(1, (cfgB.max | 0) || 18);
    const blockW = Math.max(4, (cfgB.blockW | 0) || 8);
    const blockH = Math.max(3, (cfgB.blockH | 0) || 6);

    for (let by = 2; by < H - (blockH + 4) && buildings.length < maxBuildings; by += Math.max(6, blockH + 2)) {
      for (let bx = 2; bx < W - (blockW + 4) && buildings.length < maxBuildings; bx += Math.max(8, blockW + 2)) {
        let clear = true;
        for (let yy = by; yy < by + (blockH + 1) && clear; yy++) {
          for (let xx = bx; xx < bx + (blockW + 1); xx++) {
            if (ctx.map[yy][xx] !== ctx.TILES.FLOOR) { clear = false; break; }
          }
        }
        if (!clear) continue;
        const w = Math.max(6, Math.min(blockW, 6 + ((Math.floor(ctx.rng() * 3)))));   // 6..blockW
        const h = Math.max(4, Math.min(blockH, 4 + ((Math.floor(ctx.rng() * 3)))));   // 4..blockH
        const ox = Math.floor(ctx.rng() * Math.max(1, blockW - w));
        const oy = Math.floor(ctx.rng() * Math.max(1, blockH - h));
        placeBuilding(bx + 1 + ox, by + 1 + oy, w, h);
      }
    }

    // Doors and shops near plaza (compact): just mark doors and create shop entries
    function candidateDoors(b) {
      return [
        { x: b.x + ((b.w / 2) | 0), y: b.y, ox: 0, oy: -1 },                      // top
        { x: b.x + b.w - 1, y: b.y + ((b.h / 2) | 0), ox: +1, oy: 0 },            // right
        { x: b.x + ((b.w / 2) | 0), y: b.y + b.h - 1, ox: 0, oy: +1 },            // bottom
        { x: b.x, y: b.y + ((b.h / 2) | 0), ox: -1, oy: 0 },                      // left
      ];
    }
    function ensureDoor(b) {
      const cands = candidateDoors(b);
      const good = cands.filter(d => inBounds({ map: ctx.map }, d.x + d.ox, d.y + d.oy) && ctx.map[d.y + d.oy][d.x + d.ox] === ctx.TILES.FLOOR);
      const pick = (good.length ? good : cands)[(Math.floor(ctx.rng() * (good.length ? good.length : cands.length))) % (good.length ? good.length : cands.length)];
      if (inBounds(ctx, pick.x, pick.y)) ctx.map[pick.y][pick.x] = ctx.TILES.DOOR;
      return pick;
    }
    function getExistingDoor(b) {
      const cds = candidateDoors(b);
      for (const d of cds) {
        if (inBounds(ctx, d.x, d.y) && ctx.map[d.y][d.x] === ctx.TILES.DOOR) return { x: d.x, y: d.y };
      }
      const dd = ensureDoor(b);
      return { x: dd.x, y: dd.y };
    }

    ctx.shops = [];

    // Data-first shop selection: use GameData.shops when available
    function parseHHMMToMinutes(s) {
      if (!s || typeof s !== "string") return null;
      const m = s.match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      const h = Math.max(0, Math.min(23, parseInt(m[1], 10) || 0));
      const min = Math.max(0, Math.min(59, parseInt(m[2], 10) || 0));
      return ((h | 0) * 60 + (min | 0)) % (24 * 60);
    }
    function minutesOfDay(ctx, h, m = 0) {
      try {
        if (window.ShopService && typeof ShopService.minutesOfDay === "function") {
          return ShopService.minutesOfDay(h, m, 24 * 60);
        }
      } catch (_) {}
      return ((h | 0) * 60 + (m | 0)) % (24 * 60);
    }
    function scheduleFromData(row) {
      if (!row) return { openMin: minutesOfDay(ctx, 8), closeMin: minutesOfDay(ctx, 18), alwaysOpen: false };
      if (row.alwaysOpen) return { openMin: 0, closeMin: 0, alwaysOpen: true };
      const o = parseHHMMToMinutes(row.open);
      const c = parseHHMMToMinutes(row.close);
      if (o == null || c == null) return { openMin: minutesOfDay(ctx, 8), closeMin: minutesOfDay(ctx, 18), alwaysOpen: false };
      return { openMin: o, closeMin: c, alwaysOpen: false };
    }

    const shopDefs = (window.GameData && Array.isArray(GameData.shops)) ? GameData.shops.slice(0) : [
      { type: "blacksmith", name: "Blacksmith", open: "08:00", close: "17:00" },
      { type: "apothecary", name: "Apothecary", open: "09:00", close: "18:00" },
      { type: "armorer", name: "Armorer", open: "08:00", close: "17:00" },
      { type: "trader", name: "Trader", open: "08:00", close: "18:00" },
      { type: "inn", name: "Inn", alwaysOpen: true },
    ];

    // Score buildings by distance to plaza and assign shops to closest buildings
    const scored = buildings.map(b => ({ b, d: Math.abs((b.x + (b.w / 2)) - plaza.x) + Math.abs((b.y + (b.h / 2)) - plaza.y) }));
    scored.sort((a, b) => a.d - b.d);
    const shopCount = Math.min(shopDefs.length, scored.length);

    for (let i = 0; i < shopCount; i++) {
      const b = scored[i].b;
      const door = ensureDoor(b);
      const def = shopDefs[i % shopDefs.length];
      const sched = scheduleFromData(def);
      const name = def.name || def.type || "Shop";

      // inside near door
      const inward = [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
      let inside = null;
      for (const dxy of inward) {
        const ix = door.x + dxy.dx, iy = door.y + dxy.dy;
        const insideB = (ix > b.x && ix < b.x + b.w - 1 && iy > b.y && iy < b.y + b.h - 1);
        if (insideB && ctx.map[iy][ix] === ctx.TILES.FLOOR) { inside = { x: ix, y: iy }; break; }
      }
      if (!inside) {
        const cx = Math.max(b.x + 1, Math.min(b.x + b.w - 2, Math.floor(b.x + b.w / 2)));
        const cy = Math.max(b.y + 1, Math.min(b.y + b.h - 2, Math.floor(b.y + b.h / 2)));
        inside = { x: cx, y: cy };
      }

      ctx.shops.push({
        x: door.x,
        y: door.y,
        type: def.type || "shop",
        name,
        openMin: sched.openMin,
        closeMin: sched.closeMin,
        alwaysOpen: !!sched.alwaysOpen,
        building: { x: b.x, y: b.y, w: b.w, h: b.h, door: { x: door.x, y: door.y } },
        inside
      });
    }

    // Town buildings metadata
    ctx.townBuildings = buildings.map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h, door: getExistingDoor(b) }));

    // Props
    ctx.townProps = [];
    function addProp(x, y, type, name) {
      if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return false;
      if (ctx.map[y][x] !== ctx.TILES.FLOOR) return false;
      if (ctx.townProps.some(p => p.x === x && p.y === y)) return false;
      ctx.townProps.push({ x, y, type, name });
      return true;
    }
    function addSignNear(x, y, text) {
      const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
      for (const d of dirs) {
        const sx = x + d.dx, sy = y + d.dy;
        if (sx <= 0 || sy <= 0 || sx >= W - 1 || sy >= H - 1) continue;
        if (ctx.map[sy][sx] !== ctx.TILES.FLOOR) continue;
        if (ctx.townProps.some(p => p.x === sx && p.y === sy)) continue;
        addProp(sx, sy, "sign", text);
        return true;
      }
      return false;
    }
    // Welcome sign
    addSignNear(gate.x, gate.y, `Welcome to ${ctx.townName}`);

    // Windows along building walls (limited and spaced out)
    (function placeWindowsOnAll() {
      function sidePoints(b) {
        return [
          Array.from({ length: Math.max(0, b.w - 2) }, (_, i) => ({ x: b.x + 1 + i, y: b.y })),              // top
          Array.from({ length: Math.max(0, b.w - 2) }, (_, i) => ({ x: b.x + 1 + i, y: b.y + b.h - 1 })),    // bottom
          Array.from({ length: Math.max(0, b.h - 2) }, (_, i) => ({ x: b.x, y: b.y + 1 + i })),              // left
          Array.from({ length: Math.max(0, b.h - 2) }, (_, i) => ({ x: b.x + b.w - 1, y: b.y + 1 + i })),    // right
        ];
      }
      function isAdjacent(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1; }
      for (const b of buildings) {
        let candidates = [];
        const sides = sidePoints(b);
        for (const pts of sides) {
          for (const p of pts) {
            if (!inBounds(ctx, p.x, p.y)) continue;
            const t = ctx.map[p.y][p.x];
            if (t !== ctx.TILES.WALL) continue;
            candidates.push(p);
          }
        }
        if (!candidates.length) continue;
        const limit = Math.min(3, Math.max(1, Math.floor((b.w + b.h) / 10)));
        const placed = [];
        let attempts = 0;
        while (placed.length < limit && candidates.length > 0 && attempts++ < candidates.length * 2) {
          const idx = Math.floor(ctx.rng() * candidates.length);
          const p = candidates[idx];
          if (placed.some(q => isAdjacent(p, q))) {
            candidates.splice(idx, 1);
            continue;
          }
          ctx.map[p.y][p.x] = ctx.TILES.WINDOW;
          placed.push(p);
          candidates = candidates.filter(c => !isAdjacent(c, p));
        }
      }
    })();

    // Plaza fixtures
    addProp(plaza.x, plaza.y, "well", "Town Well");
    addProp(plaza.x - 6, plaza.y - 4, "lamp", "Lamp Post");
    addProp(plaza.x + 6, plaza.y - 4, "lamp", "Lamp Post");
    addProp(plaza.x - 6, plaza.y + 4, "lamp", "Lamp Post");
    addProp(plaza.x + 6, plaza.y + 4, "lamp", "Lamp Post");

    // Benches and market decor around the plaza
    (function placePlazaDecor() {
      // Place benches along the inner perimeter of the plaza, spaced out
      const bx0 = ((plaza.x - (plazaW / 2)) | 0) + 1;
      const bx1 = ((plaza.x + (plazaW / 2)) | 0) - 1;
      const by0 = ((plaza.y - (plazaH / 2)) | 0) + 1;
      const by1 = ((plaza.y + (plazaH / 2)) | 0) - 1;

      const benchSpots = [];
      // top and bottom edges
      for (let x = bx0; x <= bx1; x += 3) {
        benchSpots.push({ x, y: by0 });
        benchSpots.push({ x, y: by1 });
      }
      // left and right edges
      for (let y = by0 + 2; y <= by1 - 2; y += 3) {
        benchSpots.push({ x: bx0, y });
        benchSpots.push({ x: bx1, y });
      }
      // Try to place up to a limit to avoid clutter
      let placed = 0;
      const benchLimitCfg = ((TOWNCFG && TOWNCFG.props && TOWNCFG.props.benchLimit && TOWNCFG.props.benchLimit[townSize]) | 0);
      const computedLimit = Math.min(12, Math.max(6, Math.floor((plazaW + plazaH) / 3)));
      const limit = benchLimitCfg > 0 ? benchLimitCfg : computedLimit;
      for (const p of benchSpots) {
        if (placed >= limit) break;
        // Only place on clear floor and keep a tile free next to the bench
        if (p.x <= 0 || p.y <= 0 || p.x >= W - 1 || p.y >= H - 1) continue;
        if (ctx.map[p.y][p.x] !== ctx.TILES.FLOOR) continue;
        if (ctx.townProps.some(q => q.x === p.x && q.y === p.y)) continue;
        if ((p.x === ctx.player.x && p.y === ctx.player.y)) continue;
        if (addProp(p.x, p.y, "bench", "Bench")) placed++;
      }

      // Small market stalls on four sides of the plaza (not blocking the center)
      const stallOffsets = [
        { dx: -((plazaW / 2) | 0) + 2, dy: 0 },
        { dx: ((plazaW / 2) | 0) - 2, dy: 0 },
        { dx: 0, dy: -((plazaH / 2) | 0) + 2 },
        { dx: 0, dy: ((plazaH / 2) | 0) - 2 },
      ];
      for (const o of stallOffsets) {
        const sx = Math.max(1, Math.min(W - 2, plaza.x + o.dx));
        const sy = Math.max(1, Math.min(H - 2, plaza.y + o.dy));
        if (ctx.map[sy][sx] === ctx.TILES.FLOOR) {
          addProp(sx, sy, "stall", "Market Stall");
          // scatter a crate/barrel next to each stall if space allows
          const neighbors = [
            { x: sx + 1, y: sy }, { x: sx - 1, y: sy },
            { x: sx, y: sy + 1 }, { x: sx, y: sy - 1 },
          ];
          for (const n of neighbors) {
            if (n.x <= 0 || n.y <= 0 || n.x >= W - 1 || n.y >= H - 1) continue;
            if (ctx.map[n.y][n.x] !== ctx.TILES.FLOOR) continue;
            if (ctx.townProps.some(p => p.x === n.x && p.y === n.y)) continue;
            const kind = ctx.rng() < 0.5 ? "crate" : "barrel";
            addProp(n.x, n.y, kind, kind === "crate" ? "Crate" : "Barrel");
            break;
          }
        }
      }

      // A few plants to soften the plaza
      const plantFactor = ((TOWNCFG && TOWNCFG.props && (TOWNCFG.props.plantTryFactor | 0)) || 10);
      const plantTry = Math.min(8, Math.max(3, Math.floor((plazaW + plazaH) / Math.max(2, plantFactor))));
      let tries = 0, planted = 0;
      while (planted < plantTry && tries++ < 80) {
        const rx = Math.max(1, Math.min(W - 2, plaza.x + (Math.floor(ctx.rng() * plazaW) - (plazaW / 2 | 0))));
        const ry = Math.max(1, Math.min(H - 2, plaza.y + (Math.floor(ctx.rng() * plazaH) - (plazaH / 2 | 0))));
        if (ctx.map[ry][rx] !== ctx.TILES.FLOOR) continue;
        if (ctx.townProps.some(p => p.x === rx && p.y === ry)) continue;
        if (addProp(rx, ry, "plant", "Plant")) planted++;
      }
    })();

    // Furnish building interiors for variety (beds, tables, chairs, fireplace, storage, shelves, plants, rugs)
    (function furnishInteriors() {
      function insideFloor(b, x, y) { return x > b.x && x < b.x + b.w - 1 && y > b.y && y < b.y + b.h - 1 && ctx.map[y][x] === ctx.TILES.FLOOR; }
      function occupiedTile(x, y) { return ctx.townProps.some(p => p.x === x && p.y === y); }
      for (const b of buildings) {
        // fireplace spots near inner walls
        const borderAdj = [];
        for (let yy = b.y + 1; yy < b.y + b.h - 1; yy++) {
          for (let xx = b.x + 1; xx < b.x + b.w - 1; xx++) {
            if (!insideFloor(b, xx, yy)) continue;
            if (ctx.map[yy - 1][xx] === ctx.TILES.WALL || ctx.map[yy + 1][xx] === ctx.TILES.WALL || ctx.map[yy][xx - 1] === ctx.TILES.WALL || ctx.map[yy][xx + 1] === ctx.TILES.WALL) {
              borderAdj.push({ x: xx, y: yy });
            }
          }
        }
        if (borderAdj.length && ctx.rng() < 0.9) {
          const f = borderAdj[Math.floor(ctx.rng() * borderAdj.length)];
          if (!occupiedTile(f.x, f.y)) addProp(f.x, f.y, "fireplace", "Fireplace");
        }

        // Beds scaled by area
        const area = b.w * b.h;
        let bedTarget = Math.max(1, Math.min(3, Math.floor(area / 24)));
        let bedsPlaced = 0, triesBed = 0;
        while (bedsPlaced < bedTarget && triesBed++ < 120) {
          const xx = Math.floor(ctx.rng() * (b.w - 2)) + b.x + 1;
          const yy = Math.floor(ctx.rng() * (b.h - 2)) + b.y + 1;
          if (!insideFloor(b, xx, yy)) continue;
          if (occupiedTile(xx, yy)) continue;
          addProp(xx, yy, "bed", "Bed"); bedsPlaced++;
        }

        // Tables and chairs
        if (ctx.rng() < 0.8) {
          let placedT = false, triesT = 0;
          while (!placedT && triesT++ < 60) {
            const tx = Math.floor(ctx.rng() * (b.w - 2)) + b.x + 1;
            const ty = Math.floor(ctx.rng() * (b.h - 2)) + b.y + 1;
            if (!insideFloor(b, tx, ty) || occupiedTile(tx, ty)) continue;
            addProp(tx, ty, "table", "Table"); placedT = true;
          }
        }
        let chairCount = ctx.rng() < 0.5 ? 2 : 1;
        let triesC = 0;
        while (chairCount > 0 && triesC++ < 80) {
          const cx = Math.floor(ctx.rng() * (b.w - 2)) + b.x + 1;
          const cy = Math.floor(ctx.rng() * (b.h - 2)) + b.y + 1;
          if (!insideFloor(b, cx, cy) || occupiedTile(cx, cy)) continue;
          addProp(cx, cy, "chair", "Chair"); chairCount--;
        }

        // Storage: chests, crates, barrels
        let chestCount = ctx.rng() < 0.5 ? 2 : 1;
        let placedC = 0, triesChest = 0;
        while (placedC < chestCount && triesChest++ < 80) {
          const xx = Math.floor(ctx.rng() * (b.w - 2)) + b.x + 1;
          const yy = Math.floor(ctx.rng() * (b.h - 2)) + b.y + 1;
          if (!insideFloor(b, xx, yy) || occupiedTile(xx, yy)) continue;
          addProp(xx, yy, "chest", "Chest"); placedC++;
        }
        let crates = ctx.rng() < 0.6 ? 2 : 1;
        let triesCr = 0;
        while (crates > 0 && triesCr++ < 120) {
          const xx = Math.floor(ctx.rng() * (b.w - 2)) + b.x + 1;
          const yy = Math.floor(ctx.rng() * (b.h - 2)) + b.y + 1;
          if (!insideFloor(b, xx, yy) || occupiedTile(xx, yy)) continue;
          addProp(xx, yy, "crate", "Crate"); crates--;
        }
        let barrels = ctx.rng() < 0.6 ? 2 : 1;
        let triesBrl = 0;
        while (barrels > 0 && triesBrl++ < 120) {
          const xx = Math.floor(ctx.rng() * (b.w - 2)) + b.x + 1;
          const yy = Math.floor(ctx.rng() * (b.h - 2)) + b.y + 1;
          if (!insideFloor(b, xx, yy) || occupiedTile(xx, yy)) continue;
          addProp(xx, yy, "barrel", "Barrel"); barrels--;
        }

        // Shelves against inner walls
        let shelves = Math.min(2, Math.floor(area / 30));
        const shelfSpots = borderAdj.slice();
        while (shelves-- > 0 && shelfSpots.length) {
          const s = shelfSpots.splice(Math.floor(ctx.rng() * shelfSpots.length), 1)[0];
          if (!occupiedTile(s.x, s.y)) addProp(s.x, s.y, "shelf", "Shelf");
        }

        // Plants/rugs for variety
        if (ctx.rng() < 0.5) {
          const px = Math.floor(ctx.rng() * (b.w - 2)) + b.x + 1;
          const py = Math.floor(ctx.rng() * (b.h - 2)) + b.y + 1;
          if (insideFloor(b, px, py) && !occupiedTile(px, py)) addProp(px, py, "plant", "Plant");
        }
        if (ctx.rng() < 0.5) {
          const rx = Math.floor(ctx.rng() * (b.w - 2)) + b.x + 1;
          const ry = Math.floor(ctx.rng() * (b.h - 2)) + b.y + 1;
          if (insideFloor(b, rx, ry) && !occupiedTile(rx, ry)) addProp(rx, ry, "rug", "Rug");
        }
      }
    })();

    // NPCs via TownAI if present
    ctx.npcs = [];
    if (window.TownAI && typeof TownAI.populateTown === "function") {
      TownAI.populateTown(ctx);
    }

    // Roaming villagers near plaza
    const ND = (window.GameData && GameData.npcs) ? GameData.npcs : null;
    const baseLines = (ND && Array.isArray(ND.residentLines) && ND.residentLines.length)
      ? ND.residentLines
      : [
          "Rest your feet a while.",
          "The dungeon is dangerous.",
          "Buy supplies before you go.",
          "Lovely day on the plaza.",
          "Care for a drink at the well?"
        ];
    const lines = [
      `Welcome to ${ctx.townName || "our town"}.`,
      ...baseLines
    ];
    const roamTarget = Math.min(14, Math.max(6, Math.floor((ctx.townBuildings?.length || 12) / 2)));
    let placed = 0, tries = 0;
    while (placed < roamTarget && tries++ < 800) {
      const onRoad = ctx.rng() < 0.4;
      let x, y;
      if (onRoad) {
        if (ctx.rng() < 0.5) { y = gate.y; x = Math.max(2, Math.min(W - 3, Math.floor(ctx.rng() * (W - 4)) + 2)); }
        else { x = plaza.x; y = Math.max(2, Math.min(H - 3, Math.floor(ctx.rng() * (H - 4)) + 2)); }
      } else {
        const ox = Math.floor(ctx.rng() * 21) - 10;
        const oy = Math.floor(ctx.rng() * 17) - 8;
        x = Math.max(1, Math.min(W - 2, plaza.x + ox));
        y = Math.max(1, Math.min(H - 2, plaza.y + oy));
      }
      if (ctx.map[y][x] !== ctx.TILES.FLOOR && ctx.map[y][x] !== ctx.TILES.DOOR) continue;
      if (x === ctx.player.x && y === ctx.player.y) continue;
      if (_manhattan(ctx, ctx.player.x, ctx.player.y, x, y) <= 1) continue;
      if (ctx.npcs.some(n => n.x === x && n.y === y)) continue;
      if (ctx.townProps.some(p => p.x === x && p.y === y)) continue;
      ctx.npcs.push({ x, y, name: `Villager ${placed + 1}`, lines, _likesTavern: ctx.rng() < 0.45 });
      placed++;
    }

    // Visibility reset for town
    ctx.seen = Array.from({ length: H }, () => Array(W).fill(false));
    ctx.visible = Array.from({ length: H }, () => Array(W).fill(false));
    ctx.enemies = [];
    ctx.corpses = [];
    ctx.decals = [];

    // Finish
    if (ctx.updateUI) ctx.updateUI();
    if (ctx.requestDraw) ctx.requestDraw();
    return true;
  }

  // ---- Shop helpers for interactProps ----
  function minutesOfDayLocal(h, m = 0) {
    try { if (window.ShopService && typeof ShopService.minutesOfDay === "function") return ShopService.minutesOfDay(h, m, 24 * 60); } catch (_){}
    return ((h | 0) * 60 + (m | 0)) % (24 * 60);
  }
  function isOpenAt(ctx, shop, minutes) {
    if (window.ShopService && typeof ShopService.isOpenAt === "function") return ShopService.isOpenAt(shop, minutes);
    if (!shop) return false;
    if (shop.alwaysOpen) return true;
    if (typeof shop.openMin !== "number" || typeof shop.closeMin !== "number") return false;
    const o = shop.openMin, c = shop.closeMin;
    if (o === c) return false;
    return c > o ? (minutes >= o && minutes < c) : (minutes >= o || minutes < c);
  }
  function isShopOpenNow(ctx, shop = null) {
    if (window.ShopService && typeof ShopService.isShopOpenNow === "function") return ShopService.isShopOpenNow(ctx, shop);
    const t = ctx.time;
    const minutes = t ? (t.hours * 60 + t.minutes) : 12 * 60;
    if (!shop) return t && t.phase === "day";
    return isOpenAt(ctx, shop, minutes);
  }
  function shopScheduleStr(ctx, shop) {
    if (window.ShopService && typeof ShopService.shopScheduleStr === "function") return ShopService.shopScheduleStr(shop);
    if (!shop) return "";
    const h2 = (min) => {
      const hh = ((min / 60) | 0) % 24;
      return String(hh).padStart(2, "0");
    };
    return `Opens ${h2(shop.openMin)}:00, closes ${h2(shop.closeMin)}:00`;
  }
  function shopAt(ctx, x, y) {
    if (window.ShopService && typeof ShopService.shopAt === "function") return ShopService.shopAt(ctx, x, y);
    const shops = Array.isArray(ctx.shops) ? ctx.shops : [];
    return shops.find(s => s.x === x && s.y === y) || null;
  }

  window.Town = { generate, ensureSpawnClear, spawnGateGreeters, interactProps };
})();