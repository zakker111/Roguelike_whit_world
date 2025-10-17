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
  const map = Array.from({ length: H }, () => Array(W).fill(T.FLOOR));
  // Simple border walls to bound the play area
  for (let x = 0; x < W; x++) { map[0][x] = T.WALL; map[H - 1][x] = T.WALL; }
  for (let y = 0; y < H; y++) { map[y][0] = T.WALL; map[y][W - 1] = T.WALL; }

  ctx.map = map;
  ctx.seen = Array.from({ length: H }, () => Array(W).fill(false));
  ctx.visible = Array.from({ length: H }, () => Array(W).fill(false));
  ctx.enemies = [];
  ctx.corpses = [];
  ctx.decals = [];

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

  // Place enemies around edges moving inward until placed
  let ring = 0, placed = 0;
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
    // Reuse dungeon combat path: try to step into enemy triggers attack via DungeonRuntime.tryMoveDungeon fallback
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

  // Move if free floor
  const walkable = (ctx.isWalkable ? ctx.isWalkable(nx, ny) : true);
  const blocked = Array.isArray(ctx.enemies) && ctx.enemies.some(e => e && e.x === nx && e.y === ny);
  if (walkable && !blocked) {
    ctx.player.x = nx; ctx.player.y = ny;
    try { ctx.updateCamera && ctx.updateCamera(); } catch (_) {}
    try { ctx.turn && ctx.turn(); } catch (_) {}
    return true;
  }
  return false;
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