(function () {
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  async function run(ctx) {
    try {
      var record = ctx.record || function(){};
      var recordSkip = ctx.recordSkip || function(){};
      var sleep = ctx.sleep || (ms => new Promise(r => setTimeout(r, ms|0)));
      var CONFIG = ctx.CONFIG || { perfBudget: { drawMs: 16.7 } };
      var caps = (ctx && ctx.caps) || {};
      if (!caps.GameAPI || !caps.getMode || !caps.getPerf) { recordSkip("Overlays scenario skipped (GameAPI/getMode/getPerf not available)"); return true; }

      function getDrawMs() {
        try {
          if (typeof window !== "undefined" && window.Perf && window.Perf._state && typeof window.Perf._state.lastDrawMs === "number") {
            return window.Perf._state.lastDrawMs || 0;
          }
        } catch (_) {}
        try {
          var p = (typeof window.GameAPI.getPerf === "function") ? window.GameAPI.getPerf() : { lastDrawMs: 0 };
          return p.lastDrawMs || 0;
        } catch (_) {}
        return 0;
      }

      async function waitForDrawChange(prev, timeoutMs) {
        var deadline = Date.now() + Math.max(0, timeoutMs | 0);
        while (Date.now() < deadline) {
          var cur = getDrawMs();
          if (cur !== prev) return cur;
          await sleep(40);
        }
        return getDrawMs();
      }

      // Perf budgets: smoketest should be functional-first; allow slower devices.
      var drawBudget = Math.max(((CONFIG.perfBudget && CONFIG.perfBudget.drawMs) ? CONFIG.perfBudget.drawMs : 16.7) * 12.0, 200);

      // Town-only overlays (route/home paths). Use centralized runner helper to enter town once.
      var okTown = (typeof ctx.ensureTownOnce === "function") ? await ctx.ensureTownOnce() : false;
      var inTown = !!okTown;

      if (inTown) {
        try {
          // Ensure GOD panel is visible before clicking overlay toggles
          try {
            if (window.UIBridge && typeof window.UIBridge.showGod === "function") {
              window.UIBridge.showGod({});
              await sleep(120);
            } else {
              var gob = document.getElementById("god-open-btn");
              if (gob) { gob.click(); await sleep(120); }
            }
          } catch (_) {}

          var beforeDraw = getDrawMs();
          // Toggle overlays
          try { var btn1 = document.getElementById("god-toggle-route-paths-btn"); btn1 && btn1.click(); } catch (_) {}
          await sleep(100);
          try { var btn2 = document.getElementById("god-toggle-home-paths-btn"); btn2 && btn2.click(); } catch (_) {}
          await sleep(100);
          var draw = await waitForDrawChange(beforeDraw, 1200);
          var ok = (draw || 0) <= drawBudget;
          record(ok, "Overlay perf: draw " + (draw && draw.toFixed ? draw.toFixed(2) : draw) + "ms");
        } catch (e) {
          record(false, "Overlay/perf snapshot failed: " + (e && e.message ? e.message : String(e)));
        }
      } else {
        recordSkip("Town overlays skipped (not in town)");
      }

      // Global overlay: grid toggle perf snapshot
      try {
        if (typeof document !== "undefined" && document.hidden) {
          recordSkip("Grid perf skipped (tab hidden)");
        } else {
          var beforeDraw = getDrawMs();
          try { var gridBtn = document.getElementById("god-toggle-grid-btn"); gridBtn && gridBtn.click(); } catch (_) {}
          await sleep(120);
          var drawB = await waitForDrawChange(beforeDraw, 1200);
          var okGridPerf = (drawB || 0) <= drawBudget;
          record(okGridPerf, "Grid perf: draw " + (drawB && drawB.toFixed ? drawB.toFixed(2) : drawB) + "ms");
        }
      } catch (e) {
        record(false, "Grid perf snapshot failed: " + (e && e.message ? e.message : String(e)));
      }

      return true;
    } catch (e) {
      try { (ctx.record || function(){false;})(false, "Overlays scenario failed: " + (e && e.message ? e.message : String(e))); } catch (_) {}
      return false;
    }
  }

  window.SmokeTest.Scenarios.Overlays = { run };
})();