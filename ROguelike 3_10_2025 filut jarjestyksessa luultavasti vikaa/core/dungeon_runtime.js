/**
 * DungeonRuntime: generation and persistence glue for dungeon mode.
 *
 * Exports (ESM + window.DungeonRuntime):
 * - keyFromWorldPos(x, y)
 * - save(ctx, logOnce=false)
 * - load(ctx, x, y): returns boolean
 * - generate(ctx, depth=1)
 * - generateLoot(ctx, source)
 * - returnToWorldIfAtExit(ctx)
 * - killEnemy(ctx, enemy)
 * - enter(ctx, info)
 */

export function keyFromWorldPos(x, y) {
  // Use a stable string key; avoid coupling to external state modules
  return `${x},${y}`;
}

export function save(ctx, logOnce) {
  if (ctx.DungeonState && typeof ctx.DungeonState.save === "function") {
    try { if (typeof window !== "undefined" && window.DEV && logOnce) console.log("[TRACE] Calling ctx.DungeonState.save"); } catch (_) {}
    ctx.DungeonState.save(ctx);
    return;
  }
  if (typeof window !== "undefined" && window.DungeonState && typeof window.DungeonState.save === "function") {
    try { if (window.DEV && logOnce) console.log("[TRACE] Calling DungeonState.save"); } catch (_) {}
    window.DungeonState.save(ctx);
    return;
  }
  if (ctx.mode !== "dungeon" || !ctx.dungeonInfo || !ctx.dungeonExitAt) return;
  const key = keyFromWorldPos(ctx.dungeonInfo.x, ctx.dungeonInfo.y);
  ctx._dungeonStates[key] = {
    map: ctx.map,
    seen: ctx.seen,
    visible: ctx.visible,
    enemies: ctx.enemies,
    corpses: ctx.corpses,
    decals: ctx.decals,
    dungeonExitAt: { x: ctx.dungeonExitAt.x, y: ctx.dungeonExitAt.y },
    info: ctx.dungeonInfo,
    level: ctx.floor
  };
  if (logOnce && ctx.log) {
    try {
      const totalEnemies = Array.isArray(ctx.enemies) ? ctx.enemies.length : 0;
      const typeCounts = (() => {
        try {
          if (!Array.isArray(ctx.enemies) || ctx.enemies.length === 0) return "";
          const mapCounts = {};
          for (const e of ctx.enemies) {
            const t = (e && e.type) ? String(e.type) : "(unknown)";
            mapCounts[t] = (mapCounts[t] || 0) + 1;
          }
          const parts = Object.keys(mapCounts).sort().map(k => `${k}:${mapCounts[k]}`);
          return parts.join(", ");
        } catch (_) { return ""; }
      })();
      const msg = `Dungeon snapshot: enemies=${totalEnemies}${typeCounts ? ` [${typeCounts}]` : ""}, corpses=${Array.isArray(ctx.corpses)?ctx.corpses.length:0}`;
      ctx.log(msg, "notice");
    } catch (_) {}
  }
}

export function load(ctx, x, y) {
  if (ctx.DungeonState && typeof ctx.DungeonState.load === "function") {
    const ok = ctx.DungeonState.load(ctx, x, y);
    if (ok) {
      ctx.updateCamera && ctx.updateCamera();
      ctx.recomputeFOV && ctx.recomputeFOV();
      ctx.updateUI && ctx.updateUI();
      ctx.requestDraw && ctx.requestDraw();
    }
    return ok;
  }
  if (typeof window !== "undefined" && window.DungeonState && typeof window.DungeonState.load === "function") {
    const ok = window.DungeonState.load(ctx, x, y);
    if (ok) {
      ctx.updateCamera && ctx.updateCamera();
      ctx.recomputeFOV && ctx.recomputeFOV();
      ctx.updateUI && ctx.updateUI();
      ctx.requestDraw && ctx.requestDraw();
    }
    return ok;
  }
  const key = keyFromWorldPos(x, y);
  const st = ctx._dungeonStates[key];
  if (!st) return false;

  ctx.mode = "dungeon";
  ctx.dungeonInfo = st.info || { x, y, level: st.level || 1, size: "medium" };
  ctx.floor = st.level || 1;

  ctx.map = st.map;
  ctx.seen = st.seen;
  ctx.visible = st.visible;
  ctx.enemies = st.enemies;
  ctx.corpses = st.corpses;
  ctx.decals = st.decals || [];
  ctx.dungeonExitAt = st.dungeonExitAt || { x, y };

  // Place player at the entrance hole
  ctx.player.x = ctx.dungeonExitAt.x;
  ctx.player.y = ctx.dungeonExitAt.y;

  // Ensure the entrance tile is marked as stairs
  if (ctx.inBounds(ctx.dungeonExitAt.x, ctx.dungeonExitAt.y)) {
    ctx.map[ctx.dungeonExitAt.y][ctx.dungeonExitAt.x] = ctx.TILES.STAIRS;
    if (ctx.visible[ctx.dungeonExitAt.y]) ctx.visible[ctx.dungeonExitAt.y][ctx.dungeonExitAt.x] = true;
    if (ctx.seen[ctx.dungeonExitAt.y]) ctx.seen[ctx.dungeonExitAt.y][ctx.dungeonExitAt.x] = true;
  }

  ctx.recomputeFOV && ctx.recomputeFOV();
  ctx.updateCamera && ctx.updateCamera();
  ctx.updateUI && ctx.updateUI();
  ctx.requestDraw && ctx.requestDraw();
  return true;
}

export function generate(ctx, depth) {
  const D = (ctx && ctx.Dungeon) || (typeof window !== "undefined" ? window.Dungeon : null);
  if (D && typeof D.generateLevel === "function") {
    ctx.startRoomRect = ctx.startRoomRect || null;
    D.generateLevel(ctx, depth);
    // Clear decals on new floor
    ctx.decals = [];
    // FOV + Camera
    try { ctx.recomputeFOV && ctx.recomputeFOV(); } catch (_) {}
    try { ctx.updateCamera && ctx.updateCamera(); } catch (_) {}
    // Visibility sanity
    try {
      if (ctx.inBounds(ctx.player.x, ctx.player.y) && ctx.visible && !ctx.visible[ctx.player.y][ctx.player.x]) {
        ctx.log && ctx.log("FOV sanity check: player tile not visible after gen; recomputing.", "warn");
        ctx.recomputeFOV && ctx.recomputeFOV();
        if (ctx.inBounds(ctx.player.x, ctx.player.y)) {
          ctx.visible[ctx.player.y][ctx.player.x] = true;
          ctx.seen[ctx.player.y][ctx.player.x] = true;
        }
      }
    } catch (_) {}
    // Occupancy
    try {
      if (ctx.OccupancyGrid && typeof ctx.OccupancyGrid.build === "function") {
        ctx.occupancy = ctx.OccupancyGrid.build({ map: ctx.map, enemies: ctx.enemies, npcs: ctx.npcs, props: ctx.townProps, player: ctx.player });
      } else if (typeof window !== "undefined" && window.OccupancyGrid && typeof window.OccupancyGrid.build === "function") {
        ctx.occupancy = window.OccupancyGrid.build({ map: ctx.map, enemies: ctx.enemies, npcs: ctx.npcs, props: ctx.townProps, player: ctx.player });
      }
    } catch (_) {}
    // Dev counts
    try {
      if (window.DEV) {
        const visCount = ctx.enemies.filter(e => ctx.inBounds(e.x, e.y) && ctx.visible[e.y][e.x]).length;
        ctx.log && ctx.log(`[DEV] Enemies spawned: ${ctx.enemies.length}, visible now: ${visCount}.`, "notice");
      }
    } catch (_) {}
    // UI and message
    ctx.updateUI && ctx.updateUI();
    ctx.log && ctx.log("You explore the dungeon.");
    save(ctx, true);
    ctx.requestDraw && ctx.requestDraw();
    return true;
  }
  // Fallback: flat-floor
  const MAP_ROWS = ctx.MAP_ROWS || (ctx.map ? ctx.map.length : 80);
  const MAP_COLS = ctx.MAP_COLS || (ctx.map && ctx.map[0] ? ctx.map[0].length : 120);
  ctx.map = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(ctx.TILES.FLOOR));
  // One stair
  const sy = Math.max(1, MAP_ROWS - 2), sx = Math.max(1, MAP_COLS - 2);
  if (ctx.map[sy] && typeof ctx.map[sy][sx] !== "undefined") {
    ctx.map[sy][sx] = ctx.TILES.STAIRS;
  }
  ctx.enemies = [];
  ctx.corpses = [];
  ctx.decals = [];
  ctx.recomputeFOV && ctx.recomputeFOV();
  ctx.updateCamera && ctx.updateCamera();
  ctx.updateUI && ctx.updateUI();
  ctx.log && ctx.log("You explore the dungeon.");
  save(ctx, true);
  ctx.requestDraw && ctx.requestDraw();
  return true;
}

export function generateLoot(ctx, source) {
  try {
    if (ctx && ctx.Loot && typeof ctx.Loot.generate === "function") {
      return ctx.Loot.generate(ctx, source) || [];
    }
    if (typeof window !== "undefined" && window.Loot && typeof window.Loot.generate === "function") {
      return window.Loot.generate(ctx, source) || [];
    }
  } catch (_) {}
  return [];
}

export function returnToWorldIfAtExit(ctx) {
  if (!ctx || ctx.mode !== "dungeon" || !ctx.world) return false;
  const onExit =
    (ctx.dungeonExitAt &&
      ctx.player.x === ctx.dungeonExitAt.x &&
      ctx.player.y === ctx.dungeonExitAt.y) ||
    (ctx.inBounds && ctx.inBounds(ctx.player.x, ctx.player.y) &&
      ctx.map && ctx.map[ctx.player.y] &&
      ctx.map[ctx.player.y][ctx.player.x] === ctx.TILES.STAIRS);

  if (!onExit) return false;

  // Save state first
  try { save(ctx, false); } catch (_) {
    try { if (ctx.DungeonState && typeof ctx.DungeonState.save === "function") ctx.DungeonState.save(ctx); } catch (_) {}
    try { if (typeof window !== "undefined" && window.DungeonState && typeof window.DungeonState.save === "function") window.DungeonState.save(ctx); } catch (_) {}
  }

  // Switch to world and clear dungeon-only entities
  ctx.mode = "world";
  if (Array.isArray(ctx.enemies)) ctx.enemies.length = 0;
  if (Array.isArray(ctx.corpses)) ctx.corpses.length = 0;
  if (Array.isArray(ctx.decals)) ctx.decals.length = 0;

  // Use world map
  ctx.map = ctx.world.map;

  // Restore world position: prefer stored worldReturnPos; else dungeon entrance coordinates
  let rx = (ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number") ? ctx.worldReturnPos.x : null;
  let ry = (ctx.worldReturnPos && typeof ctx.worldReturnPos.y === "number") ? ctx.worldReturnPos.y : null;
  if (rx == null || ry == null) {
    const info = ctx.dungeon || ctx.dungeonInfo;
    if (info && typeof info.x === "number" && typeof info.y === "number") {
      rx = info.x; ry = info.y;
    }
  }
  // Clamp to bounds as a safety net
  try {
    if (rx == null || ry == null) {
      const cols = ctx.world.map[0].length;
      const rows = ctx.world.map.length;
      rx = Math.max(0, Math.min(cols - 1, ctx.player.x));
      ry = Math.max(0, Math.min(rows - 1, ctx.player.y));
    }
  } catch (_) {}

  ctx.player.x = rx; ctx.player.y = ry;

  // Recompute FOV and UI
  try {
    if (ctx.FOV && typeof ctx.FOV.recomputeFOV === "function") ctx.FOV.recomputeFOV(ctx);
    else if (ctx.recomputeFOV) ctx.recomputeFOV();
  } catch (_) {}
  try { ctx.updateUI && ctx.updateUI(); } catch (_) {}
  try { ctx.log && ctx.log("You climb back to the overworld.", "notice"); } catch (_) {}
  try { ctx.requestDraw && ctx.requestDraw(); } catch (_) {}

  return true;
}

export function lootHere(ctx) {
  if (!ctx || ctx.mode !== "dungeon") return false;

  // QoL: if adjacent to a corpse/chest, step onto it (only if not on exit)
  try {
    const onExit =
      (ctx.dungeonExitAt &&
        ctx.player.x === ctx.dungeonExitAt.x &&
        ctx.player.y === ctx.dungeonExitAt.y) ||
      (ctx.inBounds && ctx.inBounds(ctx.player.x, ctx.player.y) &&
        ctx.map && ctx.map[ctx.player.y] &&
        ctx.map[ctx.player.y][ctx.player.x] === ctx.TILES.STAIRS);

    if (!onExit) {
      const neighbors = [
        { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }
      ];
      const hereList = Array.isArray(ctx.corpses) ? ctx.corpses : [];
      let target = null;
      for (const d of neighbors) {
        const tx = ctx.player.x + d.dx, ty = ctx.player.y + d.dy;
        const c = hereList.find(c => c && c.x === tx && c.y === ty);
        if (c) { target = { x: tx, y: ty }; break; }
      }
      if (target) {
        const walkable = (ctx.inBounds(target.x, target.y) &&
          (ctx.map[target.y][target.x] === ctx.TILES.FLOOR || ctx.map[target.y][target.x] === ctx.TILES.DOOR));
        const enemyBlocks = Array.isArray(ctx.enemies) && ctx.enemies.some(e => e && e.x === target.x && e.y === target.y);
        if (walkable && !enemyBlocks) {
          ctx.player.x = target.x; ctx.player.y = target.y;
        }
      }
    }
  } catch (_) {}

  // Delegate to Loot.lootHere if available
  try {
    if (ctx.Loot && typeof ctx.Loot.lootHere === "function") {
      ctx.Loot.lootHere(ctx);
      return true;
    }
    if (typeof window !== "undefined" && window.Loot && typeof window.Loot.lootHere === "function") {
      window.Loot.lootHere(ctx);
      return true;
    }
  } catch (_) {}

  // Minimal fallback: transfer items from corpse underfoot into inventory; auto-equip when better
  try {
    const list = Array.isArray(ctx.corpses) ? ctx.corpses.filter(c => c && c.x === ctx.player.x && c.y === ctx.player.y) : [];
    if (list.length === 0) {
      ctx.log && ctx.log("There is no corpse here to loot.");
      return true;
    }
    const container = list.find(c => Array.isArray(c.loot) && c.loot.length > 0);
    if (!container) {
      list.forEach(c => c.looted = true);
      ctx.log && ctx.log("Nothing of value here.");
      try { save(ctx, false); } catch (_) {}
      ctx.updateUI && ctx.updateUI();
      ctx.turn && ctx.turn();
      return true;
    }
    const acquired = [];
    for (const item of container.loot) {
      if (!item) continue;
      if (item.kind === "equip" && typeof ctx.equipIfBetter === "function") {
        const equipped = ctx.equipIfBetter(item);
        const desc = ctx.describeItem ? ctx.describeItem(item) : (item.name || "equipment");
        acquired.push(equipped ? `equipped ${desc}` : desc);
        if (!equipped) (ctx.player.inventory || (ctx.player.inventory = [])).push(item);
      } else if (item.kind === "gold") {
        const gold = (ctx.player.inventory || (ctx.player.inventory = [])).find(i => i && i.kind === "gold");
        if (gold) gold.amount += item.amount;
        else ctx.player.inventory.push({ kind: "gold", amount: item.amount, name: "gold" });
        acquired.push(item.name || `${item.amount} gold`);
      } else {
        (ctx.player.inventory || (ctx.player.inventory = [])).push(item);
        acquired.push(item.name || (item.kind || "item"));
      }
    }
    container.loot = [];
    container.looted = true;
    ctx.updateUI && ctx.updateUI();
    ctx.log && ctx.log(`You loot: ${acquired.join(", ")}.`);
    try { save(ctx, false); } catch (_) {}
    ctx.turn && ctx.turn();
    return true;
  } catch (_) {}

  // Not handled
  return false;
}

export function killEnemy(ctx, enemy) {
  if (!ctx || !enemy) return;
  // Announce death
  try {
    const Cap = (ctx.utils && typeof ctx.utils.capitalize === "function") ? ctx.utils.capitalize : (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    const name = Cap(enemy.type || "enemy");
    ctx.log && ctx.log(`${name} dies.`, "bad");
  } catch (_) {}

  // Generate loot
  let loot = [];
  try {
    if (ctx.Loot && typeof ctx.Loot.generate === "function") {
      loot = ctx.Loot.generate(ctx, enemy) || [];
    }
  } catch (_) { loot = []; }

  // Place corpse
  try {
    ctx.corpses = Array.isArray(ctx.corpses) ? ctx.corpses : [];
    ctx.corpses.push({ x: enemy.x, y: enemy.y, loot, looted: loot.length === 0 });
  } catch (_) {}

  // Remove enemy from list
  try {
    if (Array.isArray(ctx.enemies)) {
      ctx.enemies = ctx.enemies.filter(e => e !== enemy);
    }
  } catch (_) {}

  // Clear occupancy
  try {
    if (ctx.occupancy && typeof ctx.occupancy.clearEnemy === "function") {
      ctx.occupancy.clearEnemy(enemy.x, enemy.y);
    }
  } catch (_) {}

  // Award XP
  const xp = (typeof enemy.xp === "number") ? enemy.xp : 5;
  try {
    if (ctx.Player && typeof ctx.Player.gainXP === "function") {
      ctx.Player.gainXP(ctx.player, xp, { log: ctx.log, updateUI: ctx.updateUI });
    } else if (typeof window !== "undefined" && window.Player && typeof window.Player.gainXP === "function") {
      window.Player.gainXP(ctx.player, xp, { log: ctx.log, updateUI: ctx.updateUI });
    } else {
      ctx.player.xp = (ctx.player.xp || 0) + xp;
      ctx.log && ctx.log(`You gain ${xp} XP.`);
      while (ctx.player.xp >= ctx.player.xpNext) {
        ctx.player.xp -= ctx.player.xpNext;
        ctx.player.level = (ctx.player.level || 1) + 1;
        ctx.player.maxHp = (ctx.player.maxHp || 1) + 2;
        ctx.player.hp = ctx.player.maxHp;
        if ((ctx.player.level % 2) === 0) ctx.player.atk = (ctx.player.atk || 1) + 1;
        ctx.player.xpNext = Math.floor((ctx.player.xpNext || 20) * 1.3 + 10);
        ctx.log && ctx.log(`You are now level ${ctx.player.level}. Max HP increased.`, "good");
      }
      ctx.updateUI && ctx.updateUI();
    }
  } catch (_) {}

  // Persist dungeon state so corpses remain on revisit
  try { save(ctx, false); } catch (_) {}
}

export function enter(ctx, info) {
  if (!ctx || !info) return false;
  ctx.dungeon = info;
  ctx.dungeonInfo = info;
  ctx.floor = Math.max(1, (info.level | 0) || 1);
  ctx.mode = "dungeon";

  // Try loading an existing state first
  try {
    if (load(ctx, info.x, info.y)) {
      return true;
    }
  } catch (_) {}

  // Announce entry and generate a fresh floor
  try { ctx.log && ctx.log(`You enter the dungeon (Difficulty ${ctx.floor}${info.size ? ", " + info.size : ""}).`, "notice"); } catch (_) {}
  generate(ctx, ctx.floor);

  // Mark entrance position as the exit and ensure tile visuals
  try {
    ctx.dungeonExitAt = { x: ctx.player.x, y: ctx.player.y };
    if (ctx.inBounds && ctx.inBounds(ctx.player.x, ctx.player.y)) {
      ctx.map[ctx.player.y][ctx.player.x] = ctx.TILES.STAIRS;
      if (Array.isArray(ctx.seen) && ctx.seen[ctx.player.y]) ctx.seen[ctx.player.y][ctx.player.x] = true;
      if (Array.isArray(ctx.visible) && ctx.visible[ctx.player.y]) ctx.visible[ctx.player.y][ctx.player.x] = true;
    }
  } catch (_) {}

  // Persist immediately
  try { save(ctx, true); } catch (_) {}

  // Ensure visuals are refreshed
  try { ctx.updateCamera && ctx.updateCamera(); } catch (_) {}
  try { ctx.recomputeFOV && ctx.recomputeFOV(); } catch (_) {}
  try { ctx.updateUI && ctx.updateUI(); } catch (_) {}
  try { ctx.requestDraw && ctx.requestDraw(); } catch (_) {}

  return true;
}

export function tryMoveDungeon(ctx, dx, dy) {
  if (!ctx || ctx.mode !== "dungeon") return false;

  // Dazed: skip action if dazedTurns > 0
  try {
    if (ctx.player && ctx.player.dazedTurns && ctx.player.dazedTurns > 0) {
      ctx.player.dazedTurns -= 1;
      ctx.log && ctx.log("You are dazed and lose your action this turn.", "warn");
      ctx.turn && ctx.turn();
      return true;
    }
  } catch (_) {}

  const nx = ctx.player.x + (dx | 0);
  const ny = ctx.player.y + (dy | 0);
  if (!ctx.inBounds(nx, ny)) return false;

  // Is there an enemy at target tile?
  let enemy = null;
  try {
    const enemies = Array.isArray(ctx.enemies) ? ctx.enemies : [];
    enemy = enemies.find(e => e && e.x === nx && e.y === ny) || null;
  } catch (_) { enemy = null; }

  if (enemy) {
    // Hit location
    const C = (ctx && ctx.Combat) || (typeof window !== "undefined" ? window.Combat : null);
    const rollLoc = (C && typeof C.rollHitLocation === "function")
      ? () => C.rollHitLocation(ctx.rng)
      : (typeof ctx.rollHitLocation === "function" ? () => ctx.rollHitLocation() : null);
    let loc = rollLoc ? rollLoc() : { part: "torso", mult: 1.0, blockMod: 1.0, critBonus: 0.00 };

    // GOD forced part (best-effort)
    try {
      const forcedPart = (typeof window !== "undefined" && typeof window.ALWAYS_CRIT_PART === "string")
        ? window.ALWAYS_CRIT_PART
        : (typeof localStorage !== "undefined" ? (localStorage.getItem("ALWAYS_CRIT_PART") || "") : "");
      if (forcedPart) {
        const profs = (C && C.profiles) ? C.profiles : {
          torso: { part: "torso", mult: 1.0, blockMod: 1.0, critBonus: 0.00 },
          head:  { part: "head",  mult: 1.1, blockMod: 0.85, critBonus: 0.15 },
          hands: { part: "hands", mult: 0.9, blockMod: 0.75, critBonus: -0.05 },
          legs:  { part: "legs",  mult: 0.95, blockMod: 0.75, critBonus: -0.03 },
        };
        if (profs[forcedPart]) loc = profs[forcedPart];
      }
    } catch (_) {}

    // Block chance
    const blockChance = (C && typeof C.getEnemyBlockChance === "function")
      ? C.getEnemyBlockChance(ctx, enemy, loc)
      : (typeof ctx.getEnemyBlockChance === "function" ? ctx.getEnemyBlockChance(enemy, loc) : 0);
    const rBlock = (typeof ctx.rng === "function") ? ctx.rng() : Math.random();

    if (rBlock < blockChance) {
      try {
        const name = (enemy.type || "enemy");
        ctx.log && ctx.log(`${name.charAt(0).toUpperCase()}${name.slice(1)} blocks your attack to the ${loc.part}.`, "block");
      } catch (_) {}
      // Decay hands (light) on block
      try {
        const ED = (typeof window !== "undefined") ? window.EquipmentDecay : null;
        const twoHanded = !!(ctx.player.equipment && ctx.player.equipment.left && ctx.player.equipment.right && ctx.player.equipment.left === ctx.player.equipment.right && ctx.player.equipment.left.twoHanded);
        if (ED && typeof ED.decayAttackHands === "function") {
          ED.decayAttackHands(ctx.player, ctx.rng, { twoHanded, light: true }, { log: ctx.log, updateUI: ctx.updateUI, onInventoryChange: ctx.rerenderInventoryIfOpen });
        } else if (typeof ctx.decayEquipped === "function") {
          const rf = (typeof ctx.randFloat === "function") ? ctx.randFloat : ((min, max) => (min + (Math.random() * (max - min))));
          ctx.decayEquipped("hands", rf(0.2, 0.7));
        }
      } catch (_) {}
      ctx.turn && ctx.turn();
      return true;
    }

    // Damage calculation
    const S = (typeof window !== "undefined") ? window.Stats : null;
    const atk = (typeof ctx.getPlayerAttack === "function")
      ? ctx.getPlayerAttack()
      : (S && typeof S.getPlayerAttack === "function" ? S.getPlayerAttack(ctx) : 1);
    let dmg = (atk || 1) * (loc.mult || 1.0);
    let isCrit = false;
    const alwaysCrit = !!((typeof window !== "undefined" && typeof window.ALWAYS_CRIT === "boolean") ? window.ALWAYS_CRIT : false);
    const critChance = Math.max(0, Math.min(0.6, 0.12 + (loc.critBonus || 0)));
    const critMult = (C && typeof C.critMultiplier === "function")
      ? C.critMultiplier(ctx.rng)
      : (typeof ctx.critMultiplier === "function" ? ctx.critMultiplier() : (1.6 + ((typeof ctx.rng === "function") ? ctx.rng() : Math.random()) * 0.4));
    const rCrit = (typeof ctx.rng === "function") ? ctx.rng() : Math.random();
    if (alwaysCrit || rCrit < critChance) {
      isCrit = true;
      dmg *= critMult;
    }
    const round1 = (ctx.utils && typeof ctx.utils.round1 === "function") ? ctx.utils.round1 : ((n) => Math.round(n * 10) / 10);
    dmg = Math.max(0, round1(dmg));
    enemy.hp -= dmg;

    // Visual: blood decal
    try { if (typeof ctx.addBloodDecal === "function" && dmg > 0) ctx.addBloodDecal(enemy.x, enemy.y, isCrit ? 1.6 : 1.0); } catch (_) {}

    // Log
    try {
      const name = (enemy.type || "enemy");
      if (isCrit) ctx.log && ctx.log(`Critical! You hit the ${name}'s ${loc.part} for ${dmg}.`, "crit");
      else ctx.log && ctx.log(`You hit the ${name}'s ${loc.part} for ${dmg}.`);
      if (ctx.Flavor && typeof ctx.Flavor.logPlayerHit === "function") ctx.Flavor.logPlayerHit(ctx, { target: enemy, loc, crit: isCrit, dmg });
    } catch (_) {}

    // Status effects on crit
    try {
      const ST = (typeof window !== "undefined") ? window.Status : null;
      if (isCrit && loc.part === "legs" && enemy.hp > 0) {
        if (ST && typeof ST.applyLimpToEnemy === "function") ST.applyLimpToEnemy(ctx, enemy, 2);
        else { enemy.immobileTurns = Math.max(enemy.immobileTurns || 0, 2); ctx.log && ctx.log(`${(enemy.type || "enemy")[0].toUpperCase()}${(enemy.type || "enemy").slice(1)} staggers; its legs are crippled and it can't move for 2 turns.`, "notice"); }
      }
      if (isCrit && enemy.hp > 0) {
        if (ST && typeof ST.applyBleedToEnemy === "function") ST.applyBleedToEnemy(ctx, enemy, 2);
      }
    } catch (_) {}

    // Death
    try {
      if (enemy.hp <= 0 && typeof ctx.onEnemyDied === "function") {
        ctx.onEnemyDied(enemy);
      }
    } catch (_) {}

    // Decay hands after attack
    try {
      const ED = (typeof window !== "undefined") ? window.EquipmentDecay : null;
      const twoHanded = !!(ctx.player.equipment && ctx.player.equipment.left && ctx.player.equipment.right && ctx.player.equipment.left === ctx.player.equipment.right && ctx.player.equipment.left.twoHanded);
      if (ED && typeof ED.decayAttackHands === "function") {
        ED.decayAttackHands(ctx.player, ctx.rng, { twoHanded }, { log: ctx.log, updateUI: ctx.updateUI, onInventoryChange: ctx.rerenderInventoryIfOpen });
      } else if (typeof ctx.decayEquipped === "function") {
        const rf = (typeof ctx.randFloat === "function") ? ctx.randFloat : ((min, max) => (min + (Math.random() * (max - min))));
        ctx.decayEquipped("hands", rf(0.3, 1.0));
      }
    } catch (_) {}

    ctx.turn && ctx.turn();
    return true;
  }

  // Movement into empty tile
  try {
    const blockedByEnemy = Array.isArray(ctx.enemies) && ctx.enemies.some(e => e && e.x === nx && e.y === ny);
    const walkable = ctx.inBounds(nx, ny) && (ctx.map[ny][nx] === ctx.TILES.FLOOR || ctx.map[ny][nx] === ctx.TILES.DOOR || ctx.map[ny][nx] === ctx.TILES.STAIRS);
    if (walkable && !blockedByEnemy) {
      ctx.player.x = nx; ctx.player.y = ny;
      ctx.updateCamera && ctx.updateCamera();
      ctx.turn && ctx.turn();
      return true;
    }
  } catch (_) {}

  return false;
}

export function tick(ctx) {
  if (!ctx || ctx.mode !== "dungeon") return false;
  // Enemies act via AI
  try {
    const AIH = ctx.AI || (typeof window !== "undefined" ? window.AI : null);
    if (AIH && typeof AIH.enemiesAct === "function") {
      AIH.enemiesAct(ctx);
    }
  } catch (_) {}
  // Ensure occupancy reflects enemy movement/deaths this turn
  try {
    const OG = ctx.OccupancyGrid || (typeof window !== "undefined" ? window.OccupancyGrid : null);
    if (OG && typeof OG.build === "function") {
      ctx.occupancy = OG.build({ map: ctx.map, enemies: ctx.enemies, npcs: ctx.npcs, props: ctx.townProps, player: ctx.player });
    }
  } catch (_) {}
  // Status effects tick (bleed, dazed, etc.)
  try {
    const ST = ctx.Status || (typeof window !== "undefined" ? window.Status : null);
    if (ST && typeof ST.tick === "function") {
      ST.tick(ctx);
    }
  } catch (_) {}
  // Visual: decals fade each turn
  try {
    const DC = ctx.Decals || (typeof window !== "undefined" ? window.Decals : null);
    if (DC && typeof DC.tick === "function") {
      DC.tick(ctx);
    } else if (Array.isArray(ctx.decals) && ctx.decals.length) {
      for (let i = 0; i < ctx.decals.length; i++) {
        ctx.decals[i].a *= 0.92;
      }
      ctx.decals = ctx.decals.filter(d => d.a > 0.04);
    }
  } catch (_) {}
  // End of turn: brace stance lasts only for this enemy round
  try {
    if (ctx.player && typeof ctx.player.braceTurns === "number" && ctx.player.braceTurns > 0) {
      ctx.player.braceTurns = 0;
    }
  } catch (_) {}
  // Clamp corpse list length
  try {
    if (Array.isArray(ctx.corpses) && ctx.corpses.length > 50) {
      ctx.corpses = ctx.corpses.slice(-50);
    }
  } catch (_) {}
  return true;
}

// Back-compat: attach to window for classic scripts
if (typeof window !== "undefined") {
  window.DungeonRuntime = { keyFromWorldPos, save, load, generate, generateLoot, returnToWorldIfAtExit, lootHere, killEnemy, enter, tryMoveDungeon, tick };
}