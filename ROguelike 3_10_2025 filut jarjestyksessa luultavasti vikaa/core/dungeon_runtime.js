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

// Spawn sparse wall torches on WALL tiles adjacent to FLOOR/DOOR/STAIRS.
// Options: { density:number (0..1), minSpacing:number (tiles) }
function spawnWallTorches(ctx, options = {}) {
  const density = typeof options.density === "number" ? Math.max(0, Math.min(1, options.density)) : 0.006;
  const minSpacing = Math.max(1, (options.minSpacing | 0) || 2);
  const list = [];
  const rows = ctx.map.length;
  const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
  const RU = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
  const rng = (RU && typeof RU.getRng === "function")
    ? RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
    : ((typeof ctx.rng === "function") ? ctx.rng : null);

  const isWall = (x, y) => ctx.inBounds(x, y) && ctx.map[y][x] === ctx.TILES.WALL;
  const isWalkableTile = (x, y) => ctx.inBounds(x, y) && (ctx.map[y][x] === ctx.TILES.FLOOR || ctx.map[y][x] === ctx.TILES.DOOR || ctx.map[y][x] === ctx.TILES.STAIRS);

  function nearTorch(x, y, r = minSpacing) {
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const dx = Math.abs(p.x - x);
      const dy = Math.abs(p.y - y);
      if (dx <= r && dy <= r) return true;
    }
    return false;
  }

  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      if (!isWall(x, y)) continue;
      // Must border at least one walkable tile (corridor/room edge)
      const bordersWalkable =
        isWalkableTile(x + 1, y) || isWalkableTile(x - 1, y) ||
        isWalkableTile(x, y + 1) || isWalkableTile(x, y - 1);
      if (!bordersWalkable) continue;
      // Sparse random placement with spacing constraint
      const rv = (typeof rng === "function") ? rng() : 0.5;
      if (rv < density && !nearTorch(x, y)) {
        list.push({ x, y, type: "wall_torch", name: "Wall Torch" });
      }
    }
  }
  return list;
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
    dungeonProps: Array.isArray(ctx.dungeonProps) ? ctx.dungeonProps.slice(0) : [],
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
      try {
        const SS = ctx.StateSync || (typeof window !== "undefined" ? window.StateSync : null);
        if (SS && typeof SS.applyAndRefresh === "function") {
          SS.applyAndRefresh(ctx, {});
        }
      } catch (_) {}
    }
    return ok;
  }
  if (typeof window !== "undefined" && window.DungeonState && typeof window.DungeonState.load === "function") {
    const ok = window.DungeonState.load(ctx, x, y);
    if (ok) {
      try {
        const SS = ctx.StateSync || window.StateSync || null;
        if (SS && typeof SS.applyAndRefresh === "function") {
          SS.applyAndRefresh(ctx, {});
        }
      } catch (_) {}
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
  ctx.dungeonProps = Array.isArray(st.dungeonProps) ? st.dungeonProps : [];
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

  try {
    const SS = ctx.StateSync || (typeof window !== "undefined" ? window.StateSync : null);
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    }
  } catch (_) {}
  return true;
}

export function generate(ctx, depth) {
  const D = (ctx && ctx.Dungeon) || (typeof window !== "undefined" ? window.Dungeon : null);
  if (D && typeof D.generateLevel === "function") {
    ctx.startRoomRect = ctx.startRoomRect || null;
    D.generateLevel(ctx, depth);
    // Clear decals on new floor
    ctx.decals = [];
    // Spawn sparse wall torches along walls adjacent to floor tiles
    try {
      ctx.dungeonProps = spawnWallTorches(ctx, { density: 0.006, minSpacing: 2 });
    } catch (_) { ctx.dungeonProps = []; }
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
    // Occupancy (centralized)
    try {
      const OF = ctx.OccupancyFacade || (typeof window !== "undefined" ? window.OccupancyFacade : null);
      if (OF && typeof OF.rebuild === "function") OF.rebuild(ctx);
    } catch (_) {}
    // Dev counts
    try {
      if (window.DEV) {
        const visCount = ctx.enemies.filter(e => ctx.inBounds(e.x, e.y) && ctx.visible[e.y][e.x]).length;
        const torchCount = Array.isArray(ctx.dungeonProps) ? ctx.dungeonProps.filter(p => p && p.type === "wall_torch").length : 0;
        ctx.log && ctx.log(`[DEV] Enemies spawned: ${ctx.enemies.length}, visible now: ${visCount}. Torches: ${torchCount}.`, "notice");
      }
    } catch (_) {}
    // Refresh UI and visuals via StateSync, then message
    try {
      const SS = ctx.StateSync || (typeof window !== "undefined" ? window.StateSync : null);
      if (SS && typeof SS.applyAndRefresh === "function") {
        SS.applyAndRefresh(ctx, {});
      }
    } catch (_) {}
    try {
      const pl = (ctx.player && typeof ctx.player.level === "number") ? ctx.player.level : 1;
      const dl = Math.max(1, (ctx.floor | 0) || 1);
      const ed = Math.max(1, dl + Math.floor(Math.max(0, pl) / 2));
      ctx.log && ctx.log(`You explore the dungeon (Level ${dl}, Effective ${ed}).`);
    } catch (_) {
      ctx.log && ctx.log("You explore the dungeon.");
    }
    save(ctx, true);
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
  ctx.dungeonProps = [];
  try {
    const SS = ctx.StateSync || (typeof window !== "undefined" ? window.StateSync : null);
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    } else {
      ctx.recomputeFOV && ctx.recomputeFOV();
      ctx.updateCamera && ctx.updateCamera();
      ctx.updateUI && ctx.updateUI();
      ctx.requestDraw && ctx.requestDraw();
    }
  } catch (_) {}
  ctx.log && ctx.log("You explore the dungeon.");
  save(ctx, true);
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

  // Allow exit when standing on ANY STAIRS tile (not just the designated entrance),
  // unless it is the special mountain-pass portal handled elsewhere.
  const onStairs = (ctx.inBounds(ctx.player.x, ctx.player.y) && ctx.map[ctx.player.y][ctx.player.x] === ctx.TILES.STAIRS);
  if (!onStairs) return false;

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

  // Use world map and restore fog-of-war so minimap remembers explored areas
  ctx.map = ctx.world.map;
  try {
    if (ctx.world && ctx.world.seenRef && Array.isArray(ctx.world.seenRef)) ctx.seen = ctx.world.seenRef;
    if (ctx.world && ctx.world.visibleRef && Array.isArray(ctx.world.visibleRef)) ctx.visible = ctx.world.visibleRef;
  } catch (_) {}

  // Restore world position: prefer stored worldReturnPos; else dungeon entrance coordinates (absolute world coords)
  let rx = (ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number") ? ctx.worldReturnPos.x : null;
  let ry = (ctx.worldReturnPos && typeof ctx.worldReturnPos.y === "number") ? ctx.worldReturnPos.y : null;
  if (rx == null || ry == null) {
    const info = ctx.dungeon || ctx.dungeonInfo;
    if (info && typeof info.x === "number" && typeof info.y === "number") {
      rx = info.x; ry = info.y;
    }
  }

  // Ensure the target world cell is in the current window, then convert to local indices
  try {
    const WR = ctx.WorldRuntime || (typeof window !== "undefined" ? window.WorldRuntime : null);
    if (WR && typeof WR.ensureInBounds === "function" && typeof rx === "number" && typeof ry === "number") {
      // Suspend player shifting during expansion to avoid camera/position snaps
      ctx._suspendExpandShift = true;
      try {
        let lx = rx - ctx.world.originX;
        let ly = ry - ctx.world.originY;
        WR.ensureInBounds(ctx, lx, ly, 32);
      } finally {
        ctx._suspendExpandShift = false;
      }
      const lx2 = rx - ctx.world.originX;
      const ly2 = ry - ctx.world.originY;
      ctx.player.x = lx2;
      ctx.player.y = ly2;
    } else if (typeof rx === "number" && typeof ry === "number") {
      const lx = rx - ctx.world.originX;
      const ly = ry - ctx.world.originY;
      ctx.player.x = Math.max(0, Math.min((ctx.map[0]?.length || 1) - 1, lx));
      ctx.player.y = Math.max(0, Math.min((ctx.map.length || 1) - 1, ly));
    }
  } catch (_) {}

  // Refresh visuals via StateSync
  try {
    const SS = ctx.StateSync || (typeof window !== "undefined" ? window.StateSync : null);
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    } else {
      if (ctx.FOV && typeof ctx.FOV.recomputeFOV === "function") ctx.FOV.recomputeFOV(ctx);
      else if (ctx.recomputeFOV) ctx.recomputeFOV();
      ctx.updateUI && ctx.updateUI();
      ctx.requestDraw && ctx.requestDraw();
    }
  } catch (_) {}
  try { ctx.log && ctx.log("You climb back to the overworld.", "notice"); } catch (_) {}

  return true;
}

export function lootHere(ctx) {
  if (!ctx || (ctx.mode !== "dungeon" && ctx.mode !== "encounter")) return false;

  // Exact-tile only: do not auto-step onto adjacent corpses/chests. Looting and flavor apply only if standing on the body tile.

  // Minimal unified handling: determine what's underfoot first, then delegate when there is actual loot
  try {
    const list = Array.isArray(ctx.corpses) ? ctx.corpses.filter(c => c && c.x === ctx.player.x && c.y === ctx.player.y) : [];
    if (list.length === 0) {
      ctx.log && ctx.log("There is no corpse here to loot.");
      return true;
    }

    // Flavor: show death notes if present on any corpse underfoot
    try {
      for (const c of list) {
        const meta = c && c.meta;
        if (meta && (meta.killedBy || meta.wound)) {
          const FS = (typeof window !== "undefined" ? window.FlavorService : null);
          const line = (FS && typeof FS.describeCorpse === "function")
            ? FS.describeCorpse(meta)
            : (() => {
                const killerStr = meta.killedBy ? `Killed by ${meta.killedBy}.` : "";
                const woundStr = meta.wound ? `Wound: ${meta.wound}.` : "";
                const viaStr = meta.via ? `(${meta.via})` : "";
                const parts = [woundStr, killerStr].filter(Boolean).join(" ");
                return `${parts} ${viaStr}`.trim();
              })();
          if (line) ctx.log && ctx.log(line, "info");
        }
      }
    } catch (_) {}

    const container = list.find(c => Array.isArray(c.loot) && c.loot.length > 0);
    if (!container) {
      // No loot left underfoot; show flavor per fresh examination and avoid repeated spam
      let newlyExamined = 0;
      let examinedChestCount = 0;
      let examinedCorpseCount = 0;
      for (const c of list) {
        c.looted = true;
        if (!c._examined) {
          c._examined = true;
          // Flavor line for this corpse if available
          try {
            const meta = c && c.meta;
            if (meta && (meta.killedBy || meta.wound)) {
              const killerStr = meta.killedBy ? `Killed by ${meta.killedBy}.` : "";
              const woundStr = meta.wound ? `Wound: ${meta.wound}.` : "";
              const viaStr = meta.via ? `(${meta.via})` : "";
              const parts = [woundStr, killerStr].filter(Boolean).join(" ");
              if (parts) ctx.log && ctx.log(`${parts} ${viaStr}`.trim(), "info");
            }
          } catch (_) {}
          newlyExamined++;
          if (String(c.kind || "").toLowerCase() === "chest") examinedChestCount++;
          else examinedCorpseCount++;
        }
      }
      if (newlyExamined > 0) {
        let line = "";
        if (examinedChestCount > 0 && examinedCorpseCount === 0) {
          line = examinedChestCount === 1 ? "You search the chest but find nothing."
                                          : "You search the chests but find nothing.";
        } else if (examinedCorpseCount > 0 && examinedChestCount === 0) {
          line = newlyExamined === 1 ? "You search the corpse but find nothing."
                                     : "You search the corpses but find nothing.";
        } else {
          // Mixed containers underfoot
          line = "You search the area but find nothing.";
        }
        ctx.log && ctx.log(line);
      }
      try { save(ctx, false); } catch (_) {}
      ctx.updateUI && ctx.updateUI();
      ctx.turn && ctx.turn();
      return true;
    }

    // Delegate to Loot.lootHere for actual loot transfer if available
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

  // Build flavor metadata from last hit info if available (JSON-driven via FlavorService)
  const last = enemy._lastHit || null;
  let meta = null;
  try {
    const FS = (typeof window !== "undefined" ? window.FlavorService : null);
    if (FS && typeof FS.buildCorpseMeta === "function") {
      meta = FS.buildCorpseMeta(ctx, enemy, last);
    }
  } catch (_) { meta = null; }
  if (!meta) {
    // Fallback inline flavor
    function flavorFromLastHit(lh) {
      if (!lh) return null;
      const part = lh.part || "torso";
      const killer = lh.by || "unknown";
      const via = lh.weapon ? lh.weapon : (lh.via || "attack");
      let wound = "";
      if (part === "head") wound = lh.crit ? "head crushed into pieces" : "wound to the head";
      else if (part === "torso") wound = lh.crit ? "deep gash across the torso" : "bleeding cut in torso";
      else if (part === "legs") wound = lh.crit ? "leg shattered beyond use" : "wound to the leg";
      else if (part === "hands") wound = lh.crit ? "hands mangled" : "cut on the hand";
      else wound = "fatal wound";
      const killedBy = (killer === "player") ? "you" : killer;
      return { killedBy, wound, via };
    }
    meta = flavorFromLastHit(last);
  }

  // Place corpse with flavor meta
  try {
    ctx.corpses = Array.isArray(ctx.corpses) ? ctx.corpses : [];
    ctx.corpses.push({
      x: enemy.x,
      y: enemy.y,
      loot,
      looted: loot.length === 0,
      meta: meta || undefined
    });
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
  // Preserve world fog-of-war references so we can restore on exit
  try {
    if (ctx.world) {
      ctx.world.seenRef = ctx.seen;
      ctx.world.visibleRef = ctx.visible;
    }
  } catch (_) {}
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

  // Ensure visuals are refreshed via StateSync
  try {
    const SS = ctx.StateSync || (typeof window !== "undefined" ? window.StateSync : null);
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    }
  } catch (_) {}

  return true;
}

export function tryMoveDungeon(ctx, dx, dy) {
  if (!ctx || (ctx.mode !== "dungeon" && ctx.mode !== "encounter")) return false;
  const advanceTurn = (ctx.mode === "dungeon"); // in encounter, the orchestrator advances the turn after syncing

  // Dazed: skip action if dazedTurns > 0
  try {
    if (ctx.player && ctx.player.dazedTurns && ctx.player.dazedTurns > 0) {
      ctx.player.dazedTurns -= 1;
      ctx.log && ctx.log("You are dazed and lose your action this turn.", "warn");
      if (advanceTurn && ctx.turn) ctx.turn();
      return true;
    }
  } catch (_) {}

  const nx = ctx.player.x + (dx | 0);
  const ny = ctx.player.y + (dy | 0);
  if (!ctx.inBounds(nx, ny)) return false;

  // Special: stepping on a mountain-pass portal (if present) transfers to a dungeon across the mountain
  try {
    const pass = ctx._mountainPassAt || null;
    if (pass && nx === pass.x && ny === pass.y && ctx.map[ny][nx] === ctx.TILES.STAIRS) {
      // Compute an across-mountain target in world coordinates
      const tgt = computeAcrossMountainTarget(ctx);
      if (tgt) {
        // Persist current dungeon and enter the destination dungeon directly
        try { save(ctx, false); } catch (_) {}
        const size = (ctx.dungeonInfo && ctx.dungeonInfo.size) ? ctx.dungeonInfo.size : "medium";
        const level = Math.max(1, ctx.floor | 0);
        const info = { x: tgt.x, y: tgt.y, level, size };
        ctx.log && ctx.log("You find a hidden passage through the mountain...", "notice");
        return enter(ctx, info);
      }
    }
  } catch (_) {}

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
    const RU = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
    const rBlockFn = (RU && typeof RU.getRng === "function")
      ? RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
      : ((typeof ctx.rng === "function") ? ctx.rng : null);
    const rBlock = (typeof rBlockFn === "function") ? rBlockFn() : 0.5;

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
          const rf = (typeof ctx.randFloat === "function") ? ctx.randFloat : ((min, max) => {
            try {
              const RUx = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
              if (RUx && typeof RUx.float === "function") {
                const rfnLocal = (typeof ctx.rng === "function") ? ctx.rng : undefined;
                return RUx.float(min, max, 6, rfnLocal);
              }
            } catch (_) {}
            if (typeof ctx.rng === "function") {
              const r = ctx.rng();
              return min + r * (max - min);
            }
            // Deterministic midpoint when RNG unavailable
            return (min + max) / 2;
          });
          ctx.decayEquipped("hands", rf(0.2, 0.7));
        }
      } catch (_) {}
      if (advanceTurn && ctx.turn) ctx.turn();
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
    const RUcrit = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
    const rfnCrit = (RUcrit && typeof RUcrit.getRng === "function")
      ? RUcrit.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
      : ((typeof ctx.rng === "function") ? ctx.rng : null);
    const rCrit = (typeof rfnCrit === "function") ? rfnCrit() : 0.5;
    const critMult = (C && typeof C.critMultiplier === "function")
      ? C.critMultiplier(rfnCrit || undefined)
      : (typeof ctx.critMultiplier === "function" ? ctx.critMultiplier(rfnCrit || undefined) : 1.8);
    if (alwaysCrit || rCrit < critChance) {
      isCrit = true;
      dmg *= critMult;
    }
    const round1 = (ctx.utils && typeof ctx.utils.round1 === "function") ? ctx.utils.round1 : ((n) => Math.round(n * 10) / 10);
    // Guarantee chip damage so fights always progress, even with very low attack values.
    dmg = Math.max(0.1, round1(dmg));
    enemy.hp -= dmg;

    // Visual: blood decal (skip ethereal foes)
    try {
      const t = String(enemy.type || "");
      const ethereal = /ghost|spirit|wraith|skeleton/i.test(t);
      if (!ethereal && typeof ctx.addBloodDecal === "function" && dmg > 0) ctx.addBloodDecal(enemy.x, enemy.y, isCrit ? 1.6 : 1.0);
    } catch (_) {}

    // Log
    try {
      const name = (enemy.type || "enemy");
      if (isCrit) ctx.log && ctx.log(`Critical! You hit the ${name}'s ${loc.part} for ${dmg}.`, "crit");
    else ctx.log && ctx.log(`You hit the ${name}'s ${loc.part} for ${dmg}.`);
    if (ctx.Flavor && typeof ctx.Flavor.logPlayerHit === "function") ctx.Flavor.logPlayerHit(ctx, { target: enemy, loc, crit: isCrit, dmg });
    // Record last hit for death flavor
    try {
      const eq = ctx.player && ctx.player.equipment ? ctx.player.equipment : {};
      const weaponName = (eq.right && eq.right.name) ? eq.right.name
                   : (eq.left && eq.left.name) ? eq.left.name
                   : null;
      enemy._lastHit = { by: "player", part: loc.part, crit: isCrit, dmg, weapon: weaponName, via: weaponName ? `with ${weaponName}` : "melee" };
    } catch (_) {}
  } catch (_) {}

    // Status effects on crit
    try {
      const ST = (typeof window !== "undefined") ? window.Status : null;
      if (isCrit && loc.part === "legs" && enemy.hp > 0) {
        if (ST && typeof ST.applyLimpToEnemy === "function") ST.applyLimpToEnemy(ctx, enemy, 2);
        else { enemy.immobileTurns = Math.max(enemy.immobileTurns || 0, 2); ctx.log && ctx.log(`${(enemy.type || "enemy")[0].toUpperCase()}${(enemy.type || "enemy").slice(1)} staggers; its legs are crippled and it can't move for 2 turns.`, "notice"); }
      }
      if (isCrit && enemy.hp > 0) {
        // Skip bleed status for ethereal/undead foes
        const t = String(enemy.type || "");
        const ethereal = /ghost|spirit|wraith|skeleton/i.test(t);
        if (!ethereal && ST && typeof ST.applyBleedToEnemy === "function") ST.applyBleedToEnemy(ctx, enemy, 2);
      }
    } catch (_) {}

    // Death
    try {
      if (enemy.hp <= 0) {
        if (typeof ctx.onEnemyDied === "function") {
          ctx.onEnemyDied(enemy);
        } else {
          // Failsafe removal if the callback is missing
          try {
            // Minimal inline corpse + removal to avoid immortal enemies
            const loot = (ctx.Loot && typeof ctx.Loot.generate === "function") ? (ctx.Loot.generate(ctx, enemy) || []) : [];
            ctx.corpses = Array.isArray(ctx.corpses) ? ctx.corpses : [];
            ctx.corpses.push({ x: enemy.x, y: enemy.y, loot, looted: loot.length === 0 });
          } catch (_) {}
          try {
            if (Array.isArray(ctx.enemies)) ctx.enemies = ctx.enemies.filter(e => e !== enemy);
            if (ctx.occupancy && typeof ctx.occupancy.clearEnemy === "function") ctx.occupancy.clearEnemy(enemy.x, enemy.y);
          } catch (_) {}
        }
      }
    } catch (_) {}

    // Decay hands after attack
    try {
      const ED = (typeof window !== "undefined") ? window.EquipmentDecay : null;
      const twoHanded = !!(ctx.player.equipment && ctx.player.equipment.left && ctx.player.equipment.right && ctx.player.equipment.left === ctx.player.equipment.right && ctx.player.equipment.left.twoHanded);
      if (ED && typeof ED.decayAttackHands === "function") {
        ED.decayAttackHands(ctx.player, ctx.rng, { twoHanded }, { log: ctx.log, updateUI: ctx.updateUI, onInventoryChange: ctx.rerenderInventoryIfOpen });
      } else if (typeof ctx.decayEquipped === "function") {
        const rf = (typeof ctx.randFloat === "function") ? ctx.randFloat : ((min, max) => {
          try {
            const RUx = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
            if (RUx && typeof RUx.float === "function") {
              const rfnLocal = (typeof ctx.rng === "function") ? ctx.rng : undefined;
              return RUx.float(min, max, 6, rfnLocal);
            }
          } catch (_) {}
          // Deterministic midpoint when RNG unavailable
          return (min + max) / 2;
        });
        ctx.decayEquipped("hands", rf(0.3, 1.0));
      }
    } catch (_) {}

    if (advanceTurn && ctx.turn) ctx.turn();
    return true;
  }

  // Movement into empty tile
  try {
    const blockedByEnemy = Array.isArray(ctx.enemies) && ctx.enemies.some(e => e && e.x === nx && e.y === ny);
    const walkable = ctx.inBounds(nx, ny) && (ctx.map[ny][nx] === ctx.TILES.FLOOR || ctx.map[ny][nx] === ctx.TILES.DOOR || ctx.map[ny][nx] === ctx.TILES.STAIRS);
    if (walkable && !blockedByEnemy) {
      ctx.player.x = nx; ctx.player.y = ny;
      try {
        const SS = ctx.StateSync || (typeof window !== "undefined" ? window.StateSync : null);
        if (SS && typeof SS.applyAndRefresh === "function") {
          SS.applyAndRefresh(ctx, {});
        }
      } catch (_) {}
      if (advanceTurn && ctx.turn) ctx.turn();
      return true;
    }
  } catch (_) {}

  return false;
}

// Determine a target world coordinate across a mountain from this dungeon's entrance.
function computeAcrossMountainTarget(ctx) {
  try {
    const world = ctx.world || null;
    const gen = world && world.gen;
    const W = (typeof window !== "undefined" ? window.World : null);
    const WT = W ? W.TILES : null;
    const dinfo = ctx.dungeonInfo || ctx.dungeon || null;
    if (!gen || !WT || !dinfo) return null;
    // Mountain id
    const M = WT.MOUNTAIN;
    const wx0 = dinfo.x | 0, wy0 = dinfo.y | 0;

    // Directions to probe (N,E,S,W and diagonals) to find longest mountain run
    const dirs = [
      { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
      { dx: 1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 }
    ];

    function mountainRunLen(dx, dy) {
      let len = 0;
      let x = wx0, y = wy0;
      for (let i = 0; i < 300; i++) {
        const t = gen.tileAt(x, y);
        if (t === M) { len++; x += dx; y += dy; continue; }
        break;
      }
      return { len, endX: x, endY: y };
    }

    let best = null, bestLen = -1;
    for (const d of dirs) {
      const res = mountainRunLen(d.dx, d.dy);
      if (res.len > bestLen) { bestLen = res.len; best = { d, res }; }
    }
    if (!best) return null;
    // Move one more step beyond the last mountain tile to ensure we are across
    let tx = best.res.endX, ty = best.res.endY;
    // Nudge a few tiles further into non-mountain terrain for safety
    for (let k = 0; k < 5; k++) {
      const nx = tx + best.d.dx;
      const ny = ty + best.d.dy;
      const t = gen.tileAt(nx, ny);
      if (t === M) break;
      tx = nx; ty = ny;
    }
    return { x: tx, y: ty };
  } catch (_) { return null; }
}

export function tick(ctx) {
  if (!ctx || (ctx.mode !== "dungeon" && ctx.mode !== "encounter")) return false;
  // Enemies act via AI
  try {
    const AIH = ctx.AI || (typeof window !== "undefined" ? window.AI : null);
    if (AIH && typeof AIH.enemiesAct === "function") {
      AIH.enemiesAct(ctx);
    }
  } catch (_) {}
  // Ensure occupancy reflects enemy movement/deaths this turn
  try {
    const OF = ctx.OccupancyFacade || (typeof window !== "undefined" ? window.OccupancyFacade : null);
    if (OF && typeof OF.rebuild === "function") OF.rebuild(ctx);
  } catch (_) {}
  // Status effects tick (bleed, dazed, etc.)
  try {
    const ST = ctx.Status || (typeof window !== "undefined" ? window.Status : null);
    if (ST && typeof ST.tick === "function") {
      ST.tick(ctx);
    }
  } catch (_) {}

  // Cleanup: if any enemy died from status effects this turn, handle corpse + flavor
  try {
    const list = Array.isArray(ctx.enemies) ? ctx.enemies.slice(0) : [];
    for (const enemy of list) {
      if (!enemy) continue;
      if (typeof enemy.hp === "number" && enemy.hp <= 0) {
        // Ensure last-hit meta indicates status-based kill if none recorded
        if (!enemy._lastHit) {
          enemy._lastHit = { by: "status", part: "torso", crit: false, dmg: 0, weapon: null, via: "bleed" };
        }
        if (typeof ctx.onEnemyDied === "function") {
          ctx.onEnemyDied(enemy);
        } else {
          // Fallback removal
          try {
            const loot = (ctx.Loot && typeof ctx.Loot.generate === "function") ? (ctx.Loot.generate(ctx, enemy) || []) : [];
            ctx.corpses = Array.isArray(ctx.corpses) ? ctx.corpses : [];
            ctx.corpses.push({ x: enemy.x, y: enemy.y, loot, looted: loot.length === 0, meta: null });
          } catch (_) {}
          try {
            ctx.enemies = ctx.enemies.filter(e => e !== enemy);
            if (ctx.occupancy && typeof ctx.occupancy.clearEnemy === "function") ctx.occupancy.clearEnemy(enemy.x, enemy.y);
          } catch (_) {}
        }
      }
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