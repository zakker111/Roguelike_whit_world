/**
 * GOD mode actions: centralized debug helpers accessed by core/game.js.
 *
 * Exports (window.God):
 * - heal(ctx)
 * - spawnStairsHere(ctx)
 * - spawnItems(ctx, count=3)
 * - spawnEnemyNearby(ctx, count=1)
 * - applySeed(ctx, seedUint32)
 * - rerollSeed(ctx)
 * - setAlwaysCrit(ctx, v:boolean)
 * - setCritPart(ctx, part: "torso"|"head"|"hands"|"legs"|"" )
 */
(function () {
  function heal(ctx) {
    const p = ctx.player;
    const prev = p.hp;
    p.hp = p.maxHp;
    if (p.hp > prev) {
      ctx.log(`GOD: You are fully healed (${p.hp.toFixed(1)}/${p.maxHp.toFixed(1)} HP).`, "good");
    } else {
      ctx.log(`GOD: HP already full (${p.hp.toFixed(1)}/${p.maxHp.toFixed(1)}).`, "warn");
    }
    if (typeof ctx.updateUI === "function") ctx.updateUI();
    if (typeof ctx.requestDraw === "function") ctx.requestDraw();
  }

  function spawnStairsHere(ctx) {
    const { player, map, TILES, inBounds } = ctx;
    if (!inBounds(player.x, player.y)) {
      ctx.log("GOD: Cannot place stairs out of bounds.", "warn");
      return;
    }
    map[player.y][player.x] = TILES.STAIRS;
    ctx.seen[player.y][player.x] = true;
    ctx.visible[player.y][player.x] = true;
    ctx.log("GOD: Stairs appear beneath your feet.", "notice");
    if (typeof ctx.requestDraw === "function") ctx.requestDraw();
  }

  function spawnItems(ctx, count) {
    const rng = ctx.rng || Math.random;
    const created = [];
    for (let i = 0; i < (count || 3); i++) {
      let it = null;
      try {
        if (ctx.Items && typeof ctx.Items.createEquipment === "function") {
          const tier = Math.min(3, Math.max(1, Math.floor((ctx.floor + 1) / 2)));
          it = ctx.Items.createEquipment(tier, rng);
        } else if (ctx.DungeonItems && ctx.DungeonItems.lootFactories && typeof ctx.DungeonItems.lootFactories === "object") {
          const keys = Object.keys(ctx.DungeonItems.lootFactories);
          if (keys.length > 0) {
            const k = keys[Math.floor(rng() * keys.length)];
            it = ctx.DungeonItems.lootFactories[k](ctx, { tier: 2 });
          }
        }
      } catch (_) {}
      if (!it) {
        if (rng() < 0.5) it = { kind: "equip", slot: "hand", name: "debug sword", atk: 1.5, tier: 2, decay: (ctx.initialDecay ? ctx.initialDecay(2) : 5) };
        else it = { kind: "equip", slot: "torso", name: "debug armor", def: 1.0, tier: 2, decay: (ctx.initialDecay ? ctx.initialDecay(2) : 5) };
      }
      ctx.player.inventory.push(it);
      try {
        const name = (typeof ctx.describeItem === "function") ? ctx.describeItem(it) : (it.name || "item");
        created.push(name);
      } catch (_) {
        created.push(it.name || "item");
      }
    }
    if (created.length) {
      ctx.log(`GOD: Spawned ${created.length} item${created.length > 1 ? "s" : ""}:`);
      created.forEach(n => ctx.log(`- ${n}`));
      if (typeof ctx.updateUI === "function") ctx.updateUI();
      if (typeof ctx.renderInventory === "function") ctx.renderInventory(ctx.player, ctx.describeItem);
      if (typeof ctx.requestDraw === "function") ctx.requestDraw();
    }
  }

  function spawnEnemyNearby(ctx, count) {
    const rng = ctx.rng || Math.random;

    const isFreeFloor = (x, y) => {
      if (!ctx.inBounds(x, y)) return false;
      if (ctx.map[y][x] !== ctx.TILES.FLOOR) return false;
      if (ctx.player.x === x && ctx.player.y === y) return false;
      if (ctx.enemies.some(e => e.x === x && e.y === y)) return false;
      return true;
    };

    const pickNearby = () => {
      const maxAttempts = 60;
      for (let i = 0; i < maxAttempts; i++) {
        const dx = (Math.floor(rng() * 11) - 5);
        const dy = (Math.floor(rng() * 11) - 5);
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
      return free[Math.floor(rng() * free.length)];
    };

    const spawned = [];
    const makeEnemy = (ctx.enemyFactory || ((x, y, depth) => ({ x, y, type: "goblin", glyph: "g", hp: 3, atk: 1, xp: 5, level: depth, announced: false })));

    for (let i = 0; i < (count || 1); i++) {
      const spot = pickNearby();
      if (!spot) break;
      const e = makeEnemy(spot.x, spot.y, ctx.floor);
      if (typeof e.hp === "number" && rng() < 0.7) {
        const mult = 0.85 + rng() * 0.5;
        e.hp = Math.max(1, Math.round(e.hp * mult));
      }
      if (typeof e.atk === "number" && rng() < 0.7) {
        const multA = 0.85 + rng() * 0.5;
        e.atk = Math.max(0.1, Math.round(e.atk * multA * 10) / 10);
      }
      e.announced = false;
      ctx.enemies.push(e);
      spawned.push(e);
      const Cap = (ctx.utils && ctx.utils.capitalize) ? ctx.utils.capitalize : (s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
      ctx.log(`GOD: Spawned ${Cap(e.type || "enemy")} Lv ${e.level || 1} at (${e.x},${e.y}).`, "notice");
    }

    if (spawned.length > 0) {
      if (typeof ctx.requestDraw === "function") ctx.requestDraw();
    } else {
      ctx.log("GOD: No free space to spawn an enemy nearby.", "warn");
    }
  }

  function applySeed(ctx, seedUint32) {
    const s = (Number(seedUint32) >>> 0);
    try { localStorage.setItem("SEED", String(s)); } catch (_) {}
    try {
      if (typeof window !== "undefined" && window.RNG && typeof RNG.applySeed === "function") {
        RNG.applySeed(s);
        ctx.rng = RNG.rng;
      } else if (typeof window !== "undefined" && window.RNGFallback && typeof RNGFallback.getRng === "function") {
        ctx.rng = RNGFallback.getRng(s);
      } else {
        ctx.rng = Math.random;
      }
    } catch (_) {
      ctx.rng = Math.random;
    }

    if (ctx.mode === "world") {
      ctx.log(`GOD: Applied seed ${s}. Regenerating overworld...`, "notice");
      if (typeof ctx.initWorld === "function") ctx.initWorld();
    } else {
      ctx.log(`GOD: Applied seed ${s}. Regenerating floor ${ctx.floor}...`, "notice");
      if (typeof ctx.generateLevel === "function") ctx.generateLevel(ctx.floor);
    }
    if (typeof ctx.requestDraw === "function") ctx.requestDraw();

    try {
      const el = document.getElementById("god-seed-help");
      if (el) el.textContent = `Current seed: ${s}`;
      const input = document.getElementById("god-seed-input");
      if (input) input.value = String(s);
    } catch (_) {}
  }

  function rerollSeed(ctx) {
    const s = (Date.now() % 0xffffffff) >>> 0;
    return applySeed(ctx, s);
  }

  function setAlwaysCrit(ctx, v) {
    const on = !!v;
    try {
      if (typeof window !== "undefined") window.ALWAYS_CRIT = on;
      try { localStorage.setItem("ALWAYS_CRIT", on ? "1" : "0"); } catch (_) {}
    } catch (_) {}
    try {
      ctx.log(`GOD: Always Crit ${on ? "enabled" : "disabled"}.`, on ? "good" : "warn");
    } catch (_) {}
    if (typeof ctx.requestDraw === "function") ctx.requestDraw();
  }

  function setCritPart(ctx, part) {
    const valid = new Set(["torso","head","hands","legs",""]);
    const p = valid.has(part) ? part : "";
    try {
      if (typeof window !== "undefined") window.ALWAYS_CRIT_PART = p;
      if (p) { try { localStorage.setItem("ALWAYS_CRIT_PART", p); } catch (_) {} }
      else { try { localStorage.removeItem("ALWAYS_CRIT_PART"); } catch (_) {} }
    } catch (_) {}
    try {
      if (p) ctx.log(`GOD: Forcing crit hit location: ${p}.`, "notice");
      else ctx.log("GOD: Cleared forced crit hit location.", "notice");
    } catch (_) {}
    if (typeof ctx.requestDraw === "function") ctx.requestDraw();
  }

  window.God = { heal, spawnStairsHere, spawnItems, spawnEnemyNearby, applySeed, rerollSeed, setAlwaysCrit, setCritPart };
})();