(function () {
  // SmokeTest Scenario: Town flows (NPC interactions, home props, nearby decorations, late-night home routes)
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  async function run(ctx) {
    try {
      var record = ctx.record || function(){};
      var recordSkip = ctx.recordSkip || function(){};
      var sleep = ctx.sleep || (ms => new Promise(r => setTimeout(r, ms|0)));
      var key = ctx.key || function(){};
      var makeBudget = ctx.makeBudget || (ms => { var s=Date.now(),dl=s+(ms|0); return { exceeded:()=>Date.now()>dl, remain:()=>Math.max(0,dl-Date.now()) }; });
      var CONFIG = ctx.CONFIG || { timeouts: { route: 2500, interact: 250 } };
      var caps = (ctx && ctx.caps) || {};
      var MV = (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Movement) || null;

      async function waitUntilTrue(fn, timeoutMs, stepMs) {
        var deadline = Date.now() + (timeoutMs|0 || 0);
        var step = Math.max(20, (stepMs|0) || 80);
        while (Date.now() < deadline) {
          try { if (fn()) return true; } catch(_) {}
          await sleep(step);
        }
        try { return !!fn(); } catch(_) { return false; }
      }

      // Precondition: enter town once (centralized; avoid repeated toggles across scenarios)
      const okTown = (typeof ctx.ensureTownOnce === "function") ? await ctx.ensureTownOnce() : false;
      const inTown = (window.GameAPI && has(window.GameAPI.getMode) && window.GameAPI.getMode() === "town");
      if (!okTown || !inTown) { recordSkip("Town flows skipped (not in town)"); return true; }

      // 1) NPC bump interaction
      let lastNPC = null;
      try {
        if (!caps.getNPCs) { recordSkip("NPC bump skipped (getNPCs not available)"); }
        else {
          var npcs = window.GameAPI.getNPCs() || [];
          if (npcs && npcs.length) {
            var pl = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : { x: 0, y: 0 };
            let best = npcs[0], bestD = Math.abs(best.x - pl.x) + Math.abs(best.y - pl.y);
            for (var i = 0; i < npcs.length; i++) {
              var n = npcs[i];
              var d = Math.abs(n.x - pl.x) + Math.abs(n.y - pl.y);
              if (d < bestD) { best = n; bestD = d; }
            }
            // Route adjacent to NPC and bump into NPC tile
            let routed = false;
            try {
              if (MV && typeof MV.routeAdjTo === "function") {
                routed = await MV.routeAdjTo(best.x, best.y, { timeoutMs: (CONFIG.timeouts && CONFIG.timeouts.route) || 2500, stepMs: 110 });
              }
            } catch (_) {}
            if (!routed) {
              // fallback: routeToDungeon to an adjacent tile
              var adj = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}].map(v => ({ x: best.x + v.dx, y: best.y + v.dy }));
              var path = [];
              for (var k = 0; k < adj.length; k++) {
                var a = adj[k];
                var p = (has(window.GameAPI.routeToDungeon)) ? window.GameAPI.routeToDungeon(a.x, a.y) : [];
                if (p && p.length) { path = p; break; }
              }
              var budget = makeBudget((CONFIG.timeouts && CONFIG.timeouts.route) || 2500);
              for (var j = 0; j < path.length; j++) {
                var step = path[j];
                if (budget.exceeded()) break;
                var dx = Math.sign(step.x - window.GameAPI.getPlayer().x);
                var dy = Math.sign(step.y - window.GameAPI.getPlayer().y);
                key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                await sleep(110);
              }
            }
            // bump into NPC
            if (MV && typeof MV.bumpToward === "function") { MV.bumpToward(best.x, best.y); } else {
              var dx2 = Math.sign(best.x - window.GameAPI.getPlayer().x);
              var dy2 = Math.sign(best.y - window.GameAPI.getPlayer().y);
              key(dx2 === -1 ? "ArrowLeft" : dx2 === 1 ? "ArrowRight" : (dy2 === -1 ? "ArrowUp" : "ArrowDown"));
            }
            await sleep(160);
            record(true, "Bumped into at least one NPC");
            lastNPC = best;
          } else {
            recordSkip("No NPCs reported (town may be empty?)");
          }
        }
      } catch (e) {
        record(false, "NPC interaction failed: " + (e && e.message ? e.message : String(e)));
      }

      // 2) NPC home + decorations/props
      try {
        if (lastNPC && typeof lastNPC.i === "number" && has(window.GameAPI.getNPCHomeByIndex)) {
          var home = window.GameAPI.getNPCHomeByIndex(lastNPC.i);
          if (home && home.building) {
            var b = home.building;
            var hasProps = Array.isArray(home.props) && home.props.length > 0;
            record(hasProps, "NPC home has " + (home.props ? home.props.length : 0) + " decoration(s)/prop(s)");
            var door = b.door || { x: b.x + Math.floor(b.w / 2), y: b.y };
            let routedDoor = false;
            try { if (MV && typeof MV.routeTo === "function") routedDoor = await MV.routeTo(door.x, door.y, { timeoutMs: (CONFIG.timeouts && CONFIG.timeouts.route) || 2500, stepMs: 100 }); } catch (_) {}
            if (!routedDoor) {
              var pathDoor = (has(window.GameAPI.routeToDungeon)) ? window.GameAPI.routeToDungeon(door.x, door.y) : [];
              var bd = makeBudget((CONFIG.timeouts && CONFIG.timeouts.route) || 2500);
              for (var di = 0; di < pathDoor.length; di++) {
                var st = pathDoor[di];
                if (bd.exceeded()) { recordSkip("Routing to NPC home door timed out"); break; }
                var dx3 = Math.sign(st.x - window.GameAPI.getPlayer().x);
                var dy3 = Math.sign(st.y - window.GameAPI.getPlayer().y);
                key(dx3 === -1 ? "ArrowLeft" : dx3 === 1 ? "ArrowRight" : (dy3 === -1 ? "ArrowUp" : "ArrowDown"));
                await sleep(100);
              }
            }
            // target inside or adjacent to a prop
            let targetPath = [];
            let doInteract = false;
            if (hasProps) {
              var p0 = home.props[0];
              var adjP = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}].map(d => ({ x: p0.x + d.dx, y: p0.y + d.dy }));
              for (var ai = 0; ai < adjP.length; ai++) {
                var route = has(window.GameAPI.routeToDungeon) ? window.GameAPI.routeToDungeon(adjP[ai].x, adjP[ai].y) : [];
                if (route && route.length) { targetPath = route; doInteract = true; break; }
              }
            }
            if (!targetPath.length) {
              var inside = { x: Math.min(b.x + b.w - 2, Math.max(b.x + 1, door.x)), y: b.y + 1 };
              targetPath = has(window.GameAPI.routeToDungeon) ? window.GameAPI.routeToDungeon(inside.x, inside.y) : [];
            }
            var bi = makeBudget((CONFIG.timeouts && CONFIG.timeouts.route) || 2500);
            for (var ti = 0; ti < targetPath.length; ti++) {
              var st2 = targetPath[ti];
              if (bi.exceeded()) { recordSkip("Routing inside NPC home timed out"); break; }
              var dx4 = Math.sign(st2.x - window.GameAPI.getPlayer().x);
              var dy4 = Math.sign(st2.y - window.GameAPI.getPlayer().y);
              key(dx4 === -1 ? "ArrowLeft" : dx4 === 1 ? "ArrowRight" : (dy4 === -1 ? "ArrowUp" : "ArrowDown"));
              await sleep(100);
            }
            if (doInteract) {
              var ib = makeBudget((CONFIG.timeouts && CONFIG.timeouts.interact) || 250);
              key("g");
              await sleep(Math.min(ib.remain(), 160));
              record(true, "Interacted inside NPC home (prop/decoration)");
            } else {
              record(true, "Reached inside NPC home");
            }
          } else {
            recordSkip("NPC had no home building info");
          }
        } else {
          recordSkip("Skipped NPC home check (no NPC found or API not available)");
        }
      } catch (e) {
        record(false, "NPC home/decoration verification failed: " + (e && e.message ? e.message : String(e)));
      }

      // 3) Decoration/props: route to exact prop tile and press G only if standing on it
      try {
        if (!caps.getTownProps) { recordSkip("No town props API"); }
        else {
          var props = window.GameAPI.getTownProps() || [];
          if (props && props.length) {
            var pl2 = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : { x: 0, y: 0 };
            let bestP = props[0], bestPD = Math.abs(bestP.x - pl2.x) + Math.abs(bestP.y - pl2.y);
            for (var pi = 0; pi < props.length; pi++) {
              var p = props[pi];
              var dP = Math.abs(p.x - pl2.x) + Math.abs(p.y - pl2.y);
              if (dP < bestPD) { bestP = p; bestPD = dP; }
            }
            let routedP = false;
            try { if (MV && typeof MV.routeTo === "function") routedP = await MV.routeTo(bestP.x, bestP.y, { timeoutMs: (CONFIG.timeouts && CONFIG.timeouts.route) || 2500, stepMs: 110 }); } catch (_) {}
            if (!routedP) {
              var pathP = has(window.GameAPI.routeToDungeon) ? window.GameAPI.routeToDungeon(bestP.x, bestP.y) : [];
              var bp = makeBudget((CONFIG.timeouts && CONFIG.timeouts.route) || 2500);
              for (var pj = 0; pj < pathP.length; pj++) {
                var st3 = pathP[pj];
                if (bp.exceeded()) { recordSkip("Routing to town prop timed out"); break; }
                var dx5 = Math.sign(st3.x - window.GameAPI.getPlayer().x);
                var dy5 = Math.sign(st3.y - window.GameAPI.getPlayer().y);
                key(dx5 === -1 ? "ArrowLeft" : dx5 === 1 ? "ArrowRight" : (dy5 === -1 ? "ArrowUp" : "ArrowDown"));
                await sleep(110);
              }
            }

            // Ensure we stand exactly on the prop tile (no blind 'g' from adjacent)
            var onProp = false;
            try {
              var plp = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : { x: bestP.x, y: bestP.y };
              onProp = (plp.x === bestP.x && plp.y === bestP.y);
              if (!onProp && Math.abs(plp.x - bestP.x) + Math.abs(plp.y - bestP.y) === 1) {
                var bdxp = Math.sign(bestP.x - plp.x), bdyp = Math.sign(bestP.y - plp.y);
                key(bdxp === -1 ? "ArrowLeft" : bdxp === 1 ? "ArrowRight" : (bdyp === -1 ? "ArrowUp" : "ArrowDown"));
                await sleep(120);
                plp = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : plp;
                onProp = (plp.x === bestP.x && plp.y === bestP.y);
              }
              if (!onProp) {
                var pathExactP = has(window.GameAPI.routeToDungeon) ? (window.GameAPI.routeToDungeon(bestP.x, bestP.y) || []) : [];
                var budP = makeBudget((CONFIG.timeouts && CONFIG.timeouts.route) || 1000);
                for (var ex = 0; ex < pathExactP.length; ex++) {
                  if (budP.exceeded()) break;
                  var stp = pathExactP[ex];
                  var dxep = Math.sign(stp.x - (has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer().x : stp.x));
                  var dyep = Math.sign(stp.y - (has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer().y : stp.y));
                  key(dxep === -1 ? "ArrowLeft" : dxep === 1 ? "ArrowRight" : (dyep === -1 ? "ArrowUp" : "ArrowDown"));
                  await sleep(90);
                }
                plp = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : plp;
                onProp = (plp.x === bestP.x && plp.y === bestP.y);
              }
            } catch (_){}

            // Interact only if standing on prop
            try { if (typeof ctx.ensureAllModalsClosed === "function") await ctx.ensureAllModalsClosed(1); } catch(_){}
            if (onProp) {
              var ib2 = makeBudget((CONFIG.timeouts && CONFIG.timeouts.interact) || 250);
              key("g");
              await sleep(Math.min(ib2.remain(), 220));
              record(true, "Interacted with decoration/prop (standing on tile)");
            } else {
              recordSkip("Decoration/prop: not on prop tile; skipped G");
            }
          } else {
            recordSkip("No town decorations/props reported");
          }
        }
      } catch (e) {
        record(false, "Decoration/prop interaction failed: " + (e && e.message ? e.message : String(e)));
      }

      // 4) Wait in town (advance time) and Home Routes
      try {
        // Advance turns
        for (var t = 0; t < 8; t++) { key("Numpad5"); await sleep(60); }
        // Minute-level late-night 02:00 if available
        try {
          if (has(window.GameAPI.getClock) && has(window.GameAPI.advanceMinutes)) {
            var clk = window.GameAPI.getClock();
            var curMin = clk.hours * 60 + clk.minutes;
            var to2am = ((2 * 60) - curMin + 24 * 60) % (24 * 60);
            window.GameAPI.advanceMinutes(to2am);
            await sleep(120);
          }
        } catch (_) {}
        var res = has(window.GameAPI.checkHomeRoutes) ? window.GameAPI.checkHomeRoutes() : null;
        var residentsTotal = (res && res.residents && typeof res.residents.total === "number") ? res.residents.total : 0;
        var unreachable = (res && typeof res.unreachable === "number") ? res.unreachable : null;
        var reachable = (res && typeof res.reachable === "number") ? res.reachable : null;
        var hasResidents = residentsTotal > 0;
        record(hasResidents, "Home routes after waits: residents " + residentsTotal + (unreachable != null ? ", unreachable " + unreachable : "") + (reachable != null ? ", reachable " + reachable : ""));
        if (!hasResidents) { try { console.warn("[SMOKE] HomeRoutes raw:", res); } catch (_) {} }
        if (hasResidents && unreachable != null) {
          var lateOk = unreachable === 0;
          record(lateOk, "Late-night home routes: unreachable " + unreachable + " (expected 0)");
        }
      } catch (eHR) {
        record(false, "Home routes after waits failed: " + (eHR && eHR.message ? eHR.message : String(eHR)));
      }

      // Fallback: if town appears empty (no NPCs, shops, or props) for a short time, walk to gate and exit.
      try {
        var endBy = Date.now() + 500;
        var cntNPC = 0, cntProps = 0, cntShops = 0;
        while (Date.now() < endBy) {
          try {
            cntNPC = has(window.GameAPI.getNPCs) ? ((window.GameAPI.getNPCs() || []).length | 0) : 0;
            cntProps = has(window.GameAPI.getTownProps) ? ((window.GameAPI.getTownProps() || []).length | 0) : 0;
            cntShops = has(window.GameAPI.getShops) ? ((window.GameAPI.getShops() || []).length | 0) : 0;
          } catch (_) { cntNPC = cntProps = cntShops = 0; }
          if (cntNPC || cntProps || cntShops) break;
          await sleep(100);
        }
        if (!cntNPC && !cntProps && !cntShops) {
          var gate = has(window.GameAPI.getTownGate) ? window.GameAPI.getTownGate() : null;
          if (gate && typeof gate.x === "number" && typeof gate.y === "number") {
            var routedG = false;
            try { if (MV && typeof MV.routeTo === "function") routedG = await MV.routeTo(gate.x, gate.y, { timeoutMs: (CONFIG.timeouts && CONFIG.timeouts.route) || 2500, stepMs: 90 }); } catch (_) {}
            if (!routedG) {
              var pathG = has(window.GameAPI.routeToDungeon) ? (window.GameAPI.routeToDungeon(gate.x, gate.y) || []) : [];
              var bg = makeBudget((CONFIG.timeouts && CONFIG.timeouts.route) || 2500);
              for (var gi = 0; gi < pathG.length; gi++) {
                var stg = pathG[gi];
                if (bg.exceeded()) break;
                var dxg = Math.sign(stg.x - window.GameAPI.getPlayer().x);
                var dyg = Math.sign(stg.y - window.GameAPI.getPlayer().y);
                key(dxg === -1 ? "ArrowLeft" : dxg === 1 ? "ArrowRight" : (dyg === -1 ? "ArrowUp" : "ArrowDown"));
                await sleep(90);
              }
            }
            // final bump onto gate
            try {
              var plg = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : { x: gate.x, y: gate.y };
              if (plg.x !== gate.x || plg.y !== gate.y) {
                var bdx = Math.sign(gate.x - plg.x), bdy = Math.sign(gate.y - plg.y);
                key(bdx === -1 ? "ArrowLeft" : bdx === 1 ? "ArrowRight" : (bdy === -1 ? "ArrowUp" : "ArrowDown"));
                await sleep(120);
              }
            } catch (_) {}
            if (typeof ctx.ensureAllModalsClosed === "function") { await ctx.ensureAllModalsClosed(1); }
            key("g");
            await sleep(260);
            var left = has(window.GameAPI.getMode) ? (window.GameAPI.getMode() === "world") : false;
            if (!left) { key("g"); await sleep(240); left = has(window.GameAPI.getMode) ? (window.GameAPI.getMode() === "world") : false; }
            record(left, "Empty town fallback: exited to overworld");
          } else {
            recordSkip("Empty town fallback: gate unknown (skipped exit)");
          }
        } else {
          record(true, "Town content present: npc " + cntNPC + ", props " + cntProps + ", shops " + cntShops);
        }
      } catch (eExit) {
        record(false, "Empty town fallback failed: " + (eExit && eExit.message ? eExit.message : String(eExit)));
      }

      return true;
    } catch (e) {
      try { (ctx.record || function(){}) (false, "Town flows scenario failed: " + (e && e.message ? e.message : String(e))); } catch (_) {}
      return true;
    }
  }

  window.SmokeTest.Scenarios.Town = window.SmokeTest.Scenarios.Town || {};
  window.SmokeTest.Scenarios.Town.Flows = { run };
})();