/**
 * Town
 * Compact town generation and helpers used by the game and TownAI.
 *
 * API (ESM + window.Town):
 *   generate(ctx) -> handled:boolean (true if it generated town and mutated ctx)
 *   ensureSpawnClear(ctx) -> handled:boolean
 *   spawnGateGreeters(ctx, count) -> handled:boolean
 *   interactProps(ctx) -> handled:boolean
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

  function inBounds(ctx, x, y) {
    try {
      if (typeof window !== "undefined" && window.Bounds && typeof window.Bounds.inBounds === "function") {
        return window.Bounds.inBounds(ctx, x, y);
      }
      if (ctx && ctx.Utils && typeof ctx.Utils.inBounds === "function") return ctx.Utils.inBounds(ctx, x, y);
      if (typeof window !== "undefined" && window.Utils && typeof window.Utils.inBounds === "function") return window.Utils.inBounds(ctx, x, y);
    } catch (_) {}
    const rows = ctx.map.length, cols = ctx.map[0] ? ctx.map[0].length : 0;
    return x >= 0 && y >= 0 && x < cols && y < rows;
  }

  function _manhattan(ctx, ax, ay, bx, by) {
    try {
      if (ctx && ctx.Utils && typeof ctx.Utils.manhattan === "function") return ctx.Utils.manhattan(ax, ay, bx, by);
    } catch (_) {}
    try {
      if (typeof window !== "undefined" && window.Utils && typeof window.Utils.manhattan === "function") return window.Utils.manhattan(ax, ay, bx, by);
    } catch (_) {}
    return Math.abs(ax - bx) + Math.abs(ay - by);
  }

  function _isFreeTownFloor(ctx, x, y) {
    try {
      if (ctx && ctx.Utils && typeof ctx.Utils.isFreeTownFloor === "function") return ctx.Utils.isFreeTownFloor(ctx, x, y);
    } catch (_) {}
    try {
      if (typeof window !== "undefined" && window.Utils && typeof window.Utils.isFreeTownFloor === "function") return window.Utils.isFreeTownFloor(ctx, x, y);
    } catch (_) {}
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

    // Data-driven interactions strictly via PropsService + props.json
    if (typeof window !== "undefined" && window.PropsService && typeof window.PropsService.interact === "function") {
      return window.PropsService.interact(ctx, p);
    }
    return false;
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
    try { if (typeof window !== "undefined" && window.Fallback && typeof window.Fallback.log === "function") window.Fallback.log("town", "ensureSpawnClear: moving player to map center (no walkable tile found by BFS).", { W, H }); } catch (_) {}
    ctx.player.x = (W / 2) | 0;
    ctx.player.y = (H / 2) | 0;
    return true;
  }

  function spawnGateGreeters(ctx, count = 4) {
    if (!ctx.townExitAt) return false;
    // Clamp to ensure at most one NPC near the gate within a small radius
    const RADIUS = 2;
    const gx = ctx.townExitAt.x, gy = ctx.townExitAt.y;
    const existingNear = Array.isArray(ctx.npcs) ? ctx.npcs.filter(n => _manhattan(ctx, n.x, n.y, gx, gy) <= RADIUS).length : 0;
    const target = Math.max(0, Math.min((count | 0), 1 - existingNear));
    if (target <= 0) {
      // Keep player space clear but ensure at least one greeter remains in radius
      clearAdjacentNPCsAroundPlayer(ctx);
      try {
        const nearNow = Array.isArray(ctx.npcs) ? ctx.npcs.filter(n => _manhattan(ctx, n.x, n.y, gx, gy) <= RADIUS).length : 0;
        if (nearNow === 0) {
          const names = ["Ava", "Borin", "Cora", "Darin", "Eda", "Finn", "Goro", "Hana"];
          const lines = [
            `Welcome to ${ctx.townName || "our town"}.`,
            "Shops are marked with S.",
            "Stay as long as you like.",
            "The plaza is at the center.",
          ];
          // Prefer diagonals first to avoid blocking cardinal steps
          const candidates = [
            { x: gx + 1, y: gy + 1 }, { x: gx + 1, y: gy - 1 }, { x: gx - 1, y: gy + 1 }, { x: gx - 1, y: gy - 1 },
            { x: gx + 2, y: gy }, { x: gx - 2, y: gy }, { x: gx, y: gy + 2 }, { x: gx, y: gy - 2 },
            { x: gx + 2, y: gy + 1 }, { x: gx + 2, y: gy - 1 }, { x: gx - 2, y: gy + 1 }, { x: gx - 2, y: gy - 1 },
            { x: gx + 1, y: gy + 2 }, { x: gx + 1, y: gy - 2 }, { x: gx - 1, y: gy + 2 }, { x: gx - 1, y: gy - 2 },
          ];
          for (const c of candidates) {
            if (_isFreeTownFloor(ctx, c.x, c.y) && _manhattan(ctx, ctx.player.x, ctx.player.y, c.x, c.y) > 1) {
              const name = names[(Math.floor(ctx.rng() * names.length)) % names.length];
              ctx.npcs.push({ x: c.x, y: c.y, name, lines, greeter: true });
              break;
            }
          }
        }
      } catch (_) {}
      return true;
    }

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
    for (let ring = 1; ring <= 2 && placed < target; ring++) {
      for (const d of dirs) {
        const x = gx + d.dx * ring;
        const y = gy + d.dy * ring;
        if (_isFreeTownFloor(ctx, x, y) && _manhattan(ctx, ctx.player.x, ctx.player.y, x, y) > 1) {
          const name = names[(Math.floor(ctx.rng() * names.length)) % names.length];
          ctx.npcs.push({ x, y, name, lines, greeter: true });
          placed++;
          if (placed >= target) break;
        }
      }
    }
    clearAdjacentNPCsAroundPlayer(ctx);
    // After clearing adjacency, ensure at least one greeter remains near the gate
    try {
      const nearNow = Array.isArray(ctx.npcs) ? ctx.npcs.filter(n => _manhattan(ctx, n.x, n.y, gx, gy) <= RADIUS).length : 0;
      if (nearNow === 0) {
        const name = "Greeter";
        const lines2 = [
          `Welcome to ${ctx.townName || "our town"}.`,
          "Shops are marked with S.",
          "Stay as long as you like.",
          "The plaza is at the center.",
        ];
        const diag = [
          { x: gx + 1, y: gy + 1 }, { x: gx + 1, y: gy - 1 }, { x: gx - 1, y: gy + 1 }, { x: gx - 1, y: gy - 1 }
        ];
        for (const c of diag) {
          if (_isFreeTownFloor(ctx, c.x, c.y)) { ctx.npcs.push({ x: c.x, y: c.y, name, lines: lines2, greeter: true }); break; }
        }
      }
    } catch (_) {}
    return true;
  }

  function enforceGateNPCLimit(ctx, limit = 1, radius = 2) {
    if (!ctx || !ctx.npcs || !ctx.townExitAt) return;
    const gx = ctx.townExitAt.x, gy = ctx.townExitAt.y;
    const nearIdx = [];
    for (let i = 0; i < ctx.npcs.length; i++) {
      const n = ctx.npcs[i];
      if (_manhattan(ctx, n.x, n.y, gx, gy) <= radius) nearIdx.push({ i, d: _manhattan(ctx, n.x, n.y, gx, gy) });
    }
    if (nearIdx.length <= limit) return;
    // Keep the closest 'limit'; remove others
    nearIdx.sort((a, b) => a.d - b.d || a.i - b.i);
    const keepSet = new Set(nearIdx.slice(0, limit).map(o => o.i));
    const toRemove = nearIdx.slice(limit).map(o => o.i).sort((a, b) => b - a);
    for (const idx of toRemove) {
      ctx.npcs.splice(idx, 1);
    }
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
    // Determine current town size from overworld (default 'big') and capture its world entry for persistence
    let townSize = "big";
    let info = null;
    try {
      if (ctx.world && Array.isArray(ctx.world.towns)) {
        const wx = (ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number") ? ctx.worldReturnPos.x : ctx.player.x;
        const wy = (ctx.worldReturnPos && typeof ctx.worldReturnPos.y === "number") ? ctx.worldReturnPos.y : ctx.player.y;
        info = ctx.world.towns.find(t => t.x === wx && t.y === wy) || null;
        if (info && info.size) townSize = info.size;
      }
    } catch (_) { info = null; }

    // Size the town map from data/town.json (fallback to previous values)
    const TOWNCFG = (typeof window !== "undefined" && window.GameData && window.GameData.town) || null;
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

    // Gate placement: prefer the edge matching the approach direction, else nearest edge
    const clampXY = (x, y) => ({ x: Math.max(1, Math.min(W - 2, x)), y: Math.max(1, Math.min(H - 2, y)) });
    const pxy = clampXY(ctx.player.x, ctx.player.y);
    let gate = null;

    // If Modes recorded an approach direction (E/W/N/S), pick corresponding perimeter gate
    const dir = (typeof ctx.enterFromDir === "string") ? ctx.enterFromDir : "";
    if (dir) {
      if (dir === "E") gate = { x: 1, y: pxy.y };           // entered moving east -> came from west -> west edge
      else if (dir === "W") gate = { x: W - 2, y: pxy.y };  // entered moving west -> came from east -> east edge
      else if (dir === "N") gate = { x: pxy.x, y: H - 2 };  // entered moving north -> came from south -> south edge
      else if (dir === "S") gate = { x: pxy.x, y: 1 };      // entered moving south -> came from north -> north edge
    }

    if (!gate) {
      // Fallback: pick nearest edge to the player's (clamped) position
      const targets = [
        { x: 1, y: pxy.y },                // west
        { x: W - 2, y: pxy.y },            // east
        { x: pxy.x, y: 1 },                // north
        { x: pxy.x, y: H - 2 },            // south
      ];
      let best = targets[0], bd = Infinity;
      for (const t of targets) {
        const d = Math.abs(t.x - pxy.x) + Math.abs(t.y - pxy.y);
        if (d < bd) { bd = d; best = t; }
      }
      try { if (typeof window !== "undefined" && window.Fallback && typeof window.Fallback.log === "function") window.Fallback.log("town", "Gate placement: using nearest edge (enterFromDir unavailable).", { gate: best }); } catch (_) {}
      gate = best;
    }

    // Carve gate: mark the perimeter door and the interior gate tile as floor
    if (gate.x === 1) ctx.map[gate.y][0] = ctx.TILES.DOOR;
    else if (gate.x === W - 2) ctx.map[gate.y][W - 1] = ctx.TILES.DOOR;
    else if (gate.y === 1) ctx.map[0][gate.x] = ctx.TILES.DOOR;
    else if (gate.y === H - 2) ctx.map[H - 1][gate.x] = ctx.TILES.DOOR;

    ctx.map[gate.y][gate.x] = ctx.TILES.FLOOR;
    ctx.player.x = gate.x; ctx.player.y = gate.y;
    ctx.townExitAt = { x: gate.x, y: gate.y };

    // Name: persist on the world.towns entry so it remains stable across visits
    let townName = null;
    try {
      if (info && typeof info.name === "string" && info.name) townName = info.name;
    } catch (_) { townName = null; }
    if (!townName) {
      const prefixes = ["Oak", "Ash", "Pine", "River", "Stone", "Iron", "Silver", "Gold", "Wolf", "Fox", "Moon", "Star", "Red", "White", "Black", "Green"];
      const suffixes = ["dale", "ford", "field", "burg", "ton", "stead", "haven", "fall", "gate", "port", "wick", "shire", "crest", "view", "reach"];
      const mid = ["", "wood", "water", "brook", "hill", "rock", "ridge"];
      const p = prefixes[(Math.floor(ctx.rng() * prefixes.length)) % prefixes.length];
      const m = mid[(Math.floor(ctx.rng() * mid.length)) % mid.length];
      const s = suffixes[(Math.floor(ctx.rng() * suffixes.length)) % suffixes.length];
      townName = [p, m, s].filter(Boolean).join("");
      try { if (info) info.name = townName; } catch (_) {}
    }
    ctx.townName = townName;
    // Expose size to other modules (AI, UI)
    ctx.townSize = townSize;

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
    // Persist exact plaza rectangle bounds for diagnostics and overlay checks
    try {
      ctx.townPlazaRect = {
        x0: ((plaza.x - (plazaW / 2)) | 0),
        y0: ((plaza.y - (plazaH / 2)) | 0),
        x1: ((plaza.x + (plazaW / 2)) | 0),
        y1: ((plaza.y + (plazaH / 2)) | 0),
      };
    } catch (_) {}

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

    // Ensure a margin of clear floor around buildings so walls never touch between buildings
    function isAreaClearForBuilding(bx, by, bw, bh, margin = 1) {
      const x0 = Math.max(1, bx - margin);
      const y0 = Math.max(1, by - margin);
      const x1 = Math.min(W - 2, bx + bw - 1 + margin);
      const y1 = Math.min(H - 2, by + bh - 1 + margin);
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const t = ctx.map[yy][xx];
          if (t !== ctx.TILES.FLOOR) return false;
        }
      }
      return true;
    }

    // Prevent any building rectangle from overlapping the town plaza footprint (optionally with a small buffer)
    function overlapsPlazaRect(bx, by, bw, bh, margin = 0) {
      // Compute plaza rectangle bounds exactly as carved earlier
      const px0 = ((plaza.x - (plazaW / 2)) | 0);
      const px1 = ((plaza.x + (plazaW / 2)) | 0);
      const py0 = ((plaza.y - (plazaH / 2)) | 0);
      const py1 = ((plaza.y + (plazaH / 2)) | 0);
      const ax0 = bx, ay0 = by;
      const ax1 = bx + bw - 1, ay1 = by + bh - 1;
      const bx0 = Math.max(1, px0 - margin), by0 = Math.max(1, py0 - margin);
      const bx1 = Math.min(W - 2, px1 + margin), by1 = Math.min(H - 2, py1 + margin);
      // Axis-aligned rectangle overlap check
      const sepX = (ax1 < bx0) || (bx1 < ax0);
      const sepY = (ay1 < by0) || (by1 < ay0);
      return !(sepX || sepY);
    }

    for (let by = 2; by < H - (blockH + 4) && buildings.length < maxBuildings; by += Math.max(6, blockH + 2)) {
      for (let bx = 2; bx < W - (blockW + 4) && buildings.length < maxBuildings; bx += Math.max(8, blockW + 2)) {
        let clear = true;
        for (let yy = by; yy < by + (blockH + 1) && clear; yy++) {
          for (let xx = bx; xx < bx + (blockW + 1); xx++) {
            if (ctx.map[yy][xx] !== ctx.TILES.FLOOR) { clear = false; break; }
          }
        }
        if (!clear) continue;
        // Strongly varied house sizes:
        // Mixture of small cottages, medium houses (wide spread), and large/longhouses,
        // while respecting per-block bounds and minimums.
        const wMin = 6, hMin = 4;
        const wMax = Math.max(wMin, blockW);
        const hMax = Math.max(hMin, blockH);
        const randint = (min, max) => min + Math.floor(ctx.rng() * (Math.max(0, (max - min + 1))));
        let w, h;
        const r = ctx.rng();
        if (r < 0.35) {
          // Small cottage cluster (near minimums)
          w = randint(wMin, Math.min(wMin + 2, wMax));
          h = randint(hMin, Math.min(hMin + 2, hMax));
        } else if (r < 0.75) {
          // Medium: uniform across full range with aspect ratio nudges
          w = randint(wMin, wMax);
          h = randint(hMin, hMax);
          if (ctx.rng() < 0.5) {
            const bias = randint(-2, 3);
            h = Math.max(hMin, Math.min(hMax, h + bias));
          } else {
            const bias = randint(-2, 3);
            w = Math.max(wMin, Math.min(wMax, w + bias));
          }
        } else {
          // Large: near max with occasional longhouses
          w = Math.max(wMin, Math.min(wMax, wMax - randint(0, Math.min(3, wMax - wMin))));
          h = Math.max(hMin, Math.min(hMax, hMax - randint(0, Math.min(3, hMax - hMin))));
          // Longhouse variant: one dimension near max, the other skewed small/medium
          if (ctx.rng() < 0.4) {
            if (ctx.rng() < 0.5) {
              w = Math.max(w, Math.min(wMax, wMax - randint(0, 1)));
              h = Math.max(hMin, Math.min(hMax, hMin + randint(0, Math.min(4, hMax - hMin))));
            } else {
              h = Math.max(h, Math.min(hMax, hMax - randint(0, 1)));
              w = Math.max(wMin, Math.min(wMax, wMin + randint(0, Math.min(4, wMax - wMin))));
            }
          }
        }
        // Rare outliers: either tiny footprint or very large (still within block bounds)
        if (ctx.rng() < 0.08) {
          if (ctx.rng() < 0.5) {
            w = wMin;
            h = Math.max(hMin, Math.min(hMax, hMin + randint(0, Math.min(2, hMax - hMin))));
          } else {
            w = Math.max(wMin, Math.min(wMax, wMax - randint(0, 1)));
            h = Math.max(hMin, Math.min(hMax, hMax - randint(0, 1)));
          }
        }

        const ox = Math.floor(ctx.rng() * Math.max(1, blockW - w));
        const oy = Math.floor(ctx.rng() * Math.max(1, blockH - h));
        const fx = bx + 1 + ox;
        const fy = by + 1 + oy;
        // Avoid overlapping the town plaza footprint (with a 1-tile walkway buffer)
        if (overlapsPlazaRect(fx, fy, w, h, 1)) continue;
        // Enforce at least one tile of floor margin between buildings
        if (!isAreaClearForBuilding(fx, fy, w, h, 1)) continue;
        placeBuilding(fx, fy, w, h);
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

    // Enlarge and position the Inn next to the plaza, with size almost as big as the plaza and double doors facing it
    (function enlargeInnBuilding() {
      // Always carve the Inn even if no other buildings exist, to guarantee at least one building

      // Target size: scale from plaza dims and ensure larger minimums by town size
      const sizeKey = townSize;
      // Make inn a bit smaller than before to keep plaza spacious
      let minW = 18, minH = 12, scaleW = 1.20, scaleH = 1.10; // defaults for "big"
      if (sizeKey === "small") { minW = 14; minH = 10; scaleW = 1.15; scaleH = 1.08; }
      else if (sizeKey === "city") { minW = 24; minH = 16; scaleW = 1.35; scaleH = 1.25; }
      const targetW = Math.max(minW, Math.floor(plazaW * scaleW));
      const targetH = Math.max(minH, Math.floor(plazaH * scaleH));

      // Require a clear one-tile floor margin around the Inn so it never connects to other buildings
      function hasMarginClear(x, y, w, h, margin = 1) {
        const x0 = Math.max(1, x - margin);
        const y0 = Math.max(1, y - margin);
        const x1 = Math.min(W - 2, x + w - 1 + margin);
        const y1 = Math.min(H - 2, y + h - 1 + margin);
        for (let yy = y0; yy <= y1; yy++) {
          for (let xx = x0; xx <= x1; xx++) {
            // Outside the rect or inside, we require current tiles to be FLOOR (roads/plaza),
            // not walls/doors/windows of other buildings.
            if (ctx.map[yy][xx] !== ctx.TILES.FLOOR) return false;
          }
        }
        return true;
      }

      // Try to place the Inn on one of the four sides adjacent to the plaza, ensuring margin clear
      function placeInnRect() {
        // Start with desired target size and shrink if we cannot find a margin-clear slot
        let tw = targetW, th = targetH;

        // Attempt multiple shrink steps to satisfy margin without touching other buildings
        for (let shrink = 0; shrink < 4; shrink++) {
          const candidates = [];

          // East of plaza
          candidates.push({
            side: "westFacing",
            x: Math.min(W - 2 - tw, ((plaza.x + (plazaW / 2)) | 0) + 2),
            y: Math.max(1, Math.min(H - 2 - th, (plaza.y - (th / 2)) | 0))
          });
          // West of plaza
          candidates.push({
            side: "eastFacing",
            x: Math.max(1, ((plaza.x - (plazaW / 2)) | 0) - 2 - tw),
            y: Math.max(1, Math.min(H - 2 - th, (plaza.y - (th / 2)) | 0))
          });
          // South of plaza
          candidates.push({
            side: "northFacing",
            x: Math.max(1, Math.min(W - 2 - tw, (plaza.x - (tw / 2)) | 0)),
            y: Math.min(H - 2 - th, ((plaza.y + (plazaH / 2)) | 0) + 2)
          });
          // North of plaza
          candidates.push({
            side: "southFacing",
            x: Math.max(1, Math.min(W - 2 - tw, (plaza.x - (tw / 2)) | 0)),
            y: Math.max(1, ((plaza.y - (plazaH / 2)) | 0) - 2 - th)
          });

          // Pick the first candidate that fits fully in bounds and has a clear margin
          for (const c of candidates) {
            const nx = Math.max(1, Math.min(W - 2 - tw, c.x));
            const ny = Math.max(1, Math.min(H - 2 - th, c.y));
            const fits = (nx >= 1 && ny >= 1 && nx + tw < W - 1 && ny + th < H - 1);
            // Also ensure the Inn never overlaps the plaza footprint
            if (fits && hasMarginClear(nx, ny, tw, th, 1) && !overlapsPlazaRect(nx, ny, tw, th, 1)) {
              return { x: nx, y: ny, w: tw, h: th, facing: c.side };
            }
          }

          // If none fit with current size, shrink slightly and try again
          tw = Math.max(minW, tw - 2);
          th = Math.max(minH, th - 2);
        }

        // As a last resort, shrink until margin-clear and non-overlap near plaza center
        for (let extraShrink = 0; extraShrink < 6; extraShrink++) {
          const nx = Math.max(1, Math.min(W - 2 - tw, (plaza.x - (tw / 2)) | 0));
          const ny = Math.max(1, Math.min(H - 2 - th, (plaza.y - (th / 2)) | 0));
          const fits = (nx >= 1 && ny >= 1 && nx + tw < W - 1 && ny + th < H - 1);
          if (fits && hasMarginClear(nx, ny, tw, th, 1) && !overlapsPlazaRect(nx, ny, tw, th, 1)) {
            return { x: nx, y: ny, w: tw, h: th, facing: "southFacing" };
          }
          tw = Math.max(minW, tw - 2);
          th = Math.max(minH, th - 2);
        }
        // Final minimal placement
        const nx = Math.max(1, Math.min(W - 2 - tw, (plaza.x - (tw / 2)) | 0));
        const ny = Math.max(1, Math.min(H - 2 - th, (plaza.y - (th / 2)) | 0));
        return { x: nx, y: ny, w: tw, h: th, facing: "southFacing" };
      }

      const innRect = placeInnRect();

      // Carve the Inn: wall perimeter and floor interior
      for (let yy = innRect.y; yy < innRect.y + innRect.h; yy++) {
        for (let xx = innRect.x; xx < innRect.x + innRect.w; xx++) {
          if (yy <= 0 || xx <= 0 || yy >= H - 1 || xx >= W - 1) continue;
          const isBorder = (yy === innRect.y || yy === innRect.y + innRect.h - 1 || xx === innRect.x || xx === innRect.x + innRect.w - 1);
          ctx.map[yy][xx] = isBorder ? ctx.TILES.WALL : ctx.TILES.FLOOR;
        }
      }

      // Double doors centered on the side facing the plaza
      function carveDoubleDoors(rect) {
        if (rect.facing === "westFacing") {
          const x = rect.x; // left wall faces west (toward plaza)
          const cy = (rect.y + (rect.h / 2)) | 0;
          ctx.map[cy][x] = ctx.TILES.DOOR;
          ctx.map[cy + 1][x] = ctx.TILES.DOOR;
        } else if (rect.facing === "eastFacing") {
          const x = rect.x + rect.w - 1; // right wall faces east
          const cy = (rect.y + (rect.h / 2)) | 0;
          ctx.map[cy][x] = ctx.TILES.DOOR;
          ctx.map[cy + 1][x] = ctx.TILES.DOOR;
        } else if (rect.facing === "northFacing") {
          const y = rect.y; // top wall faces north
          const cx = (rect.x + (rect.w / 2)) | 0;
          ctx.map[y][cx] = ctx.TILES.DOOR;
          ctx.map[y][cx + 1] = ctx.TILES.DOOR;
        } else {
          const y = rect.y + rect.h - 1; // bottom wall faces south
          const cx = (rect.x + (rect.w / 2)) | 0;
          ctx.map[y][cx] = ctx.TILES.DOOR;
          ctx.map[y][cx + 1] = ctx.TILES.DOOR;
        }
      }
      carveDoubleDoors(innRect);

      // Additional opposite-side double doors to provide a rear entrance
      function carveOppositeDoor(rect) {
        if (rect.facing === "westFacing") {
          const x = rect.x + rect.w - 1;
          const cy = (rect.y + (rect.h / 2)) | 0;
          ctx.map[cy][x] = ctx.TILES.DOOR;
          if (cy + 1 <= rect.y + rect.h - 1) ctx.map[cy + 1][x] = ctx.TILES.DOOR;
        } else if (rect.facing === "eastFacing") {
          const x = rect.x;
          const cy = (rect.y + (rect.h / 2)) | 0;
          ctx.map[cy][x] = ctx.TILES.DOOR;
          if (cy + 1 <= rect.y + rect.h - 1) ctx.map[cy + 1][x] = ctx.TILES.DOOR;
        } else if (rect.facing === "northFacing") {
          const y = rect.y + rect.h - 1;
          const cx = (rect.x + (rect.w / 2)) | 0;
          ctx.map[y][cx] = ctx.TILES.DOOR;
          if (cx + 1 <= rect.x + rect.w - 1) ctx.map[y][cx + 1] = ctx.TILES.DOOR;
        } else {
          const y = rect.y;
          const cx = (rect.x + (rect.w / 2)) | 0;
          ctx.map[y][cx] = ctx.TILES.DOOR;
          if (cx + 1 <= rect.x + rect.w - 1) ctx.map[y][cx + 1] = ctx.TILES.DOOR;
        }
      }
      carveOppositeDoor(innRect);

      // Choose an existing building to replace/represent the inn, prefer the one closest to rect center
      let targetIdx = -1, bestD = Infinity;
      const cx = (innRect.x + (innRect.w / 2)) | 0;
      const cy = (innRect.y + (innRect.h / 2)) | 0;
      for (let i = 0; i < buildings.length; i++) {
        const b = buildings[i];
        const d = Math.abs((b.x + (b.w / 2)) - cx) + Math.abs((b.y + (b.h / 2)) - cy);
        if (d < bestD) { bestD = d; targetIdx = i; }
      }
      if (targetIdx === -1) {
        // If none available (shouldn't happen), push a new building record
        buildings.push({ x: innRect.x, y: innRect.y, w: innRect.w, h: innRect.h });
      } else {
        buildings[targetIdx] = { x: innRect.x, y: innRect.y, w: innRect.w, h: innRect.h };
      }

      // Record the tavern (Inn) building and its preferred door (closest to plaza)
      try {
        const cds = candidateDoors(innRect);
        let bestDoor = null, bestD = Infinity;
        for (const d of cds) {
          if (inBounds(ctx, d.x, d.y) && ctx.map[d.y][d.x] === ctx.TILES.DOOR) {
            const dd = Math.abs(d.x - plaza.x) + Math.abs(d.y - plaza.y);
            if (dd < bestD) { bestD = dd; bestDoor = { x: d.x, y: d.y }; }
          }
        }
        if (!bestDoor) {
          const dd = ensureDoor(innRect);
          bestDoor = { x: dd.x, y: dd.y };
        }
        ctx.tavern = { building: { x: innRect.x, y: innRect.y, w: innRect.w, h: innRect.h }, door: { x: bestDoor.x, y: bestDoor.y } };
      } catch (_) {}
    })();

    // Ensure minimum building count around plaza
    (function ensureMinimumBuildingsAroundPlaza() {
      try {
        const sizeKey = townSize;
        const minBySize = (sizeKey === "small") ? 10 : (sizeKey === "city" ? 24 : 16);
        if (buildings.length >= minBySize) return;
        const px0 = ((plaza.x - (plazaW / 2)) | 0), px1 = ((plaza.x + (plazaW / 2)) | 0);
        const py0 = ((plaza.y - (plazaH / 2)) | 0), py1 = ((plaza.y + (plazaH / 2)) | 0);
        const quads = [
          { x0: 1, y0: 1, x1: Math.max(2, px0 - 2), y1: Math.max(2, py0 - 2) },
          { x0: Math.min(W - 3, px1 + 2), y0: 1, x1: W - 2, y1: Math.max(2, py0 - 2) },
          { x0: 1, y0: Math.min(H - 3, py1 + 2), x1: Math.max(2, px0 - 2), y1: H - 2 },
          { x0: Math.min(W - 3, px1 + 2), y0: Math.min(H - 3, py1 + 2), x1: W - 2, y1: H - 2 },
        ];
        let added = 0;
        function tryPlaceRect(q) {
          const bw = Math.max(6, Math.min(10, 6 + Math.floor(ctx.rng() * 5)));
          const bh = Math.max(4, Math.min(8, 4 + Math.floor(ctx.rng() * 5)));
          const spanX = Math.max(1, (q.x1 - q.x0 - bw));
          const spanY = Math.max(1, (q.y1 - q.y0 - bh));
          const bx = Math.max(q.x0 + 1, Math.min(q.x1 - bw, q.x0 + 1 + Math.floor(ctx.rng() * spanX)));
          const by = Math.max(q.y0 + 1, Math.min(q.y1 - bh, q.y0 + 1 + Math.floor(ctx.rng() * spanY)));
          if (bx >= q.x1 - 1 || by >= q.y1 - 1) return false;
          if (overlapsPlazaRect(bx, by, bw, bh, 1)) return false;
          if (!isAreaClearForBuilding(bx, by, bw, bh, 1)) return false;
          placeBuilding(bx, by, bw, bh);
          added++;
          return true;
        }
        for (const q of quads) {
          if (buildings.length + added >= minBySize) break;
          for (let tries = 0; tries < 4 && buildings.length + added < minBySize; tries++) {
            if (!tryPlaceRect(q)) continue;
          }
        }
      } catch (_) {}
    })();

    // Ensure props container exists before any early prop placement (e.g., shop signs)
    ctx.townProps = Array.isArray(ctx.townProps) ? ctx.townProps : [];
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
        if (ctx && ctx.ShopService && typeof ctx.ShopService.minutesOfDay === "function") {
          return ctx.ShopService.minutesOfDay(h, m, 24 * 60);
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

    // Shop definitions: ensure Inn appears first so it's included even in small towns.
    let shopDefs = (typeof window !== "undefined" && window.GameData && Array.isArray(window.GameData.shops)) ? window.GameData.shops.slice(0) : [
      { type: "inn", name: "Inn", alwaysOpen: true },
      { type: "blacksmith", name: "Blacksmith", open: "08:00", close: "17:00" },
      { type: "apothecary", name: "Apothecary", open: "09:00", close: "18:00" },
      { type: "armorer", name: "Armorer", open: "08:00", close: "17:00" },
      { type: "trader", name: "Trader", open: "08:00", close: "18:00" },
    ];
    try {
      const idxInn = shopDefs.findIndex(d => String(d.type || "").toLowerCase() === "inn" || /inn/i.test(String(d.name || "")));
      if (idxInn > 0) {
        const innDef = shopDefs.splice(idxInn, 1)[0];
        shopDefs.unshift(innDef);
      }
    } catch (_) {}

    // Score buildings by distance to plaza and assign shops to closest buildings
    const scored = buildings.map(b => ({ b, d: Math.abs((b.x + (b.w / 2)) - plaza.x) + Math.abs((b.y + (b.h / 2)) - plaza.y) }));
    scored.sort((a, b) => a.d - b.d);
    // Track largest building by area for assigning the inn
    const largest = buildings.reduce((best, cur) => {
      const area = cur.w * cur.h;
      if (!best || area > (best.w * best.h)) return cur;
      return best;
    }, null);

    // Vary number of shops by town size
    function shopLimitBySize(sizeKey) {
      if (sizeKey === "small") return 3;
      if (sizeKey === "city") return 8;
      return 5; // big
    }
    const limit = Math.min(scored.length, shopLimitBySize(townSize));

    // Deterministic sampling helpers for shop presence
    function chanceFor(def, sizeKey) {
      try {
        const c = def && def.chanceBySize ? def.chanceBySize : null;
        if (c && typeof c[sizeKey] === "number") {
          const v = c[sizeKey];
          return (v < 0 ? 0 : (v > 1 ? 1 : v));
        }
      } catch (_) {}
      // Defaults if not specified in data
      if (sizeKey === "city") return 0.75;
      if (sizeKey === "big") return 0.60;
      return 0.50; // small
    }
    function shuffleInPlace(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(ctx.rng() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
    }

    // Build shop selection: Inn always included, others sampled by chanceBySize (dedup by type)
    let innDef = null;
    const candidateDefs = [];
    for (let i = 0; i < shopDefs.length; i++) {
      const d = shopDefs[i];
      const isInn = String(d.type || "").toLowerCase() === "inn" || /inn/i.test(String(d.name || ""));
      if (d.required === true || isInn) { innDef = d; continue; }
      candidateDefs.push(d);
    }
    // Sample presence for non-inn shops
    let sampled = [];
    for (const d of candidateDefs) {
      const ch = chanceFor(d, townSize);
      if (ctx.rng() < ch) sampled.push(d);
    }
    // Shuffle and cap, but avoid duplicate types within a single town
    shuffleInPlace(sampled);
    const restCap = Math.max(0, limit - (innDef ? 1 : 0));
    const finalDefs = [];
    const usedTypes = new Set();
    if (innDef) {
      finalDefs.push(innDef);
      usedTypes.add(String(innDef.type || innDef.name || "").toLowerCase());
    }
    // Fill with sampled unique types
    for (let i = 0; i < sampled.length && finalDefs.length < ((innDef ? 1 : 0) + restCap); i++) {
      const d = sampled[i];
      const tKey = String(d.type || d.name || "").toLowerCase();
      if (usedTypes.has(tKey)) continue;
      finalDefs.push(d);
      usedTypes.add(tKey);
    }
    // If we still have capacity, pull additional unique types from the full candidate list
    if (finalDefs.length < ((innDef ? 1 : 0) + restCap)) {
      for (const d of candidateDefs) {
        const tKey = String(d.type || d.name || "").toLowerCase();
        if (usedTypes.has(tKey)) continue;
        finalDefs.push(d);
        usedTypes.add(tKey);
        if (finalDefs.length >= ((innDef ? 1 : 0) + restCap)) break;
      }
    }

    // Avoid assigning multiple shops to the same building
    const usedBuildings = new Set();

    // Assign selected shops to nearest buildings
    const finalCount = Math.min(finalDefs.length, scored.length);
    for (let i = 0; i < finalCount; i++) {
      const def = finalDefs[i];
      let b = scored[i].b;

      // Prefer the enlarged tavern building for the Inn if available; else nearest to plaza
      if (String(def.type || "").toLowerCase() === "inn") {
        if (ctx.tavern && ctx.tavern.building) {
          b = ctx.tavern.building;
        } else {
          // Pick the closest unused building
          let candidate = null;
          for (const s of scored) {
            const key = `${s.b.x},${s.b.y}`;
            if (!usedBuildings.has(key)) { candidate = s.b; break; }
          }
          b = candidate || scored[0].b;
        }
      }

      // If chosen building is already used, pick the next nearest unused
      if (usedBuildings.has(`${b.x},${b.y}`)) {
        const alt = scored.find(s => !usedBuildings.has(`${s.b.x},${s.b.y}`));
        if (alt) b = alt.b;
      }

      // Extra guard: non-inn shops should never occupy the tavern building
      if (String(def.type || "").toLowerCase() !== "inn" && ctx.tavern && ctx.tavern.building) {
        const tb = ctx.tavern.building;
        const isTavernBld = (b.x === tb.x && b.y === tb.y && b.w === tb.w && b.h === tb.h);
        if (isTavernBld) {
          const alt = scored.find(s => {
            const key = `${s.b.x},${s.b.y}`;
            const isTavern = (s.b.x === tb.x && s.b.y === tb.y && s.b.w === tb.w && s.b.h === tb.h);
            return !usedBuildings.has(key) && !isTavern;
          });
          if (alt) b = alt.b;
        }
      }

      usedBuildings.add(`${b.x},${b.y}`);

      // For Inn: prefer using existing double doors on the side facing the plaza if present
      let door = null;
      if (String(def.type || "").toLowerCase() === "inn") {
        // check for any door on the inn building perimeter and pick one closest to plaza
        const cds = candidateDoors(b);
        let best = null, bestD = Infinity;
        for (const d of cds) {
          if (inBounds(ctx, d.x, d.y) && ctx.map[d.y][d.x] === ctx.TILES.DOOR) {
            const dd = Math.abs(d.x - plaza.x) + Math.abs(d.y - plaza.y);
            if (dd < bestD) { bestD = dd; best = { x: d.x, y: d.y }; }
          }
        }
        door = best || ensureDoor(b);
      } else {
        door = ensureDoor(b);
      }
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
      // Ensure a sign near the shop door with the correct shop name (e.g., Inn), prefer placing it outside the building
      try { addShopSign(b, { x: door.x, y: door.y }, name); } catch (_) {}
    }

    // Ensure there is always one Inn in town (fallback if not added above)
    try {
      const hasInn = Array.isArray(ctx.shops) && ctx.shops.some(s => (s.type === "inn") || (/inn/i.test(String(s.name || ""))));
      if (!hasInn) {
        try { if (typeof window !== "undefined" && window.Fallback && typeof window.Fallback.log === "function") window.Fallback.log("town", "No Inn assigned by shopDefs; creating fallback Inn."); } catch (_) {}
        // Pick an unused building near the plaza that does NOT overlap the plaza footprint
        let bInn = null;
        for (const s of scored) {
          const key = `${s.b.x},${s.b.y}`;
          if (usedBuildings.has(key)) continue;
          if (overlapsPlazaRect(s.b.x, s.b.y, s.b.w, s.b.h, 1)) continue;
          bInn = s.b;
          break;
        }
        if (!bInn) {
          // Fallback: first building that doesn't overlap (with 1-tile buffer), even if already used (will be re-used as inn)
          for (const s of scored) {
            if (!overlapsPlazaRect(s.b.x, s.b.y, s.b.w, s.b.h, 1)) { bInn = s.b; break; }
          }
        }
        if (!bInn) bInn = scored.length ? scored[0].b : null;
        if (bInn) {
          // Prefer existing door closest to plaza; else carve one
          const cds = candidateDoors(bInn);
          let best = null, bestD = Infinity;
          for (const d of cds) {
            if (inBounds(ctx, d.x, d.y) && ctx.map[d.y][d.x] === ctx.TILES.DOOR) {
              const dd = Math.abs(d.x - plaza.x) + Math.abs(d.y - plaza.y);
              if (dd < bestD) { bestD = dd; best = { x: d.x, y: d.y }; }
            }
          }
          const doorInn = best || ensureDoor(bInn);
          // Ensure double doors for inn: add adjacent door tile along the wall orientation if missing
          (function ensureDoubleInnDoors() {
            const x = doorInn.x, y = doorInn.y;
            const leftEdge = (x === bInn.x);
            const rightEdge = (x === bInn.x + bInn.w - 1);
            const topEdge = (y === bInn.y);
            const bottomEdge = (y === bInn.y + bInn.h - 1);
            if (topEdge || bottomEdge) {
              const x2 = Math.min(bInn.x + bInn.w - 1, x + 1);
              if (inBounds(ctx, x2, y) && ctx.map[y][x2] === ctx.TILES.WALL) ctx.map[y][x2] = ctx.TILES.DOOR;
            } else if (leftEdge || rightEdge) {
              const y2 = Math.min(bInn.y + bInn.h - 1, y + 1);
              if (inBounds(ctx, x, y2) && ctx.map[y2][x] === ctx.TILES.WALL) ctx.map[y2][x] = ctx.TILES.DOOR;
            }
          })();

          const nameInn = "Inn";
          const inward = [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
          let insideInn = null;
          for (const dxy of inward) {
            const ix = doorInn.x + dxy.dx, iy = doorInn.y + dxy.dy;
            const insideB = (ix > bInn.x && ix < bInn.x + bInn.w - 1 && iy > bInn.y && iy < bInn.y + bInn.h - 1);
            if (insideB && ctx.map[iy][ix] === ctx.TILES.FLOOR) { insideInn = { x: ix, y: iy }; break; }
          }
          if (!insideInn) {
            const cx = Math.max(bInn.x + 1, Math.min(bInn.x + bInn.w - 2, Math.floor(bInn.x + bInn.w / 2)));
            const cy = Math.max(bInn.y + 1, Math.min(bInn.y + bInn.h - 2, Math.floor(bInn.y + bInn.h / 2)));
            insideInn = { x: cx, y: cy };
          }

          ctx.shops.push({
            x: doorInn.x,
            y: doorInn.y,
            type: "inn",
            name: nameInn,
            openMin: 0,
            closeMin: 0,
            alwaysOpen: true,
            building: { x: bInn.x, y: bInn.y, w: bInn.w, h: bInn.h, door: { x: doorInn.x, y: doorInn.y } },
            inside: insideInn
          });
          try { addShopSign(bInn, doorInn, nameInn); } catch (_) {}
          usedBuildings.add(`${bInn.x},${bInn.y}`);
          try { ctx.tavern = { building: { x: bInn.x, y: bInn.y, w: bInn.w, h: bInn.h }, door: { x: doorInn.x, y: doorInn.y } }; } catch (_) {}
        }
      }
    } catch (_) {}

    // Safety: deduplicate Inn entries if any logic created more than one
    try {
      if (Array.isArray(ctx.shops)) {
        const out = [], seenInn = false;
        for (let i = 0; i < ctx.shops.length; i++) {
          const s = ctx.shops[i];
          const isInn = (String(s.type || "").toLowerCase() === "inn") || (/inn/i.test(String(s.name || "")));
          if (isInn) {
            if (!seenInn) { out.push(s); seenInn = true; }
            else {
              // drop duplicate inn
              continue;
            }
          } else {
            out.push(s);
          }
        }
        ctx.shops = out;
      }
      // Ensure ctx.tavern points to the single Inn building if present
      if (ctx.shops && ctx.shops.length) {
        const innShop = ctx.shops.find(s => (String(s.type || "").toLowerCase() === "inn") || (/inn/i.test(String(s.name || ""))));
        if (innShop && innShop.building && innShop.building.x != null) {
          ctx.tavern = { building: { x: innShop.building.x, y: innShop.building.y, w: innShop.building.w, h: innShop.building.h }, door: { x: innShop.building.door?.x ?? innShop.x, y: innShop.building.door?.y ?? innShop.y } };
          ctx.inn = ctx.tavern;
        }
      }
    } catch (_) {}

    // Town buildings metadata
    ctx.townBuildings = buildings.map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h, door: getExistingDoor(b) }));

    // Props
    ctx.townProps = Array.isArray(ctx.townProps) ? ctx.townProps : [];
    function addProp(x, y, type, name) {
      if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return false;
      if (ctx.map[y][x] !== ctx.TILES.FLOOR) return false;
      if (Array.isArray(ctx.townProps) && ctx.townProps.some(p => p.x === x && p.y === y)) return false;
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
    // Prefer placing shop signs outside the building, not inside
    function addShopSign(b, door, text) {
      function isInside(bld, x, y) {
        return x > bld.x && x < bld.x + bld.w - 1 && y > bld.y && y < bld.y + bld.h - 1;
      }
      // Ensure we never place a sign inside ANY building interior (not just this shop's building)
      function isInsideAnyBuilding(x, y) {
        for (let i = 0; i < buildings.length; i++) {
          const B = buildings[i];
          if (x > B.x && x < B.x + B.w - 1 && y > B.y && y < B.y + B.h - 1) return true;
        }
        return false;
      }
      let dx = 0, dy = 0;
      if (door.y === b.y) dy = -1;
      else if (door.y === b.y + b.h - 1) dy = +1;
      else if (door.x === b.x) dx = -1;
      else if (door.x === b.x + b.w - 1) dx = +1;
      const sx = door.x + dx, sy = door.y + dy;
      if (sx > 0 && sy > 0 && sx < W - 1 && sy < H - 1) {
        if (!isInside(b, sx, sy) && !isInsideAnyBuilding(sx, sy) && ctx.map[sy][sx] === ctx.TILES.FLOOR && !ctx.townProps.some(p => p.x === sx && p.y === sy)) {
          addProp(sx, sy, "sign", text);
          return true;
        }
      }
      // Fallback: nearby floor tile that is outside the building and not inside any other building
      const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
      for (const d of dirs) {
        const nx = door.x + d.dx, ny = door.y + d.dy;
        if (nx <= 0 || ny <= 0 || nx >= W - 1 || ny >= H - 1) continue;
        if (isInside(b, nx, ny)) continue;
        if (isInsideAnyBuilding(nx, ny)) continue;
        if (ctx.map[ny][nx] !== ctx.TILES.FLOOR) continue;
        if (ctx.townProps.some(p => p.x === nx && p.y === ny)) continue;
        try { if (typeof window !== "undefined" && window.Fallback && typeof window.Fallback.log === "function") window.Fallback.log("town", "Shop sign: placing at nearby floor (preferred outside placement unavailable).", { door, sign: { x: nx, y: ny }, text }); } catch (_) {}
        addProp(nx, ny, "sign", text);
        return true;
      }
      return false;
    }
    // Welcome sign: ensure only one near the gate (dedupe within a small radius), then add single canonical sign
    try {
      if (Array.isArray(ctx.townProps)) {
        const R = 3;
        for (let i = ctx.townProps.length - 1; i >= 0; i--) {
          const p = ctx.townProps[i];
          if (p && p.type === "sign") {
            const d = Math.abs(p.x - gate.x) + Math.abs(p.y - gate.y);
            if (d <= R) ctx.townProps.splice(i, 1);
          }
        }
      }
    } catch (_) {}
    addSignNear(gate.x, gate.y, `Welcome to ${ctx.townName}`);

    // Windows along building walls (spaced, not near doors)
    (function placeWindowsOnAll() {
      function sidePoints(b) {
        // Exclude corners for aesthetics; only true perimeter segments
        return [
          Array.from({ length: Math.max(0, b.w - 2) }, (_, i) => ({ x: b.x + 1 + i, y: b.y })),              // top
          Array.from({ length: Math.max(0, b.w - 2) }, (_, i) => ({ x: b.x + 1 + i, y: b.y + b.h - 1 })),    // bottom
          Array.from({ length: Math.max(0, b.h - 2) }, (_, i) => ({ x: b.x, y: b.y + 1 + i })),              // left
          Array.from({ length: Math.max(0, b.h - 2) }, (_, i) => ({ x: b.x + b.w - 1, y: b.y + 1 + i })),    // right
        ];
      }
      function isAdjacent(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1; }
      function nearDoor(x, y) {
        const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
        for (const d of dirs) {
          const nx = x + d.dx, ny = y + d.dy;
          if (!inBounds(ctx, nx, ny)) continue;
          if (ctx.map[ny][nx] === ctx.TILES.DOOR) return true;
        }
        return false;
      }
      for (const b of buildings) {
        const tav = (ctx.tavern && ctx.tavern.building) ? ctx.tavern.building : null;
        const isTavernBld = !!(tav && b.x === tav.x && b.y === tav.y && b.w === tav.w && b.h === tav.h);
        let candidates = [];
        const sides = sidePoints(b);
        for (const pts of sides) {
          for (const p of pts) {
            if (!inBounds(ctx, p.x, p.y)) continue;
            const t = ctx.map[p.y][p.x];
            // Only convert solid wall tiles, avoid doors and already-placed windows
            if (t !== ctx.TILES.WALL) continue;
            if (nearDoor(p.x, p.y)) continue;
            candidates.push(p);
          }
        }
        if (!candidates.length) continue;
        // Limit by perimeter size so larger buildings get a few more windows but not too many
        let limit = Math.min(3, Math.max(1, Math.floor((b.w + b.h) / 12)));
        if (isTavernBld) {
          limit = Math.max(1, Math.floor(limit * 0.7));
        }
        limit = Math.max(1, Math.min(limit, 4));
        const placed = [];
        let attempts = 0;
        while (placed.length < limit && candidates.length > 0 && attempts++ < candidates.length * 2) {
          const idx = Math.floor(ctx.rng() * candidates.length);
          const p = candidates[idx];
          // Keep spacing: avoid placing next to already placed windows
          if (placed.some(q => isAdjacent(p, q))) {
            candidates.splice(idx, 1);
            continue;
          }
          ctx.map[p.y][p.x] = ctx.TILES.WINDOW;
          placed.push(p);
          // Remove adjacent candidates to maintain spacing
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
      let limit = benchLimitCfg > 0 ? benchLimitCfg : computedLimit;
      // reduce bench density if tavern building is adjacent to plaza
      (function reduceBenchNearInn() {
        try {
          const tav = (ctx.tavern && ctx.tavern.building) ? ctx.tavern.building : null;
          if (!tav) return;
          const px0 = ((plaza.x - (plazaW / 2)) | 0), px1 = ((plaza.x + (plazaW / 2)) | 0);
          const py0 = ((plaza.y - (plazaH / 2)) | 0), py1 = ((plaza.y + (plazaH / 2)) | 0);
          const bx0 = tav.x, bx1 = tav.x + tav.w - 1;
          const by0 = tav.y, by1 = tav.y + tav.h - 1;
          const margin = 2;
          const adj = !((bx1 < px0 - margin) || (px1 + margin < bx0) || (by1 < py0 - margin) || (py1 + margin < by0));
          if (adj) limit = Math.max(4, Math.floor(limit * 0.7));
        } catch (_) {}
      })();
      for (const p of benchSpots) {
        if (placed >= limit) break;
        // Only place on clear floor and keep a tile free next to the bench
        if (p.x <= 0 || p.y <= 0 || p.x >= W - 1 || p.y >= H - 1) continue;
        if (ctx.map[p.y][p.x] !== ctx.TILES.FLOOR) continue;
        if (ctx.townProps.some(q => q.x === p.x && q.y === p.y)) continue;
        if ((p.x === ctx.player.x && p.y === ctx.player.y)) continue;
        if (addProp(p.x, p.y, "bench", "Bench")) placed++;
      }

      // Single market stall near the plaza (not blocking the center)
      const stallOffsets = [
        { dx: -((plazaW / 2) | 0) + 2, dy: 0 },
        { dx: ((plazaW / 2) | 0) - 2, dy: 0 },
        { dx: 0, dy: -((plazaH / 2) | 0) + 2 },
        { dx: 0, dy: ((plazaH / 2) | 0) - 2 },
      ];
      const pickIdx = Math.floor(ctx.rng() * stallOffsets.length) % stallOffsets.length;
      const o = stallOffsets[pickIdx];
      const sx = Math.max(1, Math.min(W - 2, plaza.x + o.dx));
      const sy = Math.max(1, Math.min(H - 2, plaza.y + o.dy));
      if (ctx.map[sy][sx] === ctx.TILES.FLOOR) {
        addProp(sx, sy, "stall", "Market Stall");
        // scatter a crate/barrel next to the stall if space allows
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

      // Quest Board is placed inside the Inn during interior furnishing; no plaza placement here.

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
      function rectInside(b) {
        return { x0: b.x + 1, y0: b.y + 1, x1: b.x + b.w - 2, y1: b.y + b.h - 2 };
      }
      function clampToRect(x, y, r) {
        return { x: Math.max(r.x0, Math.min(r.x1, x)), y: Math.max(r.y0, Math.min(r.y1, y)) };
      }
      function doorFacing(b, door) {
        if (!door) return "south";
        if (door.y === b.y) return "north";
        if (door.y === b.y + b.h - 1) return "south";
        if (door.x === b.x) return "west";
        if (door.x === b.x + b.w - 1) return "east";
        return "south";
      }
      function placeChairNear(x, y, limit = 4, rect = null) {
        const spots = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
        let placed = 0;
        for (const d of spots) {
          if (placed >= limit) break;
          const nx = x + d.dx, ny = y + d.dy;
          if (rect && (nx < rect.x0 || nx > rect.x1 || ny < rect.y0 || ny > rect.y1)) continue;
          if (insideBounds(nx, ny) && ctx.map[ny][nx] === ctx.TILES.FLOOR && !occupiedTile(nx, ny)) {
            addProp(nx, ny, "chair", "Chair");
            placed++;
          }
        }
      }
      function insideBounds(x, y) {
        const H = ctx.map.length, W = ctx.map[0] ? ctx.map[0].length : 0;
        return x > 0 && y > 0 && x < W - 1 && y < H - 1;
      }

      function furnishInn(ctx, b) {
        const door = (ctx.tavern && ctx.tavern.door) ? ctx.tavern.door : null;
        const facing = doorFacing(b, door);
        const r = rectInside(b);
        const w = (r.x1 - r.x0 + 1), h = (r.y1 - r.y0 + 1);

        // Partition front hall vs sleeping quarters
        const frontRatio = 0.62;
        let hallRect, sleepRect, corridorLine = null;

        if (facing === "north") {
          const hallH = Math.max(3, Math.floor(h * frontRatio));
          hallRect = { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y0 + hallH - 1 };
          sleepRect = { x0: r.x0, y0: hallRect.y1 + 1, x1: r.x1, y1: r.y1 };
          corridorLine = { axis: "y", x: Math.floor((r.x0 + r.x1) / 2) };
        } else if (facing === "south") {
          const hallH = Math.max(3, Math.floor(h * frontRatio));
          hallRect = { x0: r.x0, y0: r.y1 - hallH + 1, x1: r.x1, y1: r.y1 };
          sleepRect = { x0: r.x0, y0: r.y0, x1: r.x1, y1: hallRect.y0 - 1 };
          corridorLine = { axis: "y", x: Math.floor((r.x0 + r.x1) / 2) };
        } else if (facing === "west") {
          const hallW = Math.max(4, Math.floor(w * frontRatio));
          hallRect = { x0: r.x0, y0: r.y0, x1: r.x0 + hallW - 1, y1: r.y1 };
          sleepRect = { x0: hallRect.x1 + 1, y0: r.y0, x1: r.x1, y1: r.y1 };
          corridorLine = { axis: "x", y: Math.floor((r.y0 + r.y1) / 2) };
        } else {
          const hallW = Math.max(4, Math.floor(w * frontRatio));
          hallRect = { x0: r.x1 - hallW + 1, y0: r.y0, x1: r.x1, y1: r.y1 };
          sleepRect = { x0: r.x0, y0: r.y0, x1: hallRect.x0 - 1, y1: r.y1 };
          corridorLine = { axis: "x", y: Math.floor((r.y0 + r.y1) / 2) };
        }

        function inRect(rect, x, y) {
          return x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1 && insideFloor(b, x, y) && !occupiedTile(x, y);
        }

        // Keep a simple corridor clear along center line
        function isCorridor(x, y) {
          if (!corridorLine) return false;
          if (corridorLine.axis === "y") {
            return Math.abs(x - corridorLine.x) <= 0;
          } else {
            return Math.abs(y - corridorLine.y) <= 0;
          }
        }

        // Fireplace in hall, away from the door
        (function placeFireplace() {
          let best = null, bestD = -1;
          for (let yy = hallRect.y0; yy <= hallRect.y1; yy++) {
            for (let xx = hallRect.x0; xx <= hallRect.x1; xx++) {
              if (!insideFloor(b, xx, yy)) continue;
              const nearWall = (ctx.map[yy - 1][xx] === ctx.TILES.WALL || ctx.map[yy + 1][xx] === ctx.TILES.WALL || ctx.map[yy][xx - 1] === ctx.TILES.WALL || ctx.map[yy][xx + 1] === ctx.TILES.WALL);
              if (!nearWall) continue;
              if (occupiedTile(xx, yy)) continue;
              const d = door ? Math.abs(xx - door.x) + Math.abs(yy - door.y) : 0;
              if (d > bestD) { bestD = d; best = { x: xx, y: yy }; }
            }
          }
          if (best) addProp(best.x, best.y, "fireplace", "Fireplace");
        })();

        // Quest board near inner wall in hall, close to door
        (function placeQuestBoard() {
          const hasQB = ctx.townProps.some(p => p && p.type === "quest_board" && p.x > b.x && p.x < b.x + b.w - 1 && p.y > b.y && p.y < b.y + b.h - 1);
          if (hasQB) return;
          let best = null, bestD = Infinity;
          for (let yy = hallRect.y0; yy <= hallRect.y1; yy++) {
            for (let xx = hallRect.x0; xx <= hallRect.x1; xx++) {
              if (!insideFloor(b, xx, yy)) continue;
              const nearWall = (ctx.map[yy - 1][xx] === ctx.TILES.WALL || ctx.map[yy + 1][xx] === ctx.TILES.WALL || ctx.map[yy][xx - 1] === ctx.TILES.WALL || ctx.map[yy][xx + 1] === ctx.TILES.WALL);
              if (!nearWall) continue;
              if (occupiedTile(xx, yy)) continue;
              const d = door ? Math.abs(xx - door.x) + Math.abs(yy - door.y) : 0;
              if (d < bestD) { bestD = d; best = { x: xx, y: yy }; }
            }
          }
          if (best) addProp(best.x, best.y, "quest_board", "Quest Board");
        })();

        // Bar counter along a hall wall; shelves behind
        (function placeBarAndShelves() {
          let wallX = null, wallY = null, horizontal = true;
          if (facing === "north" || facing === "south") { wallX = hallRect.x0; horizontal = false; }
          else { wallY = hallRect.y0; horizontal = true; }
          const count = Math.max(3, Math.min(6, Math.floor((hallRect.x1 - hallRect.x0 + hallRect.y1 - hallRect.y0) / 6)));
          let placed = 0;
          if (horizontal) {
            for (let xx = hallRect.x0; xx <= hallRect.x1 && placed < count; xx += 2) {
              const yy = wallY + 1;
              if (inRect(hallRect, xx, yy) && !isCorridor(xx, yy)) { addProp(xx, yy, "table", "Table"); placed++; }
              // shelves behind counter against wall
              const sy = wallY;
              if (insideBounds(xx, sy) && ctx.map[sy][xx] === ctx.TILES.WALL) {
                const spot = { x: xx, y: yy - 1 };
                if (insideFloor(b, spot.x, spot.y) && !occupiedTile(spot.x, spot.y)) addProp(spot.x, spot.y, "shelf", "Shelf");
              }
            }
          } else {
            for (let yy = hallRect.y0; yy <= hallRect.y1 && placed < count; yy += 2) {
              const xx = wallX + 1;
              if (inRect(hallRect, xx, yy) && !isCorridor(xx, yy)) { addProp(xx, yy, "table", "Table"); placed++; }
              // shelves behind counter against wall
              const sx = wallX;
              if (insideBounds(sx, yy) && ctx.map[yy][sx] === ctx.TILES.WALL) {
                const spot = { x: xx - 1, y: yy };
                if (insideFloor(b, spot.x, spot.y) && !occupiedTile(spot.x, spot.y)) addProp(spot.x, spot.y, "shelf", "Shelf");
              }
            }
          }
        })();

        // Tables grid in hall; chairs around tables; some rugs
        (function placeTablesGrid() {
          const stepX = 3, stepY = 3;
          let countT = 0;
          for (let yy = hallRect.y0 + 1; yy <= hallRect.y1 - 1; yy += stepY) {
            for (let xx = hallRect.x0 + 1; xx <= hallRect.x1 - 1; xx += stepX) {
              if (!inRect(hallRect, xx, yy)) continue;
              if (isCorridor(xx, yy)) continue;
              if (occupiedTile(xx, yy)) continue;
              addProp(xx, yy, "table", "Table");
              countT++;
              placeChairNear(xx, yy, 4, hallRect);
              // occasional rug near table
              const rx = xx, ry = yy + 1;
              if (inRect(hallRect, rx, ry) && !occupiedTile(rx, ry) && ctx.rng() < 0.4) addProp(rx, ry, "rug", "Rug");
            }
          }
          // ensure minimum seating
          if (countT < 2) {
            const cx = Math.floor((hallRect.x0 + hallRect.x1) / 2);
            const cy = Math.floor((hallRect.y0 + hallRect.y1) / 2);
            if (inRect(hallRect, cx, cy) && !isCorridor(cx, cy)) {
              addProp(cx, cy, "table", "Table");
              placeChairNear(cx, cy, 4, hallRect);
            }
          }
        })();

        // Two-lane stairs portal near the center of the hall; generate upstairs overlay (rooms)
        (function placeStairsPortalAndUpstairs() {
          // Find a clear 2-tile horizontal portal near the hall center
          const cx = Math.floor((hallRect.x0 + hallRect.x1) / 2);
          const cy = Math.floor((hallRect.y0 + hallRect.y1) / 2);
          let sx = cx, sy = cy;
          // Nudge off corridor center if needed
          if (isCorridor(sx, sy)) {
            if (sx + 1 <= hallRect.x1 && !isCorridor(sx + 1, sy)) sx = sx + 1;
            else if (sx - 1 >= hallRect.x0 && !isCorridor(sx - 1, sy)) sx = sx - 1;
          }
          const s1 = { x: sx, y: sy };
          const s2 = { x: Math.min(hallRect.x1, sx + 1), y: sy };
          function canPlaceStairs(p) {
            // Allow placing stairs even if a prop currently occupies the tile; we'll clear props after placement.
            return inRect(hallRect, p.x, p.y) && insideFloor(b, p.x, p.y);
          }
          let ok1 = canPlaceStairs(s1), ok2 = canPlaceStairs(s2);
          if (!ok1 || !ok2) {
            // Try vertical pair
            const v1 = { x: cx, y: cy };
            const v2 = { x: cx, y: Math.min(hallRect.y1, cy + 1) };
            if (canPlaceStairs(v1) && canPlaceStairs(v2)) {
              // Use vertical pair directly
              s1.x = v1.x; s1.y = v1.y;
              s2.x = v2.x; s2.y = v2.y;
              ok1 = ok2 = true;
            } else {
              // Fallback: search a small neighborhood
              let placed = 0;
              for (let dy = -2; dy <= 2 && placed < 2; dy++) {
                for (let dx = -2; dx <= 2 && placed < 2; dx++) {
                  const nx = cx + dx, ny = cy + dy;
                  const p = { x: nx, y: ny };
                  if (canPlaceStairs(p)) {
                    if (placed === 0) { s1.x = nx; s1.y = ny; placed = 1; }
                    else if (Math.abs(nx - s1.x) + Math.abs(ny - s1.y) === 1) { // adjacent
                      const p2 = { x: nx, y: ny };
                      if (canPlaceStairs(p2)) { s2.x = nx; s2.y = ny; ok1 = ok2 = true; placed = 2; }
                    }
                  }
                }
              }
            }
          }
          if (ok1 && ok2) {
            ctx.map[s1.y][s1.x] = ctx.TILES.STAIRS;
            ctx.map[s2.y][s2.x] = ctx.TILES.STAIRS;
            // Clear any props that may have been placed on these tiles earlier
            try {
              if (Array.isArray(ctx.townProps)) {
                ctx.townProps = ctx.townProps.filter(p => !((p.x === s1.x && p.y === s1.y) || (p.x === s2.x && p.y === s2.y)));
              }
            } catch (_) {}
            try { ctx.innStairsGround = [{ x: s1.x, y: s1.y }, { x: s2.x, y: s2.y }]; } catch (_) {}
          }
          // Generate upstairs overlay with small varied rooms (pre-rendered at town gen)
          function generateInnUpstairs(ctx, bld, hall) {
            const rUp = { x0: bld.x + 1, y0: bld.y + 1, x1: bld.x + bld.w - 2, y1: bld.y + bld.h - 2 };
            const wUp = (rUp.x1 - rUp.x0 + 1);
            const hUp = (rUp.y1 - rUp.y0 + 1);
            const tiles = Array.from({ length: hUp }, () => Array(wUp).fill(ctx.TILES.FLOOR));
            // Perimeter walls
            for (let yy = 0; yy < hUp; yy++) {
              for (let xx = 0; xx < wUp; xx++) {
                const isBorder = (yy === 0 || yy === hUp - 1 || xx === 0 || xx === wUp - 1);
                if (isBorder) tiles[yy][xx] = ctx.TILES.WALL;
              }
            }
            // Corridor: along long axis, width = 2
            const vertical = (wUp >= hUp);
            const corridorWidth = 2;
            if (vertical) {
              const midX = Math.floor(wUp / 2) - 1;
              for (let yy = 1; yy < hUp - 1; yy++) {
                for (let dx = 0; dx < corridorWidth; dx++) {
                  const xx = Math.max(1, Math.min(wUp - 2, midX + dx));
                  tiles[yy][xx] = ctx.TILES.FLOOR;
                }
              }
            } else {
              const midY = Math.floor(hUp / 2) - 1;
              for (let xx = 1; xx < wUp - 1; xx++) {
                for (let dy = 0; dy < corridorWidth; dy++) {
                  const yy = Math.max(1, Math.min(hUp - 2, midY + dy));
                  tiles[yy][xx] = ctx.TILES.FLOOR;
                }
              }
            }
            // Rooms: small varied rectangles along corridor sides
            const rooms = [];
            function tryRoomAt(x0, y0, w, h) {
              if (x0 < 1 || y0 < 1 || x0 + w > wUp - 1 || y0 + h > hUp - 1) return false;
              // Ensure one-tile gap around
              for (let yy = y0 - 1; yy <= y0 + h; yy++) {
                for (let xx = x0 - 1; xx <= x0 + w; xx++) {
                  if (tiles[yy][xx] !== ctx.TILES.FLOOR) {
                    // allow corridor stroke to be floor; still acceptable
                    continue;
                  }
                }
              }
              // Carve walls on perimeter, floors inside
              for (let yy = y0; yy < y0 + h; yy++) {
                for (let xx = x0; xx < x0 + w; xx++) {
                  const border = (yy === y0 || yy === y0 + h - 1 || xx === x0 || xx === x0 + w - 1);
                  tiles[yy][xx] = border ? ctx.TILES.WALL : ctx.TILES.FLOOR;
                }
              }
              rooms.push({ x0, y0, w, h });
              return true;
            }
            // Place rooms along corridor
            const seg = vertical ? hUp : wUp;
            const step = 4;
            for (let i = 2; i < seg - 2; i += step) {
              const wR = 3 + Math.floor(ctx.rng() * 2); // 3-4
              const hR = 3 + Math.floor(ctx.rng() * 2); // 3-4
              if (vertical) {
                const y0 = Math.max(1, Math.min(hUp - hR - 1, i));
                const leftX0 = Math.max(1, Math.floor(wUp / 2) - (corridorWidth + wR));
                const rightX0 = Math.min(wUp - wR - 1, Math.floor(wUp / 2) + corridorWidth);
                // Alternate sides
                if (ctx.rng() < 0.5) tryRoomAt(leftX0, y0, wR, hR); else tryRoomAt(rightX0, y0, wR, hR);
              } else {
                const x0 = Math.max(1, Math.min(wUp - wR - 1, i));
                const topY0 = Math.max(1, Math.floor(hUp / 2) - (corridorWidth + hR));
                const bottomY0 = Math.min(hUp - hR - 1, Math.floor(hUp / 2) + corridorWidth);
                if (ctx.rng() < 0.5) tryRoomAt(x0, topY0, wR, hR); else tryRoomAt(x0, bottomY0, wR, hR);
              }
            }
            // Doors from corridor into rooms
            for (const rm of rooms) {
              let dx = 0, dy = 0, doorX = rm.x0, doorY = rm.y0;
              if (vertical) {
                const midX = Math.floor(wUp / 2);
                if (rm.x0 + rm.w - 1 < midX) { dx = +1; doorX = rm.x0 + rm.w - 1; doorY = rm.y0 + Math.floor(rm.h / 2); }
                else { dx = -1; doorX = rm.x0; doorY = rm.y0 + Math.floor(rm.h / 2); }
              } else {
                const midY = Math.floor(hUp / 2);
                if (rm.y0 + rm.h - 1 < midY) { dy = +1; doorY = rm.y0 + rm.h - 1; doorX = rm.x0 + Math.floor(rm.w / 2); }
                else { dy = -1; doorY = rm.y0; doorX = rm.x0 + Math.floor(rm.w / 2); }
              }
              tiles[doorY][doorX] = ctx.TILES.DOOR;
            }
            // Stairs landing upstairs: align roughly over hall stairs
            const upLandingLocal = { x: Math.max(1, Math.min(wUp - 2, s1.x - rUp.x0)), y: Math.max(1, Math.min(hUp - 2, s1.y - rUp.y0)) };
            tiles[upLandingLocal.y][upLandingLocal.x] = ctx.TILES.STAIRS;
            if (upLandingLocal.x + 1 < wUp - 1) tiles[upLandingLocal.y][upLandingLocal.x + 1] = ctx.TILES.STAIRS;
            // Furnish rooms minimally: bed + optional chest/table/chair/rug
            const props = [];
            function addP(ax, ay, type, name) { props.push({ x: rUp.x0 + ax, y: rUp.y0 + ay, type, name }); }
            for (const rm of rooms) {
              // interior area
              const ix0 = rm.x0 + 1, iy0 = rm.y0 + 1, ix1 = rm.x0 + rm.w - 2, iy1 = rm.y0 + rm.h - 2;
              let placedBed = false;
              for (let tries = 0; tries < 10 && !placedBed; tries++) {
                const bx = ix0 + Math.floor(ctx.rng() * Math.max(1, (ix1 - ix0 + 1)));
                const by = iy0 + Math.floor(ctx.rng() * Math.max(1, (iy1 - iy0 + 1)));
                if (tiles[by][bx] === ctx.TILES.FLOOR) { addP(bx, by, "bed", "Bed"); placedBed = true; }
              }
              if (ctx.rng() < 0.65) {
                // small table + chair
                let tx = ix0, ty = iy0;
                addP(tx, ty, "table", "Table");
                if (ctx.rng() < 0.8) addP(Math.min(ix1, tx + 1), ty, "chair", "Chair");
              }
              if (ctx.rng() < 0.55) addP(ix1, iy1, "chest", "Chest");
              if (ctx.rng() < 0.40) addP(ix0, iy1, "rug", "Rug");
              if (ctx.rng() < 0.35) addP(ix1, iy0, "shelf", "Shelf");
              if (ctx.rng() < 0.25) addP(ix0, iy0, "plant", "Plant");
            }
            try {
              ctx.innUpstairs = { offset: { x: rUp.x0, y: rUp.y0 }, w: wUp, h: hUp, tiles, props };
              ctx.innUpstairsActive = false;
            } catch (_) {}
          }
          generateInnUpstairs(ctx, b, hallRect);
        })();

        // Storage cluster in a back corner of the hall (away from stairs)
        (function placeStorageHallCorner() {
          const corners = [
            { x: hallRect.x0, y: hallRect.y0 },
            { x: hallRect.x1, y: hallRect.y0 },
            { x: hallRect.x0, y: hallRect.y1 },
            { x: hallRect.x1, y: hallRect.y1 },
          ];
          let corner = corners[0];
          let bestD = -1;
          for (const c of corners) {
            const d = door ? Math.abs(c.x - door.x) + Math.abs(c.y - door.y) : 0;
            if (d > bestD) { bestD = d; corner = c; }
          }
          const start = clampToRect(corner.x, corner.y, hallRect);
          const items = Math.max(3, Math.min(7, Math.floor((hallRect.x1 - hallRect.x0 + hallRect.y1 - hallRect.y0) / 3)));
          let placed = 0;
          for (let oy = 0; oy < 3 && placed < items; oy++) {
            for (let ox = 0; ox < 3 && placed < items; ox++) {
              const x = facing === "east" ? start.x - ox : start.x + ox;
              const y = facing === "south" ? start.y - oy : start.y + oy;
              if (inRect(hallRect, x, y) && !occupiedTile(x, y) && !isCorridor(x, y)) {
                const r = ctx.rng();
                const type = r < 0.33 ? "crate" : (r < 0.66 ? "barrel" : "chest");
                addProp(x, y, type, type[0].toUpperCase() + type.slice(1));
                placed++;
              }
            }
          }
        })();

        // A few plants in hall to soften look
        (function placePlantsHall() {
          const tries = 20;
          let planted = 0;
          for (let i = 0;  << tries && plante << 4; i++) {
            const rx = hallRect.x0 + 1 + Math.floor(ctx.rng() * Math.max(1, (hallRect.x1 - hallRect.x0 - 2)));
            const ry = hallRect.y0 + 1 + Math.floor(ctx.rng() * Math.max(1, (hallRect.y1 - hallRect.y0 - 2)));
            if (inRect(hallRect, rx, ry) && !occupiedTile(rx, ry) && !isCorridor(rx, ry)) {
              addProp(rx, ry, "plant", "Plant"); planted++;
            }
          }
        })();

        // Finalize stairs placement: ensure glyph tiles override any leftover props and remain STAIRS
        (function finalizeStairsPortal() {
          try {
            const arr = Array.isArray(ctx.innStairsGround) ? ctx.innStairsGround : [];
            if (!arr.length) return;
            // Reassert tile types and clear any props at stair coordinates
            for (const s of arr) {
              if (!s) continue;
              if (s.x > b.x && s. <x b.x + b.w - 1 && s.y > b.y && s. <y b.y + b.h - 1) {
                ctx.map[s();
      }

      for (const b of buildings) {
        const tav = (ctx.tavern && ctx.tavern.building) ? ctx.tavern.building : null;
        const isTavernBld = !!(tav && b.x === tav.x && b.y === tav.y && b.w === tav.w && b.h === tav.h);
        if (isTavernBld) {
          furnishInn(ctx, b);
          continue;
        }

        // Default building furnishing (kept mostly as before)
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

        const area = b.w * b.h;
        let bedTarget = Math.max(1, Math.min(3, Math.floor(area / 24)));
        let bedsPlaced = 0, triesBed = 0;
        while (bedsPlaced < bedTarget && triesBed++ < 200) {
          const xx = Math.floor(ctx.rng() * (b.w - 2)) + b.x + 1;
          const yy = Math.floor(ctx.rng() * (b.h - 2)) + b.y + 1;
          if (!insideFloor(b, xx, yy)) continue;
          if (occupiedTile(xx, yy)) continue;
          addProp(xx, yy, "bed", "Bed"); bedsPlaced++;
        }

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

        let chestCount = ctx.rng() < 0.5 ? 2 : 1;
        let crates = ctx.rng() < 0.6 ? 2 : 1;
        let barrels = ctx.rng() < 0.6 ? 2 : 1;

        let placedC = 0, triesChest = 0;
        while (placedC < chestCount && triesChest++ < 80) {
          const xx = Math.floor(ctx.rng() * (b.w - 2)) + b.x + 1;
          const yy = Math.floor(ctx.rng() * (b.h - 2)) + b.y + 1;
          if (!insideFloor(b, xx, yy) || occupiedTile(xx, yy)) continue;
          addProp(xx, yy, "chest", "Chest"); placedC++;
        }
        let triesCr = 0;
        while (crates > 0 && triesCr++ < 120) {
          const xx = Math.floor(ctx.rng() * (b.w - 2)) + b.x + 1;
          const yy = Math.floor(ctx.rng() * (b.h - 2)) + b.y + 1;
          if (!insideFloor(b, xx, yy) || occupiedTile(xx, yy)) continue;
          addProp(xx, yy, "crate", "Crate"); crates--;
        }
        let triesBrl = 0;
        while (barrels > 0 && triesBrl++ < 120) {
          const xx = Math.floor(ctx.rng() * (b.w - 2)) + b.x + 1;
          const yy = Math.floor(ctx.rng() * (b.h - 2)) + b.y + 1;
          if (!insideFloor(b, xx, yy) || occupiedTile(xx, yy)) continue;
          addProp(xx, yy, "barrel", "Barrel"); barrels--;
        }

        let shelves = Math.min(2, Math.floor(area / 30));
        const shelfSpots = borderAdj.slice();
        while (shelves-- > 0 && shelfSpots.length) {
          const s = shelfSpots.splice(Math.floor(ctx.rng() * shelfSpots.length), 1)[0];
          if (!occupiedTile(s.x, s.y)) addProp(s.x, s.y, "shelf", "Shelf");
        }

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
    try {
      if (ctx && ctx.TownAI && typeof ctx.TownAI.populateTown === "function") {
        ctx.TownAI.populateTown(ctx);
      } else if (typeof window !== "undefined" && window.TownAI && typeof window.TownAI.populateTown === "function") {
        window.TownAI.populateTown(ctx);
      }
    } catch (_) {}

    // One special cat: Jekku (spawn in the designated town only)
    (function placeJekku() {
      try {
        const wx = (ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number") ? ctx.worldReturnPos.x : ctx.player.x;
        const wy = (ctx.worldReturnPos && typeof ctx.worldReturnPos.y === "number") ? ctx.worldReturnPos.y : ctx.player.y;
        const info = (ctx.world && Array.isArray(ctx.world.towns)) ? ctx.world.towns.find(t => t.x === wx && t.y === wy) : null;
        if (!info || !info.jekkuHome) return;
        // Avoid duplicate by name if already present
        if (Array.isArray(ctx.npcs) && ctx.npcs.some(n => String(n.name || "").toLowerCase() === "jekku")) return;
        // Prefer a free floor near the plaza
        const spots = [
          { x: ctx.townPlaza.x + 1, y: ctx.townPlaza.y },
          { x: ctx.townPlaza.x - 1, y: ctx.townPlaza.y },
          { x: ctx.townPlaza.x, y: ctx.townPlaza.y + 1 },
          { x: ctx.townPlaza.x, y: ctx.townPlaza.y - 1 },
          { x: ctx.townPlaza.x + 2, y: ctx.townPlaza.y },
          { x: ctx.townPlaza.x - 2, y: ctx.townPlaza.y },
          { x: ctx.townPlaza.x, y: ctx.townPlaza.y + 2 },
          { x: ctx.townPlaza.x, y: ctx.townPlaza.y - 2 },
        ];
        let pos = null;
        for (const s of spots) { if (_isFreeTownFloor(ctx, s.x, s.y)) { pos = s; break; } }
        if (!pos) {
          // Fallback: any free floor near plaza
          for (let oy = -3; oy <= 3 && !pos; oy++) {
            for (let ox = -3; ox <= 3 && !pos; ox++) {
              const x = ctx.townPlaza.x + ox, y = ctx.townPlaza.y + oy;
              if (_isFreeTownFloor(ctx, x, y)) pos = { x, y };
            }
          }
        }
        if (!pos) pos = { x: ctx.townPlaza.x, y: ctx.townPlaza.y };
        ctx.npcs.push({ x: pos.x, y: pos.y, name: "Jekku", kind: "cat", lines: ["Meow.", "Purr."], pet: true });
      } catch (_) {}
    })();

    // Roaming villagers near plaza
    const ND = (typeof window !== "undefined" && window.GameData && window.GameData.npcs) ? window.GameData.npcs : null;
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
    const tbCount = Array.isArray(ctx.townBuildings) ? ctx.townBuildings.length : 12;
    const roamTarget = Math.min(14, Math.max(6, Math.floor(tbCount / 2)));
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
      // Assign a home immediately to avoid "no-home" diagnostics for roamers
      let homeRef = null;
      try {
        const tbs = Array.isArray(ctx.townBuildings) ? ctx.townBuildings : [];
        if (tbs.length) {
          const b = tbs[Math.floor(ctx.rng() * tbs.length)];
          const hx = Math.max(b.x + 1, Math.min(b.x + b.w - 2, (b.x + ((b.w / 2) | 0))));
          const hy = Math.max(b.y + 1, Math.min(b.y + b.h - 2, (b.y + ((b.h / 2) | 0))));
          const door = (b && b.door && typeof b.door.x === "number" && typeof b.door.y === "number") ? { x: b.door.x, y: b.door.y } : null;
          homeRef = { building: b, x: hx, y: hy, door };
        }
      } catch (_) {}
      ctx.npcs.push({ x, y, name: `Villager ${placed + 1}`, lines, _likesInn: ctx.rng() < 0.45, _home: homeRef });
      placed++;
    }

    // Visibility reset for town
    // Start unseen; player FOV will reveal tiles and mark memory.
    // This prevents props from showing unless the player has actually seen them.
    ctx.seen = Array.from({ length: H }, () => Array(W).fill(false));
    ctx.visible = Array.from({ length: H }, () => Array(W).fill(false));
    ctx.enemies = [];
    ctx.corpses = [];
    ctx.decals = [];

    // Spawn a greeter near the gate and greet the player (single NPC greeting)
    try {
      if (typeof spawnGateGreeters === "function") {
        spawnGateGreeters(ctx, 1);
        // Find nearest greeter we just placed and greet
        const greeters = Array.isArray(ctx.npcs) ? ctx.npcs.filter(n => Array.isArray(n.lines) && n.lines.length && /welcome/i.test(n.lines[0])) : [];
        if (greeters.length) {
          // Pick the closest to the player
          let g = greeters[0], gd = _manhattan(ctx, ctx.player.x, ctx.player.y, g.x, g.y);
          for (const n of greeters) {
            const d = _manhattan(ctx, ctx.player.x, ctx.player.y, n.x, n.y);
            if (d < gd) { g = n; gd = d; }
          }
          const line = g.lines[0] || `Welcome to ${ctx.townName || "our town"}.`;
          ctx.log(`${g.name || "Greeter"}: ${line}`, "notice");
        }
      }
    } catch (_) {}

    // Enforce a single NPC near the gate to avoid congestion
    try { enforceGateNPCLimit(ctx, 1, 2); } catch (_) {}

    // Finish
    try { ctx.inn = ctx.tavern; } catch (_) {}
    if (ctx.updateUI) ctx.updateUI();
    // Draw is handled by orchestrator after generation; avoid redundant frame
    return true;
  }

  // ---- Shop helpers for interactProps (delegate to ShopService) ----
  function isShopOpenNow(ctx, shop = null) {
    try {
      if (ctx && ctx.ShopService && typeof ctx.ShopService.isShopOpenNow === "function") {
        return ctx.ShopService.isShopOpenNow(ctx, shop);
      }
      if (typeof window !== "undefined" && window.ShopService && typeof window.ShopService.isShopOpenNow === "function") {
        return window.ShopService.isShopOpenNow(ctx, shop);
      }
    } catch (_){}
    return false;
  }
  function shopScheduleStr(ctx, shop) {
    try {
      if (ctx && ctx.ShopService && typeof ctx.ShopService.shopScheduleStr === "function") {
        return ctx.ShopService.shopScheduleStr(shop);
      }
      if (typeof window !== "undefined" && window.ShopService && typeof window.ShopService.shopScheduleStr === "function") {
        return window.ShopService.shopScheduleStr(shop);
      }
    } catch (_){}
    return "";
  }
  function shopAt(ctx, x, y) {
    try {
      if (ctx && ctx.ShopService && typeof ctx.ShopService.shopAt === "function") {
        return ctx.ShopService.shopAt(ctx, x, y);
      }
      if (typeof window !== "undefined" && window.ShopService && typeof window.ShopService.shopAt === "function") {
        return window.ShopService.shopAt(ctx, x, y);
      }
    } catch (_){}
    return null;
  }

  import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper and export for ESM
export { generate, ensureSpawnClear, spawnGateGreeters, interactProps };
attachGlobal("Town", { generate, ensureSpawnClear, spawnGateGreeters, interactProps });