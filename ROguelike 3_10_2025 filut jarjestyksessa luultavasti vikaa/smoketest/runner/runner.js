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

  // Ensure the GOD panel is visible so logs render into its output area
  function openGodPanel() {
    try {
      if (window.UI && typeof window.UI.showGod === "function") {
        window.UI.showGod();
        return true;
      }
    } catch (_) {}
    try {
      const btn = document.getElementById("god-open-btn");
      if (btn) { btn.click(); return true; }
    } catch (_) {}
    return false;
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

  // Wait helpers: prefer Dom.waitUntilTrue if available, else fallback
  async function waitUntilTrue(fn, timeoutMs, intervalMs) {
    try {
      var D = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Dom;
      if (D && typeof D.waitUntilTrue === "function") {
        return await D.waitUntilTrue(fn, timeoutMs, intervalMs);
      }
    } catch (_) {}
    var deadline = Date.now() + Math.max(0, (timeoutMs | 0) || 0);
    var interval = Math.max(1, (intervalMs | 0) || 50);
    while (Date.now() < deadline) {
      try { if (fn()) return true; } catch (_) {}
      await sleep(interval);
    }
    try { return !!fn(); } catch (_) { return false; }
  }

  function isGameReady() {
    try {
      var G = window.GameAPI || {};
      if (typeof G.getMode === "function") {
        var m = G.getMode();
        if (m === "world" || m === "dungeon" || m === "town") return true;
      }
      // Fallback: player exists with coordinates
      if (typeof G.getPlayer === "function") {
        var p = G.getPlayer();
        if (p && typeof p.x === "number" && typeof p.y === "number") return true;
      }
    } catch (_) {}
    return false;
  }

  async function waitUntilGameReady(timeoutMs) {
    return await waitUntilTrue(() => isGameReady(), Math.max(500, timeoutMs | 0), 80);
  }

  async function run(ctx) {
    try {
      await waitUntilGameReady(6000);
      const caps = detectCaps();
      const params = parseParams();
      const sel = params.scenarios;
      const steps = [];
      function record(ok, msg) { steps.push({ ok: !!ok, msg: String(msg || "") }); }
      function recordSkip(msg) { steps.push({ ok: true, msg: String(msg || ""), skipped: true }); }

      // Open GOD panel to make logs visible
      try { openGodPanel(); } catch (_) {}
      try {
        var B = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
        if (B && typeof B.log === "function") B.log("Starting smoke test…", "notice");
      } catch (_) {}

      const baseCtx = { key, sleep, makeBudget, ensureAllModalsClosed, CONFIG, caps, record, recordSkip };

      // Dev-only RNG audit (if module present)
      try {
        if (params.dev) {
          var RA = window.SmokeTest && window.SmokeTest.Capabilities && window.SmokeTest.Capabilities.RNGAudit;
          if (RA && typeof RA.run === "function") {
            await RA.run({ record, recordSkip, sleep, makeBudget, CONFIG });
          }
        }
      } catch (_) {}

      const S = window.SmokeTest && window.SmokeTest.Scenarios ? window.SmokeTest.Scenarios : {};
      const pipeline = [
        { name: "world", fn: S.World && S.World.run },
        { name: "dungeon", fn: S.Dungeon && S.Dungeon.run },
        { name: "inventory", fn: S.Inventory && S.Inventory.run },
        { name: "combat", fn: S.Combat && S.Combat.run },
        { name: "dungeon_persistence", fn: S.Dungeon && S.Dungeon.Persistence && S.Dungeon.Persistence.run },
        { name: "town", fn: S.Town && S.Town.run },
        { name: "town_diagnostics", fn: S.Town && S.Town.Diagnostics && S.Town.Diagnostics.run },
        { name: "overlays", fn: S.Overlays && S.Overlays.run },
        { name: "determinism", fn: S.Determinism && S.Determinism.run },
      ];

      // Stream progress into GOD panel/status
      let Banner = null;
      try { Banner = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner; } catch (_) {}

      for (let i = 0; i < pipeline.length; i++) {
        const step = pipeline[i];
        if (sel.length && !sel.includes(step.name)) continue;
        if (typeof step.fn !== "function") { recordSkip("Scenario '" + step.name + "' not available"); continue; }
        try {
          if (Banner && typeof Banner.log === "function") Banner.log("Running scenario: " + step.name, "info");
          await step.fn(baseCtx);
          if (Banner && typeof Banner.log === "function") Banner.log("Scenario completed: " + step.name, "good");
        } catch (e) {
          if (Banner && typeof Banner.log === "function") Banner.log("Scenario failed: " + step.name, "bad");
          record(false, step.name + " failed: " + (e && e.message ? e.message : String(e)));
        }
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
      // Provide hidden DOM tokens for CI (align with legacy runner)
      try {
        var token = document.getElementById("smoke-pass-token");
        if (!token) {
          token = document.createElement("div");
          token.id = "smoke-pass-token";
          token.style.display = "none";
          document.body.appendChild(token);
        }
        token.textContent = ok ? "PASS" : "FAIL";
        var jsonToken = document.getElementById("smoke-json-token");
        if (!jsonToken) {
          jsonToken = document.createElement("div");
          jsonToken.id = "smoke-json-token";
          jsonToken.style.display = "none";
          document.body.appendChild(jsonToken);
        }
        jsonToken.textContent = JSON.stringify({ ok, steps, caps });
      } catch (_) {}
      return { ok, steps, caps };
    } catch (e) {
      try { console.error("[SMOKE] Orchestrator run failed", e); } catch (_) {}
      return null;
    }
  }

  async function runSeries(count) {
    const params = parseParams();
    const n = Math.max(1, (count | 0) || params.smokecount || 1);
    const all = [];
    let pass = 0, fail = 0;
    let perfSumTurn = 0, perfSumDraw = 0;

    // Ensure GOD panel visible for live progress
    try { openGodPanel(); } catch (_) {}

    for (let i = 0; i < n; i++) {
      const res = await run({});
      all.push(res);
      if (res && res.ok) pass++; else fail++;

      // Progress panel
      try {
        panelReport(`<div><strong>Smoke Test Progress:</strong> ${i + 1} / ${n}</div><div>Pass: ${pass}  Fail: ${fail}</div>`);
      } catch (_) {}

      // Perf snapshot aggregation
      try {
        if (window.GameAPI && typeof window.GameAPI.getPerf === "function") {
          const p = window.GameAPI.getPerf();
          perfSumTurn += (p.lastTurnMs || 0);
          perfSumDraw += (p.lastDrawMs || 0);
        }
      } catch (_) {}

      await sleep(300);
    }

    const avgTurn = (pass + fail) ? (perfSumTurn / (pass + fail)) : 0;
    const avgDraw = (pass + fail) ? (perfSumDraw / (pass + fail)) : 0;

    // Summary via reporting module (concise)
    try {
      const last = all.length ? all[all.length - 1] : null;
      const R = window.SmokeTest && window.SmokeTest.Reporting && window.SmokeTest.Reporting.Render;
      let keyChecklistFromLast = "";
      try {
        if (R && typeof R.buildKeyChecklistHtmlFromSteps === "function" && last && Array.isArray(last.steps)) {
          keyChecklistFromLast = R.buildKeyChecklistHtmlFromSteps(last.steps);
        }
      } catch (_) {}

      const perfWarnings = [];
      try {
        if (avgTurn > CONFIG.perfBudget.turnMs) perfWarnings.push(`Avg turn ${avgTurn.toFixed ? avgTurn.toFixed(2) : avgTurn}ms exceeds budget ${CONFIG.perfBudget.turnMs}ms`);
        if (avgDraw > CONFIG.perfBudget.drawMs) perfWarnings.push(`Avg draw ${avgDraw.toFixed ? avgDraw.toFixed(2) : avgDraw}ms exceeds budget ${CONFIG.perfBudget.drawMs}ms`);
      } catch (_) {}

      const summary = [
        `<div><strong>Smoke Test Summary:</strong></div>`,
        `<div>Runs: ${n}  Pass: ${pass}  Fail: <span style="${fail ? "color:#ef4444" : "color:#86efac"};">${fail}</span></div>`,
        keyChecklistFromLast,
        perfWarnings.length ? `<div style="color:#ef4444; margin-top:4px;"><strong>Performance:</strong> ${perfWarnings.join("; ")}</div>` : ``,
        `<div class="help" style="color:#8aa0bf; margin-top:4px;">Runner v${RUNNER_VERSION}</div>`,
        fail ? `<div style="margin-top:6px; color:#ef4444;"><strong>Some runs failed.</strong> See per-run details above.</div>` : ``
      ].join("");
      panelReport(summary);

      // Export buttons aggregation
      try {
        const E = window.SmokeTest && window.SmokeTest.Reporting && window.SmokeTest.Reporting.Export;
        if (E && typeof E.attachButtons === "function") {
          const rep = {
            runnerVersion: RUNNER_VERSION,
            runs: n,
            pass, fail,
            avgTurnMs: Number(avgTurn.toFixed ? avgTurn.toFixed(2) : avgTurn),
            avgDrawMs: Number(avgDraw.toFixed ? avgDraw.toFixed(2) : avgDraw),
            results: all
          };
          const summaryText = [
            `Roguelike Smoke Test Summary (Runner v${rep.runnerVersion})`,
            `Runs: ${rep.runs}  Pass: ${rep.pass}  Fail: ${rep.fail}`,
            `Avg PERF: turn ${rep.avgTurnMs} ms, draw ${rep.avgDrawMs} ms`
          ].join("\n");
          const checklistText = (keyChecklistFromLast || "").replace(/<[^>]+>/g, "");
          E.attachButtons(rep, summaryText, checklistText);
        }
      } catch (_) {}
    } catch (_) {}

    return { pass, fail, results: all, avgTurnMs: Number(avgTurn), avgDrawMs: Number(avgDraw), runnerVersion: RUNNER_VERSION };
  }

  window.SmokeTest.Run = { run, runSeries, CONFIG, RUNNER_VERSION, parseParams };
  // Back-compat aliases for UI/GOD button and legacy code paths (always point to orchestrator)
  try {
    window.SmokeTest.runSeries = runSeries;
    window.SmokeTest.run = run;
  } catch (_) {}

  // Auto-run orchestrator when ?smoketest=1
  try {
    const params = parseParams();
    const shouldAuto = params.smoketest;
    const count = params.smokecount || 1;
    if (shouldAuto) {
      const start = async () => { await waitUntilGameReady(6000); await runSeries(count); };
      if (document.readyState !== "loading") {
        setTimeout(() => { start(); }, 400);
      } else {
        window.addEventListener("load", () => { setTimeout(() => { start(); }, 800); });
      }
    }
  } catch (_) {}
})();