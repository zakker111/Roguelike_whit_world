/**
 * DungeonRuntime: generation and persistence glue for dungeon mode.
 *
 * Exports (window.DungeonRuntime):
 * - keyFromWorldPos(x, y)
 * - save(ctx, logOnce=false)
 * - load(ctx, x, y): returns boolean
 * - generate(ctx, depth=1)
 */
(function () {
  function keyFromWorldPos(x, y) {
    if (typeof window !== "undefined" && window.DungeonState && typeof DungeonState.key === "function") {
      return DungeonState.key(x, y);
    }
    return `${x},${y}`;
  }

  function save(ctx, logOnce) {
    if (typeof window !== "undefined" && window.DungeonState && typeof DungeonState.save === "function") {
      try { if (window.DEV && logOnce) console.log("[TRACE] Calling DungeonState.save"); } catch (_) {}
      DungeonState.save(ctx);
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

  function load(ctx, x, y) {
    if (typeof window !== "undefined" && window.DungeonState && typeof DungeonState.load === "function") {
      const ok = DungeonState.load(ctx, x, y);
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

  function generate(ctx, depth) {
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
        if (typeof window !== "undefined" && window.OccupancyGrid && typeof OccupancyGrid.build === "function") {
          ctx.occupancy = OccupancyGrid.build({ map: ctx.map, enemies: ctx.enemies, npcs: ctx.npcs, props: ctx.townProps, player: ctx.player });
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

  function killEnemy(ctx, enemy) {
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
      } else if (typeof window !== "undefined" && window.Player && typeof Player.gainXP === "function") {
        Player.gainXP(ctx.player, xp, { log: ctx.log, updateUI: ctx.updateUI });
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
    try {
      if (typeof save === "function") {
        save(ctx, false);
      } else if (ctx.DungeonState && typeof ctx.DungeonState.save === "function") {
        ctx.DungeonState.save(ctx);
      } else if (typeof window !== "undefined" && window.DungeonState && typeof DungeonState.save === "function") {
        DungeonState.save(ctx);
      }
    } catch (_) {}
  }

  window.DungeonRuntime = { keyFromWorldPos, save, load, generate, killEnemy };
})();