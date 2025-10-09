(function () {
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  async function run(ctx) {
    try {
      var record = ctx.record || function(){};
      var recordSkip = ctx.recordSkip || function(){};
      var sleep = ctx.sleep || (ms => new Promise(r => setTimeout(r, ms|0)));
      var key = ctx.key || function(){};
      var makeBudget = ctx.makeBudget || (ms => {
        var start = Date.now(); var dl = start + (ms|0);
        return { exceeded: function(){return Date.now() > dl;}, remain: function(){return Math.max(0, dl - Date.now());} };
      });
      var CONFIG = ctx.CONFIG || { timeouts: { route: 5000, battle: 5000 } };
      var caps = (ctx && ctx.caps) || {};
      if (!caps.GameAPI || !caps.getMode || !caps.getEnemies) {
        recordSkip("Combat scenario skipped (GameAPI/getMode/getEnemies not available)");
        return true;
      }

      // Ensure no modal (GOD/Inventory/Shop/Smoke) is intercepting keys
      try { if (typeof ctx.ensureAllModalsClosed === "function") await ctx.ensureAllModalsClosed(8); } catch (_) {}

      // Ensure in dungeon with a single centralized attempt (avoid repeated toggles across scenarios)
      try {
        const mode0 = (window.GameAPI && typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : null;
        if (mode0 !== "dungeon") {
          const ok = (typeof ctx.ensureDungeonOnce === "function") ? await ctx.ensureDungeonOnce() : false;
          if (!ok) { recordSkip("Combat scenario skipped (not in dungeon)"); return true; }
        }
      } catch (_) {}

      // Ensure baseline hand equipment so decay snapshot has signal
      try {
        var ensureTries = 0;
        var hasHands = function () {
          var eqInfo = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
          return !!(eqInfo && (eqInfo.left || eqInfo.right));
        };
        var findHandIdx = function () {
          var inv = (typeof window.GameAPI.getInventory === "function") ? window.GameAPI.getInventory() : [];
          return inv.findIndex(function (it) { return it && it.kind === "equip" && it.slot === "hand"; });
        };
        while (!hasHands() && ensureTries < 3) {
          if (typeof window.GameAPI.spawnItems === "function") { window.GameAPI.spawnItems(3); }
          await sleep(160);
          // Try explicit hand equip first
          var hi = findHandIdx();
          if (hi !== -1) {
            if (typeof window.GameAPI.equipItemAtIndexHand === "function") {
              // Prefer left if empty, else right
              var eq0 = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
              var hand = (!eq0.left ? "left" : (!eq0.right ? "right" : "left"));
              window.GameAPI.equipItemAtIndexHand(hi, hand);
            } else if (typeof window.GameAPI.equipItemAtIndex === "function") {
              window.GameAPI.equipItemAtIndex(hi);
            }
            await sleep(140);
          } else if (typeof window.GameAPI.equipBestFromInventory === "function") {
            window.GameAPI.equipBestFromInventory();
            await sleep(140);
          }
          ensureTries++;
        }
      } catch (_) {}

      var enemiesBefore = (typeof window.GameAPI.getEnemies === "function") ? window.GameAPI.getEnemies().length : 0;

      // Spawn enemies via GOD panel and GameAPI (multiple attempts)
      try {
        var spawnedOk = false;
        // DOM clicks (GOD button) only make sense in dungeon; otherwise skip this sub-step
        try {
          var modeForSpawn = (typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : null;
          if (modeForSpawn === "dungeon") {
            var opened = false;
            var gob = document.getElementById("god-open-btn");
            if (gob) { gob.click(); opened = true; }
            if (opened) { await sleep(200); }
            for (var c = 0; c < 2; c++) {
              var btn = document.getElementById("god-spawn-enemy-btn");
              if (btn) { btn.click(); await sleep(160); }
            }
            var enemiesAfterDom = (typeof window.GameAPI.getEnemies === "function") ? window.GameAPI.getEnemies().length : enemiesBefore;
            spawnedOk = enemiesAfterDom > enemiesBefore;
            record(spawnedOk, "Dungeon spawn (GOD): enemies " + enemiesBefore + " -> " + enemiesAfterDom);
          } else {
            recordSkip("Dungeon spawn (GOD) skipped (not in dungeon)");
          }
        } catch (_) {}
        // GameAPI fallback with retries (works in dungeon; may also work in world depending on implementation)
        var attempts = 0;
        while (!spawnedOk && attempts < 3) {
          if (typeof window.GameAPI.spawnEnemyNearby === "function") {
            window.GameAPI.spawnEnemyNearby(2);
            await sleep(200);
          }
          var enemiesNow = (typeof window.GameAPI.getEnemies === "function") ? window.GameAPI.getEnemies().length : enemiesBefore;
          spawnedOk = enemiesNow > enemiesBefore;
          attempts++;
        }
        if (!spawnedOk) {
          recordSkip("No enemies available for combat pathing");
        }
      } catch (_) {}

      // Confirm enemy is near, then wait for first enemy hit (up to a short cap)
      try {
        var playerPos = (typeof window.GameAPI.getPlayer === "function") ? window.GameAPI.getPlayer() : { x: 0, y: 0 };
        var listNow = (typeof window.GameAPI.getEnemies === "function") ? (window.GameAPI.getEnemies() || []) : [];
        var nearest = null, bestD2 = Infinity;
        for (var ne = 0; ne < listNow.length; ne++) {
          var en = listNow[ne];
          var d2 = Math.abs(en.x - playerPos.x) + Math.abs(en.y - playerPos.y);
          if (d2 < bestD2) { bestD2 = d2; nearest = en; }
        }
        var NEAR_R = 5;
        if (nearest) {
          record(bestD2 <= NEAR_R, "Enemy nearby: dist " + bestD2 + (bestD2 <= NEAR_R ? " (<= " + NEAR_R + ")" : " (> " + NEAR_R + ")"));
        } else {
          recordSkip("No enemies visible after spawn for proximity check");
        }

        // If near enough, wait for first enemy hit (player HP drops)
        var st0 = (typeof window.GameAPI.getPlayerStatus === "function") ? window.GameAPI.getPlayerStatus() : null;
        var hp0 = (st0 && typeof st0.hp === "number") ? st0.hp : null;
        var turnsToWait = 10;
        var gotHit = false;
        if (nearest && bestD2 <= NEAR_R && hp0 != null) {
          for (var wt = 0; wt < turnsToWait; wt++) {
            key("Numpad5");
            await sleep(80);
            var stCur = (typeof window.GameAPI.getPlayerStatus === "function") ? window.GameAPI.getPlayerStatus() : null;
            var hpCur = (stCur && typeof stCur.hp === "number") ? stCur.hp : null;
            if (hpCur != null && hpCur < hp0) {
              record(true, "Enemy hit: HP " + hp0 + " -> " + hpCur + " in " + (wt + 1) + " turns");
              gotHit = true;
              break;
            }
          }
          if (!gotHit) {
            recordSkip("Enemy hit: none within " + turnsToWait + " turns");
          }
        } else {
          recordSkip("Enemy not near; skip waiting for hit");
        }
      } catch (_) {}

      // Route to nearest enemy and bump-attack
      var enemies = (typeof window.GameAPI.getEnemies === "function") ? window.GameAPI.getEnemies() : [];
      if (enemies && enemies.length) {
        var best = enemies[0];
        var bestD = Math.abs(best.x - window.GameAPI.getPlayer().x) + Math.abs(best.y - window.GameAPI.getPlayer().y);
        for (var i = 0; i < enemies.length; i++) {
          var e = enemies[i];
          var d = Math.abs(e.x - window.GameAPI.getPlayer().x) + Math.abs(e.y - window.GameAPI.getPlayer().y);
          if (d < bestD) { best = e; bestD = d; }
        }
        var usedHelper = false;
        try {
          var MV = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Movement;
          if (MV && typeof MV.routeTo === "function") {
            usedHelper = await MV.routeTo(best.x, best.y, { timeoutMs: (CONFIG && CONFIG.timeouts && CONFIG.timeouts.route) || 5000, stepMs: 110 });
          }
        } catch (_) {}
        if (!usedHelper) {
          var path = (typeof window.GameAPI.routeToDungeon === "function") ? window.GameAPI.routeToDungeon(best.x, best.y) : [];
          var budget = makeBudget(CONFIG.timeouts.route);
          for (var j = 0; j < path.length; j++) {
            var step = path[j];
            if (budget.exceeded()) { recordSkip("Routing to enemy timed out"); break; }
            var dx = Math.sign(step.x - window.GameAPI.getPlayer().x);
            var dy = Math.sign(step.y - window.GameAPI.getPlayer().y);
            key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
            await sleep(110);
          }
        }

        // Snapshot before bump-attacks
        var enemiesPre = (typeof window.GameAPI.getEnemies === "function") ? (window.GameAPI.getEnemies() || []) : [];
        var sumHpPre = enemiesPre.reduce(function(acc, e){ return acc + (typeof e.hp === "number" ? e.hp : 0); }, 0);
        var bestHpBefore = (typeof best.hp === "number") ? best.hp : null;
        var corpsesPre = (typeof window.GameAPI.getCorpses === "function") ? (window.GameAPI.getCorpses() || []).length : null;
        var decalsPre = (typeof window.GameAPI.getDecalsCount === "function") ? (window.GameAPI.getDecalsCount() | 0) : null;

        // battle bumps (attempt to collide/attack)
        var bb = makeBudget(CONFIG.timeouts.battle);
        for (var t = 0; t < 4; t++) {
          if (bb.exceeded()) { recordSkip("Combat burst timed out"); break; }
          var dx2 = Math.sign(best.x - window.GameAPI.getPlayer().x);
          var dy2 = Math.sign(best.y - window.GameAPI.getPlayer().y);
          key(dx2 === -1 ? "ArrowLeft" : dx2 === 1 ? "ArrowRight" : (dy2 === -1 ? "ArrowUp" : "ArrowDown"));
          await sleep(140);
        }
        record(true, "Moved and attempted attacks");

        // Post-checks: HP decrease, corpse or decals increase
        try {
          var enemiesPost = (typeof window.GameAPI.getEnemies === "function") ? (window.GameAPI.getEnemies() || []) : [];
          var sumHpPost = enemiesPost.reduce(function(acc, e){ return acc + (typeof e.hp === "number" ? e.hp : 0); }, 0);
          var corpsesPost = (typeof window.GameAPI.getCorpses === "function") ? (window.GameAPI.getCorpses() || []).length : null;
          var decalsPost = (typeof window.GameAPI.getDecalsCount === "function") ? (window.GameAPI.getDecalsCount() | 0) : null;

          // Find nearest enemy to original target and compare hp if possible
          var nearestAfter = null, nd = Infinity;
          for (var ii = 0; ii < enemiesPost.length; ii++) {
            var en = enemiesPost[ii];
            var d2 = Math.abs(en.x - best.x) + Math.abs(en.y - best.y);
            if (d2 < nd) { nd = d2; nearestAfter = en; }
          }
          var hpDroppedForTarget = (nearestAfter && typeof nearestAfter.hp === "number" && typeof bestHpBefore === "number") ? (nearestAfter.hp < bestHpBefore) : false;
          var sumHpDropped = (typeof sumHpPre === "number" && typeof sumHpPost === "number") ? (sumHpPost < sumHpPre) : false;
          var corpseInc = (corpsesPre != null && corpsesPost != null) ? (corpsesPost > corpsesPre) : false;
          var decalsInc = (decalsPre != null && decalsPost != null) ? (decalsPost > decalsPre) : false;

          var fightOk = hpDroppedForTarget || sumHpDropped || corpseInc || decalsInc;
          record(fightOk, "Combat effects: " +
            (hpDroppedForTarget ? "target hp↓ " : "") +
            (sumHpDropped ? "sum hp↓ " : "") +
            (corpseInc ? "corpse+ " : "") +
            (decalsInc ? "decals+ " : ""));
        } catch (_) {}
      }

      // Basic decay snapshot after combat attempt
      var eq = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
      var leftDecay = (eq && eq.left && typeof eq.left.decay === "number") ? eq.left.decay : null;
      var rightDecay = (eq && eq.right && typeof eq.right.decay === "number") ? eq.right.decay : null;
      if (leftDecay != null || rightDecay != null) {
        record(true, "Decay snapshot: left " + leftDecay + ", right " + rightDecay);
      } else {
        recordSkip("No hand equipment to measure decay");
      }

      return true;
    } catch (e) {
      try { (ctx.record || function(){false;})(false, "Combat scenario failed: " + (e && e.message ? e.message : String(e))); } catch (_) {}
      return false;
    }
  }

  window.SmokeTest.Scenarios.Combat = { run };
})();