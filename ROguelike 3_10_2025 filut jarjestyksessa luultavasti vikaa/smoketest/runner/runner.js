(function () {
  // Orchestrator shim: provides a compact runner interface while delegating
  // to the existing smoketest_runner's runSeries for now.
  // Future steps will move orchestration logic here.

  window.SmokeTest = window.SmokeTest || {};

  const CONFIG = window.SmokeTest.Config || {
    timeouts: { route: 5000, interact: 2500, battle: 5000 },
    perfBudget: { turnMs: 6.0, drawMs: 12.0 }
  };
  const RUNNER_VERSION = "1.6.0";

  function parseParams() {
    try {
      const u = new URL(window.location.href);
      const p = (name, def) => u.searchParams.get(name) || def;
      return {
        smoketest: p("smoketest", "0") === "1",
        dev: p("dev", "0") === "1",
        smokecount: Number(p("smokecount", "1")) || 1,
        scenarios: (p("scenarios", "world,dungeon,inventory,combat,town,overlays")).split(",").map(s => s.trim()).filter(Boolean)
      };
    } catch (_) {
      return { smoketest: false, dev: false, smokecount: 1, scenarios: [] };
    }
  }

  async function run(_ctx) {
    // Placeholder: will orchestrate scenarios in later steps
    return null;
  }

  async function runSeries(count) {
    // Delegate to the existing runner's runSeries if available (loaded last by index.html)
    try {
      const delayMs = 50;
      const maxWait = 3000;
      const deadline = Date.now() + maxWait;
      while (!(window.SmokeTest && typeof window.SmokeTest.runSeries === "function") && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, delayMs));
      }
      if (window.SmokeTest && typeof window.SmokeTest.runSeries === "function") {
        return window.SmokeTest.runSeries(count);
      }
    } catch (_) {}
    try { console.warn("[SMOKE] Orchestrator: runner.runSeries not available yet; skipping."); } catch (_) {}
    return null;
  }

  window.SmokeTest.Run = { run, runSeries, CONFIG, RUNNER_VERSION, parseParams };
})();