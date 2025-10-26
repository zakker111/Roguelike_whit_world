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

// Prefab embedded prop code mapping (shared by ground floor and upstairs overlay)
function prefabPropType(code) {
  var s = String(code || "").toUpperCase();
  if (s === "BED") return "bed";
  if (s === "TABLE") return "table";
  if (s === "CHAIR") return "chair";
  if (s === "SHELF") return "shelf";
  if (s === "COUNTER") return "counter";
  if (s === "FIREPLACE") return "fireplace";
  if (s === "CHEST") return "chest";
  if (s === "CRATE") return "crate";
  if (s === "BARREL") return "barrel";
  if (s === "PLANT") return "plant";
  if (s === "RUG") return "rug";
  if (s === "QUEST_BOARD") return "quest_board";
  return null;
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
  const RAND = (typeof ctx.rng === "function") ? ctx.rng : Math.random;
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
            const name = names[Math.floor(RAND() * names.length) % names.length];
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
        const name = names[Math.floor(RAND() * names.length) % names.length];
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
  // Seeded RNG helper for determinism
  const RU = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
  const rng = (RU && typeof RU.getRng === "function")
    ? RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
    : ((typeof ctx.rng === "function") ? ctx.rng : null);

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
    const p = prefixes[Math.floor(rng() * prefixes.length) % prefixes.length];
    const m = mid[Math.floor(rng() * mid.length) % mid.length];
    const s = suffixes[Math.floor(rng() * suffixes.length) % suffixes.length];
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

  // Buildings container (either prefab-placed or hollow rectangles as fallback)
  const buildings = [];
  // Prefab-stamped shops (collected during placement; integrated later with schedules and signs)
  const prefabShops = [];
  const STRICT_PREFABS = true;
  // Enforce strict prefab mode when prefab registry has loaded
  function prefabsAvailable() {
    try {
      const PFB = (typeof window !== "undefined" && window.GameData && window.GameData.prefabs) ? window.GameData.prefabs : null;
      if (!PFB || typeof PFB !== "object") return false;
      const hasHouses = Array.isArray(PFB.houses) && PFB.houses.length > 0;
      const hasInns = Array.isArray(PFB.inns) && PFB.inns.length > 0;
      const hasShops = Array.isArray(PFB.shops) && PFB.shops.length > 0;
      return hasHouses || hasInns || hasShops;
    } catch (_) { return false; }
  }
  const strictNow = !!STRICT_PREFABS && !!prefabsAvailable();
  try { if (!strictNow && typeof ctx.log === "function") ctx.log("Prefabs not loaded yet; using rectangle fallback this visit.", "warn"); } catch (_) {}

  // Rect helpers and conflict resolution
  function rectOverlap(ax, ay, aw, ah, bx, by, bw, bh, margin = 0) {
    const ax0 = ax - margin, ay0 = ay - margin, ax1 = ax + aw - 1 + margin, ay1 = ay + ah - 1 + margin;
    const bx0 = bx - margin, by0 = by - margin, bx1 = bx + bw - 1 + margin, by1 = by + bh - 1 + margin;
    const sepX = (ax1 < bx0) || (bx1 < ax0);
    const sepY = (ay1 < by0) || (by1 < ay0);
    return !(sepX || sepY);
  }
  function findBuildingsOverlappingRect(x0, y0, w, h, margin = 0) {
    const out = [];
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (rectOverlap(b.x, b.y, b.w, b.h, x0, y0, w, h, margin)) out.push(b);
    }
    return out;
  }
  function removeBuildingAndProps(b) {
    try {
      // Clear tiles to FLOOR inside building rect (remove walls/doors/windows)
      for (let yy = b.y; yy <= b.y + b.h - 1; yy++) {
        for (let xx = b.x; xx <= b.x + b.w - 1; xx++) {
          if (inBounds(ctx, xx, yy)) ctx.map[yy][xx] = ctx.TILES.FLOOR;
        }
      }
    } catch (_) {}
    try {
      // Remove props inside rect with 1-tile margin (includes signs just outside)
      ctx.townProps = Array.isArray(ctx.townProps)
        ? ctx.townProps.filter(p => !(rectOverlap(b.x, b.y, b.w, b.h, p.x, p.y, 1, 1, 1)))
        : [];
    } catch (_) {}
    try {
      // Remove shops tied to this building
      ctx.shops = Array.isArray(ctx.shops)
        ? ctx.shops.filter(s => !(s && s.building && rectOverlap(s.building.x, s.building.y, s.building.w, s.building.h, b.x, b.y, b.w, b.h, 0)))
        : [];
      // Also remove any pending prefab shop records mapped to this rect
      for (let i = prefabShops.length - 1; i >= 0; i--) {
        const ps = prefabShops[i];
        if (ps && ps.building && rectOverlap(ps.building.x, ps.building.y, ps.building.w, ps.building.h, b.x, b.y, b.w, b.h, 0)) {
          prefabShops.splice(i, 1);
        }
      }
    } catch (_) {}
    try {
      // Remove from buildings list
      for (let i = buildings.length - 1; i >= 0; i--) {
        const q = buildings[i];
        if (q && q.x === b.x && q.y === b.y && q.w === b.w && q.h === b.h) buildings.splice(i, 1);
      }
    } catch (_) {}
    try {
      // Invalidate tavern reference if it overlaps
      const tb = (ctx.tavern && ctx.tavern.building) ? ctx.tavern.building : null;
      if (tb && rectOverlap(tb.x, tb.y, tb.w, tb.h, b.x, b.y, b.w, b.h, 0)) {
        ctx.tavern = undefined; ctx.inn = undefined;
      }
    } catch (_) {}
  }
  function trySlipStamp(ctx, prefab, bx, by, maxSlip = 2) {
    const offsets = [];
    for (let d = 1; d <= maxSlip; d++) {
      offsets.push({ dx: d, dy: 0 }, { dx: -d, dy: 0 }, { dx: 0, dy: d }, { dx: 0, dy: -d });
      offsets.push({ dx: d, dy: d }, { dx: -d, dy: d }, { dx: d, dy: -d }, { dx: -d, dy: -d });
    }
    for (const o of offsets) {
      const x = bx + o.dx, y = by + o.dy;
      if (stampPrefab(ctx, prefab, x, y)) return true;
    }
    return false;
  }

  // --- Prefab helpers ---
  function stampPrefab(ctx, prefab, bx, by) {
    if (!prefab || !prefab.size || !Array.isArray(prefab.tiles)) return false;
    const w = prefab.size.w | 0, h = prefab.size.h | 0;
    // Bounds and clear margin check
    const x0 = bx, y0 = by, x1 = bx + w - 1, y1 = by + h - 1;
    if (x0 <= 0 || y0 <= 0 || x1 >= W - 1 || y1 >= H - 1) return false;
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        if (ctx.map[yy][xx] !== ctx.TILES.FLOOR) return false;
      }
    }

    // Ensure props container
    try { if (!Array.isArray(ctx.townProps)) ctx.townProps = []; } catch (_) {}

    // Vendor hint for embedded COUNTER props
    function vendorForCounter(prefab) {
      try {
        const cat = String(prefab.category || "").toLowerCase();
        if (cat === "inn") return "inn";
        if (cat === "shop") {
          const t = (prefab.shop && prefab.shop.type) ? String(prefab.shop.type) : null;
          return t || "shop";
        }
      } catch (_) {}
      return undefined;
    }

    // Recognized prop codes in tiles
    const PROPMAP = {
      BED: "bed",
      TABLE: "table",
      CHAIR: "chair",
      SHELF: "shelf",
      RUG: "rug",
      FIREPLACE: "fireplace",
      CHEST: "chest",
      CRATE: "crate",
      BARREL: "barrel",
      PLANT: "plant",
      COUNTER: "counter",
      STALL: "stall",
      LAMP: "lamp",
      WELL: "well"
    };

    // Stamp tiles and embedded props
    for (let yy = 0; yy < h; yy++) {
      const row = prefab.tiles[yy];
      if (!row || row.length !== w) return false;
      for (let xx = 0; xx < w; xx++) {
        const code = row[xx];
        const wx = x0 + xx, wy = y0 + yy;

        // Embedded prop code
        if (code && PROPMAP[code]) {
          // props sit on floor
          ctx.map[wy][wx] = ctx.TILES.FLOOR;
          if (!ctx.townProps.some(q => q && q.x === wx && q.y === wy)) {
            const type = PROPMAP[code];
            const vendor = (type === "counter") ? vendorForCounter(prefab) : undefined;
            ctx.townProps.push({ x: wx, y: wy, type, vendor });
          }
          continue;
        }

        // Normal tile mapping
        let t = ctx.TILES.FLOOR;
        if (code === "WALL") t = ctx.TILES.WALL;
        else if (code === "FLOOR") t = ctx.TILES.FLOOR;
        else if (code === "DOOR") t = ctx.TILES.DOOR;
        else if (code === "WINDOW") t = ctx.TILES.WINDOW;
        else if (code === "STAIRS") t = ctx.TILES.STAIRS;
        ctx.map[wy][wx] = t;
      }
    }

    // Ensure a solid perimeter: convert any non-door/window on the boundary to WALL.
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const isBorder = (yy === y0 || yy === y1 || xx === x0 || xx === x1);
        if (!isBorder) continue;
        const cur = ctx.map[yy][xx];
        if (cur !== ctx.TILES.DOOR && cur !== ctx.TILES.WINDOW) {
          ctx.map[yy][xx] = ctx.TILES.WALL;
        }
      }
    }

    // Explicitly stamp doors from prefab metadata (in case tiles[] omitted them)
    try {
      if (Array.isArray(prefab.doors)) {
        for (const d of prefab.doors) {
          if (d && typeof d.x === "number" && typeof d.y === "number") {
            const dx = x0 + (d.x | 0), dy = y0 + (d.y | 0);
            if (inBounds(ctx, dx, dy)) ctx.map[dy][dx] = ctx.TILES.DOOR;
          }
        }
      }
    } catch (_) {}

    // For inns, rely solely on prefab DOOR tiles; do not auto-carve doors.
    if (String(prefab.category || "").toLowerCase() !== "inn") {
      (function ensurePerimeterDoor() {
        let hasDoor = false;
        for (let xx = x0; xx <= x1 && !hasDoor; xx++) {
          if (inBounds(ctx, xx, y0) && ctx.map[y0][xx] === ctx.TILES.DOOR) { hasDoor = true; break; }
          if (inBounds(ctx, xx, y1) && ctx.map[y1][xx] === ctx.TILES.DOOR) { hasDoor = true; break; }
        }
        for (let yy = y0; yy <= y1 && !hasDoor; yy++) {
          if (inBounds(ctx, x0, yy) && ctx.map[yy][x0] === ctx.TILES.DOOR) { hasDoor = true; break; }
          if (inBounds(ctx, x1, yy) && ctx.map[yy][x1] === ctx.TILES.DOOR) { hasDoor = true; break; }
        }
        if (!hasDoor) {
          const cx = x0 + ((w / 2) | 0);
          const cy = y0 + h - 1;
          if (inBounds(ctx, cx, cy)) ctx.map[cy][cx] = ctx.TILES.DOOR;
        }
      })();
    }

    // Back-compat: consume explicit props array if present
    try {
      if (Array.isArray(prefab.props)) {
        for (const p of prefab.props) {
          const px = x0 + (p.x | 0), py = y0 + (p.y | 0);
          if (px > 0 && py > 0 && px < W - 1 && py < H - 1 && ctx.map[py][px] === ctx.TILES.FLOOR) {
            if (!ctx.townProps.some(q => q && q.x === px && q.y === py)) {
              ctx.townProps.push({ x: px, y: py, type: p.type || "prop", name: p.name || undefined, vendor: p.vendor || undefined });
            }
          }
        }
      }
    } catch (_) {}

    // Record building rect
    const rect = { x: x0, y: y0, w, h, prefabId: (prefab && prefab.id) ? String(prefab.id) : null, prefabCategory: String(prefab.category || "").toLowerCase() || null };
    buildings.push(rect);

    // Inn: consume upstairsOverlay and record ground stairs if present in prefab tiles
    try {
      if (String(prefab.category || "").toLowerCase() === "inn") {
        // Record ground stairs inside inn building from prefab tiles
        const stairs = [];
        for (let yy = y0; yy <= y1; yy++) {
          for (let xx = x0; xx <= x1; xx++) {
            if (inBounds(ctx, xx, yy) && ctx.map[yy][xx] === ctx.TILES.STAIRS) stairs.push({ x: xx, y: yy });
          }
        }
        if (stairs.length) {
          let pair = null;
          for (let i = 0; i < stairs.length && !pair; i++) {
            for (let j = i + 1; j < stairs.length && !pair; j++) {
              const a = stairs[i], b = stairs[j];
              if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1) pair = [a, b];
            }
          }
          ctx.innStairsGround = pair || stairs.slice(0, 2);
        }
        // Upstairs overlay from prefab (if present)
        const ov = prefab.upstairsOverlay;
        if (ov && Array.isArray(ov.tiles)) {
          const offX = (ov.offset && (ov.offset.x != null ? ov.offset.x : ov.offset.ox)) | 0;
          const offY = (ov.offset && (ov.offset.y != null ? ov.offset.y : ov.offset.oy)) | 0;
          const wUp = (ov.w | 0) || (ov.tiles[0] ? ov.tiles[0].length : 0);
          const hUp = (ov.h | 0) || ov.tiles.length;
          const tilesUp = Array.from({ length: hUp }, () => Array(wUp).fill(ctx.TILES.FLOOR));
          const propsUp = [];
          for (let yy = 0; yy < hUp; yy++) {
            const row = ov.tiles[yy];
            if (!row) continue;
            for (let xx = 0; xx < Math.min(wUp, row.length); xx++) {
              const code = row[xx];
              // Embedded upstairs props
              if (code && PROPMAP[code]) {
                const px = (x0 + offX) + xx;
                const py = (y0 + offY) + yy;
                propsUp.push({ x: px, y: py, type: PROPMAP[code] });
                tilesUp[yy][xx] = ctx.TILES.FLOOR;
                continue;
              }
              let t = ctx.TILES.FLOOR;
              if (code === "WALL") t = ctx.TILES.WALL;
              else if (code === "FLOOR") t = ctx.TILES.FLOOR;
              else if (code === "DOOR") t = ctx.TILES.DOOR;
              else if (code === "WINDOW") t = ctx.TILES.WINDOW;
              else if (code === "STAIRS") t = ctx.TILES.STAIRS;
              tilesUp[yy][xx] = t;
            }
          }
          // Back-compat: explicit upstairs props list
          try {
            if (Array.isArray(ov.props)) {
              for (const p of ov.props) {
                const px = (p.x | 0), py = (p.y | 0);
                propsUp.push({ x: (x0 + offX) + px, y: (y0 + offY) + py, type: p.type || "prop", name: p.name || undefined });
              }
            }
          } catch (_) {}
          ctx.innUpstairs = { offset: { x: x0 + offX, y: y0 + offY }, w: wUp, h: hUp, tiles: tilesUp, props: propsUp };
          ctx.innUpstairsActive = false;
        }
      }
    } catch (_) {}

    // If prefab declares it is a shop, collect for later schedule/sign assignment
    try {
      if (String(prefab.category || "").toLowerCase() === "shop" || (prefab.shop && prefab.shop.type)) {
        const shopType = (prefab.shop && prefab.shop.type) ? String(prefab.shop.type) : (prefab.tags && prefab.tags.find(t => t !== "shop")) || "shop";
        const shopName = String(prefab.name || (prefab.shop && prefab.shop.signText) || (shopType[0].toUpperCase() + shopType.slice(1)));
        // Choose front door: prefer role=main else first door; translate to world coords
        let doorWorld = null;
        if (Array.isArray(prefab.doors) && prefab.doors.length) {
          let d0 = prefab.doors.find(d => String(d.role || "").toLowerCase() === "main") || prefab.doors[0];
          if (d0 && typeof d0.x === "number" && typeof d0.y === "number") {
            doorWorld = { x: x0 + (d0.x | 0), y: y0 + (d0.y | 0) };
          }
        }
        // If no explicit door, pick midpoint on bottom edge
        if (!doorWorld) {
          doorWorld = { x: x0 + ((w / 2) | 0), y: y0 + h - 1 };
        }
        // Optional schedule override from prefab
        let scheduleOverride = null;
        try {
          const s = prefab.shop && prefab.shop.schedule;
          if (s && (s.open || s.close || s.alwaysOpen != null)) {
            scheduleOverride = { open: s.open || null, close: s.close || null, alwaysOpen: !!s.alwaysOpen };
          }
        } catch (_) {}
        prefabShops.push({
          type: shopType,
          building: rect,
          door: doorWorld,
          name: shopName,
          scheduleOverride
        });
      }
    } catch (_) {}

    return true;
  }

  function pickPrefab(list, rng) {
    if (!Array.isArray(list) || list.length === 0) return null;
    const idx = Math.floor(rng() * list.length) % list.length;
    return list[idx];
  }

  // --- Hollow rectangle fallback helpers ---
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
      const randint = (min, max) => min + Math.floor(rng() * (Math.max(0, (max - min + 1))));
      let w, h;
      const r = rng();
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

      const PFB = (typeof window !== "undefined" && window.GameData && window.GameData.prefabs) ? window.GameData.prefabs : null;
      let usedPrefab = false;
      if (PFB && Array.isArray(PFB.houses) && PFB.houses.length) {
        // Pick a house prefab that fits in (w,h)
        const candidates = PFB.houses.filter(p => p && p.size && p.size.w <= w && p.size.h <= h);
        if (candidates.length) {
          const pref = pickPrefab(candidates, ctx.rng || rng);
          if (pref && pref.size) {
            const oxCenter = Math.floor((w - pref.size.w) / 2);
            const oyCenter = Math.floor((h - pref.size.h) / 2);
            usedPrefab = stampPrefab(ctx, pref, fx + oxCenter, fy + oyCenter) || trySlipStamp(ctx, pref, fx + oxCenter, fy + oyCenter, 2);
          }
        }
      }
      if (!usedPrefab) {
        if (strictNow) {
          try { if (ctx && typeof ctx.log === "function") ctx.log(`Strict prefabs: no house prefab fit ${w}x${h} at ${fx},${fy}. Skipping fallback.`, "error"); } catch (_) {}
          // Skip placing a building here
        } else {
          placeBuilding(fx, fy, w, h);
        }
      }
    }
  }

  // Additional residential fill pass: attempt to reach a target count by random-fit stamping with slip
  (function prefabResidentialFillPass() {
    try {
      const PFB = (typeof window !== "undefined" && window.GameData && window.GameData.prefabs) ? window.GameData.prefabs : null;
      if (!PFB || !Array.isArray(PFB.houses) || !PFB.houses.length) return;
      const sizeKey = townSize;
      const targetBySize = (sizeKey === "small") ? 12 : (sizeKey === "city" ? 34 : 22);
      if (buildings.length >= targetBySize) return;
      let attempts = 0, successes = 0;
      while (buildings.length < targetBySize && attempts++ < 600) {
        // Random provisional rectangle within bounds
        const bw = Math.max(6, Math.min(12, 6 + Math.floor((ctx.rng || rng)() * 7)));
        const bh = Math.max(4, Math.min(10, 4 + Math.floor((ctx.rng || rng)() * 7)));
        const bx = Math.max(2, Math.min(W - bw - 3, 2 + Math.floor((ctx.rng || rng)() * (W - bw - 4))));
        const by = Math.max(2, Math.min(H - bh - 3, 2 + Math.floor((ctx.rng || rng)() * (H - bh - 4))));
        // Skip near plaza and enforce margin clear
        if (overlapsPlazaRect(bx, by, bw, bh, 1)) continue;
        if (!isAreaClearForBuilding(bx, by, bw, bh, 1)) continue;
        // Pick a prefab that fits
        const candidates = PFB.houses.filter(p => p && p.size && p.size.w <= bw && p.size.h <= bh);
        if (!candidates.length) continue;
        const pref = pickPrefab(candidates, ctx.rng || rng);
        if (!pref || !pref.size) continue;
        const ox = Math.floor((bw - pref.size.w) / 2);
        const oy = Math.floor((bh - pref.size.h) / 2);
        const px = bx + ox, py = by + oy;
        if (stampPrefab(ctx, pref, px, py) || trySlipStamp(ctx, pref, px, py, 2)) {
          successes++;
        }
      }
      try { if (ctx && typeof ctx.log === "function") ctx.log(`Residential fill: added ${successes} houses (target ${targetBySize}).`, "notice"); } catch (_) {}
    } catch (_) {}
  })();

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
    let rectUsedInn = null;
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

    // Prefer prefab-based Inn stamping when available
    const PFB = (typeof window !== "undefined" && window.GameData && window.GameData.prefabs) ? window.GameData.prefabs : null;
    let usedPrefabInn = false;
    if (PFB && Array.isArray(PFB.inns) && PFB.inns.length) {
      // Prefer the largest inn prefab that fits, to ensure a roomy tavern
      const innsSorted = PFB.inns
        .slice()
        .filter(p => p && p.size && typeof p.size.w === "number" && typeof p.size.h === "number")
        .sort((a, b) => (b.size.w * b.size.h) - (a.size.w * a.size.h));

      // Try stamping centered in innRect; if it doesn't fit, shrink rect and retry a few times
      let bx = innRect.x, by = innRect.y, bw = innRect.w, bh = innRect.h;
      for (let attempts = 0; attempts < 4 && !usedPrefabInn; attempts++) {
        const pref = innsSorted.find(p => p.size.w <= bw && p.size.h <= bh) || null;
        if (pref) {
          const ox = Math.floor((bw - pref.size.w) / 2);
          const oy = Math.floor((bh - pref.size.h) / 2);
          if (stampPrefab(ctx, pref, bx + ox, by + oy)) {
            usedPrefabInn = true;
            rectUsedInn = { x: bx + ox, y: by + oy, w: pref.size.w, h: pref.size.h };
            break;
          }
        }
        bw = Math.max(10, bw - 2);
        bh = Math.max(8, bh - 2);
      }
    }

    // Decide whether to proceed with inn assignment
    let proceedInn = true;
    if (!usedPrefabInn) {
      // Second pass: try stamping an inn prefab anywhere on the map (largest-first), allowing removal of overlapping buildings
      const PFB2 = (typeof window !== "undefined" && window.GameData && window.GameData.prefabs) ? window.GameData.prefabs : null;
      if (PFB2 && Array.isArray(PFB2.inns) && PFB2.inns.length) {
        const innsSorted2 = PFB2.inns
          .slice()
          .filter(function(p){ return p && p.size && typeof p.size.w === "number" && typeof p.size.h === "number"; })
          .sort(function(a, b){ return (b.size.w * b.size.h) - (a.size.w * a.size.h); });
        let stamped = false;
        for (let ip = 0; ip < innsSorted2.length && !stamped; ip++) {
          const pref = innsSorted2[ip];
          const wInn = pref.size.w | 0, hInn = pref.size.h | 0;
          for (let y = 2; y <= H - hInn - 2 && !stamped; y++) {
            for (let x = 2; x <= W - wInn - 2 && !stamped; x++) {
              // Try stamping directly
              if (stampPrefab(ctx, pref, x, y)) {
                rectUsedInn = { x: x, y: y, w: wInn, h: hInn };
                usedPrefabInn = true;
                stamped = true;
                break;
              }
              // If blocked by existing buildings, remove ALL overlaps and try again
              const overl = findBuildingsOverlappingRect(x, y, wInn, hInn, 0);
              if (overl && overl.length) {
                for (let oi = 0; oi < overl.length; oi++) {
                  removeBuildingAndProps(overl[oi]);
                }
                if (stampPrefab(ctx, pref, x, y)) {
                  rectUsedInn = { x: x, y: y, w: wInn, h: hInn };
                  usedPrefabInn = true;
                  stamped = true;
                  break;
                }
              }
            }
          }
        }
        // Force a plaza-centered placement by clearing overlaps if none were stamped in the scan
        if (!stamped) {
          const pref0 = innsSorted2[0];
          if (pref0 && pref0.size) {
            const wInn0 = pref0.size.w | 0, hInn0 = pref0.size.h | 0;
            const fx = Math.max(2, Math.min(W - wInn0 - 2, ((plaza.x - ((wInn0 / 2) | 0)) | 0)));
            const fy = Math.max(2, Math.min(H - hInn0 - 2, ((plaza.y - ((hInn0 / 2) | 0)) | 0)));
            const overl0 = findBuildingsOverlappingRect(fx, fy, wInn0, hInn0, 0);
            if (overl0 && overl0.length) {
              for (let oi = 0; oi < overl0.length; oi++) {
                removeBuildingAndProps(overl0[oi]);
              }
            }
            if (stampPrefab(ctx, pref0, fx, fy)) {
              rectUsedInn = { x: fx, y: fy, w: wInn0, h: hInn0 };
              usedPrefabInn = true;
            }
          }
        }
      }
      // As an absolute fallback, carve a hollow-rectangle Inn near the plaza to guarantee an Inn exists
      if (!usedPrefabInn) {
        placeBuilding(innRect.x, innRect.y, innRect.w, innRect.h);
        rectUsedInn = { x: innRect.x, y: innRect.y, w: innRect.w, h: innRect.h };
      }
    }

    if (!proceedInn) return;

    // Choose an existing building to replace/represent the inn, prefer the one closest to baseRect center,
    // and ensure the building record matches the actual stamped inn rectangle so furnishing runs correctly.
    const baseRect = rectUsedInn || innRect;
    let targetIdx = -1, bestD = Infinity;
    const cx = (baseRect.x + (baseRect.w / 2)) | 0;
    const cy = (baseRect.y + (baseRect.h / 2)) | 0;
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      const d = Math.abs((b.x + (b.w / 2)) - cx) + Math.abs((b.y + (b.h / 2)) - cy);
      if (d < bestD) { bestD = d; targetIdx = i; }
    }
    if (targetIdx === -1) {
      // If none available (shouldn't happen), push a new building record
      buildings.push({ x: baseRect.x, y: baseRect.y, w: baseRect.w, h: baseRect.h });
    } else {
      const prevB = buildings[targetIdx];
      buildings[targetIdx] = {
        x: baseRect.x,
        y: baseRect.y,
        w: baseRect.w,
        h: baseRect.h,
        prefabId: prevB ? prevB.prefabId : null,
        prefabCategory: prevB ? prevB.prefabCategory : null
      };
    }

    // Record the tavern (Inn) building and its preferred door (closest to plaza)
    try {
      const cds = candidateDoors(baseRect);
      let bestDoor = null, bestD2 = Infinity;
      for (const d of cds) {
        if (inBounds(ctx, d.x, d.y) && ctx.map[d.y][d.x] === ctx.TILES.DOOR) {
          const dd = Math.abs(d.x - plaza.x) + Math.abs(d.y - plaza.y);
          if (dd < bestD2) { bestD2 = dd; bestDoor = { x: d.x, y: d.y }; }
        }
      }
      // Do not auto-carve doors for the inn; rely solely on prefab DOOR tiles.
      try {
        const bRec = buildings.find(b => b.x === baseRect.x && b.y === baseRect.y && b.w === baseRect.w && b.h === baseRect.h) || null;
        const pid = (bRec && typeof bRec.prefabId !== "undefined") ? bRec.prefabId : null;
        const pcat = (bRec && typeof bRec.prefabCategory !== "undefined") ? bRec.prefabCategory : null;
        if (bestDoor) {
          ctx.tavern = {
            building: { x: baseRect.x, y: baseRect.y, w: baseRect.w, h: baseRect.h, prefabId: pid, prefabCategory: pcat },
            door: { x: bestDoor.x, y: bestDoor.y }
          };
        } else {
          ctx.tavern = {
            building: { x: baseRect.x, y: baseRect.y, w: baseRect.w, h: baseRect.h, prefabId: pid, prefabCategory: pcat }
          };
        }
      } catch (_) {
        if (bestDoor) {
          ctx.tavern = { building: { x: baseRect.x, y: baseRect.y, w: baseRect.w, h: baseRect.h }, door: { x: bestDoor.x, y: bestDoor.y } };
        } else {
          ctx.tavern = { building: { x: baseRect.x, y: baseRect.y, w: baseRect.w, h: baseRect.h } };
        }
      }
    } catch (_) {}
  })();

  // Remove any buildings overlapping the Inn building
  (function cleanupInnOverlap() {
    try {
      const tb = (ctx.tavern && ctx.tavern.building) ? ctx.tavern.building : null;
      if (!tb) return;
      const toDel = [];
      for (const b of buildings) {
        if (b.x === tb.x && b.y === tb.y && b.w === tb.w && b.h === tb.h) continue;
        if (rectOverlap(b.x, b.y, b.w, b.h, tb.x, tb.y, tb.w, tb.h, 0)) toDel.push(b);
      }
      for (const b of toDel) removeBuildingAndProps(b);
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
        // Strict prefabs: attempt to stamp a house prefab; else carve fallback rectangle
        const PFB = (typeof window !== "undefined" && window.GameData && window.GameData.prefabs) ? window.GameData.prefabs : null;
        if (PFB && Array.isArray(PFB.houses) && PFB.houses.length) {
          const candidates = PFB.houses.filter(p => p && p.size && p.size.w <= bw && p.size.h <= bh);
          if (candidates.length) {
            const pref = pickPrefab(candidates, ctx.rng || rng);
            if (pref && pref.size) {
              const ox = Math.floor((bw - pref.size.w) / 2);
              const oy = Math.floor((bh - pref.size.h) / 2);
              if (stampPrefab(ctx, pref, bx + ox, by + oy)) {
                added++;
                return true;
              }
            }
          }
        }
        if (!strictNow) {
          placeBuilding(bx, by, bw, bh);
          added++;
          return true;
        }
        try { if (ctx && typeof ctx.log === "function") ctx.log(`Strict prefabs: failed to place extra house prefab in quad (${q.x0},${q.y0})-(${q.x1},${q.y1}); skipping fallback.`, "error"); } catch (_) {}
        return false;
      }
      for (const q of quads) {
        if (buildings.length + added >= minBySize) break;
        for (let tries = 0; tries < 4 && buildings.length + added < minBySize; tries++) {
          if (!tryPlaceRect(q)) continue;
        }
      }
    } catch (_) {}
  })();

  // Place shop prefabs near plaza with conflict resolution
  (function placeShopPrefabsStrict() {
    try {
      const PFB = (typeof window !== "undefined" && window.GameData && window.GameData.prefabs) ? window.GameData.prefabs : null;
      if (!PFB || !Array.isArray(PFB.shops) || !PFB.shops.length) return;
      const pr = ctx.townPlazaRect;
      if (!pr) return;
      const px0 = pr.x0, px1 = pr.x1, py0 = pr.y0, py1 = pr.y1;
      const sideCenterX = ((px0 + px1) / 2) | 0;
      const sideCenterY = ((py0 + py1) / 2) | 0;
      function stampWithResolution(pref, bx, by) {
        if (stampPrefab(ctx, pref, bx, by)) return true;
        // Try slip first
        if (trySlipStamp(ctx, pref, bx, by, 2)) return true;
        // If still blocked, remove the first overlapping building and try once more
        const overlaps = findBuildingsOverlappingRect(bx, by, pref.size.w, pref.size.h, 0);
        if (overlaps.length) {
          removeBuildingAndProps(overlaps[0]);
          if (stampPrefab(ctx, pref, bx, by)) return true;
          if (trySlipStamp(ctx, pref, bx, by, 2)) return true;
        }
        return false;
      }
      // Choose a few unique shop types based on town size
      const sizeKey = ctx.townSize || "big";
      let limit = sizeKey === "city" ? 6 : (sizeKey === "small" ? 3 : 4);
      const usedTypes = new Set();
      let sideIdx = 0;
      const sides = ["west", "east", "north", "south"];
      let attempts = 0;
      while (limit > 0 && attempts++ < 20) {
        // pick a prefab with a new type
        const candidates = PFB.shops.filter(p => {
          const t = (p.shop && p.shop.type) ? String(p.shop.type) : null;
          return !t || !usedTypes.has(t.toLowerCase());
        });
        if (!candidates.length) break;
        const pref = pickPrefab(candidates, ctx.rng || Math.random);
        if (!pref || !pref.size) break;
        const tKey = (pref.shop && pref.shop.type) ? String(pref.shop.type).toLowerCase() : `shop_${attempts}`;
        // compute anchor by side
        const side = sides[sideIdx % sides.length]; sideIdx++;
        let bx = 1, by = 1;
        if (side === "west") {
          bx = Math.max(1, px0 - 3 - pref.size.w);
          by = Math.max(1, Math.min((H - pref.size.h - 2), sideCenterY - ((pref.size.h / 2) | 0)));
        } else if (side === "east") {
          bx = Math.min(W - pref.size.w - 2, px1 + 3);
          by = Math.max(1, Math.min((H - pref.size.h - 2), sideCenterY - ((pref.size.h / 2) | 0)));
        } else if (side === "north") {
          bx = Math.max(1, Math.min(W - pref.size.w - 2, sideCenterX - ((pref.size.w / 2) | 0)));
          by = Math.max(1, py0 - 3 - pref.size.h);
        } else {
          bx = Math.max(1, Math.min(W - pref.size.w - 2, sideCenterX - ((pref.size.w / 2) | 0)));
          by = Math.min(H - pref.size.h - 2, py1 + 3);
        }
        if (stampWithResolution(pref, bx, by)) {
          usedTypes.add(tKey);
          limit--;
        } else {
          try { if (ctx && typeof ctx.log === "function") ctx.log(`Strict prefabs: failed to stamp shop '${(pref.name ? pref.name : ((pref.shop && pref.shop.type) ? pref.shop.type : "shop"))}' at ${bx},${by}.`, "error"); } catch (_) {}

        }
      }
    } catch (_) {}
  })();

  // After shops and houses, remove any buildings touching the central plaza footprint
  (function cleanupBuildingsTouchingPlaza() {
    try {
      const pr = ctx.townPlazaRect;
      if (!pr) return;
      const pw = pr.x1 - pr.x0 + 1;
      const ph = pr.y1 - pr.y0 + 1;
      const toDel = [];
      for (const b of buildings) {
        if (rectOverlap(b.x, b.y, b.w, b.h, pr.x0, pr.y0, pw, ph, 0)) toDel.push(b);
      }
      for (const b of toDel) removeBuildingAndProps(b);
    } catch (_) {}
  })();

  // Ensure props container exists before any early prop placement (e.g., shop signs)
  ctx.townProps = Array.isArray(ctx.townProps) ? ctx.townProps : [];
  ctx.shops = [];
  // Integrate prefab-declared shops: resolve schedules, add signs, and mark buildings as used.
  (function integratePrefabShops() {
    try {
      // Helper: find matching shop def by type from GameData.shops
      function findShopDefByType(type) {
        try {
          const defs = (typeof window !== "undefined" && window.GameData && Array.isArray(window.GameData.shops)) ? window.GameData.shops : null;
          if (!defs) return null;
          const tkey = String(type || "").toLowerCase();
          return defs.find(d => String(d.type || "").toLowerCase() === tkey) || null;
        } catch (_) { return null; }
      }
      function parseHHMMToMinutes(s) {
        if (!s || typeof s !== "string") return null;
        const m = s.match(/^(\d{1,2}):(\d{2})$/);
        if (!m) return null;
        const h = Math.max(0, Math.min(23, parseInt(m[1], 10) || 0));
        const min = Math.max(0, Math.min(59, parseInt(m[2], 10) || 0));
        return ((h | 0) * 60 + (min | 0)) % (24 * 60);
      }
      function scheduleForType(type) {
        const def = findShopDefByType(type);
        if (!def) return { openMin: ((8|0)*60), closeMin: ((18|0)*60), alwaysOpen: false };
        if (def.alwaysOpen) return { openMin: 0, closeMin: 0, alwaysOpen: true };
        const o = parseHHMMToMinutes(def.open);
        const c = parseHHMMToMinutes(def.close);
        if (o == null || c == null) return { openMin: ((8|0)*60), closeMin: ((18|0)*60), alwaysOpen: false };
        return { openMin: o, closeMin: c, alwaysOpen: false };
      }

      for (const ps of prefabShops) {
        if (!ps || !ps.building) continue;
        // Add shop entry
        let sched = scheduleForType(ps.type);
        // Apply prefab schedule override when present
        if (ps.scheduleOverride) {
          const o = parseHHMMToMinutes(ps.scheduleOverride.open);
          const c = parseHHMMToMinutes(ps.scheduleOverride.close);
          if (ps.scheduleOverride.alwaysOpen) {
            sched = { openMin: 0, closeMin: 0, alwaysOpen: true };
          } else {
            if (o != null && c != null) {
              sched = { openMin: o, closeMin: c, alwaysOpen: false };
            }
          }
        }
        const name = ps.name || ps.type || "Shop";
        // Compute an inside tile near the door
        const inward = [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
        let inside = null;
        for (const dxy of inward) {
          const ix = ps.door.x + dxy.dx, iy = ps.door.y + dxy.dy;
          const insideB = (ix > ps.building.x && ix < ps.building.x + ps.building.w - 1 && iy > ps.building.y && iy < ps.building.y + ps.building.h - 1);
          if (insideB && ctx.map[iy][ix] === ctx.TILES.FLOOR) { inside = { x: ix, y: iy }; break; }
        }
        if (!inside) {
          const cx = Math.max(ps.building.x + 1, Math.min(ps.building.x + ps.building.w - 2, Math.floor(ps.building.x + ps.building.w / 2)));
          const cy = Math.max(ps.building.y + 1, Math.min(ps.building.y + ps.building.h - 2, Math.floor(ps.building.y + ps.building.h / 2)));
          inside = { x: cx, y: cy };
        }

        ctx.shops.push({
          x: ps.door.x,
          y: ps.door.y,
          type: ps.type || "shop",
          name,
          openMin: sched.openMin,
          closeMin: sched.closeMin,
          alwaysOpen: !!sched.alwaysOpen,
          building: { x: ps.building.x, y: ps.building.y, w: ps.building.w, h: ps.building.h, door: { x: ps.door.x, y: ps.door.y } },
          inside
        });
        try { addShopSign(ps.building, { x: ps.door.x, y: ps.door.y }, name); } catch (_) {}
      }
    } catch (_) {}
  })();

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

  // Shop definitions: disable data-assigned shops only when strict prefabs are available
  let shopDefs = strictNow
    ? []
    : ((typeof window !== "undefined" && window.GameData && Array.isArray(window.GameData.shops)) ? window.GameData.shops.slice(0) : [
        { type: "inn", name: "Inn", alwaysOpen: true },
        { type: "blacksmith", name: "Blacksmith", open: "08:00", close: "17:00" },
        { type: "apothecary", name: "Apothecary", open: "09:00", close: "18:00" },
        { type: "armorer", name: "Armorer", open: "08:00", close: "17:00" },
        { type: "trader", name: "Trader", open: "08:00", close: "18:00" },
      ]);
  try {
    const idxInn = shopDefs.findIndex(d => String(d.type || "").toLowerCase() === "inn" || /inn/i.test(String(d.name || "")));
    if (idxInn > 0) {
      const innDef = shopDefs.splice(idxInn, 1)[0];
      shopDefs.unshift(innDef);
    }
  } catch (_) {}

  // Score buildings by distance to plaza and assign shops to closest buildings
  const scored = buildings.map(b => ({ b, d: Math.abs((b.x + ((b.w / 2))) - plaza.x) + Math.abs((b.y + ((b.h / 2))) - plaza.y) }));
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
      const j = Math.floor(rng() * (i + 1));
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
    if (rng() < ch) sampled.push(d);
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
      let best = null, bestD2 = Infinity;
      for (const d of cds) {
        if (inBounds(ctx, d.x, d.y) && ctx.map[d.y][d.x] === ctx.TILES.DOOR) {
          const dd = Math.abs(d.x - plaza.x) + Math.abs(d.y - plaza.y);
          if (dd < bestD2) { bestD2 = dd; best = { x: d.x, y: d.y }; }
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

  // No fallback Inn shop creation; rely on prefab or data-driven shop assignments
  try {
    const hasInn = Array.isArray(ctx.shops) && ctx.shops.some(s => (String(s.type || "").toLowerCase() === "inn") || (/inn/i.test(String(s.name || ""))));
    if (!hasInn) {
      try { if (ctx && typeof ctx.log === "function") ctx.log("No Inn shop integrated (prefab-only).", "notice"); } catch (_) {}
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
        (function assignInnTavern() {
          try {
            const doorX = (innShop.building && innShop.building.door && typeof innShop.building.door.x === "number") ? innShop.building.door.x : innShop.x;
            const doorY = (innShop.building && innShop.building.door && typeof innShop.building.door.y === "number") ? innShop.building.door.y : innShop.y;
            ctx.tavern = {
              building: { x: innShop.building.x, y: innShop.building.y, w: innShop.building.w, h: innShop.building.h },
              door: { x: doorX, y: doorY }
            };
          } catch (_) {
            ctx.tavern = { building: { x: innShop.building.x, y: innShop.building.y, w: innShop.building.w, h: innShop.building.h }, door: { x: innShop.x, y: innShop.y } };
          }
        })();
        ctx.inn = ctx.tavern;
      }
    }
  } catch (_) {}

  // Cleanup dangling props from removed buildings: ensure interior-only props are only inside valid buildings
  (function cleanupDanglingProps() {
    try {
      if (!Array.isArray(ctx.townProps) || !ctx.townProps.length) return;
      function insideAnyBuilding(x, y) {
        for (let i = 0; i < buildings.length; i++) {
          const B = buildings[i];
          if (x > B.x && x < B.x + B.w - 1 && y > B.y && y < B.y + B.h - 1) return true;
        }
        return false;
      }
      // Props that should never exist outside a building interior
      const interiorOnly = new Set(["bed","table","chair","shelf","rug","fireplace","quest_board","chest"]);
      ctx.townProps = ctx.townProps.filter(p => {
        if (!inBounds(ctx, p.x, p.y)) return false;
        const t = ctx.map[p.y][p.x];
        // Drop props that sit on non-walkable tiles
        if (t !== ctx.TILES.FLOOR && t !== ctx.TILES.STAIRS) return false;
        const inside = insideAnyBuilding(p.x, p.y);
        // Interior-only items: keep only if inside some building
        if (interiorOnly.has(String(p.type || "").toLowerCase())) return inside;
        // Signs: keep only if outside buildings
        if (String(p.type || "").toLowerCase() === "sign") return !inside;
        // Other props (crates/barrels/plants/stall) are allowed anywhere if tile is walkable
        return true;
      });
    } catch (_) {}
  })();

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
      for (let i = 0; i < dirs.length; i++) {
        const nx = x + dirs[i].dx, ny = y + dirs[i].dy;
        if (!inBounds(ctx, nx, ny)) continue;
        if (ctx.map[ny][nx] === ctx.TILES.DOOR) return true;
      }
      return false;
    }
    for (let bi = 0; bi < buildings.length; bi++) {
      const b = buildings[bi];
      // Skip window auto-placement for prefab-stamped buildings; rely on prefab WINDOW tiles
      if (b && b.prefabId) continue;
      const tavB = (ctx.tavern && ctx.tavern.building) ? ctx.tavern.building : null;
      const isTavernBld = !!(tavB && b.x === tavB.x && b.y === tavB.y && b.w === tavB.w && b.h === tavB.h);
      let candidates = [];
      const sides = sidePoints(b);
      for (let si = 0; si < sides.length; si++) {
        const pts = sides[si];
        for (let pi = 0; pi < pts.length; pi++) {
          const p = pts[pi];
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
        const idx = Math.floor(((typeof ctx.rng === "function") ? ctx.rng() : Math.random()) * candidates.length);
        const p = candidates[idx];
        // Keep spacing: avoid placing next to already placed windows
        let adjacent = false;
        for (let j = 0; j < placed.length; j++) {
          if (isAdjacent(p, placed[j])) { adjacent = true; break; }
        }
        if (adjacent) {
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

  // Repair pass: enforce solid building perimeters (convert any non-door/window on borders to WALL)
  (function repairBuildingPerimeters() {
    try {
      for (const b of buildings) {
        const x0 = b.x, y0 = b.y, x1 = b.x + b.w - 1, y1 = b.y + b.h - 1;
        // Top and bottom edges
        for (let xx = x0; xx <= x1; xx++) {
          if (inBounds(ctx, xx, y0)) {
            const t = ctx.map[y0][xx];
            if (t !== ctx.TILES.DOOR && t !== ctx.TILES.WINDOW) ctx.map[y0][xx] = ctx.TILES.WALL;
          }
          if (inBounds(ctx, xx, y1)) {
            const t = ctx.map[y1][xx];
            if (t !== ctx.TILES.DOOR && t !== ctx.TILES.WINDOW) ctx.map[y1][xx] = ctx.TILES.WALL;
          }
        }
        // Left and right edges
        for (let yy = y0; yy <= y1; yy++) {
          if (inBounds(ctx, x0, yy)) {
            const t = ctx.map[yy][x0];
            if (t !== ctx.TILES.DOOR && t !== ctx.TILES.WINDOW) ctx.map[yy][x0] = ctx.TILES.WALL;
          }
          if (inBounds(ctx, x1, yy)) {
            const t = ctx.map[yy][x1];
            if (t !== ctx.TILES.DOOR && t !== ctx.TILES.WINDOW) ctx.map[yy][x1] = ctx.TILES.WALL;
          }
        }
      }
    } catch (_) {}
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
        const b = tbs[Math.floor(rng() * tbs.length)];
        const hx = Math.max(b.x + 1, Math.min(b.x + b.w - 2, (b.x + ((b.w / 2) | 0))));
        const hy = Math.max(b.y + 1, Math.min(b.y + b.h - 2, (b.y + ((b.h / 2) | 0))));
        const door = (b && b.door && typeof b.door.x === "number" && typeof b.door.y === "number") ? { x: b.door.x, y: b.door.y } : null;
        homeRef = { building: b, x: hx, y: hy, door };
      }
    } catch (_) {}
    ctx.npcs.push({ x, y, name: `Villager ${placed + 1}`, lines, _likesInn: rng() < 0.45, _home: homeRef });
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

    