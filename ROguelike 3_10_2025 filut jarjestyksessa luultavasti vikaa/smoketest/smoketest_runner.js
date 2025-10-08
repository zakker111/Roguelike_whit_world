// Tiny Roguelike Legacy Smoke Test Runner (thin shim)
// Purpose: minimal legacy wrapper that opens GOD, applies seed (optional), then delegates execution and reporting to the modular orchestrator.
// This file now avoids inline scenario logic, duplicate renderers, and heavy fallbacks.

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
        dev: p("dev", "0") === "1",
        legacy: p("legacy", "0") === "1",
        smokecount: Number(p("smokecount", "1")) || 1,
        scenarios: sel.split(",").map(s => s.trim()).filter(Boolean),
        seed: (p("seed", "") || "").trim()
      };
    } catch (_) {
      return { smoketest: false, dev: false, legacy: false, smokecount: 1, scenarios: [], seed: "" };
    }
  }

  

  

  // Thin legacy run: open GOD and delegate to orchestrator's run()
  async function run() {
    try {
      const params = parseParams();

      // Respect scenario filter by setting window.SmokeTest.Config if available
      try {
        if (params.scenarios.length) {
          window.SmokeTest = window.SmokeTest || {};
          window.SmokeTest.__legacySelectedScenarios = params.scenarios.slice();
        }
      } catch (_) {}

      // Delegate to orchestrator
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

  // Thin legacy series: open GOD and delegate to orchestrator's runSeries()
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

      // Header via reporting renderer with fallback
      let headerHtmlOut = "";
      try {
        var R = window.SmokeTest && window.SmokeTest.Reporting && window.SmokeTest.Reporting.Render;
        if (R && typeof R.renderHeader === "function") {
          headerHtmlOut = R.renderHeader({ ok, stepCount: steps.length, totalIssues, runnerVersion: RUNNER_VERSION, caps: capsList });
        }
      } catch (_) {}
      if (!headerHtmlOut) {
        const capsLineLocal = capsList.length
          ? `<div class="help" style="color:#8aa0bf; margin-top:6px;">Runner v${RUNNER_VERSION} | Caps: ${capsList.join(", ")}</div>`
          : `<div class="help" style="color:#8aa0bf; margin-top:6px;">Runner v${RUNNER_VERSION}</div>`;
        headerHtmlOut = `
        <div style="margin-bottom:6px;">
          <div><strong>Smoke Test Result:</strong> ${ok ? "<span style='color:#86efac'>PASS</span>" : "<span style='color:#fca5a5'>PARTIAL/FAIL</span>"}</div>
          <div>Steps: ${steps.length}  Issues: <span style="color:${totalIssues ? "#ef4444" : "#86efac"};">${totalIssues}</span></div>
          ${capsLineLocal}
        </div>`;
      }

      // Main report assembly via renderer with fallback
      let mainHtmlOut = "";
      try {
        var R2 = window.SmokeTest && window.SmokeTest.Reporting && window.SmokeTest.Reporting.Render;
        if (R2 && typeof R2.renderMainReport === "function") {
          mainHtmlOut = R2.renderMainReport({
            headerHtml: headerHtmlOut,
            keyChecklistHtml,
            issuesHtml,
            passedHtml,
            skippedHtml,
            detailsTitle: `<div style="margin-top:10px;"><strong>Step Details</strong></div>`,
            detailsHtml
          });
        }
      } catch (_) {}
      if (!mainHtmlOut) {
        mainHtmlOut = [
          headerHtmlOut,
          keyChecklistHtml,
          issuesHtml,
          passedHtml,
          skippedHtml,
          `<div style="margin-top:10px;"><strong>Step Details</strong></div>`,
          detailsHtml,
        ].join("");
      }

      panelReport(mainHtmlOut);
      // Expose tokens for CI: DOM + localStorage
      try {
        let token = document.getElementById("smoke-pass-token");
        if (!token) {
          token = document.createElement("div");
          token.id = "smoke-pass-token";
          token.style.display = "none";
          document.body.appendChild(token);
        }
        token.textContent = ok ? "PASS" : "FAIL";
        try { localStorage.setItem("smoke-pass-token", ok ? "PASS" : "FAIL"); } catch (_) {}
        // Also expose compact JSON summary
        let jsonToken = document.getElementById("smoke-json-token");
        if (!jsonToken) {
          jsonToken = document.createElement("div");
          jsonToken.id = "smoke-json-token";
          jsonToken.style.display = "none";
          document.body.appendChild(jsonToken);
        }
        const compact = {
          ok,
          passCount: passedSteps.length,
          failCount: failedSteps.length,
          skipCount: skipped.length,
          seed: runMeta.seed,
          caps: Object.keys(runMeta.caps || {}).filter(k => runMeta.caps[k]),
          determinism: runMeta.determinism || {}
        };
        const compactStr = JSON.stringify(compact);
        jsonToken.textContent = compactStr;
        try { localStorage.setItem("smoke-json-token", compactStr); } catch (_) {}
      } catch (_) {}

      return { ok, steps, errors, passedSteps, failedSteps, skipped, console: runMeta.console, determinism: runMeta.determinism, seed: runMeta.seed, caps: runMeta.caps, runnerVersion: RUNNER_VERSION };
    } catch (err) {
      log("Smoke test failed: " + (err && err.message ? err.message : String(err)), "bad");
      try { console.error(err); } catch (_) {}
      const html = `<div><strong>Smoke Test Result:</strong> FAIL (runner crashed)</div><div>${(err && err.message) ? err.message : String(err)}</div>`;
      panelReport(html);
      try {
        let token = document.getElementById("smoke-pass-token");
        if (!token) {
          token = document.createElement("div");
          token.id = "smoke-pass-token";
          token.style.display = "none";
          document.body.appendChild(token);
        }
        token.textContent = "FAIL";
        try { localStorage.setItem("smoke-pass-token", "FAIL"); } catch (_) {}
        let jsonToken = document.getElementById("smoke-json-token");
        if (!jsonToken) {
          jsonToken = document.createElement("div");
          jsonToken.id = "smoke-json-token";
          jsonToken.style.display = "none";
          document.body.appendChild(jsonToken);
        }
        const compact = { ok: false, passCount: 0, failCount: 1, skipCount: 0, seed: null, caps: [], determinism: {} };
        const compactStr = JSON.stringify(compact);
        jsonToken.textContent = compactStr;
        try { localStorage.setItem("smoke-json-token", compactStr); } catch (_) {}
      } catch (_) {}
      return { ok: false, steps: [], errors: [String(err)], passedSteps: [], failedSteps: [], console: ConsoleCapture.snapshot(), determinism: {} };
    }
  }

  async function runSeries(count = 1) {
    const n = Math.max(1, Math.min(20, parseInt(count, 10) || 1));
    let pass = 0, fail = 0;
    const all = [];
    let perfSumTurn = 0, perfSumDraw = 0;

    const det = {
      npcPropSample: null,
      firstEnemyType: null,
      chestItemsCSV: null,
      mismatches: []
    };

    // Generate per-run varying seeds (different key per run)
    const base = (Date.now() >>> 0);
    const seeds = Array.from({ length: n }, (_, i) => ((base + Math.imul(0x9e3779b1, i + 1)) >>> 0));

    log(`Running smoke test ${n} time(s)…`, "notice");
    for (let i = 0; i < n; i++) {
      const res = await runOnce(seeds[i]);
      all.push(res);
      if (res.ok) pass++; else fail++;

      // Capture perf snapshot if exposed
      try {
        if (window.GameAPI && typeof window.GameAPI.getPerf === "function") {
          const p = window.GameAPI.getPerf();
          perfSumTurn += (p.lastTurnMs || 0);
          perfSumDraw += (p.lastDrawMs || 0);
        }
      } catch (_) {}

      // Determinism samples: only compare when seeds are identical (n==1); otherwise just record for report
      try {
        if (n === 1) {
          if (window.GameAPI && typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() === "town") {
            const npcs = (typeof window.GameAPI.getNPCs === "function") ? window.GameAPI.getNPCs() : [];
            const props = (typeof window.GameAPI.getTownProps === "function") ? window.GameAPI.getTownProps() : [];
            const sampleTown = `${npcs[0] ? (npcs[0].name || "") : ""}|${props[0] ? (props[0].type || "") : ""}`;
            det.npcPropSample = det.npcPropSample || sampleTown;
          }
          if (res && res.determinism) {
            if (res.determinism.firstEnemyType) det.firstEnemyType = res.determinism.firstEnemyType;
            if (Array.isArray(res.determinism.chestItems)) det.chestItemsCSV = res.determinism.chestItems.join(",");
          }
        }
      } catch (_) {}

      panelReport(`<div><strong>Smoke Test Progress:</strong> ${i + 1} / ${n}</div><div>Pass: ${pass}  Fail: ${fail}</div>`);
      await sleep(300);
    }
    const avgTurn = (pass + fail) ? (perfSumTurn / (pass + fail)).toFixed(2) : "0.00";
    const avgDraw = (pass + fail) ? (perfSumDraw / (pass + fail)).toFixed(2) : "0.00";

    // Determinism duplicate run: re-run first seed and compare key invariants
    try {
      if (all.length >= 1) {
        log("Determinism duplicate run (same seed) …", "info");
        const dup = await runOnce(seeds[0]);
        const a = all[0] || {};
        const aDet = a.determinism || {};
        const bDet = dup.determinism || {};
        const sameEnemy = (aDet.firstEnemyType || "") === (bDet.firstEnemyType || "");
        const aChest = Array.isArray(aDet.chestItems) ? aDet.chestItems.join(",") : (aDet.chestItemsCSV || "");
        const bChest = Array.isArray(bDet.chestItems) ? bDet.chestItems.join(",") : (bDet.chestItemsCSV || "");
        const sameChest = aChest === bChest;
        const msg = `Determinism: firstEnemy=${aDet.firstEnemyType || ""}/${bDet.firstEnemyType || ""} (${sameEnemy ? "OK" : "MISMATCH"}), chest=${sameChest ? "OK" : "MISMATCH"}`;
        appendToPanel(`<div style="color:${(sameEnemy && sameChest) ? "#86efac" : "#fca5a5"}; margin-top:6px;"><strong>${msg}</strong></div>`);
      }
    } catch (_) {}

    // Aggregate step counts
    let totalPassedSteps = 0, totalFailedSteps = 0, totalSkippedSteps = 0;
    for (const r of all) {
      totalPassedSteps += Array.isArray(r.passedSteps) ? r.passedSteps.length : 0;
      totalFailedSteps += Array.isArray(r.failedSteps) ? r.failedSteps.length : 0;
      totalSkippedSteps += Array.isArray(r.skipped) ? r.skipped.length : 0;
    }

    // Perf budget warnings
    const perfWarnings = [];
    const aTurn = parseFloat(avgTurn);
    const aDraw = parseFloat(avgDraw);
    if (aTurn > CONFIG.perfBudget.turnMs) perfWarnings.push(`Avg turn ${avgTurn}ms exceeds budget ${CONFIG.perfBudget.turnMs}ms`);
    if (aDraw > CONFIG.perfBudget.drawMs) perfWarnings.push(`Avg draw ${avgDraw}ms exceeds budget ${CONFIG.perfBudget.drawMs}ms`);

    // Build Key Checklist for the last run (delegate to reporting module if present; fallback inline)
        function buildKeyChecklistHtmlFromSteps(steps) {
          try {
            var R = window.SmokeTest && window.SmokeTest.Reporting && window.SmokeTest.Reporting.Render;
            if (R && typeof R.buildKeyChecklistHtmlFromSteps === "function") return R.buildKeyChecklistHtmlFromSteps(steps);
          } catch (_) {}
          return "";
        }
      const last = all.length ? all[all.length - 1] : null;
      const keyChecklistFromLast = last ? buildKeyChecklistHtmlFromSteps(last.steps) : "";

      const summary = [
          `<div><strong>Smoke Test Summary:</strong></div>`,
          `<div>Runs: ${n}  Pass: ${pass}  Fail: <span style="${fail ? "color:#ef4444" : "color:#86efac"};">${fail}</span></div>`,
          `<div>Checks: passed ${totalPassedSteps}, failed <span style="${totalFailedSteps ? "color:#ef4444" : "color:#86efac"};">${totalFailedSteps}</span>, skipped <span style="color:#fde68a;">${totalSkippedSteps}</span></div>`,
          `<div>Avg PERF: turn ${avgTurn} ms, draw ${avgDraw} ms</div>`,
          keyChecklistFromLast,
          perfWarnings.length ? `<div style="color:#ef4444; margin-top:4px;"><strong>Performance:</strong> ${perfWarnings.join("; ")}</div>` : ``,
          n === 1 && det.npcPropSample ? `<div>Determinism sample (NPC|prop): ${det.npcPropSample}</div>` : ``,
          n === 1 && det.firstEnemyType ? `<div>Determinism sample (first enemy): ${det.firstEnemyType}</div>` : ``,
          n === 1 && det.chestItemsCSV ? `<div>Determinism sample (chest loot): ${det.chestItemsCSV}</div>` : ``,
          `<div class="help" style="color:#8aa0bf; margin-top:4px;">Runner v${RUNNER_VERSION}</div>`,
          fail ? `<div style="margin-top:6px; color:#ef4444;"><strong>Some runs failed.</strong> See per-run details above.</div>` : ``
        ].join("");
      panelReport(summary);

      log(`Smoke test series done. Pass=${pass} Fail=${fail} AvgTurn=${avgTurn} AvgDraw=${avgDraw}`, fail === 0 ? "good" : "warn");

      // Provide export buttons for JSON and TXT summary + Checklist rendering
      try {
        const report = {
          runnerVersion: RUNNER_VERSION,
          runs: n,
          pass, fail,
          totalPassedSteps, totalFailedSteps, totalSkippedSteps,
          avgTurnMs: Number(avgTurn),
          avgDrawMs: Number(avgDraw),
          seeds,
          determinism: det,
          results: all
        };
        window.SmokeTest.lastReport = report;

        function buildSummaryText(rep) {
          const lines = [];
          lines.push(`Roguelike Smoke Test Summary (Runner v${rep.runnerVersion || RUNNER_VERSION})`);
          lines.push(`Runs: ${rep.runs}  Pass: ${rep.pass}  Fail: ${rep.fail}`);
          lines.push(`Checks: passed ${rep.totalPassedSteps}, failed ${rep.totalFailedSteps}, skipped ${rep.totalSkippedSteps}`);
          lines.push(`Avg PERF: turn ${rep.avgTurnMs} ms, draw ${rep.avgDrawMs} ms`);
          if (Array.isArray(rep.seeds)) lines.push(`Seeds: ${rep.seeds.join(", ")}`);
          if (rep.determinism) {
            if (rep.determinism.npcPropSample) lines.push(`Determinism (NPC|prop): ${rep.determinism.npcPropSample}`);
            if (rep.determinism.firstEnemyType) lines.push(`Determinism (first enemy): ${rep.determinism.firstEnemyType}`);
            if (rep.determinism.chestItemsCSV) lines.push(`Determinism (chest loot): ${rep.determinism.chestItemsCSV}`);
          }
          lines.push("");
          const good = [];
          const bad = [];
          const skipped = [];
          for (let i = 0; i < rep.results.length; i++) {
            const r = rep.results[i];
            const runId = `Run ${i + 1}${r.seed != null ? ` (seed ${r.seed})` : ""}`;
            if (Array.isArray(r.passedSteps)) for (const m of r.passedSteps) good.push(`${runId}: ${m}`);
            if (Array.isArray(r.failedSteps)) for (const m of r.failedSteps) bad.push(`${runId}: ${m}`);
            if (Array.isArray(r.skipped)) for (const m of r.skipped) skipped.push(`${runId}: ${m}`);
          }
          lines.push("GOOD:");
          if (good.length) lines.push(...good.map(s => `  + ${s}`)); else lines.push("  (none)");
          lines.push("");
          lines.push("PROBLEMS:");
          if (bad.length) lines.push(...bad.map(s => `  - ${s}`)); else lines.push("  (none)");
          lines.push("");
          lines.push("SKIPPED:");
          if (skipped.length) lines.push(...skipped.map(s => `  ~ ${s}`)); else lines.push("  (none)");
          lines.push("");
          // Include top few console/browser issues
          const consoleIssues = [];
          for (let i = 0; i < rep.results.length; i++) {
            const r = rep.results[i];
            const id = `Run ${i + 1}`;
            const c = (r.console && (r.console.consoleErrors || [])).slice(0, 3).map(x => `${id}: console.error: ${x}`);
            const w = (r.console && (r.console.windowErrors || [])).slice(0, 3).map(x => `${id}: window: ${x}`);
            const cw = (r.console && (r.console.consoleWarns || [])).slice(0, 2).map(x => `${id}: console.warn: ${x}`);
            consoleIssues.push(...c, ...w, ...cw);
          }
          if (consoleIssues.length) {
            lines.push("Console/Browser issues:");
            lines.push(...consoleIssues.map(s => `  ! ${s}`));
            lines.push("");
          }
          lines.push("End of report.");
          return lines.join("\n");
        }

        function buildChecklistText(rep) {
          const lines = [];
          lines.push(`Roguelike Smoke Test Checklist (Runner v${rep.runnerVersion || RUNNER_VERSION})`);
          lines.push(`Runs: ${rep.runs}  Pass: ${rep.pass}  Fail: ${rep.fail}`);
          lines.push("");
          for (let i = 0; i < rep.results.length; i++) {
            const r = rep.results[i];
            const runId = `Run ${i + 1}${r.seed != null ? ` (seed ${r.seed})` : ""}`;
            lines.push(runId + ":");
            if (Array.isArray(r.passedSteps)) {
              for (const m of r.passedSteps) lines.push(`[x] ${m}`);
            }
            if (Array.isArray(r.failedSteps)) {
              for (const m of r.failedSteps) lines.push(`[ ] ${m}`);
            }
            if (Array.isArray(r.skipped)) {
              for (const m of r.skipped) lines.push(`[~] ${m}`);
            }
            lines.push("");
          }
          return lines.join("\n");
        }

        const summaryText = buildSummaryText(report);
        const checklistText = buildChecklistText(report);
        window.SmokeTest.lastSummaryText = summaryText;
        window.SmokeTest.lastChecklistText = checklistText;

        // Render concise checklist via reporting module
        function buildKeyChecklistHtmlFromSteps(steps) {
          try {
            var R = window.SmokeTest && window.SmokeTest.Reporting && window.SmokeTest.Reporting.Render;
            if (R && typeof R.buildKeyChecklistHtmlFromSteps === "function") return R.buildKeyChecklistHtmlFromSteps(steps);
          } catch (_) {}
          return "";
        }

        const checklistHtml = (() => {
          const items = [];
          for (let i = 0; i < all.length; i++) {
            const r = all[i];
            const runId = `Run ${i + 1}${r.seed != null ? ` (seed ${r.seed})` : ""}`;
            items.push(`<div style="margin-top:6px;"><strong>${runId}</strong></div>`);
            // Key checklist for this run
            items.push(buildKeyChecklistHtmlFromSteps(r.steps));
            // Raw step checklist for this run
            if (Array.isArray(r.passedSteps)) for (const m of r.passedSteps) items.push(`<div style="color:#86efac;">[x] ${m}</div>`);
            if (Array.isArray(r.failedSteps)) for (const m of r.failedSteps) items.push(`<div style="color:#fca5a5;">[ ] ${m}</div>`);
            if (Array.isArray(r.skipped)) for (const m of r.skipped) items.push(`<div style="color:#fde68a;">[~] ${m}</div>`);
          }
          return `<div style="margin-top:8px;"><strong>Checklist</strong></div>` + items.join("");
        })();
        appendToPanel(checklistHtml);

        // Render full report JSON inline (collapsible)
        try {
          const fullReportJson = JSON.stringify(report, null, 2);
          const fullHtml = `
            <div style="margin-top:10px;">
              <details open>
                <summary style="cursor:pointer;"><strong>Full Report (JSON)</strong></summary>
                <pre id="smoke-full-report" style="white-space:pre-wrap; background:#0f1522; color:#d6deeb; padding:10px; border:1px solid #334155; border-radius:6px; max-height:40vh; overflow:auto; margin-top:6px;">${fullReportJson.replace(/[&<]/g, s => s === '&' ? '&amp;' : '&lt;')}</pre>
              </details>
            </div>`;
          appendToPanel(fullHtml);
        } catch (_) {}

        // Export buttons: delegate to reporting module only
        try {
          var E = window.SmokeTest && window.SmokeTest.Reporting && window.SmokeTest.Reporting.Export;
          if (E && typeof E.attachButtons === "function") {
            E.attachButtons(report, summaryText, checklistText);
          }
        } catch (_) {}
      } catch (_) {}

    return { pass, fail, results: all, totalPassedSteps, totalFailedSteps, totalSkippedSteps, avgTurnMs: Number(avgTurn), avgDrawMs: Number(avgDraw), seeds, determinism: det, runnerVersion: RUNNER_VERSION };
  }

  // Expose a global trigger
  window.SmokeTest = window.SmokeTest || {};
  try {
    // If orchestrator is present, register under Legacy namespace and do not override orchestrator aliases.
    if (window.SmokeTest && window.SmokeTest.Run) {
      window.SmokeTest.Legacy = window.SmokeTest.Legacy || {};
      window.SmokeTest.Legacy.run = runOnce;
      window.SmokeTest.Legacy.runSeries = runSeries;
    } else {
      window.SmokeTest.run = runOnce;
      window.SmokeTest.runSeries = runSeries;
    }
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
    var params = new URLSearchParams(location.search);
    var shouldAuto = (params.get("smoketest") === "1") && (params.get("legacy") === "1");
    var autoCount = parseInt(params.get("smokecount") || "1", 10) || 1;
    if (document.readyState !== "loading") {
      if (shouldAuto) { setTimeout(() => { __smokeTriggerRunSeries(autoCount); }, 400); }
    } else {
      window.addEventListener("load", () => {
        if (shouldAuto) { setTimeout(() => { __smokeTriggerRunSeries(autoCount); }, 800); }
      });
    }
  } catch (_) {
    // Fallback: only run if legacy explicitly requested
    window.addEventListener("load", () => {
      var params2 = new URLSearchParams(location.search);
      if ((params2.get("smoketest") === "1") && (params2.get("legacy") === "1")) {
        setTimeout(() => { __smokeTriggerRunSeries(1); }, 800);
      }
    });
  }
})();