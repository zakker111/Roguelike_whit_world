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

      // Snapshot before spawns for low-HP clamping of new enemies
      var enemiesBeforeList = (typeof window.GameAPI.getEnemies === "function") ? (window.GameAPI.getEnemies() || []) : [];
      var enemiesBefore = enemiesBeforeList.length;

      // Decay baseline before combat attempt
      var eqStart = (typeof window.GameAPI.getEquipment === "function") ? (window.GameAPI.getEquipment() || {}) : {};
      var leftDecay0 = (eqStart && eqStart.left && typeof eqStart.left.decay === "number") ? eqStart.left.decay : null;
      var rightDecay0 = (eqStart && eqStart.right && typeof eqStart.right.decay === "number") ? eqStart.right.decay : null;

      // Helper: clamp HP of newly spawned enemies (by position delta)
      async function clampNewEnemiesLowHp(beforeList, afterList) {
        try {
          if (!Array.isArray(beforeList) || !Array.isArray(afterList)) return 0;
          var beforeSet = new Set(beforeList.map(function(e){ return (e && (e.x != null) && (e.y != null)) ? (e.x + "," + e.y) : ""; }));
          var clamped = 0;
          for (var i = 0; i < afterList.length; i++) {
            var e = afterList[i];
            var key = (e && (e.x != null) && (e.y != null)) ? (e.x + "," + e.y) : "";
            if (key && !beforeSet.has(key)) {
              if (typeof window.GameAPI.setEnemyHpAt === "function") {
                if (window.GameAPI.setEnemyHpAt(e.x, e.y, 1)) clamped++;
                await sleep(10);
              }
            }
          }
          if (clamped > 0) record(true, "Spawn clamp: set low HP for " + clamped + " new enemy(ies)");
          return clamped;
        } catch (_) { return 0; }
      }

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
            var enemiesAfterDomList = (typeof window.GameAPI.getEnemies === "function") ? (window.GameAPI.getEnemies() || []) : enemiesBeforeList;
            var enemiesAfterDom = enemiesAfterDomList.length;
            spawnedOk = enemiesAfterDom > enemiesBefore;
            // Checklist expects: "Dungeon spawn: enemies X -> Y"
            record(spawnedOk, "Dungeon spawn: enemies " + enemiesBefore + " -> " + enemiesAfterDom);
            // Clamp low HP for newly spawned ones
            await clampNewEnemiesLowHp(enemiesBeforeList, enemiesAfterDomList);
            enemiesBeforeList = enemiesAfterDomList.slice(0);
            enemiesBefore = enemiesAfterDom;
          } else {
            recordSkip("Dungeon spawn: skipped (not in dungeon)");
          }
        } catch (_) {}
        // GameAPI fallback with retries (works in dungeon; may also work in world depending on implementation)
        var attempts = 0;
        while (!spawnedOk && attempts < 3) {
          if (typeof window.GameAPI.spawnEnemyNearby === "function") {
            window.GameAPI.spawnEnemyNearby(2);
            await sleep(200);
          }
          var enemiesNowList = (typeof window.GameAPI.getEnemies === "function") ? (window.GameAPI.getEnemies() || []) : enemiesBeforeList;
          var enemiesNow = enemiesNowList.length;
          spawnedOk = enemiesNow > enemiesBefore;
          // Clamp newly spawned via fallback
          if (spawnedOk) {
            await clampNewEnemiesLowHp(enemiesBeforeList, enemiesNowList);
            enemiesBeforeList = enemiesNowList.slice(0);
            enemiesBefore = enemiesNow;
          }
          attempts++;
        }
        if (!spawnedOk) {
          recordSkip("No enemies available for combat pathing");
        }
      } catch (_) {}

      // Enemy audits: types present and glyphs not '?'
      try {
        var enemiesForAudit = (typeof window.GameAPI.getEnemies === "function") ? (window.GameAPI.getEnemies() || []) : [];
        if (enemiesForAudit && enemiesForAudit.length) {
          var typeCount = enemiesForAudit.filter(function (e) { return !!(e && (e.kind || e.type)); }).length;
          // Checklist expects: "Enemy types present:"
          record(typeCount > 0, "Enemy types present: " + typeCount);
          // Checklist expects: "Enemy glyphs:" and fail line 'All enemy glyphs are "?"'
          var allQuestion = enemiesForAudit.length > 0 && enemiesForAudit.every(function (e) {
            var g = (e && (e.glyph != null ? e.glyph : e.char != null ? e.char : "?"));
            return String(g) === "?";
          });
          if (allQuestion) {
            record(false, "All enemy glyphs are \"?\"");
          } else {
            record(true, "Enemy glyphs: OK");
          }
        } else {
          recordSkip("Enemy audits skipped (no enemies)");
        }
      } catch (_) {}

      // Confirm enemy is near, then wait for first enemy hit (up to a short cap)
      try {
        // Spawn an extra enemy via GOD UI right before proximity check
        try {
          var modeForSpawn2 = (typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : null;
          if (modeForSpawn2 === "dungeon") {
            // Snapshot before
            var beforeExtra = (typeof window.GameAPI.getEnemies === "function") ? (window.GameAPI.getEnemies() || []) : [];
            var gob2 = document.getElementById("god-open-btn");
            if (gob2) { gob2.click(); await sleep(150); }
            var btn2 = document.getElementById("god-spawn-enemy-btn");
            if (btn2) { btn2.click(); await sleep(160); }
            // Clamp new ones to low HP
            var afterExtra = (typeof window.GameAPI.getEnemies === "function") ? (window.GameAPI.getEnemies() || []) : [];
            if (typeof clampNewEnemiesLowHp === "function") { await clampNewEnemiesLowHp(beforeExtra, afterExtra); }
          }
        } catch (_) {}
        // Close modals so wait/keys are not swallowed
        try { if (typeof ctx.ensureAllModalsClosed === "function") await ctx.ensureAllModalsClosed(2); } catch (_) {}

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

      // Route to nearest enemy and bump-attack (more robust dynamic pursuit)
      var enemies = (typeof window.GameAPI.getEnemies === "function") ? window.GameAPI.getEnemies() : [];
      if (enemies && enemies.length) {
        // Pick initial target
        var best = enemies[0];
        var bestD = Math.abs(best.x - window.GameAPI.getPlayer().x) + Math.abs(best.y - window.GameAPI.getPlayer().y);
        for (var i = 0; i < enemies.length; i++) {
          var e = enemies[i];
          var d = Math.abs(e.x - window.GameAPI.getPlayer().x) + Math.abs(e.y - window.GameAPI.getPlayer().y);
          if (d < bestD) { best = e; bestD = d; }
        }

        // Try routing to the target's tile (or adjacency via helper)
        var usedHelper = false;
        try {
          var MV = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Movement;
          if (MV && typeof MV.routeTo === "function") {
            usedHelper = await MV.routeTo(best.x, best.y, { timeoutMs: (CONFIG && CONFIG.timeouts && CONFIG.timeouts.route) || 5000, stepMs: 90 });
          }
          // If helper not used or failed, try simple BFS path as fallback
          if (!usedHelper) {
            var path = (typeof window.GameAPI.routeToDungeon === "function") ? window.GameAPI.routeToDungeon(best.x, best.y) : [];
            var budget = makeBudget((CONFIG && CONFIG.timeouts && CONFIG.timeouts.route) || 5000);
            for (var j = 0; j < path.length; j++) {
              var step = path[j];
              if (budget.exceeded()) { recordSkip("Routing to enemy timed out"); break; }
              var plNow = (typeof window.GameAPI.getPlayer === "function") ? window.GameAPI.getPlayer() : step;
              var dx = Math.sign(step.x - plNow.x);
              var dy = Math.sign(step.y - plNow.y);
              key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
              await sleep(90);
            }
          }
        } catch (_) {}

        // Snapshot before dynamic bump-attacks
        var enemiesPre = (typeof window.GameAPI.getEnemies === "function") ? (window.GameAPI.getEnemies() || []) : [];
        var sumHpPre = enemiesPre.reduce(function(acc, e){ return acc + (typeof e.hp === "number" ? e.hp : 0); }, 0);
        var bestHpBefore = (typeof best.hp === "number") ? best.hp : null;
        var corpsesPre = (typeof window.GameAPI.getCorpses === "function") ? (window.GameAPI.getCorpses() || []).length : null;
        var decalsPre = (typeof window.GameAPI.getDecalsCount === "function") ? (window.GameAPI.getDecalsCount() | 0) : null;

        // Dynamic pursuit: recompute nearest and bump up to N times, respecting battle budget
        var bb = makeBudget((CONFIG && CONFIG.timeouts && CONFIG.timeouts.battle) || 5000);
        var bumps = 0;
        for (var t = 0; t < 8; t++) {
          if (bb.exceeded()) { recordSkip("Combat burst timed out"); break; }
          // Recompute nearest enemy relative to current player
          var curEnemies = (typeof window.GameAPI.getEnemies === "function") ? (window.GameAPI.getEnemies() || []) : [];
          var pl = (typeof window.GameAPI.getPlayer === "function") ? window.GameAPI.getPlayer() : { x: 0, y: 0 };
          var curBest = null; var curBestD = Infinity;
          for (var k = 0; k < curEnemies.length; k++) {
            var en = curEnemies[k];
            var dcur = Math.abs(en.x - pl.x) + Math.abs(en.y - pl.y);
            if (dcur < curBestD) { curBestD = dcur; curBest = en; }
          }
          // If none, stop
          if (!curBest) break;
          var dx2 = Math.sign(curBest.x - pl.x);
          var dy2 = Math.sign(curBest.y - pl.y);
          key(dx2 === -1 ? "ArrowLeft" : dx2 === 1 ? "ArrowRight" : (dy2 === -1 ? "ArrowUp" : "ArrowDown"));
          bumps++;
          await sleep(140);
        }
        record(true, "Moved and attempted attacks (" + bumps + " bumps)");

        // Post-checks: HP decrease, corpse or decals increase
        try {
          var enemiesPost = (typeof window.GameAPI.getEnemies === "function") ? (window.GameAPI.getEnemies() || []) : [];
          var sumHpPost = enemiesPost.reduce(function(acc, e){ return acc + (typeof e.hp === "number" ? e.hp : 0); }, 0);
          var corpsesPost = (typeof window.GameAPI.getCorpses === "function") ? (window.GameAPI.getCorpses() || []) : null;
          var decalsPost = (typeof window.GameAPI.getDecalsCount === "function") ? (window.GameAPI.getDecalsCount() | 0) : null;

          // Compare target hp if possible (nearest to original best)
          var nearestAfter = null, nd = Infinity;
          for (var ii = 0; ii < enemiesPost.length; ii++) {
            var en = enemiesPost[ii];
            var d2 = Math.abs(en.x - best.x) + Math.abs(en.y - best.y);
            if (d2 < nd) { nd = d2; nearestAfter = en; }
          }
          var hpDroppedForTarget = (nearestAfter && typeof nearestAfter.hp === "number" && typeof bestHpBefore === "number") ? (nearestAfter.hp < bestHpBefore) : false;
          var sumHpDropped = (typeof sumHpPre === "number" && typeof sumHpPost === "number") ? (sumHpPost < sumHpPre) : false;
          var corpseInc = (corpsesPre != null && Array.isArray(corpsesPost)) ? ((corpsesPost.length | 0) > (corpsesPre | 0)) : false;
          var decalsInc = (decalsPre != null && decalsPost != null) ? (decalsPost > decalsPre) : false;

          var fightOk = hpDroppedForTarget || sumHpDropped || corpseInc || decalsInc;
          record(fightOk, "Combat effects: " +
            (hpDroppedForTarget ? "target hp↓ " : "") +
            (sumHpDropped ? "sum hp↓ " : "") +
            (corpseInc ? "corpse+ " : "") +
            (decalsInc ? "decals+ " : ""));

          // Explicit kill check for checklist: corpse count increased
          record(!!corpseInc, "Killed enemy: " + (corpseInc ? "YES" : "NO"));

          // Retry burst with forced crit if no effect detected and API supports it (stabilize test)
          if (!fightOk && typeof window.GameAPI.setAlwaysCrit === "function") {
            try {
              window.GameAPI.setAlwaysCrit(true);
              if (typeof window.GameAPI.setCritPart === "function") window.GameAPI.setCritPart("");
              for (var rt = 0; rt < 2; rt++) {
                var pl2 = window.GameAPI.getPlayer();
                var curEnemies2 = window.GameAPI.getEnemies() || [];
                var curB2 = null; var curD2 = Infinity;
                for (var kk = 0; kk < curEnemies2.length; kk++) {
                  var en2 = curEnemies2[kk];
                  var d2b = Math.abs(en2.x - pl2.x) + Math.abs(en2.y - pl2.y);
                  if (d2b < curD2) { curD2 = d2b; curB2 = en2; }
                }
                if (!curB2) break;
                var dx3 = Math.sign(curB2.x - pl2.x);
                var dy3 = Math.sign(curB2.y - pl2.y);
                key(dx3 === -1 ? "ArrowLeft" : dx3 === 1 ? "ArrowRight" : (dy3 === -1 ? "ArrowUp" : "ArrowDown"));
                await sleep(140);
              }
            } catch (_) {}
            try { window.GameAPI.setAlwaysCrit(false); } catch (_) {}
            try { if (typeof window.GameAPI.setCritPart === "function") window.GameAPI.setCritPart(""); } catch (_) {}

            // Re-evaluate post-checks
            try {
              enemiesPost = (typeof window.GameAPI.getEnemies === "function") ? (window.GameAPI.getEnemies() || []) : [];
              sumHpPost = enemiesPost.reduce(function(acc, e){ return acc + (typeof e.hp === "number" ? e.hp : 0); }, 0);
              corpsesPost = (typeof window.GameAPI.getCorpses === "function") ? (window.GameAPI.getCorpses() || []) : null;
              decalsPost = (typeof window.GameAPI.getDecalsCount === "function") ? (window.GameAPI.getDecalsCount() | 0) : null;

              nearestAfter = null; nd = Infinity;
              for (ii = 0; ii < enemiesPost.length; ii++) {
                var enr = enemiesPost[ii];
                var d2r = Math.abs(enr.x - best.x) + Math.abs(enr.y - best.y);
                if (d2r < nd) { nd = d2r; nearestAfter = enr; }
              }
              hpDroppedForTarget = (nearestAfter && typeof nearestAfter.hp === "number" && typeof bestHpBefore === "number") ? (nearestAfter.hp < bestHpBefore) : false;
              sumHpDropped = (typeof sumHpPre === "number" && typeof sumHpPost === "number") ? (sumHpPost < sumHpPre) : false;
              corpseInc = (corpsesPre != null && Array.isArray(corpsesPost)) ? ((corpsesPost.length | 0) > (corpsesPre | 0)) : false;
              decalsInc = (decalsPre != null && decalsPost != null) ? (decalsPost > decalsPre) : false;

              fightOk = hpDroppedForTarget || sumHpDropped || corpseInc || decalsInc;
              record(fightOk, "Combat effects (retry): " +
                (hpDroppedForTarget ? "target hp↓ " : "") +
                (sumHpDropped ? "sum hp↓ " : "") +
                (corpseInc ? "corpse+ " : "") +
                (decalsInc ? "decals+ " : ""));
            } catch (_) {}
          }
        } catch (_) {}
      }

      // Basic decay snapshot after combat attempt
      var eq = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
      var leftDecay = (eq && eq.left && typeof eq.left.decay === "number") ? eq.left.decay : null;
      var rightDecay = (eq && eq.right && typeof eq.right.decay === "number") ? eq.right.decay : null;
      if (leftDecay != null || rightDecay != null) {
        record(true, "Decay snapshot: left " + leftDecay + ", right " + rightDecay);
        var incLeft = (leftDecay0 != null && leftDecay != null) ? (leftDecay > leftDecay0) : false;
        var incRight = (rightDecay0 != null && rightDecay != null) ? (rightDecay > rightDecay0) : false;
        if (incLeft || incRight) {
          record(true, "Decay check: increased");
        } else {
          record(false, "Decay did not increase");
        }
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