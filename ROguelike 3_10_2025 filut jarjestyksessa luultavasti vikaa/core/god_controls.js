/**
 * GodControls: GOD mode helpers extracted from game.js.
 *
 * API (globals on window.GodControls):
 *  - heal(ctx)
 *  - spawnStairsHere(ctx)
 *  - spawnItems(ctx, count=3)
 *  - spawnEnemyNearby(ctx, count=1)
 *  - setAlwaysCrit(ctx, v)
 *  - setCritPart(ctx, part)
 *  - applySeed(ctx, seedUint32)
 *  - rerollSeed(ctx)
 */
(function () {
  function heal(ctx) {
    const God = ctx.God || window.God;
    if (God && typeof God.heal === "function") { God.heal(ctx); return; }
    const prev = ctx.player.hp;
    ctx.player.hp = ctx.player.maxHp;
    if (ctx.log) {
      if (ctx.player.hp > prev) ctx.log(`GOD: You are fully healed (${ctx.player.hp.toFixed(1)}/${ctx.player.maxHp.toFixed(1)} HP).`, "good");
      else ctx.log(`GOD: HP already full (${ctx.player.hp.toFixed(1)}/${ctx.player.maxHp.toFixed(1)}).`, "warn");
    }
    if (ctx.updateUI) ctx.updateUI();
    if (ctx.requestDraw) ctx.requestDraw();
  }

  function spawnStairsHere(ctx) {
    const God = ctx.God || window.God;
    if (God && typeof God.spawnStairsHere === "function") { God.spawnStairsHere(ctx); return; }
    if (!ctx.inBounds(ctx.player.x, ctx.player.y)) {
      if (ctx.log) ctx.log("GOD: Cannot place stairs out of bounds.", "warn");
      return;
    }
    ctx.map[ctx.player.y][ctx.player.x] = ctx.TILES.STAIRS;
    ctx.seen[ctx.player.y][ctx.player.x] = true;
    ctx.visible[ctx.player.y][ctx.player.x] = true;
    if (ctx.log) ctx.log("GOD: Stairs appear beneath your feet.", "notice");
    if (ctx.requestDraw) ctx.requestDraw();
  }

  function spawnItems(ctx, count = 3) {
    const God = ctx.God || window.God;
    if (God && typeof God.spawnItems === "function") { God.spawnItems(ctx, count); return; }
    const created = [];
    for (let i = 0; i < count; i++) {
      let it = null;
      const Items = ctx.Items || window.Items;
      const DungeonItems = ctx.DungeonItems || window.DungeonItems;
      if (Items && typeof Items.createEquipment === "function") {
        const tier = Math.min(3, Math.max(1, Math.floor((ctx.floor + 1) / 2)));
        it = Items.createEquipment(tier, ctx.rng);
      } else if (DungeonItems && DungeonItems.lootFactories && typeof DungeonItems.lootFactories === "object") {
        const keys = Object.keys(DungeonItems.lootFactories);
        if (keys.length > 0) {
          const k = keys[Math.floor(ctx.rng() * keys.length)];
          try { it = DungeonItems.lootFactories[k](ctx, { tier: 2 }); } catch (_) {}
        }
      }
      if (!it) {
        if (ctx.rng() < 0.5) it = { kind: "equip", slot: "hand", name: "debug sword", atk: 1.5, tier: 2, decay: (ctx.initialDecay ? ctx.initialDecay(2) : 10) };
        else it = { kind: "equip", slot: "torso", name: "debug armor", def: 1.0, tier: 2, decay: (ctx.initialDecay ? ctx.initialDecay(2) : 10) };
      }
      ctx.player.inventory.push(it);
      const describe = ctx.describeItem || ((x)=>x?.name||"item");
      created.push(describe(it));
    }
    if (created.length) {
      if (ctx.log) {
        ctx.log(`GOD: Spawned ${created.length} item${created.length > 1 ? "s" : ""}:`);
        created.forEach(n => ctx.log(`- ${n}`));
      }
      if (ctx.updateUI) ctx.updateUI();
      const GI = window.GameInventory;
      if (GI && typeof GI.renderInventoryPanel === "function") GI.renderInventoryPanel(ctx);
      if (ctx.requestDraw) ctx.requestDraw();
    }
  }

  function spawnEnemyNearby(ctx, count = 1) {
    const God = ctx.God || window.God;
    if (God && typeof God.spawnEnemyNearby === "function") { God.spawnEnemyNearby(ctx, count); return; }
    const isFreeFloor = (x, y) => {
      if (!ctx.inBounds(x, y)) return false;
      if (ctx.map[y][x] !== ctx.TILES.FLOOR) return false;
      if (ctx.player.x === x && ctx.player.y === y) return false;
      if (Array.isArray(ctx.enemies) && ctx.enemies.some(e => e.x === x && e.y === y)) return false;
      return true;
    };
    const pickNearby = () => {
      const maxAttempts = 60;
      for (let i = 0; i < maxAttempts; i++) {
        const dx = Math.floor(ctx.rng() * 11) - 5;
        const dy = Math.floor(ctx.rng() * 11) - 5;
        const x = ctx.player.x + dx;
        const y = ctx.player.y + dy;
        if (isFreeFloor(x, y)) return { x, y };
      }
      const free = [];
      for (let y = 0; y < ctx.map.length; y++) {
        for (let x = 0; x < (ctx.map[0] ? ctx.map[0].length : 0); x++) {
          if (isFreeFloor(x, y)) free.push({ x, y });
        }
      }
      if (free.length === 0) return null;
      return free[Math.floor(ctx.rng() * free.length)];
    };

    const spawned = [];
    for (let i = 0; i < count; i++) {
      const spot = pickNearby();
      if (!spot) break;
      const makeEnemy = (ctx.enemyFactory || ((x, y, depth) => ({ x, y, type: "goblin", glyph: "g", hp: 3, atk: 1, xp: 5, level: depth, announced: false })));
      const e = makeEnemy(spot.x, spot.y, ctx.floor);

      if (typeof e.hp === "number" && ctx.rng() < 0.7) {
        const mult = 0.85 + ctx.rng() * 0.5;
        e.hp = Math.max(1, Math.round(e.hp * mult));
      }
      if (typeof e.atk === "number" && ctx.rng() < 0.7) {
        const multA = 0.85 + ctx.rng() * 0.5;
        const round1 = ctx.round1 || ((n) => Math.round(n * 10) / 10);
        e.atk = Math.max(0.1, round1(e.atk * multA));
      }
      e.announced = false;
      ctx.enemies.push(e);
      spawned.push(e);
      const cap = (ctx.PlayerUtils && typeof ctx.PlayerUtils.capitalize === "function") ? ctx.PlayerUtils.capitalize : (s)=>s ? s.charAt(0).toUpperCase()+s.slice(1) : s;
      if (ctx.log) ctx.log(`GOD: Spawned ${cap(e.type || "enemy")} Lv ${e.level || 1} at (${e.x},${e.y}).`, "notice");
    }
    if (spawned.length > 0) {
      if (ctx.requestDraw) ctx.requestDraw();
    } else {
      if (ctx.log) ctx.log("GOD: No free space to spawn an enemy nearby.", "warn");
    }
  }

  function setAlwaysCrit(ctx, v) {
    const God = ctx.God || window.God;
    if (God && typeof God.setAlwaysCrit === "function") { God.setAlwaysCrit(ctx, v); return; }
    const alwaysCrit = !!v;
    try { window.ALWAYS_CRIT = alwaysCrit; localStorage.setItem("ALWAYS_CRIT", alwaysCrit ? "1" : "0"); } catch (_) {}
    if (ctx.log) ctx.log(`GOD: Always Crit ${alwaysCrit ? "enabled" : "disabled"}.`, alwaysCrit ? "good" : "warn");
  }

  function setCritPart(ctx, part) {
    const God = ctx.God || window.God;
    if (God && typeof God.setCritPart === "function") { God.setCritPart(ctx, part); return; }
    const valid = new Set(["torso","head","hands","legs",""]);
    const p = valid.has(part) ? part : "";
    try {
      window.ALWAYS_CRIT_PART = p;
      if (p) localStorage.setItem("ALWAYS_CRIT_PART", p);
      else localStorage.removeItem("ALWAYS_CRIT_PART");
    } catch (_) {}
    if (ctx.log) {
      if (p) ctx.log(`GOD: Forcing crit hit location: ${p}.`, "notice");
      else ctx.log("GOD: Cleared forced crit hit location.", "notice");
    }
  }

  function applySeed(ctx, seedUint32) {
    const God = ctx.God || window.God;
    if (God && typeof God.applySeed === "function") { God.applySeed(ctx, seedUint32); return; }
    const s = (Number(seedUint32) >>> 0);
    try { localStorage.setItem("SEED", String(s)); } catch (_) {}
    if (typeof window !== "undefined" && window.RNG && typeof window.RNG.applySeed === "function") {
      window.RNG.applySeed(s);
      ctx.rng = window.RNG.rng;
    } else {
      function mulberry32(a) {
        return function() {
          let t = a += 0x6D2B79F5;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }
      const _rng = mulberry32(s);
      ctx.rng = function () { return _rng(); };
    }
    if (ctx.mode === "world") {
      if (ctx.log) ctx.log(`GOD: Applied seed ${s}. Regenerating overworld...`, "notice");
      if (ctx.initWorld) ctx.initWorld();
    } else {
      if (ctx.log) ctx.log(`GOD: Applied seed ${s}. Regenerating floor ${ctx.floor}...`, "notice");
      if (ctx.generateLevel) ctx.generateLevel(ctx.floor);
    }
    if (ctx.requestDraw) ctx.requestDraw();
    try {
      const el = document.getElementById("god-seed-help");
      if (el) el.textContent = `Current seed: ${s}`;
      const input = document.getElementById("god-seed-input");
      if (input) input.value = String(s);
    } catch (_) {}
  }

  function rerollSeed(ctx) {
    const God = ctx.God || window.God;
    if (God && typeof God.rerollSeed === "function") { God.rerollSeed(ctx); return; }
    const s = (Date.now() % 0xffffffff) >>> 0;
    applySeed(ctx, s);
  }

  window.GodControls = {
    heal,
    spawnStairsHere,
    spawnItems,
    spawnEnemyNearby,
    setAlwaysCrit,
    setCritPart,
    applySeed,
    rerollSeed,
  };
})();