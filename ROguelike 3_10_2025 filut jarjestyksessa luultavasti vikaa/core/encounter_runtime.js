/**
 * EncounterRuntime: compact, single-scene skirmishes triggered from overworld.
 *
 * Exports (ESM + window.EncounterRuntime):
 * - enter(ctx, info): switches to encounter mode and generates a tactical map
 * - tryMoveEncounter(ctx, dx, dy): movement during encounter (bump to attack)
 * - tick(ctx): drives AI and completes encounter on kill-all
 */
export function enter(ctx, info) {
  if (!ctx || !ctx.world || !ctx.world.map) return false;
  const template = info && info.template ? info.template : { id: "ambush_forest", name: "Ambush", map: { w: 24, h: 16 }, groups: [ { type: "bandit", count: { min: 2, max: 3 } } ] };

  // Remember return position in overworld
  const worldX = ctx.player.x | 0;
  const worldY = ctx.player.y | 0;
  ctx.worldReturnPos = { x: worldX, y: worldY };

  // Switch to encounter mode and build a small tactical map
  const W = Math.max(18, Math.min(60, (template.map && template.map.w) ? template.map.w : 24));
  const H = Math.max(12, Math.min(40, (template.map && template.map.h) ? template.map.h : 16));

  ctx.mode = "encounter";
  // Use dungeon-style tiles (Render falls back to dungeon renderer for unknown modes)
  const T = ctx.TILES;

  // Simple generator set for varied arenas (kept intentionally minimal)
  function genEmpty() {
    const m = Array.from({ length: H }, () => Array(W).fill(T.FLOOR));
    for (let x = 0; x < W; x++) { m[0][x] = T.WALL; m[H - 1][x] = T.WALL; }
    for (let y = 0; y < H; y++) { m[y][0] = T.WALL; m[y][W - 1] = T.WALL; }
    return m;
  }
  function genAmbushForest(rng) {
    const m = genEmpty();
    const clusters = Math.max(3, Math.floor((W * H) / 80));
    for (let i = 0; i < clusters; i++) {
      const cx = 2 + Math.floor((rng() * (W - 4)));
      const cy = 2 + Math.floor((rng() * (H - 4)));
      const r = 1 + Math.floor(rng() * 2); // radius 1..2
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) continue;
          if ((dx*dx + dy*dy) <= (r*r) && rng() < 0.85) m[y][x] = T.WALL; // tree clump
        }
      }
    }
    // Clear a circle around center so player has breathing room
    const px = (W / 2) | 0, py = (H / 2) | 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = px + dx, y = py + dy;
        if (x > 0 && y > 0 && x < W - 1 && y < H - 1) m[y][x] = T.FLOOR;
      }
    }
    return m;
  }
  function genCamp(rng) {
    const m = genEmpty();
    // Place 2–4 small huts (3x3 walls with one door)
    const huts = 2 + Math.floor(rng() * 3);
    const taken = [];
    for (let i = 0; i < huts; i++) {
      let tries = 0;
      while (tries++ < 80) {
        const x0 = 2 + Math.floor(rng() * (W - 5));
        const y0 = 2 + Math.floor(rng() * (H - 5));
        // avoid overlapping centers
        if (taken.some(t => Math.abs(t.x - x0) < 4 && Math.abs(t.y - y0) < 4)) continue;
        taken.push({ x: x0, y: y0 });
        for (let x = x0; x < x0 + 3; x++) { m[y0][x] = T.WALL; m[y0 + 2][x] = T.WALL; }
        for (let y = y0; y < y0 + 3; y++) { m[y][x0] = T.WALL; m[y][x0 + 2] = T.WALL; }
        // carve a random door
        const side = Math.floor(rng() * 4);
        if (side === 0) m[y0][x0 + 1] = T.DOOR;
        else if (side === 1) m[y0 + 2][x0 + 1] = T.DOOR;
        else if (side === 2) m[y0 + 1][x0] = T.DOOR;
        else m[y0 + 1][x0 + 2] = T.DOOR;
        break;
      }
    }
    // Add a campfire clearing in center
    const px = (W / 2) | 0, py = (H / 2) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m[py + dy][px + dx] = T.FLOOR;
    return m;
  }
  function genRuins(rng) {
    const m = genEmpty();
    // Scatter short wall segments
    const segs = Math.max(4, Math.floor((W + H) / 6));
    for (let i = 0; i < segs; i++) {
      const len = 2 + Math.floor(rng() * 5);
      const x0 = 2 + Math.floor(rng() * (W - 4));
      const y0 = 2 + Math.floor(rng() * (H - 4));
      const horiz = rng() < 0.5;
      for (let k = 0; k < len; k++) {
        const x = x0 + (horiz ? k : 0);
        const y = y0 + (horiz ? 0 : k);
        if (x > 0 && y > 0 && x < W - 1 && y < H - 1) m[y][x] = T.WALL;
      }
    }
    // Clear spawn pocket
    const px = (W / 2) | 0, py = (H / 2) | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = px + dx, y = py + dy;
      if (x > 0 && y > 0 && x < W - 1 && y < H - 1) m[y][x] = T.FLOOR;
    }
    return m;
  }
  function genArena(rng) {
    const m = genEmpty();
    // Plus-shaped barriers
    const cx = (W / 2) | 0, cy = (H / 2) | 0;
    for (let x = 2; x < W - 2; x++) { if (Math.abs(x - cx) > 1) m[cy][x] = T.WALL; }
    for (let y = 2; y < H - 2; y++) { if (Math.abs(y - cy) > 1) m[y][cx] = T.WALL; }
    // Open few gaps
    m[cy][2 + Math.floor(rng() * Math.max(1, cx - 3))] = T.DOOR;
    m[cy][(W - 3) - Math.floor(rng() * Math.max(1, cx - 3))] = T.DOOR;
    m[2 + Math.floor(rng() * Math.max(1, cy - 3))][cx] = T.DOOR;
    m[(H - 3) - Math.floor(rng() * Math.max(1, cy - 3))][cx] = T.DOOR;
    return m;
  }

  const r = (typeof ctx.rng === "function") ? ctx.rng : Math.random;
  const genId = (template && template.map && template.map.generator) ? String(template.map.generator) : "";
  let map = null;
  const id = genId.toLowerCase();
  if (id === "ambush_forest" || id === "ambush" || id === "forest") map = genAmbushForest(r);
  else if (id === "camp" || id === "bandit_camp" || id === "camp_small") map = genCamp(r);
  else if (id === "ruins" || id === "ruin") map = genRuins(r);
  else if (id === "arena" || id === "cross") map = genArena(r);
  else map = genEmpty();

  ctx.map = map;
  ctx.seen = Array.from({ length: H }, () => Array(W).fill(false));
  ctx.visible = Array.from({ length: H }, () => Array(W).fill(false));
  ctx.enemies = [];
  ctx.corpses = [];
  ctx.decals = [];

  // Add simple exit tiles near each edge so the player can always walk out.
  // These use the STAIRS tile, consistent with dungeon exit semantics.
  try {
    const cx = (W / 2) | 0, cy = (H / 2) | 0;
    const exits = [
      { x: 1, y: cy },            // West edge
      { x: W - 2, y: cy },        // East edge
      { x: cx, y: 1 },            // North edge
      { x: cx, y: H - 2 },        // South edge
    ];
    for (const e of exits) {
      if (e.x > 0 && e.y > 0 && e.x < W - 1 && e.y < H - 1) {
        map[e.y][e.x] = T.STAIRS;
        // Ensure a small clearing around the exit so it's accessible
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x = e.x + dx, y = e.y + dy;
            if (x > 0 && y > 0 && x < W - 1 && y < H - 1) {
              if (map[y][x] === T.WALL) map[y][x] = T.FLOOR;
            }
          }
        }
      }
    }
  } catch (_) {}

  // Spawn player near center
  const px = (W / 2) | 0, py = (H / 2) | 0;
  ctx.player.x = px; ctx.player.y = py;

  // Spawn enemies per template groups
  const groups = Array.isArray(template.groups) ? template.groups : [];
  const totalWanted = groups.reduce((acc, g) => {
    const min = (g && g.count && typeof g.count.min === "number") ? g.count.min : 1;
    const max = (g && g.count && typeof g.count.max === "number") ? g.count.max : Math.max(1, min + 2);
    const n = Math.max(min, Math.min(max, min + Math.floor(((ctx.rng ? ctx.rng() : Math.random()) * (max - min + 1)))));
    return acc + n;
  }, 0);

  const placements = [];
  function free(x, y) {
    if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return false;
    if (x === ctx.player.x && y === ctx.player.y) return false;
    if (placements.some(p => p.x === x && p.y === y)) return false;
    return map[y][x] === T.FLOOR;
    }

  // Seed at least one placement near the player within FOV range to ensure visibility
  (function seedNearPlayer() {
    try {
      const px = (ctx.player.x | 0), py = (ctx.player.y | 0);
      const maxR = Math.max(3, Math.min(6, ((ctx.fovRadius | 0) || 8) - 1));
      outer:
      for (let r = 2; r <= maxR; r++) {
        const dirs = [
          [ r,  0], [ 0,  r], [-r,  0], [ 0, -r],
          [ r,  1], [ 1,  r], [-1,  r], [-r,  1],
          [-r, -1], [-1, -r], [ 1, -r], [ r, -1],
          [ r,  2], [ 2,  r], [-2,  r], [-r,  2],
        ];
        for (const d of dirs) {
          const x = px + d[0], y = py + d[1];
          if (free(x, y)) { placements.push({ x, y }); break outer; }
        }
      }
    } catch (_) {}
  })();

  // Place enemies around edges moving inward until placed
  let ring = 0, placed = placements.length | 0;
  while (placed < totalWanted && ring < Math.max(W, H)) {
    for (let x = 1 + ring; x < W - 1 - ring && placed < totalWanted; x++) {
      const y1 = 1 + ring, y2 = H - 2 - ring;
      if (free(x, y1)) { placements.push({ x, y: y1 }); placed++; }
      if (placed >= totalWanted) break;
      if (free(x, y2)) { placements.push({ x, y: y2 }); placed++; }
    }
    for (let y = 2 + ring; y < H - 2 - ring && placed < totalWanted; y++) {
      const x1 = 1 + ring, x2 = W - 2 - ring;
      if (free(x1, y)) { placements.push({ x: x1, y }); placed++; }
      if (placed >= totalWanted) break;
      if (free(x2, y)) { placements.push({ x: x2, y }); placed++; }
    }
    ring++;
  }

  // Materialize enemies with enemyFactory
  let pIdx = 0;
  const depth = Math.max(1, (ctx.floor | 0) || 1);
  for (const g of groups) {
    const type = g.type || "goblin";
    const min = (g && g.count && typeof g.count.min === "number") ? g.count.min : 1;
    const max = (g && g.count && typeof g.count.max === "number") ? g.count.max : Math.max(1, min + 2);
    const n = Math.max(min, Math.min(max, min + Math.floor(((ctx.rng ? ctx.rng() : Math.random()) * (max - min + 1)))));
    for (let i = 0; i < n && pIdx < placements.length; i++) {
      const p = placements[pIdx++];
      const e = (typeof ctx.enemyFactory === "function") ? ctx.enemyFactory(p.x, p.y, depth) : { x: p.x, y: p.y, type: type, hp: 4, atk: 1, xp: 6, level: depth };
      e.type = type || e.type || "goblin";
      ctx.enemies.push(e);
    }
  }

  // Recompute visibility, occupancy, and center camera
  try { ctx.recomputeFOV && ctx.recomputeFOV(); } catch (_) {}
  try {
    const OG = ctx.OccupancyGrid || (typeof window !== "undefined" ? window.OccupancyGrid : null);
    if (OG && typeof OG.build === "function") {
      ctx.occupancy = OG.build({ map: ctx.map, enemies: ctx.enemies, npcs: ctx.npcs, props: ctx.townProps, player: ctx.player });
    }
  } catch (_) {}
  try { ctx.updateCamera && ctx.updateCamera(); } catch (_) {}
  try { ctx.updateUI && ctx.updateUI(); } catch (_) {}
  try { ctx.requestDraw && ctx.requestDraw(); } catch (_) {}

  try { ctx.log && ctx.log(`${template.name || "Encounter"} begins: eliminate the hostiles.`, "notice"); } catch (_) {}
  ctx.encounterInfo = { id: template.id, name: template.name || "Encounter" };
  return true;
}

export function tryMoveEncounter(ctx, dx, dy) {
  if (!ctx || ctx.mode !== "encounter") return false;
  const nx = ctx.player.x + (dx | 0);
  const ny = ctx.player.y + (dy | 0);
  if (!(ctx.inBounds && ctx.inBounds(nx, ny))) return false;

  // Attack if enemy occupies target
  let enemy = null;
  try { enemy = Array.isArray(ctx.enemies) ? ctx.enemies.find(e => e && e.x === nx && e.y === ny) : null; } catch (_) { enemy = null; }
  if (enemy) {
    // Prefer Combat via ctx-first path
    const C = ctx.Combat || (typeof window !== "undefined" ? window.Combat : null);
    if (C && typeof C.playerAttackEnemy === "function") {
      try { C.playerAttackEnemy(ctx, enemy); } catch (_) {}
      ctx.turn && ctx.turn();
      return true;
    }
    // Minimal fallback: push damage via game helpers
    try {
      const loc = { part: "torso", mult: 1.0, blockMod: 1.0, critBonus: 0.0 };
      const blockChance = (typeof ctx.getEnemyBlockChance === "function") ? ctx.getEnemyBlockChance(enemy, loc) : 0;
      const rb = (typeof ctx.rng === "function") ? ctx.rng() : Math.random();
      if (rb < blockChance) {
        ctx.log && ctx.log(`${(enemy.type || "enemy")} blocks your attack.`, "block");
      } else {
        const atk = (typeof ctx.getPlayerAttack === "function") ? ctx.getPlayerAttack() : 1;
        const dmg = Math.max(0.1, Math.round(atk * 10) / 10);
        enemy.hp -= dmg;
        ctx.log && ctx.log(`You hit the ${(enemy.type || "enemy")} for ${dmg}.`);
        if (enemy.hp <= 0 && typeof ctx.onEnemyDied === "function") ctx.onEnemyDied(enemy);
      }
    } catch (_) {}
    ctx.turn && ctx.turn();
    return true;
  }

  // Move if free floor (auto-exit if stepping onto an exit tile)
  const T = ctx.TILES || {};
  const walkable = (ctx.isWalkable ? ctx.isWalkable(nx, ny) : true);
  const blocked = Array.isArray(ctx.enemies) && ctx.enemies.some(e => e && e.x === nx && e.y === ny);
  if (walkable && !blocked) {
    const isExit = (Array.isArray(ctx.map) && ctx.map[ny] && ctx.map[ny][nx] === T.STAIRS);
    ctx.player.x = nx; ctx.player.y = ny;
    try { ctx.updateCamera && ctx.updateCamera(); } catch (_) {}
    if (isExit) {
      try {
        complete(ctx, "withdraw");
      } catch (_) {
        try { ctx.turn && ctx.turn(); } catch (_) {}
      }
    } else {
      try { ctx.turn && ctx.turn(); } catch (_) {}
    }
    return true;
  }
  return false;
}

// Start an encounter within the existing Region Map mode (ctx.mode === "region").
// Spawns enemies on the current region sample without changing mode or map.
export function enterRegion(ctx, info) {
  if (!ctx || ctx.mode !== "region" || !ctx.map || !Array.isArray(ctx.map) || !ctx.map.length) return false;
  const template = info && info.template ? info.template : { id: "ambush_forest", name: "Ambush", groups: [ { type: "bandit", count: { min: 2, max: 3 } } ] };

  const WT = (typeof window !== "undefined" && window.World && window.World.TILES) ? window.World.TILES : (ctx.World && ctx.World.TILES) ? ctx.World.TILES : null;
  const isWalkableWorld = (typeof window !== "undefined" && window.World && typeof window.World.isWalkable === "function")
    ? window.World.isWalkable
    : (ctx.World && typeof ctx.World.isWalkable === "function") ? ctx.World.isWalkable : null;

  const H = ctx.map.length;
  const W = ctx.map[0] ? ctx.map[0].length : 0;
  if (!W || !H) return false;

  // Initialize encounter state on region
  if (!Array.isArray(ctx.enemies)) ctx.enemies = [];
  ctx.corpses = Array.isArray(ctx.corpses) ? ctx.corpses : [];

  // Helper: free spawn spot (walkable region tile, not on player, not duplicate)
  const placements = [];
  function walkableAt(x, y) {
    if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return false;
    const t = ctx.map[y][x];
    if (isWalkableWorld) return !!isWalkableWorld(t);
    if (!WT) return true;
    // Fallback: avoid water/river/mountain
    return !(t === WT.WATER || t === WT.RIVER || t === WT.MOUNTAIN);
  }
  function free(x, y) {
    if (!walkableAt(x, y)) return false;
    if (x === (ctx.player.x | 0) && y === (ctx.player.y | 0)) return false;
    if (placements.some(p => p.x === x && p.y === y)) return false;
    return true;
  }

  // Determine total enemies from groups
  const groups = Array.isArray(template.groups) ? template.groups : [];
  const totalWanted = groups.reduce((acc, g) => {
    const min = (g && g.count && typeof g.count.min === "number") ? g.count.min : 1;
    const max = (g && g.count && typeof g.count.max === "number") ? g.count.max : Math.max(1, min + 2);
    const n = Math.max(min, Math.min(max, min + Math.floor(((ctx.rng ? ctx.rng() : Math.random()) * (max - min + 1)))));
    return acc + n;
  }, 0);

  // Seed at least one placement near the player within FOV range to ensure visibility
  (function seedNearPlayer() {
    try {
      const px = (ctx.player.x | 0), py = (ctx.player.y | 0);
      const maxR = Math.max(3, Math.min(6, ((ctx.fovRadius | 0) || 8) - 1));
      outer:
      for (let r = 2; r <= maxR; r++) {
        // Sample 16 directions around the ring
        const dirs = [
          [ r,  0], [ 0,  r], [-r,  0], [ 0, -r],
          [ r,  1], [ 1,  r], [-1,  r], [-r,  1],
          [-r, -1], [-1, -r], [ 1, -r], [ r, -1],
          [ r,  2], [ 2,  r], [-2,  r], [-r,  2],
        ];
        for (const d of dirs) {
          const x = px + d[0], y = py + d[1];
          if (free(x, y)) { placements.push({ x, y }); break outer; }
        }
      }
    } catch (_) {}
  })();

  // Collect edge-ring placements inward to avoid spawning adjacent to player
  let ring = 0, placed = placements.length | 0;
  while (placed < totalWanted && ring < Math.max(W, H)) {
    for (let x = 1 + ring; x < W - 1 - ring && placed < totalWanted; x++) {
      const y1 = 1 + ring, y2 = H - 2 - ring;
      if (free(x, y1)) { placements.push({ x, y: y1 }); placed++; }
      if (placed >= totalWanted) break;
      if (free(x, y2)) { placements.push({ x, y: y2 }); placed++; }
    }
    for (let y = 2 + ring; y < H - 2 - ring && placed < totalWanted; y++) {
      const x1 = 1 + ring, x2 = W - 2 - ring;
      if (free(x1, y)) { placements.push({ x: x1, y }); placed++; }
      if (placed >= totalWanted) break;
      if (free(x2, y)) { placements.push({ x: x2, y }); placed++; }
    }
    ring++;
  }

  // Materialize enemies
  let pIdx = 0;
  const depth = Math.max(1, (ctx.floor | 0) || 1);
  for (const g of groups) {
    const type = g.type || "goblin";
    const min = (g && g.count && typeof g.count.min === "number") ? g.count.min : 1;
    const max = (g && g.count && typeof g.count.max === "number") ? g.count.max : Math.max(1, min + 2);
    const n = Math.max(min, Math.min(max, min + Math.floor(((ctx.rng ? ctx.rng() : Math.random()) * (max - min + 1)))));
    for (let i = 0; i < n && pIdx < placements.length; i++) {
      const p = placements[pIdx++];
      const e = (typeof ctx.enemyFactory === "function") ? ctx.enemyFactory(p.x, p.y, depth) : { x: p.x, y: p.y, type: type, hp: 4, atk: 1, xp: 6, level: depth };
      e.type = type || e.type || "goblin";
      ctx.enemies.push(e);
    }
  }

  // Build occupancy for region map
  try {
    const OG = ctx.OccupancyGrid || (typeof window !== "undefined" ? window.OccupancyGrid : null);
    if (OG && typeof OG.build === "function") {
      ctx.occupancy = OG.build({ map: ctx.map, enemies: ctx.enemies, npcs: ctx.npcs, props: ctx.townProps, player: ctx.player });
    }
  } catch (_) {}

  // Mark encounter-active in region and notify
  try { ctx.log && ctx.log(`${template.name || "Encounter"} begins here.`, "notice"); } catch (_) {}
  ctx.encounterInfo = { id: template.id, name: template.name || "Encounter" };
  if (!ctx.region) ctx.region = {};
  ctx.region._isEncounter = true;

  try { ctx.updateUI && ctx.updateUI(); } catch (_) {}
  try { ctx.requestDraw && ctx.requestDraw(); } catch (_) {}
  return true;
}

export function complete(ctx, outcome = "victory") {
  if (!ctx || ctx.mode !== "encounter") return false;
  // Return to the overworld
  ctx.mode = "world";
  if (ctx.world && ctx.world.map) {
    ctx.map = ctx.world.map;
    const rows = ctx.map.length, cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
    ctx.seen = Array.from({ length: rows }, () => Array(cols).fill(true));
    ctx.visible = Array.from({ length: rows }, () => Array(cols).fill(true));
  }
  // Restore player to the entry tile
  try {
    const pos = ctx.worldReturnPos || null;
    if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
      ctx.player.x = pos.x; ctx.player.y = pos.y;
    }
  } catch (_) {}
  try { ctx.updateCamera && ctx.updateCamera(); } catch (_) {}
  try { ctx.recomputeFOV && ctx.recomputeFOV(); } catch (_) {}
  try {
    if (outcome === "victory") ctx.log && ctx.log("You prevail and return to the overworld.", "good");
    else ctx.log && ctx.log("You withdraw and return to the overworld.", "info");
  } catch (_) {}
  try { ctx.updateUI && ctx.updateUI(); } catch (_) {}
  try { ctx.requestDraw && ctx.requestDraw(); } catch (_) {}
  ctx.encounterInfo = null;
  return true;
}

export function tick(ctx) {
  if (!ctx || ctx.mode !== "encounter") return false;
  // Drive AI using the same path as dungeon mode
  try {
    const AIH = ctx.AI || (typeof window !== "undefined" ? window.AI : null);
    if (AIH && typeof AIH.enemiesAct === "function") {
      AIH.enemiesAct(ctx);
    }
  } catch (_) {}
  // Rebuild occupancy to reflect enemy movement
  try {
    const OG = ctx.OccupancyGrid || (typeof window !== "undefined" ? window.OccupancyGrid : null);
    if (OG && typeof OG.build === "function") {
      ctx.occupancy = OG.build({ map: ctx.map, enemies: ctx.enemies, npcs: ctx.npcs, props: ctx.townProps, player: ctx.player });
    }
  } catch (_) {}
  // Check objective: killAll
  try {
    if (!Array.isArray(ctx.enemies) || ctx.enemies.length === 0) {
      complete(ctx, "victory");
      return true;
    }
  } catch (_) {}
  return true;
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.EncounterRuntime = { enter, tryMoveEncounter, tick, complete };
}