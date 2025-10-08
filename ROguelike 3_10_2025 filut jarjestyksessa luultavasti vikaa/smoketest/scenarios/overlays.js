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

      // Town-only overlays (route/home paths)
      var inTown = (window.GameAPI && typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() === "town");
      if (inTown) {
        try {
          var perfBefore = (typeof window.GameAPI.getPerf === "function") ? window.GameAPI.getPerf() : { lastDrawMs: 0 };
          // Toggle overlays
          try { var btn1 = document.getElementById("god-toggle-route-paths-btn"); btn1 && btn1.click(); } catch (_) {}
          await sleep(100);
          try { var btn2 = document.getElementById("god-toggle-home-paths-btn"); btn2 && btn2.click(); } catch (_) {}
          await sleep(100);
          var perfAfter = (typeof window.GameAPI.getPerf === "function") ? window.GameAPI.getPerf() : { lastDrawMs: 0 };
          var ok = (perfAfter.lastDrawMs || 0) <= (CONFIG.perfBudget.drawMs * 2.0);
          var draw = perfAfter.lastDrawMs;
          record(ok, "Overlay perf: draw " + (draw && draw.toFixed ? draw.toFixed(2) : draw) + "ms");
        } catch (e) {
          record(false, "Overlay/perf snapshot failed: " + (e && e.message ? e.message : String(e)));
        }
      } else {
        recordSkip("Town overlays skipped (not in town)");
      }

      // Global overlay: grid toggle perf snapshot
      try {
        var perfA = (typeof window.GameAPI.getPerf === "function") ? window.GameAPI.getPerf() : { lastDrawMs: 0 };
        try { var gridBtn = document.getElementById("god-toggle-grid-btn"); gridBtn && gridBtn.click(); } catch (_) {}
        await sleep(120);
        var perfB = (typeof window.GameAPI.getPerf === "function") ? window.GameAPI.getPerf() : { lastDrawMs: 0 };
        var okGridPerf = (perfB.lastDrawMs || 0) <= (CONFIG.perfBudget.drawMs * 2.0);
        var drawB = perfB.lastDrawMs;
        record(okGridPerf, "Grid perf: draw " + (drawB && drawB.toFixed ? drawB.toFixed(2) : drawB) + "ms");
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