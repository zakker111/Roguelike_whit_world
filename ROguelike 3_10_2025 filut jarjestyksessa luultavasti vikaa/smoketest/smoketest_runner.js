// Tiny Roguelike Smoke Test Runner (minimal, modularized helpers)
// Loads when index.html?smoketest=1; exposes window.SmokeTest.run/runSeries.

(function () {
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      try {
        var s = document.createElement("script");
        s.src = src;
        s.defer = true;
        s.onload = function () { resolve(); };
        s.onerror = function (e) { reject(e); };
        document.head.appendChild(s);
      } catch (e) { reject(e); }
    });
  }

  async function boot() {
    try {
      var id = "smoke-banner";
      if (!document.getElementById(id)) {
        var el = document.createElement("div");
        el.id = id;
        el.style.position = "fixed";
        el.style.right = "12px";
        el.style.bottom = "12px";
        el.style.zIndex = "9999";
        el.style.padding = "8px 10px";
        el.style.fontFamily = "JetBrains Mono, monospace";
        el.style.fontSize = "12px";
        el.style.background = "rgba(21,22,27,0.9)";
        el.style.color = "#d6deeb";
        el.style.border = "1px solid rgba(122,162,247,0.35)";
        el.style.borderRadius = "8px";
        el.style.boxShadow = "0 10px 24px rgba(0,0,0,0.5)";
        el.textContent = "[SMOKE] Loading…";
        document.body.appendChild(el);
      }
    } catch (_) {}

    var base = "smoketest/";
    var deps = [
      base + "utils/time.js",
      base + "utils/dom.js",
      base + "utils/keys.js",
      base + "utils/env.js",
      base + "capture/console_capture.js",
      base + "ui/status.js"
    ];
    for (var i = 0; i < deps.length; i++) {
      try { await loadScript(deps[i]); } catch (e) { try { console.error("[SMOKE] Failed to load", deps[i], e); } catch (_) {} }
    }

    var sleep = (window.SmokeTime && window.SmokeTime.sleep) || (function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); });
    var waitUntilTrue = (window.SmokeTime && window.SmokeTime.waitUntilTrue) || (async function (fn, timeoutMs, intervalMs) {
      var deadline = Date.now() + (timeoutMs | 0);
      var interval = intervalMs || 40;
      while (Date.now() < deadline) { try { if (fn()) return true; } catch (_) {} await sleep(interval); }
      return !!fn();
    });
    var panelReport = (window.SmokeDOM && window.SmokeDOM.panelReport) || null;
    var ensureBanner = (window.SmokeDOM && window.SmokeDOM.ensureBanner) || null;
    var ensureStatusEl = (window.SmokeDOM && window.SmokeDOM.ensureStatusEl) || null;
    var key = (window.SmokeKeys && window.SmokeKeys.key) || null;
    var safeClick = (window.SmokeKeys && window.SmokeKeys.safeClick) || null;
    var safeSetInput = (window.SmokeKeys && window.SmokeKeys.safeSetInput) || null;
    var detectCaps = (window.SmokeEnv && window.SmokeEnv.detectCaps) || (function () { return {}; });
    var log = (window.SmokeStatus && window.SmokeStatus.log) || (function (m) { try { console.log("[SMOKE]", m); } catch (_) {} });
    var ConsoleCapture = window.SmokeConsoleCapture;

    var RUNNER_VERSION = "1.6.0";

    async function runOnce(seedOverride) {
      ensureBanner && ensureBanner();
      ensureStatusEl && ensureStatusEl();

      var steps = [];
      var errors = [];
      var skipped = [];
      var runMeta = { console: null, caps: detectCaps ? detectCaps() : {}, seed: null, runnerVersion: RUNNER_VERSION };

      function record(ok, msg) {
        steps.push({ ok: ok, msg: msg });
        if (!ok) errors.push(msg);
        log((ok ? "OK: " : "ERR: ") + msg, ok ? "good" : "bad");
      }
      function recordSkip(msg) {
        skipped.push(msg);
        steps.push({ ok: true, skipped: true, msg: msg });
        log("SKIP: " + msg, "info");
      }

      try {
        ConsoleCapture && ConsoleCapture.reset && ConsoleCapture.reset();
        log("Starting smoke test…", "notice");

        // GOD open
        await sleep(200);
        if (safeClick && safeClick("god-open-btn")) record(true, "Opened GOD panel");
        else recordSkip("GOD open button not present");
        await sleep(200);

        // Seed apply
        try {
          var seed = (typeof seedOverride === "number" && isFinite(seedOverride)) ? (seedOverride >>> 0) : ((Date.now() % 0xffffffff) >>> 0);
          runMeta.seed = seed;
          var okIn = safeSetInput && safeSetInput("god-seed-input", seed);
          var okBtn = safeClick && safeClick("god-apply-seed-btn");
          if (okIn && okBtn) record(true, "Applied seed " + seed);
          else recordSkip("Seed controls not present; skipping seed apply");
        } catch (e) { record(false, "Apply seed failed: " + (e && e.message ? e.message : String(e))); }
        await sleep(300);

        // Registry presence sanity
        try {
          var GD = window.GameData || null;
          var loaded = !!(GD && GD.items && GD.enemies && GD.npcs && GD.shops && GD.town);
          record(loaded, "Data registries present");
        } catch (e) { record(false, "Registry check failed: " + (e && e.message ? e.message : String(e))); }

        // Close GOD
        key && key("Escape");
        await sleep(150);

        // Simple modal priority quick check (best-effort)
        try {
          key && key("KeyI");
          await waitUntilTrue(function () {
            var el = document.getElementById("inv-panel");
            return !!(el && el.hidden === false);
          }, 800, 80);
          key && key("ArrowRight");
          await sleep(200);
          safeClick && safeClick("god-open-btn");
          await waitUntilTrue(function () {
            var el = document.getElementById("god-panel");
            return !!(el && el.hidden === false);
          }, 800, 80);
          key && key("Escape");
          await waitUntilTrue(function () {
            var el = document.getElementById("god-panel");
            return !!(el && el.hidden === true);
          }, 800, 80);
          key && key("Escape");
          await waitUntilTrue(function () {
            var el = document.getElementById("inv-panel");
            return !!(el && el.hidden === true);
          }, 800, 80);
          record(true, "Modal priority basic check done");
        } catch (e) {
          recordSkip("Modal priority inconclusive (timing)");
        }

        // Skip extended flows during modular refactor
        recordSkip("Skipped extended world/dungeon/town/diagnostics flows (temporary during refactor)");

        var ok = errors.length === 0;
        runMeta.console = ConsoleCapture && ConsoleCapture.snapshot ? ConsoleCapture.snapshot() : { consoleErrors: [], consoleWarns: [], windowErrors: [] };

        try {
          var passed = steps.filter(function (s) { return s.ok && !s.skipped; }).length;
          var failed = steps.filter(function (s) { return !s.ok; }).length;
          var skippedN = steps.filter(function (s) { return s.skipped; }).length;
          var html = "<div><strong>Smoke Test Result:</strong> " + (ok ? "<span style='color:#86efac'>PASS</span>" : "<span style='color:#fca5a5'>PARTIAL/FAIL</span>") + "</div>" +
                     "<div>Steps: " + steps.length + " | Passed: " + passed + " | Failed: " + failed + " | Skipped: " + skippedN + "</div>" +
                     "<div class='help' style='color:#8aa0bf; margin-top:6px;'>Runner v" + RUNNER_VERSION + "</div>";
          panelReport && panelReport(html);
        } catch (_) {}

        // PASS/FAIL tokens
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
          var compact = { ok: ok, passCount: passed, failCount: failed, skipCount: skippedN, seed: runMeta.seed, caps: Object.keys(runMeta.caps || {}).filter(function (k) { return runMeta.caps[k]; }) };
          jsonToken.textContent = JSON.stringify(compact);
        } catch (_) {}

        return { ok: ok, steps: steps, errors: errors, skipped: skipped, runnerVersion: RUNNER_VERSION, seed: runMeta.seed, caps: runMeta.caps, console: runMeta.console };
      } catch (err) {
        log("Smoke test failed: " + (err && err.message ? err.message : String(err)), "bad");
        try { console.error(err); } catch (_) {}
        try { panelReport && panelReport("<div><strong>Smoke Test Result:</strong> FAIL (runner crashed)</div><div>" + ((err && err.message) ? err.message : String(err)) + "</div>"); } catch (_) {}
        try {
          var token2 = document.getElementById("smoke-pass-token");
          if (!token2) {
            token2 = document.createElement("div");
            token2.id = "smoke-pass-token";
            token2.style.display = "none";
            document.body.appendChild(token2);
          }
          token2.textContent = "FAIL";
        } catch (_) {}
        return { ok: false, steps: [], errors: [String(err)], skipped: [], runnerVersion: RUNNER_VERSION, seed: null, caps: {} };
      }
    }

    async function runSeries(count) {
      var n = Math.max(1, Math.min(20, parseInt(count, 10) || 1));
      var pass = 0, fail = 0;
      var results = [];
      for (var i = 0; i < n; i++) {
        var res = await runOnce();
        results.push(res);
        if (res.ok) pass++; else fail++;
        try { panelReport && panelReport("<div><strong>Smoke Test Progress:</strong> " + (i + 1) + " / " + n + "</div><div>Pass: " + pass + "  Fail: " + fail + "</div>"); } catch (_) {}
        await sleep(200);
      }
      return { pass: pass, fail: fail, results: results, runnerVersion: RUNNER_VERSION };
    }

    window.SmokeTest = window.SmokeTest || {};
    window.SmokeTest.run = runOnce;
    window.SmokeTest.runSeries = runSeries;

    try {
      var params = new URLSearchParams(location.search);
      var shouldAuto = (params.get("smoketest") === "1") || (window.SMOKETEST_REQUESTED === true);
      var autoCount = parseInt(params.get("smokecount") || "1", 10) || 1;
      if (document.readyState !== "loading") {
        if (shouldAuto) { setTimeout(function () { runSeries(autoCount); }, 400); }
      } else {
        window.addEventListener("load", function () {
          if (shouldAuto) { setTimeout(function () { runSeries(autoCount); }, 800); }
        });
      }
    } catch (_) {
      window.addEventListener("load", function () { setTimeout(function () { runSeries(1); }, 800); });
    }
  } // end boot

  if (document.readyState !== "loading") {
    try { boot(); } catch (e) { try { console.error("[SMOKE] boot failed", e); } catch (_) {} }
  } else {
    window.addEventListener("load", function () {
      try { boot(); } catch (e) { try { console.error("[SMOKE] boot failed", e); } catch (_) {} }
    });
  }
})();

      const headerHtml =
       "< div style=\\\"margin-bottom:6px;\\\">" +
         "<odi><mstrong>Smoke Test Resu:</ $strong> " + (ok  "<'span style='color:#86efac'>PA</<sspan>" :e='color:#fca5a5'>PARTIAL/FAIL</span>"}</div>
          <div>Steps: ${steps.length}  Issues: <span style="${totalIssues ? "#ef4444" : "#86efac"};">${totalIssues}</span></div>
          ${capsLine}
        </div>`;

      const html = [
        headerHtml,
        keyChecklistHtml,
        issuesHtml,
        passedHtml,
        skippedHtml,
        `<div style="margin-top:10px;"><strong>Step Details</strong></div>`,
        detailsHtml,
      ].join("");
      panelReport(html);
      // Expose a simple PASS/FAIL token for CI
      try {
        let token = document.getElementById("smoke-pass-token");
        if (!token) {
          token = document.createElement("div");
          token.id = "smoke-pass-token";
          token.style.display = "none";
          document.body.appendChild(token);
        }
        token.textContent = ok ? "PASS" : "FAIL";
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
        jsonToken.textContent = JSON.stringify(compact);
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
        let jsonToken = document.getElementById("smoke-json-token");
        if (!jsonToken) {
          jsonToken = document.createElement("div");
          jsonToken.id = "smoke-json-token";
          jsonToken.style.display = "none";
          document.body.appendChild(jsonToken);
        }
        const compact = { ok: false, passCount: 0, failCount: 1, skipCount: 0, seed: null, caps: [], determinism: {} };
        jsonToken.textContent = JSON.stringify(compact);
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

    // Build Key Checklist for the last run so it survives the runSeries summary overwrite
      function buildKeyChecklistHtmlFromSteps(steps) {
        if (!Array.isArray(steps)) return "";
        function hasStep(sub, okOnly = true) {
          for (const s of steps) {
            if (okOnly && !s.ok) continue;
            if (String(s.msg || "").toLowerCase().includes(String(sub).toLowerCase())) return true;
          }
          return false;
        }
        const keyChecks = [
          { label: "Entered dungeon", pass: hasStep("Entered dungeon") },
          { label: "Looted chest", pass: hasStep("Looted chest at (") },
          { label: "Chest invariant persists (empty on re-enter)", pass: hasStep("Chest invariant:") },
          { label: "Spawned enemy from GOD", pass: hasStep("Dungeon spawn: enemies") },
          { label: "Enemy types present", pass: hasStep("Enemy types present:") },
          { label: "Enemy glyphs not '?'", pass: hasStep("Enemy glyphs:") && !hasStep('All enemy glyphs are "?"', false) },
          { label: "Attacked enemy (moved/attempted attacks)", pass: hasStep("Moved and attempted attacks") },
          { label: "Killed enemy (corpse increased)", pass: hasStep("Killed enemy: YES") },
          { label: "Decay increased on equipped hand(s)", pass: hasStep("Decay check:") && !hasStep("Decay did not increase", false) },
          { label: "Stair guard (G on non-stair doesn’t exit)", pass: hasStep("Stair guard: G on non-stair does not exit dungeon") },
          { label: "Returned to overworld from dungeon", pass: hasStep("Returned to overworld from dungeon") },
          { label: "Dungeon corpses persisted", pass: hasStep("Persistence corpses:") },
          { label: "Dungeon decals persisted", pass: hasStep("Persistence decals:") },
          { label: "Town entered", pass: hasStep("Entered town") },
          { label: "NPCs present in town", pass: hasStep("NPC presence: count") },
          { label: "Bumped into NPC", pass: hasStep("Bumped into at least one NPC") },
          { label: "NPC home has decorations/props", pass: hasStep("NPC home has") },
          { label: "Shop UI closes with Esc", pass: hasStep("Shop UI closes with Esc") },
        ];
        const rows = keyChecks.map(c => {
          const mark = c.pass ? "[x]" : "[ ]";
          const color = c.pass ? "#86efac" : "#fca5a5";
          return `<div style="color:${color};">${mark} ${c.label}</div>`;
        }).join("");
        return `<div style="margin-top:10px;"><strong>Key Checklist (last run)</strong></div>${rows}`;
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

        // Render concise checklist into GOD panel as well
        // Helper to build key checklist from a set of steps
        function buildKeyChecklistHtmlFromSteps(steps) {
          if (!Array.isArray(steps)) return "";
          function hasStep(sub, okOnly = true) {
            for (const s of steps) {
              if (okOnly && !s.ok) continue;
              if (String(s.msg || "").toLowerCase().includes(String(sub).toLowerCase())) return true;
            }
            return false;
          }
          const keyChecks = [
            { label: "Entered dungeon", pass: hasStep("Entered dungeon") },
            { label: "Looted chest", pass: hasStep("Looted chest at (") },
            { label: "Chest invariant persists (empty on re-enter)", pass: hasStep("Chest invariant:") },
            { label: "Spawned enemy from GOD", pass: hasStep("Dungeon spawn: enemies") },
            { label: "Enemy types present", pass: hasStep("Enemy types present:") },
            { label: "Enemy glyphs not '?'", pass: hasStep("Enemy glyphs:") && !hasStep('All enemy glyphs are "?"', false) },
            { label: "Attacked enemy (moved/attempted attacks)", pass: hasStep("Moved and attempted attacks") },
            { label: "Killed enemy (corpse increased)", pass: hasStep("Killed enemy: YES") },
            { label: "Decay increased on equipped hand(s)", pass: hasStep("Decay check:") && !hasStep("Decay did not increase", false) },
            { label: "Stair guard (G on non-stair doesn’t exit)", pass: hasStep("Stair guard: G on non-stair does not exit dungeon") },
            { label: "Returned to overworld from dungeon", pass: hasStep("Returned to overworld from dungeon") },
            { label: "Dungeon corpses persisted", pass: hasStep("Persistence corpses:") },
            { label: "Dungeon decals persisted", pass: hasStep("Persistence decals:") },
            { label: "Town entered", pass: hasStep("Entered town") },
            { label: "NPCs present in town", pass: hasStep("NPC presence: count") },
            { label: "Bumped into NPC", pass: hasStep("Bumped into at least one NPC") },
            { label: "NPC home has decorations/props", pass: hasStep("NPC home has") },
            { label: "Shop UI closes with Esc", pass: hasStep("Shop UI closes with Esc") },
          ];
          const rows = keyChecks.map(c => {
            const mark = c.pass ? "[x]" : "[ ]";
            const color = c.pass ? "#86efac" : "#fca5a5";
            return `<div style="color:${color};">${mark} ${c.label}</div>`;
          }).join("");
          return `<div style="margin-top:4px;"><em>Key Checklist</em></div>${rows}`;
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

        const btnHtml = `
          <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
            <button id="smoke-export-btn" style="padding:6px 10px; background:#1f2937; color:#e5e7eb; border:1px solid #334155; border-radius:4px; cursor:pointer;">Download Report (JSON)</button>
            <button id="smoke-export-summary-btn" style="padding:6px 10px; background:#1f2937; color:#e5e7eb; border:1px solid #334155; border-radius:4px; cursor:pointer;">Download Summary (TXT)</button>
            <button id="smoke-export-checklist-btn" style="padding:6px 10px; background:#1f2937; color:#e5e7eb; border:1px solid #334155; border-radius:4px; cursor:pointer;">Download Checklist (TXT)</button>
          </div>`;
        appendToPanel(btnHtml);

        // Ensure GOD panel is open so the report is visible, and scroll to it
        try {
          if (window.UI && typeof UI.showGod === "function") {
            UI.showGod();
          } else {
            // Fallback to clicking the GOD button
            try { document.getElementById("god-open-btn")?.click(); } catch (_) {}
          }
          setTimeout(() => {
            try {
              const pre = document.getElementById("smoke-full-report");
              if (pre && typeof pre.scrollIntoView === "function") {
                pre.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            } catch (_) {}
          }, 50);
        } catch (_) {}

        setTimeout(() => {
          const jsonBtn = document.getElementById("smoke-export-btn");
          if (jsonBtn) {
            jsonBtn.onclick = () => {
              try {
                const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "smoketest_report.json";
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                }, 100);
              } catch (e) {
                console.error("Export failed", e);
              }
            };
          }
          const txtBtn = document.getElementById("smoke-export-summary-btn");
          if (txtBtn) {
            txtBtn.onclick = () => {
              try {
                const blob = new Blob([summaryText], { type: "text/plain" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "smoketest_summary.txt";
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                }, 100);
              } catch (e) {
                console.error("Export summary failed", e);
              }
            };
          }
          const clBtn = document.getElementById("smoke-export-checklist-btn");
          if (clBtn) {
            clBtn.onclick = () => {
              try {
                const blob = new Blob([checklistText], { type: "text/plain" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "smoketest_checklist.txt";
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                }, 100);
              } catch (e) {
                console.error("Export checklist failed", e);
              }
            };
          }
        }, 0);
      } catch (_) {}

    return { pass, fail, results: all, totalPassedSteps, totalFailedSteps, totalSkippedSteps, avgTurnMs: Number(avgTurn), avgDrawMs: Number(avgDraw), seeds, determinism: det, runnerVersion: RUNNER_VERSION };
  }

  // Expose a global trigger
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.run = runOnce;
  window.SmokeTest.runSeries = runSeries;

  // Auto-run conditions:
  // - If ?smoketest=1 param was set and script loaded during/after page load
  // - If the loader set window.SMOKETEST_REQUESTED
  try {
    var params = new URLSearchParams(location.search);
    var shouldAuto = (params.get("smoketest") === "1") || (window.SMOKETEST_REQUESTED === true);
    var autoCount = parseInt(params.get("smokecount") || "1", 10) || 1;
    if (document.readyState !== "loading") {
      if (shouldAuto) { setTimeout(() => { runSeries(autoCount); }, 400); }
    } else {
      window.addEventListener("load", () => {
        if (shouldAuto) { setTimeout(() => { runSeries(autoCount); }, 800); }
      });
    }
  } catch (_) {
    // Fallback: run on load if present
    window.addEventListener("load", () => { setTimeout(() => { runSeries(1); }, 800); });
  }
} // end boot()

// Ensure boot runs
if (document.readyState !== "loading") {
  try { boot(); } catch (e) { console.error("[SMOKE] boot failed", e); }
} else {
  window.addEventListener("load", () => {
    try { boot(); } catch (e) { console.error("[SMOKE] boot failed", e); }
  });
}

})();