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

        // Close modals so 'g' isn't swallowed
        try { if (opts && opts.closeModals !== false) await ensureAllModalsClosed(1); } catch (_){}

        const tpOk = await Teleport.teleportTo(gate.x, gate.y, { ensureWalkable: true, fallbackScanRadius: 4 });
        if (tpOk) {
          try { key("g"); } catch (_) {}
          await sleep(waitMs);
          // As a fallback, try context action APIs
          try { if (has(G.returnToWorldIfAtExit)) G.returnToWorldIfAtExit(); } catch (_){}
          await sleep(waitMs);
          const modeNow = has(G.getMode) ? G.getMode() : "";
          return modeNow === "world";
        }

        // If teleport failed, try a precise route+bump as fallback
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
        // If adjacent, single nudge
        try {
          const pl = has(G.getPlayer) ? G.getPlayer() : { x: gate.x, y: gate.y };
          if (Math.abs(pl.x - gate.x) + Math.abs(pl.y - gate.y) === 1) {
            const dx = Math.sign(gate.x - pl.x);
            const dy = Math.sign(gate.y - pl.y);
            key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
            await sleep(120);
          }
        } catch (_){}

        try { key("g"); } catch (_){}
        await sleep(waitMs);
        try { if (has(G.returnToWorldIfAtExit)) G.returnToWorldIfAtExit(); } catch (_){}
        await sleep(waitMs);
        return (has(G.getMode) ? G.getMode() : "") === "world";
      } catch (_) {
        return false;
      }
    },
  };

  window.SmokeTest.Helpers.Teleport = Teleport;
})();