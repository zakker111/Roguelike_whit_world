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
        const waitMs = (opts && opts.waitMs != null) ? (opts.waitMs | 0) : 500;

        if (!has(G.getMode) || G.getMode() !== "town") return false;

        let gate = has(G.getTownGate) ? G.getTownGate() : null;
        if (!gate && has(G.nearestTown)) gate = G.nearestTown();
        if (!gate) return false;

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
        try { if (opts && opts.closeModals !== false) await ensureAllModalsClosed(1); } catch (_){}

        // Try to land exactly on gate, with walkable-guard first
        let tpOk = await Teleport.teleportTo(gate.x, gate.y, { ensureWalkable: true, fallbackScanRadius: 4 });
        // If we teleported but did not end up exactly on gate (landed adjacent due to NPC block), try to step or force-teleport
        if (tpOk && !isOnGate()) {
          // If adjacent, nudge once toward gate
          try {
            const pl = has(G.getPlayer) ? G.getPlayer() : { x: gate.x, y: gate.y };
            if (Math.abs(pl.x - gate.x) + Math.abs(pl.y - gate.y) === 1) {
              await stepTowardGateOnce();
            }
          } catch(_) {}
          // If still not on gate, force-teleport ignoring walkability (NPCs)
          if (!isOnGate()) {
            try { tpOk = await Teleport.teleportTo(gate.x, gate.y, { ensureWalkable: false, fallbackScanRadius: 0 }); } catch(_) {}
          }
        }

        // If initial teleport failed, try routing precisely to gate
        if (!tpOk) {
          let routed = false;
          try { if (MV && typeof MV.routeTo === "function") routed = await MV.routeTo(gate.x, gate.y, { timeoutMs: 2000, stepMs: 90 }); } catch (_){}
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
          try { await Teleport.teleportTo(gate.x, gate.y, { ensureWalkable: false, fallbackScanRadius: 0 }); } catch(_) {}
        }

        // Press 'g' and use API fallback; then confirm world
        try { key("g"); } catch (_) {}
        await sleep(waitMs);
        try { if (has(G.returnToWorldIfAtExit)) G.returnToWorldIfAtExit(); } catch (_){}
        await sleep(waitMs);
        let modeNow = has(G.getMode) ? G.getMode() : "";
        if (modeNow === "world") return true;

        // Final fallback: force-overworld (hard escape hatch)
        try { if (has(G.forceWorld)) { G.forceWorld(); await sleep(waitMs); } } catch (_) {}
        modeNow = has(G.getMode) ? G.getMode() : "";
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
        const waitMs = (opts && opts.waitMs != null) ? (opts.waitMs | 0) : 500;

        if (!has(G.getMode) || G.getMode() !== "dungeon") return false;

        const exit = has(G.getDungeonExit) ? G.getDungeonExit() : null;
        if (!exit || typeof exit.x !== "number" || typeof exit.y !== "number") return false;

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
        try { if (opts && opts.closeModals !== false) await ensureAllModalsClosed(1); } catch (_){}

        // Try to land exactly on exit, with walkable-guard first
        let tpOk = await Teleport.teleportTo(exit.x, exit.y, { ensureWalkable: true, fallbackScanRadius: 4 });
        // If we teleported but did not end up exactly on exit, try to step or force-teleport
        if (tpOk && !isOnExit()) {
          try {
            const pl = has(G.getPlayer) ? G.getPlayer() : { x: exit.x, y: exit.y };
            if (Math.abs(pl.x - exit.x) + Math.abs(pl.y - exit.y) === 1) {
              await stepTowardExitOnce();
            }
          } catch(_) {}
          if (!isOnExit()) {
            try { tpOk = await Teleport.teleportTo(exit.x, exit.y, { ensureWalkable: false, fallbackScanRadius: 0 }); } catch(_) {}
          }
        }

        // If teleport failed, try route+bump as fallback
        if (!tpOk) {
          let routed = false;
          try { if (MV && typeof MV.routeTo === "function") routed = await MV.routeTo(exit.x, exit.y, { timeoutMs: 2000, stepMs: 90 }); } catch (_){}
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
          try { await Teleport.teleportTo(exit.x, exit.y, { ensureWalkable: false, fallbackScanRadius: 0 }); } catch(_) {}
        }

        // Press 'g' and use API fallback; then confirm world
        try { key("g"); } catch (_) {}
        await sleep(waitMs);
        try { if (has(G.returnToWorldIfAtExit)) G.returnToWorldIfAtExit(); } catch (_){}
        await sleep(waitMs);
        let modeNow = has(G.getMode) ? G.getMode() : "";
        if (modeNow === "world") return true;

        // Final fallback: force-overworld (hard escape hatch)
        try { if (has(G.forceWorld)) { G.forceWorld(); await sleep(waitMs); } } catch (_) {}
        modeNow = has(G.getMode) ? G.getMode() : "";
        return modeNow === "world";
      } catch (_) {
        return false;
      }
    },
  };

  window.SmokeTest.Helpers.Teleport = Teleport;
})();