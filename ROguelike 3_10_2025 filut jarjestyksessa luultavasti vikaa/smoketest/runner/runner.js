(function () {
  // Orchestrator runner: compact scenario pipeline; now default unless ?legacy=1 is present.
  window.SmokeTest = window.SmokeTest || {};

  const CONFIG = window.SmokeTest.Config || {
    timeouts: { route: 5000, interact: 2500, battle: 5000 },
    perfBudget: { turnMs: 6.0, drawMs: 12.0 }
  };
  const RUNNER_VERSION = "1.8.0";

  function parseParams() {
    try {
      const u = new URL(window.location.href);
      const p = (name, def) => u.searchParams.get(name) || def;
      // Support both legacy "smoke" and new "scenarios" params
      const legacySel = (p("smoke", "") || "").trim();
      const sel = legacySel ? legacySel : p("scenarios", "world,dungeon,inventory,combat,town,overlays,determinism");
      return {
        smoketest: p("smoketest", "0") === "1",
        dev: p("dev", "0") === "1",
        smokecount: Number(p("smokecount", "1")) || 1,
        legacy: p("legacy", "0") === "1",
        scenarios: sel.split(",").map(s => s.trim()).filter(Boolean)
      };
    } catch (_) {
      return { smoketest: false, dev: false, smokecount: 1, legacy: false, scenarios: [] };
    }
  }

  function key(code) {
    try {
      if (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Dom && typeof window.SmokeTest.Helpers.Dom.key === "function") {
        return window.SmokeTest.Helpers.Dom.key(code);
      }
      const ev = new KeyboardEvent("keydown", { key: code, code, bubbles: true });
      try { window.dispatchEvent(ev); } catch (_) {}
      try { document.dispatchEvent(ev); } catch (_) {}
      return true;
    } catch (_) { return false; }
  }
  function sleep(ms) {
    try {
      if (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Dom && typeof window.SmokeTest.Helpers.Dom.sleep === "function") {
        return window.SmokeTest.Helpers.Dom.sleep(ms);
      }
    } catch (_) {}
    return new Promise(r => setTimeout(r, Math.max(0, ms | 0)));
  }
  function makeBudget(ms) {
    try {
      if (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Budget && typeof window.SmokeTest.Helpers.Budget.makeBudget === "function") {
        return window.SmokeTest.Helpers.Budget.makeBudget(ms);
      }
    } catch (_) {}
    const start = Date.now(); const dl = start + Math.max(0, ms | 0);
    return { exceeded: () => Date.now() > dl, remain: () => Math.max(0, dl - Date.now()) };
  }

  // Optional: close any modals that could obstruct movement
  async function ensureAllModalsClosed(times) {
    try {
      const n = Math.max(1, times | 0);
      for (let i = 0; i < n; i++) {
        key("Escape"); await sleep(80);
        try {
          if (window.UI && typeof window.UI.hideLoot === "function") window.UI.hideLoot();
          if (window.UI && typeof window.UI.hideInventory === "function") window.UI.hideInventory();
          if (window.UI && typeof window.UI.hideGod === "function") window.UI.hideGod();
        } catch (_) {}
      }
    } catch (_) {}
  }

  function detectCaps() {
    try {
      if (window.SmokeTest && window.SmokeTest.Capabilities && typeof window.SmokeTest.Capabilities.detect === "function") {
        return window.SmokeTest.Capabilities.detect();
      }
    } catch (_) {}
    const caps = {};
    try {
      const G = window.GameAPI || {};
      ["getMode","nearestTown","nearestDungeon","routeTo","routeToDungeon","getPerf","gotoNearestTown","gotoNearestDungeon",
       "getPlayer","getInventory","getStats","getEquipment","equipBestFromInventory","equipItemAtIndex","equipItemAtIndexHand",
       "unequipSlot","drinkPotionAtIndex","getPotions","getEnemies","returnToWorldIfAtExit"]
       .forEach(k => caps[k] = typeof G[k] === "function");
      caps.GameAPI = !!window.GameAPI;
    } catch (_) {}
    return caps;
  }

  function panelReport(html) {
    try {
      var RB = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
      if (RB && typeof RB.panelReport === "function") return RB.panelReport(html);
    } catch (_) {}
    try {
      var H = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Logging;
      if (H && typeof H.panelReport === "function") return H.panelReport(html);
    } catch (_) {}
  }

  async function run(ctx) {
    try {
      const caps = detectCaps();
      const params = parseParams();
      const sel = params.scenarios;
      const steps = [];
      function record(ok, msg) { steps.push({ ok: !!ok, msg: String(msg || "") }); }
      function recordSkip(msg) { steps.push({ ok: true, msg: String(msg || ""), skipped: true }); }

      const baseCtx = { key, sleep, makeBudget, ensureAllModalsClosed, CONFIG, caps, record, recordSkip };

      const S = window.SmokeTest && window.SmokeTest.Scenarios ? window.SmokeTest.Scenarios : {};
      const pipeline = [
        { name: "world", fn: S.World && S.World.run },
        { name: "dungeon", fn: S.Dungeon && S.Dungeon.run },
        { name: "inventory", fn: S.Inventory && S.Inventory.run },
        { name: "combat", fn: S.Combat && S.Combat.run },
        { name: "town", fn: S.Town && S.Town.run },
        { name: "overlays", fn: S.Overlays && S.Overlays.run },
        { name: "determinism", fn: S.Determinism && S.Determinism.run },
      ];

      for (let i = 0; i < pipeline.length; i++) {
        const step = pipeline[i];
        if (sel.length && !sel.includes(step.name)) continue;
        if (typeof step.fn !== "function") { recordSkip("Scenario '" + step.name + "' not available"); continue; }
        try { await step.fn(baseCtx); } catch (e) { record(false, step.name + " failed: " + (e && e.message ? e.message : String(e))); }
      }

      // Build report via reporting renderer
      const ok = steps.every(s => !!s.ok);
      let issuesHtml = ""; let passedHtml = ""; let skippedHtml = ""; let detailsHtml = "";
      try {
        const R = window.SmokeTest && window.SmokeTest.Reporting && window.SmokeTest.Reporting.Render;
        const passed = steps.filter(s => s.ok && !s.skipped);
        const skipped = steps.filter(s => s.skipped);
        const failed = steps.filter(s => !s.ok && !s.skipped);
        issuesHtml = failed.length ? (`<div style="margin-top:10px;"><strong>Issues</strong></div>` + R.renderStepsPretty(failed)) : "";
        passedHtml = passed.length ? (`<div style="margin-top:10px;"><strong>Passed</strong></div>` + R.renderStepsPretty(passed)) : "";
        skippedHtml = skipped.length ? (`<div style="margin-top:10px;"><strong>Skipped</strong></div>` + R.renderStepsPretty(skipped)) : "";
        detailsHtml = R.renderStepsPretty(steps);
        const headerHtml = R.renderHeader({ ok, stepCount: steps.length, totalIssues: failed.length, runnerVersion: RUNNER_VERSION, caps: Object.keys(caps).filter(k => caps[k]) });
        const keyChecklistHtml = R.buildKeyChecklistHtmlFromSteps(steps);
        const main = R.renderMainReport({
          headerHtml,
          keyChecklistHtml,
          issuesHtml,
          passedHtml,
          skippedHtml,
          detailsTitle: `<div style="margin-top:10px;"><strong>Step Details</strong></div>`,
          detailsHtml
        });
        panelReport(main);
        // Export buttons
        try {
          var E = window.SmokeTest && window.SmokeTest.Reporting && window.SmokeTest.Reporting.Export;
          if (E && typeof E.attachButtons === "function") {
            const summaryText = steps.map(s => (s.skipped ? "[SKIP] " : (s.ok ? "[OK] " : "[FAIL] ")) + (s.msg || "")).join("\n");
            const checklistText = (R.buildKeyChecklistHtmlFromSteps(steps) || "").replace(/<[^>]+>/g, "");
            E.attachButtons({ ok, steps, caps, version: RUNNER_VERSION }, summaryText, checklistText);
          }
        } catch (_) {}
      } catch (_) {}

      try { window.SMOKE_OK = ok; window.SMOKE_STEPS = steps.slice(); window.SMOKE_JSON = { ok, steps, caps }; } catch (_) {}
      try { localStorage.setItem("smoke-pass-token", ok ? "PASS" : "FAIL"); localStorage.setItem("smoke-json-token", JSON.stringify({ ok, steps, caps })); } catch (_) {}
      return { ok, steps, caps };
    } catch (e) {
      try { console.error("[SMOKE] Orchestrator run failed", e); } catch (_) {}
      return null;
    }
  }

  async function runSeries(count) {
    const params = parseParams();
    // Legacy escape hatch: delegate to original smoketest_runner.js when ?legacy=1
    if (params.legacy) {
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
      try { console.warn("[SMOKE] Legacy runner not available; executing orchestrator once."); } catch (_) {}
      return run({});
    }
    // Default: orchestrator pipeline runs N times; display last
    const n = Math.max(1, (count | 0) || 1);
    let last = null;
    for (let i = 0; i < n; i++) {
      last = await run({});
      await sleep(50);
    }
    return last;
  }

  window.SmokeTest.Run = { run, runSeries, CONFIG, RUNNER_VERSION, parseParams };
})();