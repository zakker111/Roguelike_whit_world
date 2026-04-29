(function () {
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  async function run(ctx) {
    var record = (ctx && ctx.record) ? ctx.record : function () {};
    var recordSkip = (ctx && ctx.recordSkip) ? ctx.recordSkip : function () {};
    var sleep = (ctx && ctx.sleep) ? ctx.sleep : (ms => new Promise(r => setTimeout(r, Math.max(0, ms | 0))));

    var canvas = null;
    var log = null;
    var logRight = null;

    try {
      canvas = document.getElementById("game");
      log = document.getElementById("log");
      logRight = document.getElementById("log-right");
    } catch (_) {}

    if (!canvas) {
      recordSkip("UI layout skipped (#game not found)");
      return true;
    }

    var restore = {
      canvasMarginTop: null,
      canvasMarginBottom: null,
      logDisplay: null,
      logRightDisplay: null
    };

    try {
      restore.canvasMarginTop = canvas.style.marginTop;
      restore.canvasMarginBottom = canvas.style.marginBottom;
      if (log) restore.logDisplay = log.style.display;
      if (logRight) restore.logRightDisplay = logRight.style.display;

      // Phase 1: try to create a no-scroll baseline so we can detect scrollbar-induced shifts.
      try { canvas.style.marginTop = "0px"; } catch (_) {}
      try { canvas.style.marginBottom = "0px"; } catch (_) {}
      try { if (log) log.style.display = "none"; } catch (_) {}
      try { if (logRight) logRight.style.display = "none"; } catch (_) {}

      await sleep(80);
      await new Promise(r => {
        try {
          requestAnimationFrame(() => requestAnimationFrame(r));
        } catch (_) {
          r();
        }
      });

      var leftBefore = canvas.getBoundingClientRect().left;

      // Phase 2: re-enable logs and append long log lines (historically could trigger scrollbars/overflow).
      // Keep the canvas margins at 0 so the initial baseline can fit without scrolling, then let logs induce overflow.
      try { if (log) log.style.display = restore.logDisplay; } catch (_) {}
      try { if (logRight) logRight.style.display = restore.logRightDisplay; } catch (_) {}

      // Clear existing logs to reduce noise.
      try {
        if (window.Logger && typeof window.Logger.clear === "function") {
          window.Logger.clear();
        } else if (log) {
          log.textContent = "";
        }
      } catch (_) {}

      var longToken = "X".repeat(2600);
      for (var i = 0; i < 90; i++) {
        var msg = "[layout] long log line " + i + " " + longToken;
        try {
          if (window.Logger && typeof window.Logger.log === "function") {
            window.Logger.log(msg, "info");
          } else if (log) {
            var div = document.createElement("div");
            div.className = "entry info";
            div.textContent = msg;
            log.prepend(div);
          }
        } catch (_) {}
      }

      await sleep(220);
      await new Promise(r => {
        try {
          requestAnimationFrame(() => requestAnimationFrame(r));
        } catch (_) {
          r();
        }
      });

      var leftAfter = canvas.getBoundingClientRect().left;
      var delta = Math.abs(leftAfter - leftBefore);
      var ok = delta <= 1;

      record(ok, "Canvas left offset stable after long logs (delta=" + delta.toFixed(2) + ", before=" + leftBefore.toFixed(2) + ", after=" + leftAfter.toFixed(2) + ")");
      return true;
    } catch (e) {
      record(false, "UI layout scenario failed: " + (e && e.message ? e.message : String(e)));
      return false;
    } finally {
      try { canvas.style.marginTop = restore.canvasMarginTop; } catch (_) {}
      try { canvas.style.marginBottom = restore.canvasMarginBottom; } catch (_) {}
      try { if (log) log.style.display = restore.logDisplay; } catch (_) {}
      try { if (logRight) logRight.style.display = restore.logRightDisplay; } catch (_) {}
    }
  }

  window.SmokeTest.Scenarios.UILayout = { run };
})();
