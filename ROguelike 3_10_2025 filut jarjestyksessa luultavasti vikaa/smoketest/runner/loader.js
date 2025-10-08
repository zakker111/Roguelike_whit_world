// Smoketest Loader: ensures helper modules are loaded before the runner
(function () {
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      try {
        const s = document.createElement("script");
        s.src = src;
        s.defer = true;
        s.onload = () => resolve();
        s.onerror = (e) => reject(e);
        document.body.appendChild(s);
      } catch (e) {
        reject(e);
      }
    });
  }

  async function boot() {
    const base = "smoketest/";
    const scripts = [
      base + "helpers/capture.js",
      base + "helpers/dom.js",
      base + "helpers/util.js",
      base + "reporting/ui_report.js",
      base + "smoketest_runner.js"
    ];
    for (const u of scripts) {
      try { await loadScript(u); } catch (e) { console.warn("[SMOKE] loader failed to load", u, e); }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();