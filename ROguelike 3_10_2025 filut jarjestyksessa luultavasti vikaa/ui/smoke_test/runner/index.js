// SmokeTest bootstrap (smoke_test/runner/index.js)
// Dynamically loads core and scenario modules, exposes window.SmokeTest, and autoruns on ?smoketest=1

(function () {
  function loadScriptsSequentially(urls) {
    return urls.reduce((p, url) => p.then(() => new Promise((resolve, reject) => {
      try {
        var s = document.createElement('script');
        s.src = url;
        s.defer = true;
        s.onload = () => resolve();
        s.onerror = (e) => reject(e);
        document.body.appendChild(s);
      } catch (e) { reject(e); }
    })), Promise.resolve());
  }

  const core = [
    "ui/smoke_test/core/config.js",
    "ui/smoke_test/core/console_capture.js",
    "ui/smoke_test/core/budget.js",
    "ui/smoke_test/core/caps.js",
    "ui/smoke_test/core/dom.js"
  ];
  const scenarios = [
    "ui/smoke_test/scenarios/full.js"
  ];

  function autorunIfRequested(runSeries) {
    try {
      var params = new URLSearchParams(location.search);
      var shouldAuto = (params.get("smoketest") === "1") || (window.SMOKETEST_REQUESTED === true);
      var autoCount = parseInt(params.get("smokecount") || "1", 10) || 1;
      if (document.readyState !== "loading") {
        if (shouldAuto) setTimeout(() => runSeries(autoCount), 400);
      } else {
        window.addEventListener("load", () => {
          if (shouldAuto) setTimeout(() => runSeries(autoCount), 800);
        });
      }
    } catch (_) {
      window.addEventListener("load", () => setTimeout(() => runSeries(1), 800));
    }
  }

  loadScriptsSequentially(core.concat(scenarios)).then(() => {
    // Bind exported API from scenarios
    window.SmokeTest = window.SmokeTest || {};
    if (window.SmokeScenarios) {
      window.SmokeTest.run = window.SmokeScenarios.runFullOnce;
      window.SmokeTest.runSeries = window.SmokeScenarios.runFullSeries;
    } else {
      // Fallback no-op
      window.SmokeTest.run = async () => ({ ok: false, steps: [], errors: ["SmokeScenarios missing"] });
      window.SmokeTest.runSeries = async () => ({ pass: 0, fail: 1, results: [] });
    }
    autorunIfRequested(window.SmokeTest.runSeries);
  }).catch(err => {
    console.error("[SMOKE] Bootstrap failed", err);
  });
})();