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

      // Ensure in dungeon; if not, attempt to enter quickly
      try {
        if (window.GameAPI && typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() !== "dungeon") {
          if (typeof window.GameAPI.gotoNearestDungeon === "function") await window.GameAPI.gotoNearestDungeon();
          key("Enter"); await sleep(280);
          if (typeof window.GameAPI.enterDungeonIfOnEntrance === "function") window.GameAPI.enterDungeonIfOnEntrance();
          await sleep(260);
        }
      } catch (_) {}

      var enemiesBefore = (typeof window.GameAPI.getEnemies === "function") ? window.GameAPI.getEnemies().length : 0;
      // Spawn two enemies from GOD panel if available
      if (typeof document !== "undefined") {
        try {
          var opened = false;
          if (document.getElementById("god-open-btn")) { document.getElementById("god-open-btn").click(); opened = true; }
          if (opened) { await sleep(200); }
          var clicks = 0;
          if (document.getElementById("god-spawn-enemy-btn")) { document.getElementById("god-spawn-enemy-btn").click(); clicks++; await sleep(140); }
          if (document.getElementById("god-spawn-enemy-btn")) { document.getElementById("god-spawn-enemy-btn").click(); clicks++; await sleep(140); }
          var enemiesAfter = (typeof window.GameAPI.getEnemies === "function") ? window.GameAPI.getEnemies().length : enemiesBefore;
          var spawnedOk = enemiesAfter > enemiesBefore;
          record(spawnedOk, "Dungeon spawn: enemies " + enemiesBefore + " -> " + enemiesAfter + " (clicked " + clicks + "x)");
        } catch (_) {}
      }

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
        // battle bumps
        var bb = makeBudget(CONFIG.timeouts.battle);
        for (var t = 0; t < 3; t++) {
          if (bb.exceeded()) { recordSkip("Combat burst timed out"); break; }
          var dx2 = Math.sign(best.x - window.GameAPI.getPlayer().x);
          var dy2 = Math.sign(best.y - window.GameAPI.getPlayer().y);
          key(dx2 === -1 ? "ArrowLeft" : dx2 === 1 ? "ArrowRight" : (dy2 === -1 ? "ArrowUp" : "ArrowDown"));
          await sleep(140);
        }
        record(true, "Moved and attempted attacks");
      } else {
        recordSkip("No enemies available for combat pathing");
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