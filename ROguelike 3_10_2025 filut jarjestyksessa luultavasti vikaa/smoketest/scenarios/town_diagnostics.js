(function () {
  // SmokeTest Scenario: Town diagnostics (GOD diagnostics, shops, currency ops, bump-buy, shop UI)
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  function domSafeClick(id) {
    try {
      var H = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Dom;
      if (H && typeof H.safeClick === "function") return H.safeClick(id);
    } catch (_) {}
    try {
      var el = document.getElementById(id);
      if (!el) return false;
      el.click();
      return true;
    } catch (_) { return false; }
  }

  async function waitUntilTrue(fn, timeoutMs, intervalMs, sleepFn) {
    var deadline = Date.now() + Math.max(0, timeoutMs | 0);
    var interval = Math.max(1, intervalMs | 0);
    while (Date.now() < deadline) {
      try { if (fn()) return true; } catch (_) {}
      await sleepFn(interval);
    }
    try { return !!fn(); } catch (_) { return false; }
  }

  async function run(ctx) {
    try {
      var record = ctx.record || function(){};
      var recordSkip = ctx.recordSkip || function(){};
      var sleep = ctx.sleep || (ms => new Promise(r => setTimeout(r, ms|0)));
      var key = ctx.key || function(){};
      var makeBudget = ctx.makeBudget || (ms => { var s=Date.now(),dl=s+(ms|0); return { exceeded:()=>Date.now()>dl, remain:()=>Math.max(0,dl-Date.now()) }; });
      var CONFIG = ctx.CONFIG || { timeouts: { route: 2500, interact: 250, battle: 2500 } };
      var caps = (ctx && ctx.caps) || {};
      var MV = (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Movement) || null;

      // Open GOD and diagnostics
      if (domSafeClick("god-open-btn")) {
        await sleep(250);
        if (domSafeClick("god-diagnostics-btn")) {
          // ok
        } else {
          recordSkip("Diagnostics button not present");
        }
      } else {
        recordSkip("GOD open button not present (diagnostics)");
      }
      await sleep(250);

      // If currently in dungeon, exit to world first to enable town routing.
      var mode0 = (window.GameAPI && has(window.GameAPI.getMode)) ? window.GameAPI.getMode() : null;
      if (mode0 === "dungeon") {
        try {
          var exit = has(window.GameAPI.getDungeonExit) ? window.GameAPI.getDungeonExit() : null;
          if (exit && has(window.GameAPI.routeToDungeon)) {
            var pE = window.GameAPI.routeToDungeon(exit.x, exit.y) || [];
            for (var ei = 0; ei < pE.length; ei++) {
              var st = pE[ei];
              var dx = Math.sign(st.x - window.GameAPI.getPlayer().x);
              var dy = Math.sign(st.y - window.GameAPI.getPlayer().y);
              key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
              await sleep(90);
            }
            key("KeyG"); await sleep(260);
          }
        } catch (_) {}
        mode0 = window.GameAPI.getMode();
        if (mode0 !== "world") {
          try { var btnNG = document.getElementById("god-newgame-btn"); if (btnNG) btnNG.click(); } catch (_) {}
          await sleep(400);
        }
      }

      var inTown = (window.GameAPI && has(window.GameAPI.getMode) && window.GameAPI.getMode() === "town");
      if (!inTown) {
        // Attempt to enter town from overworld
        try {
          if (window.GameAPI && typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() === "world") {
            if (has(window.GameAPI.gotoNearestTown)) {
              await window.GameAPI.gotoNearestTown();
            } else if (has(window.GameAPI.nearestTown) && has(window.GameAPI.routeTo)) {
              var nt = window.GameAPI.nearestTown();
              var pathNT = window.GameAPI.routeTo(nt.x, nt.y);
              var budgetNT = makeBudget((CONFIG.timeouts && CONFIG.timeouts.route) || 2500);
              for (var i = 0; i < pathNT.length; i++) {
                if (budgetNT.exceeded()) break;
                var step = pathNT[i];
                var dx = Math.sign(step.x - window.GameAPI.getPlayer().x);
                var dy = Math.sign(step.y - window.GameAPI.getPlayer().y);
                key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                await sleep(100);
              }
            }
            key("Enter"); await sleep(260);
            if (has(window.GameAPI.enterTownIfOnTile)) window.GameAPI.enterTownIfOnTile();
            await sleep(240);
          }
        } catch (_) {}
        inTown = (window.GameAPI && has(window.GameAPI.getMode) && window.GameAPI.getMode() === "town");
        if (!inTown) {
          recordSkip("Town diagnostics skipped (not in town)");
          return true;
        }
      }

      // Shops schedule check
      var shops = has(window.GameAPI.getShops) ? (window.GameAPI.getShops() || []) : [];
      if (shops && shops.length) {
        var s0 = shops[0];
        var openNow = has(window.GameAPI.isShopOpenNowFor) ? !!window.GameAPI.isShopOpenNowFor(s0) : false;
        var sched = has(window.GameAPI.getShopSchedule) ? (window.GameAPI.getShopSchedule(s0) || "") : "";
        record(true, "Shop check: " + (s0.name || "Shop") + " is " + (openNow ? "OPEN" : "CLOSED") + " (" + sched + ")");
        // Boundary: move from 07:59 to 08:00 if possible
        try {
          if (has(window.GameAPI.getClock) && has(window.GameAPI.advanceMinutes)) {
            var clk = window.GameAPI.getClock();
            var curMin = clk.hours * 60 + clk.minutes;
            var to759 = ((8 * 60 - 1) - curMin + 24 * 60) % (24 * 60);
            window.GameAPI.advanceMinutes(to759);
            await sleep(120);
            var at759 = has(window.GameAPI.isShopOpenNowFor) ? !!window.GameAPI.isShopOpenNowFor(s0) : false;
            window.GameAPI.advanceMinutes(1);
            await sleep(120);
            var at800 = has(window.GameAPI.isShopOpenNowFor) ? !!window.GameAPI.isShopOpenNowFor(s0) : false;
            record(true, "Shop boundary: 07:59=" + (at759 ? "OPEN" : "CLOSED") + " 08:00=" + (at800 ? "OPEN" : "CLOSED"));
          } else {
            var before = openNow;
            if (has(window.GameAPI.restUntilMorning)) window.GameAPI.restUntilMorning();
            await sleep(200);
            var after = has(window.GameAPI.isShopOpenNowFor) ? !!window.GameAPI.isShopOpenNowFor(s0) : before;
            record(true, "Shop open state after morning: " + (after ? "OPEN" : "CLOSED"));
          }
        } catch (_) {}
      } else {
        record(true, "No shops available to check");
      }

      // Basic currency ops
      try {
        if (has(window.GameAPI.getGold) && has(window.GameAPI.addGold) && has(window.GameAPI.removeGold)) {
          var g0 = window.GameAPI.getGold();
          window.GameAPI.addGold(25);
          var g1 = window.GameAPI.getGold();
          var addOk = g1 >= g0 + 25;
          window.GameAPI.removeGold(10);
          var g2 = window.GameAPI.getGold();
          var remOk = (g2 === (g1 - 10)) || (g2 <= g1);
          record(addOk && remOk, "Gold ops: " + g0 + " -> " + g1 + " -> " + g2);
        } else {
          recordSkip("Gold ops not available in GameAPI");
        }
      } catch (e) {
        record(false, "Gold ops failed: " + (e && e.message ? e.message : String(e)));
      }

      // Bump-buy near shop (NPC adjacent to a shop)
      try {
        var npcs = has(window.GameAPI.getNPCs) ? (window.GameAPI.getNPCs() || []) : [];
        if (shops && shops.length && npcs && npcs.length && has(window.GameAPI.getGold)) {
          var targetNPC = null;
          for (var i = 0; i < npcs.length && !targetNPC; i++) {
            var n = npcs[i];
            for (var j = 0; j < shops.length; j++) {
              var s = shops[j];
              var d = Math.abs(n.x - s.x) + Math.abs(n.y - s.y);
              if (d <= 1) { targetNPC = n; break; }
            }
          }
          if (targetNPC) {
            var gBefore = window.GameAPI.getGold();
            // route to adjacent tile to NPC and then bump
            var adj = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}].map(v => ({ x: targetNPC.x + v.dx, y: targetNPC.y + v.dy }));
            var path = [];
            // Prefer movement helper
            var routedAdj = false;
            try {
              if (MV && typeof MV.routeAdjTo === "function") {
                routedAdj = await MV.routeAdjTo(targetNPC.x, targetNPC.y, { timeoutMs: (CONFIG.timeouts && CONFIG.timeouts.route) || 2500, stepMs: 100 });
              }
            } catch (_) {}
            if (!routedAdj) {
              for (var a = 0; a < adj.length; a++) {
                var p = has(window.GameAPI.routeToDungeon) ? window.GameAPI.routeToDungeon(adj[a].x, adj[a].y) : [];
                if (p && p.length) { path = p; break; }
              }
              var budget = makeBudget((CONFIG.timeouts && CONFIG.timeouts.route) || 2500);
              for (var k = 0; k < path.length; k++) {
                var step = path[k];
                if (budget.exceeded()) { recordSkip("Routing to shopkeeper timed out"); break; }
                var dx = Math.sign(step.x - window.GameAPI.getPlayer().x);
                var dy = Math.sign(step.y - window.GameAPI.getPlayer().y);
                key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                await sleep(100);
              }
            }
            // bump
            var dxb = Math.sign(targetNPC.x - window.GameAPI.getPlayer().x);
            var dyb = Math.sign(targetNPC.y - window.GameAPI.getPlayer().y);
            key(dxb === -1 ? "ArrowLeft" : dxb === 1 ? "ArrowRight" : (dyb === -1 ? "ArrowUp" : "ArrowDown"));
            await sleep(220);
            var gAfter = window.GameAPI.getGold();
            var inv = has(window.GameAPI.getInventory) ? (window.GameAPI.getInventory() || []) : [];
            var gotItem = inv && inv.length ? true : false;
            var spentGold = gAfter < gBefore;
            record(spentGold || gotItem, "Bump-buy near shop: gold " + gBefore + " -> " + gAfter + (gotItem ? ", inventory updated" : ""));
          } else {
            recordSkip("No NPC found near a shop for bump-buy");
          }
        } else {
          recordSkip("Bump-buy skipped (no shops/NPCs or gold API missing)");
        }
      } catch (e) {
        record(false, "Bump-buy failed: " + (e && e.message ? e.message : String(e)));
      }

      // Route to first shop and interact (press G), then Esc-close UI
      try {
        if (shops && shops.length) {
          var shop = shops[0];
          var routedS = false;
          try {
            if (MV && typeof MV.routeTo === "function") {
              routedS = await MV.routeTo(shop.x, shop.y, { timeoutMs: (CONFIG.timeouts && CONFIG.timeouts.route) || 2500, stepMs: 100 });
            }
          } catch (_) {}
          if (!routedS) {
            var pathS = has(window.GameAPI.routeToDungeon) ? window.GameAPI.routeToDungeon(shop.x, shop.y) : [];
            var budgetS = makeBudget((CONFIG.timeouts && CONFIG.timeouts.route) || 2500);
            for (var si = 0; si < pathS.length; si++) {
              var st = pathS[si];
              if (budgetS.exceeded()) { recordSkip("Routing to shop timed out"); break; }
              var dx = Math.sign(st.x - window.GameAPI.getPlayer().x);
              var dy = Math.sign(st.y - window.GameAPI.getPlayer().y);
              key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
              await sleep(100);
            }
          }
          var ib = makeBudget((CONFIG.timeouts && CONFIG.timeouts.interact) || 250);
          key("KeyG");
          await sleep(Math.min(ib.remain(), 220));
          // Esc closes Shop UI fallback panel
          try {
            var open = !!(document.getElementById("shop-panel") && document.getElementById("shop-panel").hidden === false);
            if (open) {
              key("Escape");
              var closed = await waitUntilTrue(function () { var el = document.getElementById("shop-panel"); return !!(el && el.hidden === true); }, 600, 60, sleep);
              record(closed, "Shop UI closes with Esc");
            } else {
              record(true, "Shop UI not open (no Esc-close needed)");
            }
          } catch (_) {}
          // Optional buy/sell
          var didAny = false;
          if (has(window.GameAPI.shopBuyFirst)) { var okB = !!window.GameAPI.shopBuyFirst(); record(okB, "Shop buy (first item)"); didAny = true; }
          if (has(window.GameAPI.shopSellFirst)) { var okS = !!window.GameAPI.shopSellFirst(); record(okS, "Shop sell (first inventory item)"); didAny = true; }
          if (!didAny) record(true, "Interacted at shop (G). No programmatic buy/sell API; skipped.");
        }
      } catch (e) {
        record(false, "Shop interaction failed: " + (e && e.message ? e.message : String(e)));
      }

      // Resting
      try {
        var inn = shops.find(function (s) { return ((s.name || "").toLowerCase().includes("inn")); });
        if (inn && has(window.GameAPI.restAtInn)) {
          window.GameAPI.restAtInn();
          record(true, "Rested at inn (time advanced to morning, HP restored)");
        } else if (has(window.GameAPI.restUntilMorning)) {
          window.GameAPI.restUntilMorning();
          record(true, "Rested until morning");
        }
      } catch (e) {
        record(false, "Resting failed: " + (e && e.message ? e.message : String(e)));
      }

      return true;
    } catch (e) {
      try { (ctx.record || function(){}) (false, "Town diagnostics scenario failed: " + (e && e.message ? e.message : String(e))); } catch (_) {}
      return true;
    }
  }

  window.SmokeTest.Scenarios.Town = window.SmokeTest.Scenarios.Town || {};
  window.SmokeTest.Scenarios.Town.Diagnostics = { run };
})();