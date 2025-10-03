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
    const isFreeFloor = (x, y) => {
      if (window.Utils && typeof Utils.isFreeFloor === "function") {
        return Utils.isFreeFloor(ctx, x, y);
      }
      if (!ctx.inBounds(x, y)) return false;
      if (ctx.map[y][x] !== ctx.TILES.FLOOR) return false;
      if (ctx.player.x === x && ctx.player.y === y) return false;
      if (ctx.enemies.some(e => e.x === x && e.y === y)) return false;
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
      if (!free.length) return null;
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
        e.atk = Math.max(0.1, Math.round(e.atk * multA * 10) / 10);
      }
      e.announced = false;
      ctx.enemies.push(e);
      spawned.push(e);
      const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
      ctx.log(`GOD: Spawned ${cap(e.type || "enemy")} Lv ${e.level || 1} at (${e.x},${e.y}).`, "notice");
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