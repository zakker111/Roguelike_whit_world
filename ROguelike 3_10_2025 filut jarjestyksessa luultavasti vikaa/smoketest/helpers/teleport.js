(function () {
  // SmokeTest Teleport helper: dev-only utilities to reposition the player safely
  // Exposes:
  // - Teleport.teleportTo(x, y, opts)
  // - Teleport.teleportToGateAndExit(ctx, opts)
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Helpers = window.SmokeTest.Helpers || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  const Teleport = {
    // Teleport directly via GameAPI.teleportTo if available.
    // opts: { ensureWalkable: true, fallbackScanRadius: 6 }
    async teleportTo(x, y, opts) {
      try {
        const G = window.GameAPI || {};
        const ensureWalkable = !opts || (opts.ensureWalkable !== false);
        const r = (opts && opts.fallbackScanRadius != null) ? (opts.fallbackScanRadius | 0) : 6;
        if (has(G.teleportTo)) {
          return !!G.teleportTo(x | 0, y | 0, { ensureWalkable, fallbackScanRadius: r });
        }
      } catch (_) {}
      return false;
    },

    // Convenience: teleport to town gate and press 'g' to exit to overworld.
    // opts: { closeModals: true, waitMs: 500 }
    async teleportToGateAndExit(ctx, opts) {
      try {
        const G = window.GameAPI || {};
        const MV = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Movement;
        const key = (ctx && ctx.key) || (MV && MV.key) || function(){};
        const sleep = (ctx && ctx.sleep) || ((ms) => new Promise(r => setTimeout(r, ms | 0)));
        const ensureAllModalsClosed = (ctx && ctx.ensureAllModalsClosed) ? ctx.ensureAllModalsClosed : async function(){};
        const waitMs = (opts && opts.waitMs != null) ? (opts.waitMs | 0) : 700;
        const record = (ctx && ctx.record) || function(){};
        const trace = (act) => { try { if (window.SmokeTest && window.SmokeTest.Runner && typeof window.SmokeTest.Runner.traceAction === "function") window.SmokeTest.Runner.traceAction(act); } catch (_) {} };

        if (!has(G.getMode) || G.getMode() !== "town") return false;

        let gate = has(G.getTownGate) ? G.getTownGate() : null;
        if (!gate && has(G.nearestTown)) gate = G.nearestTown();
        if (!gate) return false;

        record(true, "Town exit helper: gate at " + gate.x + "," + gate.y);

        const act = { type: "townExitHelper", startMode: "town", gate: { x: gate.x, y: gate.y }, teleports: [], nudged: false, routed: false, gPresses: 0, usedReturnToWorldIfAtExit: false, usedForceWorld: false, endMode: null, success: false };

        const isOnGate = () => {
          try {
            const pl = has(G.getPlayer) ? G.getPlayer() : { x: gate.x, y: gate.y };
            return (pl.x === gate.x && pl.y === gate.y);
          } catch(_) { return false; }
        };

        const stepTowardGateOnce = async () => {
          try {
            const pl = has(G.getPlayer) ? G.getPlayer() : { x: gate.x, y: gate.y };
            const dx = Math.sign(gate.x - pl.x);
            const dy = Math.sign(gate.y - pl.y);
            key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
            await sleep(120);
          } catch(_) {}
        };

        // Close modals so 'g' isn't swallowed
        try { if (opts && opts.closeModals !== false) await ensureAllModalsClosed(4); } catch (_){}

        // Try to land exactly on gate, with walkable-guard first
        let tpOk = await Teleport.teleportTo(gate.x, gate.y, { ensureWalkable: true, fallbackScanRadius: 4 });
        act.teleports.push({ x: gate.x, y: gate.y, walkable: true, ok: !!tpOk });
        if (!tpOk) {
          // Force-teleport ignoring walkability (NPCs)
          let tp2 = await Teleport.teleportTo(gate.x, gate.y, { ensureWalkable: false, fallbackScanRadius: 0 });
          act.teleports.push({ x: gate.x, y: gate.y, walkable: false, ok: !!tp2 });
          tpOk = tp2;
        }
        // If we teleported but did not end up exactly on gate (landed adjacent due to NPC block), try to step or force-teleport
        if (tpOk && !isOnGate()) {
          // If adjacent, nudge once toward gate
          try {
            const pl = has(G.getPlayer) ? G.getPlayer() : { x: gate.x, y: gate.y };
            if (Math.abs(pl.x - gate.x) + Math.abs(pl.y - gate.y) === 1) {
              await stepTowardGateOnce();
              act.nudged = true;
            }
          } catch(_) {}
          // If still not on gate, force-teleport ignoring walkability (NPCs)
          if (!isOnGate()) {
            try {
              const tp3 = await Teleport.teleportTo(gate.x, gate.y, { ensureWalkable: false, fallbackScanRadius: 0 });
              act.teleports.push({ x: gate.x, y: gate.y, walkable: false, ok: !!tp3, phase: "retry" });
            } catch(_) {}
          }
        }

        // If initial teleport failed, try routing precisely to gate
        if (!tpOk) {
          let routed = false;
          try { if (MV && typeof MV.routeTo === "function") routed = await MV.routeTo(gate.x, gate.y, { timeoutMs: 2000, stepMs: 90 }); } catch (_){}
          act.routed = !!routed;
          if (!routed && has(G.routeToDungeon)) {
            const path = G.routeToDungeon(gate.x, gate.y) || [];
            for (let i = 0; i < path.length; i++) {
              const st = path[i];
              const pl = has(G.getPlayer) ? G.getPlayer() : st;
              const dx = Math.sign(st.x - pl.x);
              const dy = Math.sign(st.y - pl.y);
              key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
              await sleep(80);
            }
          }
          // Final nudge if adjacent
          if (!isOnGate()) await stepTowardGateOnce();
        }

        // Ensure we are exactly on gate before pressing 'g'. If not, one last force-teleport.
        if (!isOnGate()) {
          try {
            const tp4 = await Teleport.teleportTo(gate.x, gate.y, { ensureWalkable: false, fallbackScanRadius: 0 });
            act.teleports.push({ x: gate.x, y: gate.y, walkable: false, ok: !!tp4, phase: "final" });
          } catch(_) {}
        }

        // Debug: report tile underfoot and onGate status before attempting exit
        try {
          const ctxG = has(G.getCtx) ? G.getCtx() : null;
          const plHere = has(G.getPlayer) ? G.getPlayer() : { x: gate.x, y: gate.y };
          let tileStr = "(unknown)";
          try {
            const modeDbg = has(G.getMode) ? G.getMode() : "";
            if (modeDbg === "world") {
              const WT = (ctxG && ctxG.World && ctxG.World.TILES) ? ctxG.World.TILES : null;
              const worldObj = (ctxG && ctxG.world) ? ctxG.world : null;
              if (WT && worldObj && worldObj.map && worldObj.map[plHere.y] && typeof worldObj.map[plHere.y][plHere.x] !== "undefined") {
                const t = worldObj.map[plHere.y][plHere.x];
                const walk = (ctxG && ctxG.World && typeof ctxG.World.isWalkable === "function") ? ctxG.World.isWalkable(t) : true;
                tileStr = (t === WT.TOWN ? "TOWN" : (t === WT.DUNGEON ? "DUNGEON" : (walk ? "walkable" : "blocked")));
              }
            } else {
              const localMap = (typeof ctxG.getMap === "function") ? ctxG.getMap() : (ctxG && ctxG.map);
              if (Array.isArray(localMap) && localMap[plHere.y] && typeof localMap[plHere.y][plHere.x] !== "undefined") {
                const walk = (typeof ctxG.isWalkable === "function") ? !!ctxG.isWalkable(plHere.x, plHere.y) : true;
                tileStr = walk ? "walkable" : "blocked";
              }
            }
          } catch (_) {}
          record(true, "Town exit helper: onGate=" + (isOnGate() ? "YES" : "NO") + " tile=" + tileStr + " at " + plHere.x + "," + plHere.y);
        } catch (_) {}

        // Press 'g' and use API fallback; then confirm world
        try { key("g"); act.gPresses += 1; } catch (_) {}
        await sleep(waitMs);
        try {
          if (has(G.getMode) && G.getMode() === "town" && has(G.returnToWorldFromTown)) { G.returnToWorldFromTown(); act.usedReturnToWorldIfAtExit = true; }
          else if (has(G.returnToWorldIfAtExit)) { G.returnToWorldIfAtExit(); act.usedReturnToWorldIfAtExit = true; }
        } catch (_){}
        await sleep(waitMs);
        let modeNow = has(G.getMode) ? G.getMode() : "";
        record(true, "Town exit helper: post-'g' mode=" + modeNow);
        if (modeNow === "world") {
          act.endMode = "world"; act.success = true; trace(act);
          return true;
        }

        // Final fallback: force-overworld (hard escape hatch)
        try {
          if (has(G.forceWorld)) { G.forceWorld(); act.usedForceWorld = true; await sleep(waitMs); }
        } catch (_) {}
        modeNow = has(G.getMode) ? G.getMode() : "";
        if (modeNow !== "world") {
          // Last resort: use GameAPI wrapper to leave town and re-sync state
          try {
            if (has(G.leaveTownNow)) {
              G.leaveTownNow();
              await sleep(waitMs);
              modeNow = has(G.getMode) ? G.getMode() : modeNow;
            }
          } catch (_) {}
        }
        act.endMode = modeNow; act.success = (modeNow === "world"); trace(act);
        record(act.success, "Town exit helper: final mode=" + modeNow + (act.usedForceWorld ? " [forceWorld]" : ""));
        return modeNow === "world";
      } catch (_) {
        return false;
      }
    },

    // Convenience: teleport to dungeon exit and press 'g' to leave to overworld.
    // opts: { closeModals: true, waitMs: 500 }
    async teleportToDungeonExitAndLeave(ctx, opts) {
      try {
        const G = window.GameAPI || {};
        const MV = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Movement;
        const key = (ctx && ctx.key) || (MV && MV.key) || function(){};
        const sleep = (ctx && ctx.sleep) || ((ms) => new Promise(r => setTimeout(r, ms | 0)));
        const ensureAllModalsClosed = (ctx && ctx.ensureAllModalsClosed) ? ctx.ensureAllModalsClosed : async function(){};
        const waitMs = (opts && opts.waitMs != null) ? (opts.waitMs | 0) : 700;
        const record = (ctx && ctx.record) || function(){};
        const trace = (act) => { try { if (window.SmokeTest && window.SmokeTest.Runner && typeof window.SmokeTest.Runner.traceAction === "function") window.SmokeTest.Runner.traceAction(act); } catch (_) {} };

        if (!has(G.getMode) || G.getMode() !== "dungeon") return false;

        let exit = has(G.getDungeonExit) ? G.getDungeonExit() : null;
        if (!exit || typeof exit.x !== "number" || typeof exit.y !== "number") return false;

        record(true, "Dungeon exit helper: exit at " + exit.x + "," + exit.y);

        const act = { type: "dungeonExitHelper", startMode: "dungeon", exit: { x: exit.x, y: exit.y }, teleports: [], nudged: false, routed: false, gPresses: 0, usedReturnToWorldIfAtExit: false, usedForceWorld: false, endMode: null, success: false };

        const isOnExit = () => {
          try {
            const pl = has(G.getPlayer) ? G.getPlayer() : { x: exit.x, y: exit.y };
            return (pl.x === exit.x && pl.y === exit.y);
          } catch(_) { return false; }
        };

        const stepTowardExitOnce = async () => {
          try {
            const pl = has(G.getPlayer) ? G.getPlayer() : { x: exit.x, y: exit.y };
            const dx = Math.sign(exit.x - pl.x);
            const dy = Math.sign(exit.y - pl.y);
            key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
            await sleep(120);
          } catch(_) {}
        };

        // Close modals so 'g' isn't swallowed
        try { if (opts && opts.closeModals !== false) await ensureAllModalsClosed(4); } catch (_){}

        // Try to land exactly on exit, with walkable-guard first
        let tpOk = await Teleport.teleportTo(exit.x, exit.y, { ensureWalkable: true, fallbackScanRadius: 4 });
        act.teleports.push({ x: exit.x, y: exit.y, walkable: true, ok: !!tpOk });
        if (!tpOk) {
          // Force-teleport ignoring walkability (NPCs)
          let tp2 = await Teleport.teleportTo(exit.x, exit.y, { ensureWalkable: false, fallbackScanRadius: 0 });
          act.teleports.push({ x: exit.x, y: exit.y, walkable: false, ok: !!tp2 });
          tpOk = tp2;
        }
        // If we teleported but did not end up exactly on exit (landed adjacent due to NPC block), try to step or force-teleport
        if (tpOk && !isOnExit()) {
          // If adjacent, nudge once toward exit
          try {
            const pl = has(G.getPlayer) ? G.getPlayer() : { x: exit.x, y: exit.y };
            if (Math.abs(pl.x - exit.x) + Math.abs(pl.y - exit.y) === 1) {
              await stepTowardExitOnce();
              act.nudged = true;
            }
          } catch(_) {}
          // If still not on exit, force-teleport ignoring walkability (NPCs)
          if (!isOnExit()) {
            try {
              const tp3 = await Teleport.teleportTo(exit.x, exit.y, { ensureWalkable: false, fallbackScanRadius: 0 });
              act.teleports.push({ x: exit.x, y: exit.y, walkable: false, ok: !!tp3, phase: "retry" });
            } catch(_) {}
          }
        }

        // If teleport failed, try route+bump as fallback
        if (!tpOk) {
          let routed = false;
          try { if (MV && typeof MV.routeTo === "function") routed = await MV.routeTo(exit.x, exit.y, { timeoutMs: 2000, stepMs: 90 }); } catch (_){}
          act.routed = !!routed;
          if (!routed && has(G.routeToDungeon)) {
            const path = G.routeToDungeon(exit.x, exit.y) || [];
            for (let i = 0; i < path.length; i++) {
              const st = path[i];
              const pl = has(G.getPlayer) ? G.getPlayer() : st;
              const dx = Math.sign(st.x - pl.x);
              const dy = Math.sign(st.y - pl.y);
              key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
              await sleep(80);
            }
          }
          // Final nudge if adjacent
          if (!isOnExit()) await stepTowardExitOnce();
        }

        // Ensure we are exactly on exit before pressing 'g'. If not, one last force-teleport.
        if (!isOnExit()) {
          try {
            const tp4 = await Teleport.teleportTo(exit.x, exit.y, { ensureWalkable: false, fallbackScanRadius: 0 });
            act.teleports.push({ x: exit.x, y: exit.y, walkable: false, ok: !!tp4, phase: "final" });
          } catch(_) {}
        }

        // Press 'g' and use API fallback; then confirm world
        try { key("g"); act.gPresses += 1; } catch (_) {}
        await sleep(waitMs);
        try {
          if (has(G.returnToWorldIfAtExit)) { G.returnToWorldIfAtExit(); act.usedReturnToWorldIfAtExit = true; }
        } catch (_){}
        await sleep(waitMs);
        let modeNow = has(G.getMode) ? G.getMode() : "";
        record(true, "Dungeon exit helper: post-'g' mode=" + modeNow);
        if (modeNow === "world") {
          act.endMode = "world"; act.success = true; trace(act);
          return true;
        }

        // Final fallback: force-overworld (hard escape hatch)
        try {
          if (has(G.forceWorld)) { G.forceWorld(); act.usedForceWorld = true; await sleep(waitMs); }
        } catch (_) {}
        modeNow = has(G.getMode) ? G.getMode() : "";
        act.endMode = modeNow; act.success = (modeNow === "world"); trace(act);
        record(act.success, "Dungeon exit helper: final mode=" + modeNow + (act.usedForceWorld ? " [forceWorld]" : ""));
        return modeNow === "world";
      } catch (_) {
        return false;
      }
    },
  };

  window.SmokeTest.Helpers.Teleport = Teleport;
})();