(function () {
  // Dev-only RNG audit: surface Math.random usage hints and RNG source snapshot
  // Exposes: window.SmokeTest.Capabilities.RNGAudit.run(ctx)
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Capabilities = window.SmokeTest.Capabilities || {};

  function isDev() {
    try {
      var params = new URLSearchParams(location.search);
      if (params.get("dev") === "1") return true;
      if (localStorage.getItem("DEV") === "1") return true;
    } catch (_) {}
    return false;
  }

  async function run(ctx) {
    try {
      var record = ctx && ctx.record ? ctx.record : function(){};
      var recordSkip = ctx && ctx.recordSkip ? ctx.recordSkip : function(){};
      var sleep = ctx && ctx.sleep ? ctx.sleep : (ms => new Promise(r => setTimeout(r, ms|0)));

      if (!isDev()) {
        recordSkip("RNG audit skipped (DEV mode off)");
        return true;
      }

      // RNG source snapshot
      var src = "unknown";
      try {
        src = (typeof window !== "undefined" && window.RNG && typeof window.RNG.rng === "function") ? "RNG.service" : "mulberry32.fallback";
        record(true, "RNG source: " + src);
      } catch (_) {}

      // Heuristic audit: scan DOM HTML for Math.random mentions
      var hits = 0;
      try {
        var html = document && document.documentElement && document.documentElement.outerHTML ? document.documentElement.outerHTML : "";
        if (html) {
          var m = html.match(/Math\.random/g);
          hits = m ? m.length : 0;
        }
      } catch (_) {}

      // Inline script text audit
      try {
        var scripts = Array.from(document.scripts || []);
        for (var i = 0; i < scripts.length; i++) {
          var s = scripts[i];
          // only inline scripts can be scanned safely
          if (!s.src && typeof s.text === "string" && s.text.includes("Math.random")) {
            hits++;
          }
        }
      } catch (_) {}

      var ok = hits === 0;
      record(ok, "RNG audit: Math.random mention(s) " + (hits || 0));
      if (!ok) {
        try { await sleep(10); } catch (_) {}
        record(true, "Note: mentions may be harmless (e.g., docs or comments). Prefer deterministic RNG service where feasible.");
      }

      return true;
    } catch (e) {
      try { (ctx && ctx.record ? ctx.record : function(){}) (false, "RNG audit failed: " + (e && e.message ? e.message : String(e))); } catch (_) {}
      return false;
    }
  }

  window.SmokeTest.Capabilities.RNGAudit = { run };
})();