// Tiny Roguelike Legacy Smoke Test Runner (thin shim)
// Purpose: minimal legacy wrapper that delegates execution and reporting to the modular orchestrator.
// Notes:
// - No inline scenario logic, renderers, or UI helpers here.
// - Orchestrator handles GOD panel visibility, logging, reporting, and CI tokens.
// - Auto-runs only when ?smoketest=1&legacy=1 is present.

(function () {
  const RUNNER_VERSION = "1.8.0";

  // Parse relevant params (support legacy &smoke= and new &scenarios=)
  function parseParams() {
    try {
      const u = new URL(window.location.href);
      const p = (name, def) => u.searchParams.get(name) || def;
      const legacySel = (p("smoke", "") || "").trim();
      const sel = legacySel ? legacySel : p("scenarios", "");
      return {
        smoketest: p("smoketest", "0") === "1",
        legacy: p("legacy", "0") === "1",
        smokecount: Number(p("smokecount", "1")) || 1,
        scenarios: sel.split(",").map(s => s.trim()).filter(Boolean)
      };
    } catch (_) {
      return { smoketest: false, legacy: false, smokecount: 1, scenarios: [] };
    }
  }

  // Thin legacy run: delegate to orchestrator's run()
  async function run() {
    try {
      const OR = window.SmokeTest && window.SmokeTest.Run;
      if (OR && typeof OR.run === "function") {
        return await OR.run({});
      }
      // Fallback: minimal no-op report when orchestrator missing
      try {
        const Banner = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
        Banner && Banner.panelReport && Banner.panelReport(`<div><strong>Legacy runner:</strong> orchestrator not available.</div>`);
      } catch (_) {}
      return { ok: false, steps: [{ ok: false, msg: "Orchestrator missing" }], caps: {}, version: RUNNER_VERSION };
    } catch (e) {
      try { console.error("[SMOKE] Legacy run failed", e); } catch (_) {}
      return null;
    }
  }

  // Thin legacy series: delegate to orchestrator's runSeries()
  async function runSeries(count) {
    const params = parseParams();
    const n = Math.max(1, (count | 0) || params.smokecount || 1);
    const OR = window.SmokeTest && window.SmokeTest.Run;
    if (OR && typeof OR.runSeries === "function") {
      return await OR.runSeries(n);
    }
    // Fallback single run
    return await run();
  }

  // Register under Legacy namespace and avoid overriding orchestrator aliases
  window.SmokeTest = window.SmokeTest || {};
  try {
    window.SmokeTest.Legacy = window.SmokeTest.Legacy || {};
    window.SmokeTest.Legacy.run = run;
    window.SmokeTest.Legacy.runSeries = runSeries;
    window.SmokeTest.Legacy.RUNNER_VERSION = RUNNER_VERSION;
  } catch (_) {}

  // Auto-run only in explicit legacy mode to avoid double execution
  function __smokeTriggerRunSeries(n) {
    try {
      var RR = window.SmokeTest && window.SmokeTest.Run && window.SmokeTest.Run.runSeries;
      if (typeof RR === "function") { RR(n); return; }
    } catch (_) {}
    try { runSeries(n); } catch (_) {}
  }

  try {
    const params = parseParams();
    const shouldAuto = params.smoketest && params.legacy;
    const autoCount = params.smokecount || 1;
    if (document.readyState !== "loading") {
      if (shouldAuto) { setTimeout(() => { __smokeTriggerRunSeries(autoCount); }, 400); }
    } else {
      window.addEventListener("load", () => {
        if (shouldAuto) { setTimeout(() => { __smokeTriggerRunSeries(autoCount); }, 800); }
      });
    }
  } catch (_) {}
})();

      