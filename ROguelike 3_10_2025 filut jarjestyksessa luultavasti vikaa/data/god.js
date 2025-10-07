/**
 * GOD utilities: cheat/debug helpers wired through ctx.
 *
 * API:
 *   God.heal(ctx)
 *   God.spawnStairsHere(ctx)
 *   God.spawnItems(ctx, count)
 *   God.spawnEnemyNearby(ctx, count)
 *   God.setAlwaysCrit(ctx, enabled)
 *   God.setCritPart(ctx, part)
 *   God.applySeed(ctx, seedUint32)
 *   God.rerollSeed(ctx)
 */
(function () {
  function heal(ctx) {
    const prev = ctx.player.hp;
    ctx.player.hp = ctx.player.maxHp;
    if (ctx.player.hp > prev) ctx.log(`GOD: You are fully healed (${ctx.player.hp.toFixed(1)}/${ctx.player.maxHp.toFixed(1)} HP).`, "good");
    else ctx.log(`GOD: HP already full (${ctx.player.hp.toFixed(1)}/${ctx.player.maxHp.toFixed(1)}).`, "warn");
    ctx.updateUI();
    ctx.requestDraw();
  }

  function spawnStairsHere(ctx) {
    const x = ctx.player.x, y = ctx.player.y;
    if (!ctx.inBounds(x, y)) { ctx.log("GOD: Cannot place stairs out of bounds.", "warn"); return; }
    ctx.map[y][x] = ctx.TILES.STAIRS;
    ctx.seen[y][x] = true;
    ctx.visible[y][x] = true;
    ctx.log("GOD: Stairs appear beneath your feet.", "notice");
    ctx.requestDraw();
  }

  function spawnItems(ctx, count = 3) {
    const created = [];
    for (let i = 0; i < count; i++) {
      let it = null;
      if (ctx.Items && typeof ctx.Items.createEquipment === "function") {
        const tier = Math.min(3, Math.max(1, Math.floor((ctx.floor + 1) / 2)));
        it = ctx.Items.createEquipment(tier, ctx.rng);
      } else if (ctx.DungeonItems && ctx.DungeonItems.lootFactories && typeof ctx.DungeonItems.lootFactories === "object") {
        const keys = Object.keys(ctx.DungeonItems.lootFactories);
        if (keys.length > 0) {
          const k = keys[Math.floor(ctx.rng() * keys.length)];
          try { it = ctx.DungeonItems.lootFactories[k](ctx, { tier: 2 }); } catch (_) {}
        }
      }
      if (!it) {
        if (ctx.rng() < 0.5) it = { kind: "equip", slot: "hand", name: "debug sword", atk: 1.5, tier: 2, decay: (ctx.initialDecay ? ctx.initialDecay(2) : 0) };
        else it = { kind: "equip", slot: "torso", name: "debug armor", def: 1.0, tier: 2, decay: (ctx.initialDecay ? ctx.initialDecay(2) : 0) };
      }
      ctx.player.inventory.push(it);
      if (ctx.describeItem) created.push(ctx.describeItem(it));
    }
    if (created.length) {
      ctx.log(`GOD: Spawned ${created.length} item${created.length > 1 ? "s" : ""}:`);
      created.forEach(n => ctx.log(`- ${n}`));
      ctx.updateUI();
      if (ctx.renderInventory) ctx.renderInventory();
      ctx.requestDraw();
    }
  }

  function spawnEnemyNearby(ctx, count = 1) {
    // Enemy spawning is supported in dungeon mode only
    if (ctx.mode !== "dungeon") {
      ctx.log("GOD: Enemy spawn works in dungeon mode only.", "warn");
      return;
    }
    const isFreeFloor = (x, y) => {
      try {
        if (!ctx.inBounds(x, y)) return false;
        // Prefer generalized walkability over strict FLOOR to allow doors, etc.
        const walkable = (typeof ctx.isWalkable === "function") ? ctx.isWalkable(x, y) : (ctx.map[y][x] === ctx.TILES.FLOOR || ctx.map[y][x] === ctx.TILES.DOOR || ctx.map[y][x] === ctx.TILES.STAIRS);
        if (!walkable) return false;
        if (ctx.player.x === x && ctx.player.y === y) return false;
        // Prefer occupancy grid if available to avoid stale blocking
        const occEnemy = (ctx.occupancy && typeof ctx.occupancy.hasEnemy === "function") ? ctx.occupancy.hasEnemy(x, y) : ctx.enemies.some(e => e && e.x === x && e.y === y);
        if (occEnemy) return false;
        return true;
      } catch (_) {
        return false;
      }
    };
    const pickNearby = () => {
      const maxAttempts = 100;
      for (let i = 0; i < maxAttempts; i++) {
        const dx = Math.floor(ctx.rng() * 17) - 8; // wider search radius
        const dy = Math.floor(ctx.rng() * 17) - 8;
        const x = ctx.player.x + dx;
        const y = ctx.player.y + dy;
        if (isFreeFloor(x, y)) return { x, y };
      }
      const free = [];
      const rows = ctx.map.length;
      const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if (isFreeFloor(x, y)) free.push({ x, y });
        }
      }
      if (!free.length) return null;
      return free[Math.floor(ctx.rng() * free.length)];
    };

    const spawned = [];
    for (let i = 0; i < count; i++) {
      const spot = pickNearby();
      if (!spot) break;
      const makeEnemy = (ctx.enemyFactory || ((x, y, depth) => ({ x, y, type: "goblin", glyph: "g", hp: 3, atk: 1, xp: 5, level: depth, announced: false })));
      const e = makeEnemy(spot.x, spot.y, ctx.floor);

      // Guard against null/invalid enemy factories — fallback to a basic goblin
      let ee = e;
      if (!ee || typeof ee.x !== "number" || typeof ee.y !== "number") {
        // Try to construct from Enemies registry for variety if available; fallback to GameData.enemies ids
        try {
          const EM = (typeof window !== "undefined" ? window.Enemies : null);
          let types = [];
          if (EM && typeof EM.listTypes === "function") {
            types = EM.listTypes();
          }
          if ((!types || types.length === 0) && typeof window !== "undefined" && window.GameData && Array.isArray(window.GameData.enemies)) {
            types = window.GameData.enemies.map(e => e.id || e.key).filter(Boolean);
          }
          if (types && types.length) {
            // Weighted pick by weight(depth) if EM available; otherwise uniform
            let pickKey = types[0];
            if (EM && typeof EM.getTypeDef === "function") {
              const entries = types.map(k => {
                const tdef = EM.getTypeDef(k);
                const w = (tdef && typeof tdef.weight === "function") ? tdef.weight(ctx.floor) : 1;
                return { key: k, w: Math.max(0, Number(w) || 0) };
              });
              const total = entries.reduce((s, e) => s + e.w, 0);
              if (total > 0) {
                let r = ctx.rng() * total;
                for (const e2 of entries) {
                  if (r < e2.w) { pickKey = e2.key; break; }
                  r -= e2.w;
                }
              }
              const td = EM.getTypeDef(pickKey);
              ee = {
                x: spot.x, y: spot.y,
                type: pickKey,
                glyph: td.glyph,
                hp: td.hp(ctx.floor),
                atk: td.atk(ctx.floor),
                xp: td.xp(ctx.floor),
                level: (EM.levelFor && typeof EM.levelFor === "function") ? EM.levelFor(pickKey, ctx.floor, ctx.rng) : ctx.floor,
                announced: false
              };
            } else {
              // No registry methods; create a minimal enemy object
              ee = { x: spot.x, y: spot.y, type: pickKey, glyph: "?", hp: 3, atk: 1, xp: 5, level: ctx.floor, announced: false };
            }
          } else {
            ee = { x: spot.x, y: spot.y, type: "goblin", glyph: "g", hp: 3, atk: 1, xp: 5, level: ctx.floor, announced: false };
          }
        } catch (_) {
          ee = { x: spot.x, y: spot.y, type: "goblin", glyph: "g", hp: 3, atk: 1, xp: 5, level: ctx.floor, announced: false };
        }
      }

      if (typeof ee.hp === "number" && ctx.rng() < 0.7) {
        const mult = 0.85 + ctx.rng() * 0.5;
        ee.hp = Math.max(1, Math.round(ee.hp * mult));
      }
      if (typeof ee.atk === "number" && ctx.rng() < 0.7) {
        const multA = 0.85 + ctx.rng() * 0.5;
        ee.atk = Math.max(0.1, Math.round(ee.atk * multA * 10) / 10);
      }
      ee.announced = false;
      ctx.enemies.push(ee);
      spawned.push(ee);
      const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
      ctx.log(`GOD: Spawned ${cap(ee.type || "enemy")} Lv ${ee.level || 1} at (${ee.x},${ee.y}).`, "notice");
    }
    if (spawned.length) ctx.requestDraw();
    else ctx.log("GOD: No free space to spawn an enemy nearby.", "warn");
  }

  function setAlwaysCrit(ctx, enabled) {
    ctx.alwaysCrit = !!enabled;
    try { window.ALWAYS_CRIT = ctx.alwaysCrit; localStorage.setItem("ALWAYS_CRIT", ctx.alwaysCrit ? "1" : "0"); } catch (_) {}
    ctx.log(`GOD: Always Crit ${ctx.alwaysCrit ? "enabled" : "disabled"}.`, ctx.alwaysCrit ? "good" : "warn");
  }

  function setCritPart(ctx, part) {
    const valid = new Set(["torso","head","hands","legs",""]);
    const p = valid.has(part) ? part : "";
    ctx.forcedCritPart = p;
    try {
      window.ALWAYS_CRIT_PART = p;
      if (p) localStorage.setItem("ALWAYS_CRIT_PART", p);
      else localStorage.removeItem("ALWAYS_CRIT_PART");
    } catch (_) {}
    if (p) ctx.log(`GOD: Forcing crit hit location: ${p}.`, "notice");
    else ctx.log("GOD: Cleared forced crit hit location.", "notice");
  }

  function applySeed(ctx, seedUint32) {
    const s = (Number(seedUint32) >>> 0);
    try { localStorage.setItem("SEED", String(s)); } catch (_) {}
    if (typeof window !== "undefined" && window.RNG && typeof RNG.applySeed === "function") {
      RNG.applySeed(s);
      ctx.rng = RNG.rng;
    } else {
      try {
        if (typeof window !== "undefined" && window.RNGFallback && typeof RNGFallback.getRng === "function") {
          ctx.rng = RNGFallback.getRng(s);
        } else {
          // As a last resort, use a time-seeded deterministic fallback
          ctx.rng = (function () {
            try { return RNGFallback.getRng(s); } catch (_) {}
            const seed = ((Date.now() % 0xffffffff) >>> 0);
            function mulberry32(a) {
              return function () {
                let t = a += 0x6D2B79F5;
                t = Math.imul(t ^ (t >>> 15), t | 1);
                t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
              };
            }
            const f = mulberry32(seed);
            return function () { return f(); };
          })();
        }
      } catch (_) {
        // Same last-resort deterministic fallback
        const seed = ((Date.now() % 0xffffffff) >>> 0);
        function mulberry32(a) {
          return function () {
            let t = a += 0x6D2B79F5;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
          };
        }
        const f = mulberry32(seed);
        ctx.rng = function () { return f(); };
      }
    }
    if (ctx.mode === "world") {
      ctx.log(`GOD: Applied seed ${s}. Regenerating overworld...`, "notice");
      ctx.initWorld();
    } else {
      ctx.log(`GOD: Applied seed ${s}. Regenerating floor ${ctx.floor}...`, "notice");
      ctx.generateLevel(ctx.floor);
    }
    ctx.requestDraw();
    try {
      const el = document.getElementById("god-seed-help");
      if (el) el.textContent = `Current seed: ${s}`;
      const input = document.getElementById("god-seed-input");
      if (input) input.value = String(s);
    } catch (_) {}
  }

  function rerollSeed(ctx) {
    const s = (Date.now() % 0xffffffff) >>> 0;
    applySeed(ctx, s);
  }

  window.God = { heal, spawnStairsHere, spawnItems, spawnEnemyNearby, setAlwaysCrit, setCritPart, applySeed, rerollSeed };
})();