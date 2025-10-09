(function () {
  // Movement helpers for routing and bump actions
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Helpers = window.SmokeTest.Helpers || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  const Movement = {
    key(code) {
      try {
        if (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Dom && typeof window.SmokeTest.Helpers.Dom.key === "function") {
          return window.SmokeTest.Helpers.Dom.key(code);
        }
      } catch (_) {}
      try {
        const ev = new KeyboardEvent("keydown", { key: code, code, bubbles: true });
        try { window.dispatchEvent(ev); } catch (_) {}
        try { document.dispatchEvent(ev); } catch (_) {}
        return true;
      } catch (_) { return false; }
    },

    sleep(ms) {
      try {
        if (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Dom && typeof window.SmokeTest.Helpers.Dom.sleep === "function") {
          return window.SmokeTest.Helpers.Dom.sleep(ms);
        }
      } catch (_) {}
      return new Promise(resolve => setTimeout(resolve, Math.max(0, ms | 0)));
    },

    makeBudget(ms) {
      try {
        if (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Budget && typeof window.SmokeTest.Helpers.Budget.makeBudget === "function") {
          return window.SmokeTest.Helpers.Budget.makeBudget(ms);
        }
      } catch (_) {}
      const start = Date.now();
      const deadline = start + Math.max(0, ms | 0);
      return {
        exceeded: function () { return Date.now() > deadline; },
        remain: function () { return Math.max(0, deadline - Date.now()); }
      };
    },

    async routeTo(x, y, opts) {
      try {
        const timeoutMs = (opts && typeof opts.timeoutMs === "number") ? (opts.timeoutMs | 0) : 2500;
        const stepMs = (opts && typeof opts.stepMs === "number") ? (opts.stepMs | 0) : 90;
        const budget = Movement.makeBudget(timeoutMs);

        let path = [];
        try {
          const mode = (window.GameAPI && has(window.GameAPI.getMode)) ? window.GameAPI.getMode() : "";
          // Use current-map routing (routeToDungeon) for any non-world mode (works for town and dungeon)
          if (mode !== "world" && has(window.GameAPI.routeToDungeon)) {
            path = window.GameAPI.routeToDungeon(x, y) || [];
          } else if (has(window.GameAPI.routeTo)) {
            // World-mode routing
            path = window.GameAPI.routeTo(x, y) || [];
          }
        } catch (_) {}

        for (let i = 0; i < path.length; i++) {
          if (budget.exceeded()) return false;
          const step = path[i];
          let pl = null;
          try { pl = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : null; } catch (_) {}
          const px = pl ? pl.x : step.x;
          const py = pl ? pl.y : step.y;
          const dx = Math.sign(step.x - px);
          const dy = Math.sign(step.y - py);
          Movement.key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
          await Movement.sleep(stepMs);
        }
        return path.length > 0;
      } catch (_) {
        return false;
      }
    },

    async routeAdjTo(x, y, opts) {
      const adj = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];
      for (let i = 0; i < adj.length; i++) {
        const a = { x: x + adj[i].dx, y: y + adj[i].dy };
        try {
          const ok = await Movement.routeTo(a.x, a.y, opts);
          if (ok) return true;
        } catch (_) {}
      }
      return false;
    },

    bumpToward(x, y, opts) {
      try {
        let pl = null;
        try { pl = has(window.GameAPI.getPlayer) ? window.GameAPI.getPlayer() : null; } catch (_) {}
        if (!pl) return false;
        const dx = Math.sign(x - pl.x);
        const dy = Math.sign(y - pl.y);
        Movement.key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
        return true;
      } catch (_) {
        return false;
      }
    }
  };

  window.SmokeTest.Helpers.Movement = Movement;
})();