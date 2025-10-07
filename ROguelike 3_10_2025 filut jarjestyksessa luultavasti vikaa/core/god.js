/**
 * GodFallback: extracted GOD helpers (fallbacks when data/god.js is not present).
 *
 * Exports (window.GodFallback):
 * - heal(ctx)
 * - spawnStairsHere(ctx)
 * - spawnItems(ctx, count=3)
 * - spawnEnemyNearby(ctx, count=1)
 *
 * These operate entirely via the provided ctx from core/game.js (window.__getGameCtx()).
 */
(function () {
  function heal(ctx) {
    try {
      var prev = ctx.player.hp;
      ctx.player.hp = ctx.player.maxHp;
      if (ctx.player.hp > prev) {
        ctx.log("GOD: You are fully healed (" + ctx.player.hp.toFixed(1) + "/" + ctx.player.maxHp.toFixed(1) + " HP).", "good");
      } else {
        ctx.log("GOD: HP already full (" + ctx.player.hp.toFixed(1) + "/" + ctx.player.maxHp.toFixed(1) + ").", "warn");
      }
      ctx.updateUI();
      ctx.requestDraw();
    } catch (e) {}
  }

  function spawnStairsHere(ctx) {
    try {
      var x = ctx.player.x, y = ctx.player.y;
      if (!ctx.inBounds(x, y)) {
        ctx.log("GOD: Cannot place stairs out of bounds.", "warn");
        return;
      }
      ctx.map[y][x] = ctx.TILES.STAIRS;
      if (ctx.seen[y]) ctx.seen[y][x] = true;
      if (ctx.visible[y]) ctx.visible[y][x] = true;
      ctx.log("GOD: Stairs appear beneath your feet.", "notice");
      ctx.requestDraw();
    } catch (e) {}
  }

  function priceFor(item) {
    if (!item) return 10;
    if (item.kind === "potion") {
      var h = item.heal != null ? item.heal : 5;
      return Math.max(5, Math.min(50, Math.round(h * 2)));
    }
    var base = (item.atk || 0) * 10 + (item.def || 0) * 10;
    var tier = (item.tier || 1);
    return Math.max(15, Math.round(base + tier * 15));
  }

  function spawnItems(ctx, count) {
    var n = (Number(count) || 0) | 0;
    if (n <= 0) n = 3;
    var created = [];
    for (var i = 0; i < n; i++) {
      var it = null;
      try {
        if (window.Items && typeof window.Items.createEquipment === "function") {
          var tier = Math.min(3, Math.max(1, Math.floor(((ctx.floor || 1) + 1) / 2)));
          it = window.Items.createEquipment(tier, (ctx.rng || Math.random));
        } else if (window.DungeonItems && window.DungeonItems.lootFactories && typeof window.DungeonItems.lootFactories === "object") {
          var keys = Object.keys(window.DungeonItems.lootFactories);
          if (keys.length > 0) {
            var k = keys[Math.floor((ctx.rng ? ctx.rng() : Math.random) * keys.length)];
            try { it = window.DungeonItems.lootFactories[k](ctx, { tier: 2 }); } catch (_) {}
          }
        }
      } catch (_) {}
      if (!it) {
        if ((ctx.rng ? ctx.rng() : Math.random) < 0.5) {
          it = { kind: "equip", slot: "hand", name: "debug sword", atk: 1.5, tier: 2, decay: (typeof ctx.initialDecay === "function" ? ctx.initialDecay(2) : 10) };
        } else {
          it = { kind: "equip", slot: "torso", name: "debug armor", def: 1.0, tier: 2, decay: (typeof ctx.initialDecay === "function" ? ctx.initialDecay(2) : 10) };
        }
      }
      ctx.player.inventory.push(it);
      var name = (typeof ctx.describeItem === "function") ? ctx.describeItem(it) : (it.name || "item");
      created.push(name);
    }
    if (created.length) {
      ctx.log("GOD: Spawned " + created.length + " item" + (created.length > 1 ? "s" : "") + ":", "info");
      created.forEach(function (n) { ctx.log("- " + n); });
      ctx.updateUI();
      if (typeof ctx.renderInventory === "function") ctx.renderInventory();
      ctx.requestDraw();
    }
  }

  function spawnEnemyNearby(ctx, count) {
    var n = (Number(count) || 0) | 0;
    if (n <= 0) n = 1;

    function isFreeFloor(x, y) {
      if (!ctx.inBounds(x, y)) return false;
      if (ctx.map[y][x] !== ctx.TILES.FLOOR) return false;
      if (ctx.player.x === x && ctx.player.y === y) return false;
      if (Array.isArray(ctx.enemies) && ctx.enemies.some(function (e) { return e.x === x && e.y === y; })) return false;
      return true;
    }

    function pickNearby() {
      var maxAttempts = 60;
      for (var i = 0; i < maxAttempts; i++) {
        var dx = (typeof window.RNG !== "undefined" && typeof RNG.int === "function") ? RNG.int(-5, 5) : (Math.floor((ctx.rng ? ctx.rng() : Math.random) * 11) - 5);
        var dy = (typeof window.RNG !== "undefined" && typeof RNG.int === "function") ? RNG.int(-5, 5) : (Math.floor((ctx.rng ? ctx.rng() : Math.random) * 11) - 5);
        var x = ctx.player.x + dx;
        var y = ctx.player.y + dy;
        if (isFreeFloor(x, y)) return { x: x, y: y };
      }
      var free = [];
      for (var y = 0; y < ctx.map.length; y++) {
        for (var x = 0; x < (ctx.map[0] ? ctx.map[0].length : 0); x++) {
          if (isFreeFloor(x, y)) free.push({ x: x, y: y });
        }
      }
      if (free.length === 0) return null;
      var idx = Math.floor((ctx.rng ? ctx.rng() : Math.random) * free.length);
      return free[idx];
    }

    var spawned = [];
    for (var i = 0; i < n; i++) {
      var spot = pickNearby();
      if (!spot) break;
      var makeEnemy = (ctx.enemyFactory || function (x, y, depth) { return { x: x, y: y, type: "goblin", glyph: "g", hp: 3, atk: 1, xp: 5, level: depth, announced: false }; });
      var e = makeEnemy(spot.x, spot.y, (ctx.floor || 1));
      try {
        var r = (ctx.rng ? ctx.rng() : Math.random);
        if (typeof e.hp === "number" && r < 0.7) {
          var mult = 0.85 + (ctx.rng ? ctx.rng() : Math.random) * 0.5;
          e.hp = Math.max(1, Math.round(e.hp * mult));
        }
        if (typeof e.atk === "number" && ((ctx.rng ? ctx.rng() : Math.random) < 0.7)) {
          var multA = 0.85 + (ctx.rng ? ctx.rng() : Math.random) * 0.5;
          e.atk = Math.max(0.1, Math.round(e.atk * multA * 10) / 10);
        }
      } catch (_) {}
      e.announced = false;
      ctx.enemies.push(e);
      spawned.push(e);
      ctx.log("GOD: Spawned " + (ctx.PlayerUtils && typeof ctx.PlayerUtils.capitalize === "function" ? ctx.PlayerUtils.capitalize(e.type || "enemy") : (e.type || "enemy")) + " Lv " + (e.level || 1) + " at (" + e.x + "," + e.y + ").", "notice");
    }
    if (spawned.length > 0) {
      ctx.requestDraw();
    } else {
      ctx.log("GOD: No free space to spawn an enemy nearby.", "warn");
    }
  }

  window.GodFallback = {
    heal: heal,
    spawnStairsHere: spawnStairsHere,
    spawnItems: spawnItems,
    spawnEnemyNearby: spawnEnemyNearby
  };
})();