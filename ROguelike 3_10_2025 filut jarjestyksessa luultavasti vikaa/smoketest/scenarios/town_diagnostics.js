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
      var TP = (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Teleport) || null;
      var hadTimeout = false;

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

      // Single-attempt centralized entry to avoid repeated toggles across scenarios
      const okTown = (typeof ctx.ensureTownOnce === "function") ? await ctx.ensureTownOnce() : false;
      if (!okTown || !(window.GameAPI && has(window.GameAPI.getMode) && window.GameAPI.getMode() === "town")) {
        recordSkip("Town diagnostics skipped (not in town)");
        return true;
      }

      // Gate greeter count: ensure only one NPC near the town gate
      try {
        var gate = has(window.GameAPI.getTownGate) ? window.GameAPI.getTownGate() : null;
        var npcsAll = has(window.GameAPI.getNPCs) ? (window.GameAPI.getNPCs() || []) : [];
        if (gate && npcsAll && npcsAll.length) {
          var radius = 2; // manhattan radius around gate
          var nearGate = npcsAll.filter(function (n) {
            return (Math.abs(n.x - gate.x) + Math.abs(n.y - gate.y)) <= radius;
          });
          record(true, "Gate NPCs within r<=2: " + nearGate.length);
          record(nearGate.length === 1, "Gate greeter count is " + nearGate.length + " (expected 1)");
        } else {
          record(true, "Gate NPC count check skipped (no gate or no NPCs)");
        }
      } catch (e) {
        record(false, "Gate NPC count check failed: " + (e && e.message ? e.message : String(e)));
      }

      // Shops sign check (no boundary/schedule)
      var shops = has(window.GameAPI.getShops) ? (window.GameAPI.getShops() || []) : [];
      if (shops && shops.length) {
        var s0 = shops[0];
        var openNow = has(window.GameAPI.isShopOpenNowFor) ? !!window.GameAPI.isShopOpenNowFor(s0) : false;
        record(true, "Shop sign: " + (openNow ? "OPEN" : "CLOSED") + " (" + (s0.name || "Shop") + ")");
      } else {
        record(true, "No shops available to check");
      }

      // Inn/Tavern availability via GOD button (no resting)
      try {
        // Ensure GOD panel is open, then click the inn/tavern check
        domSafeClick("god-open-btn");
        await sleep(200);
        var clickedInn = domSafeClick("god-check-inn-tavern-btn");
        if (clickedInn) { await sleep(300); }
        // Count inns from shops list
        var allShops = has(window.GameAPI.getShops) ? (window.GameAPI.getShops() || []) : [];
        var inns = allShops.filter(function (s) {
          var nm = (s && s.name) ? String(s.name).toLowerCase() : "";
          return nm.includes("inn");
        });
        record(true, "Inn/Tavern check: " + inns.length + " inn(s)");
      } catch (e) {
        record(false, "Inn/Tavern check failed: " + (e && e.message ? e.message : String(e)));
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

      // Bump-buy near shop (NPC adjacent to a shop) — teleport near keeper first, then route adj and bump
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

            // 1) Teleport to a safe tile near the keeper (avoid walls/NPC occupancy)
            var teleportedNear = false;
            if (TP && typeof TP.teleportTo === "function") {
              var adjTiles = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}]
                .map(v => ({ x: targetNPC.x + v.dx, y: targetNPC.y + v.dy }));
              for (var t = 0; t < adjTiles.length && !teleportedNear; t++) {
                try {
                  teleportedNear = !!(await TP.teleportTo(adjTiles[t].x, adjTiles[t].y, { ensureWalkable: true, fallbackScanRadius: 3 }));
                } catch (_) { teleportedNear = false; }
              }
              // If adjacency is densely blocked, allow a broader safe fallback near the keeper
              if (!teleportedNear) {
                try { teleportedNear = !!(await TP.teleportTo(targetNPC.x, targetNPC.y, { ensureWalkable: true, fallbackScanRadius: 4 })); } catch (_) {}
              }
            }

            // 2) Route to adjacency and bump toward keeper
            var routedAdj = false;
            try {
              if (MV && typeof MV.routeAdjTo === "function") {
                routedAdj = await MV.routeAdjTo(targetNPC.x, targetNPC.y, { timeoutMs: (CONFIG.timeouts && CONFIG.timeouts.route) || 2500, stepMs: 100 });
              }
            } catch (_) {}
            // Fallback precise routing to any adjacent tile
            if (!routedAdj) {
              var adj = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}].map(v => ({ x: targetNPC.x + v.dx, y: targetNPC.y + v.dy }));
              var path = [];
              for (var a = 0; a < adj.length; a++) {
                var p = has(window.GameAPI.routeToDungeon) ? window.GameAPI.routeToDungeon(adj[a].x, adj[a].y) : [];
                if (p && p.length) { path = p; break; }
              }
              var budget = makeBudget((CONFIG.timeouts && CONFIG.timeouts.route) || 2500);
              for (var k = 0; k < path.length; k++) {
                var step = path[k];
                if (budget.exceeded()) { hadTimeout = true; recordSkip("Routing to shopkeeper timed out"); break; }
                var plNow = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : { x: step.x, y: step.y };
                var dx = Math.sign(step.x - plNow.x);
                var dy = Math.sign(step.y - plNow.y);
                key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                await sleep(100);
              }
            }

            // bump toward keeper
            var pl = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : { x: targetNPC.x, y: targetNPC.y };
            var dxb = Math.sign(targetNPC.x - pl.x);
            var dyb = Math.sign(targetNPC.y - pl.y);
            key(dxb === -1 ? "ArrowLeft" : dxb === 1 ? "ArrowRight" : (dyb === -1 ? "ArrowUp" : "ArrowDown"));
            await sleep(220);

            // Verify purchase/interaction effect
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

      // Route to first shop and interact (press G), then Esc-close UI — teleport near shop first to avoid long routes
      try {
        if (shops && shops.length) {
          var shop = shops[0];

          // Teleport to a safe adjacent tile near the shop (avoid walls/NPCs)
          var teleportedNearShop = false;
          if (TP && typeof TP.teleportTo === "function") {
            var adjShopTiles = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}]
              .map(v => ({ x: shop.x + v.dx, y: shop.y + v.dy }));
            for (var ts = 0; ts < adjShopTiles.length && !teleportedNearShop; ts++) {
              try {
                teleportedNearShop = !!(await TP.teleportTo(adjShopTiles[ts].x, adjShopTiles[ts].y, { ensureWalkable: true, fallbackScanRadius: 3 }));
              } catch (_) { teleportedNearShop = false; }
            }
            // If adjacency is densely blocked, allow a broader safe fallback near the shop
            if (!teleportedNearShop) {
              try { teleportedNearShop = !!(await TP.teleportTo(shop.x, shop.y, { ensureWalkable: true, fallbackScanRadius: 4 })); } catch (_) {}
            }
          }

          // Route to the exact shop tile after teleporting near it
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
              if (budgetS.exceeded()) { hadTimeout = true; recordSkip("Routing to shop timed out"); break; }
              var plNowS = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : { x: st.x, y: st.y };
              var dx = Math.sign(st.x - plNowS.x);
              var dy = Math.sign(st.y - plNowS.y);
              key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
              await sleep(100);
            }
          }

          // Before opening shop UI, try a natural bump on a shopkeeper adjacent to the shop tile
          try {
            var npcsAll2 = has(window.GameAPI.getNPCs) ? (window.GameAPI.getNPCs() || []) : [];
            var keeper = null, kdMin = Infinity;
            for (var ii2 = 0; ii2 < npcsAll2.length; ii2++) {
              var n2 = npcsAll2[ii2];
              var d2k = Math.abs(n2.x - shop.x) + Math.abs(n2.y - shop.y);
              if (d2k <= 1 && d2k < kdMin) { kdMin = d2k; keeper = n2; }
            }
            if (keeper) {
              // Route adjacent to keeper and bump once toward them
              var routedAdj = false;
              try {
                if (MV && typeof MV.routeAdjTo === "function") {
                  routedAdj = await MV.routeAdjTo(keeper.x, keeper.y, { timeoutMs: 1200, stepMs: 90 });
                }
              } catch (_) {}
              if (!routedAdj) {
                var pathA = has(window.GameAPI.routeToDungeon) ? window.GameAPI.routeToDungeon(shop.x, shop.y) : [];
                var budA = makeBudget(1200);
                for (var pa = 0; pa < pathA.length; pa++) {
                  var stp = pathA[pa];
                  if (budA.exceeded()) break;
                  var plNowA = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : { x: stp.x, y: stp.y };
                  var dxA = Math.sign(stp.x - plNowA.x);
                  var dyA = Math.sign(stp.y - plNowA.y);
                  key(dxA === -1 ? "ArrowLeft" : dxA === 1 ? "ArrowRight" : (dyA === -1 ? "ArrowUp" : "ArrowDown"));
                  await sleep(90);
                }
              }
              var plB = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : { x: keeper.x, y: keeper.y };
              var dxB = Math.sign(keeper.x - plB.x);
              var dyB = Math.sign(keeper.y - plB.y);
              key(dxB === -1 ? "ArrowLeft" : dxB === 1 ? "ArrowRight" : (dyB === -1 ? "ArrowUp" : "ArrowDown"));
              await sleep(160);
              record(true, "Bump near shopkeeper: OK");
            } else {
              record(true, "Bump near shopkeeper: skipped (none near shop)");
            }
          } catch (_) {}

          var ib = makeBudget((CONFIG.timeouts && CONFIG.timeouts.interact) || 250);
          // Close modals to avoid swallowing 'g'
          try { await ctx.ensureAllModalsClosed?.(1); } catch (_) {}
          key("g");
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

      

      // If any routing step timed out, attempt safe exit: teleport to gate and press 'g'
      try {
        if (hadTimeout && window.GameAPI && has(window.GameAPI.getMode) && window.GameAPI.getMode() === "town" && TP && typeof TP.teleportToGateAndExit === "function") {
          var exited = await TP.teleportToGateAndExit(ctx, { closeModals: true, waitMs: 500 });
          record(exited, exited ? "Diagnostics timeout: exited town via teleport" : "Diagnostics timeout: failed to exit town");
        }
      } catch (_) {}

      return true;
    } catch (e) {
      try { (ctx.record || function(){}) (false, "Town diagnostics scenario failed: " + (e && e.message ? e.message : String(e))); } catch (_) {}
      return true;
    }
  }

  window.SmokeTest.Scenarios.Town = window.SmokeTest.Scenarios.Town || {};
  window.SmokeTest.Scenarios.Town.Diagnostics = { run };
})();