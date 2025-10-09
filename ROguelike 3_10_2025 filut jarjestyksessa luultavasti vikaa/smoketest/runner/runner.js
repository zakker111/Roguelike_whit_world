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
        scenarios: sel.split(",").map(s => s.trim()).filter(Boolean),
        // New: skip scenarios after they have passed a given number of runs (0 = disabled)
        skipokafter: Number(p("skipokafter", "0")) || 0,
        // Control dungeon persistence scenario frequency: "once" (default), "always", or "never"
        persistence: (p("persistence", "once") || "once").toLowerCase(),
        // Optional base seed override; if provided, seeds are derived deterministically per run
        seed: (function(){ const v = p("seed", ""); if (!v) return null; const n = Number(v); return Number.isFinite(n) ? (n >>> 0) : null; })()
      };
    } catch (_) {
      return { smoketest: false, dev: false, smokecount: 1, legacy: false, scenarios: [], skipokafter: 0 };
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

  // New: wait until scenarios have been defined (avoid "Scenario 'X' not available" due to load race)
  async function waitUntilScenariosReady(timeoutMs) {
    const ok = await waitUntilTrue(() => {
      try {
        const S = window.SmokeTest && window.SmokeTest.Scenarios;
        if (!S) return false;
        // Require at least a couple of core scenarios to be present
        const hasAny =
          (S.World && typeof S.World.run === "function") ||
          (S.Dungeon && typeof S.Dungeon.run === "function") ||
          (S.Inventory && typeof S.Inventory.run === "function") ||
          (S.Combat && typeof S.Combat.run === "function");
        return !!hasAny;
      } catch (_) { return false; }
    }, Math.max(600, timeoutMs | 0), 60);
    return ok;
  }

  async function run(ctx) {
    try {
      const runIndex = (ctx && ctx.index) ? (ctx.index | 0) : null;
      const runTotal = (ctx && ctx.total) ? (ctx.total | 0) : null;
      const stacking = !!(window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.STACK_LOGS);
      const suppress = !!(ctx && ctx.suppressReport);
      // New: scenarios to skip (already stable OK in prior runs)
      const skipSet = new Set((ctx && ctx.skipScenarios) ? ctx.skipScenarios : []);

      await waitUntilGameReady(6000);
      await waitUntilScenariosReady(2000);
      const caps = detectCaps();
      const params = parseParams();
      const sel = params.scenarios;
      const steps = [];
      const skipOk = new Set((ctx && ctx.skipSteps) ? ctx.skipSteps : []);
      function gameLog(m, type) { try { if (window.Logger && typeof Logger.log === "function") Logger.log(String(m || ""), type || "info"); } catch (_) {} }
      function record(ok, msg) {
        const text = String(msg || "");
        if (!!ok && skipOk.has(text)) {
          steps.push({ ok: true, msg: text, skipped: true, skippedReason: "prior_ok" });
          try {
            var B = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
            if (B && typeof B.log === "function") {
              B.log("SKIP (prior OK): " + text, "info");
            }
          } catch (_) {}
          // Also write into the main game log for visibility
          gameLog("[SMOKE] OK in prior run; skipped: " + text, "info");
          return;
        }
        steps.push({ ok: !!ok, msg: text });
        try {
          var B = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
          if (B && typeof B.log === "function") {
            B.log((ok ? "OK: " : "ERR: ") + text, ok ? "good" : "bad");
          }
        } catch (_) {}
      }
      function recordSkip(msg) {
        steps.push({ ok: true, msg: String(msg || ""), skipped: true });
        try {
          var B = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
          if (B && typeof B.log === "function") {
            B.log("SKIP: " + String(msg || ""), "info");
          }
        } catch (_) {}
      }

      // Open GOD panel to make logs visible
      try { openGodPanel(); } catch (_) {}
      try {
        var B = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
        if (B && typeof B.log === "function") B.log("Starting smoke test…", "notice");
      } catch (_) {}

      // Centralized, single-attempt dungeon entry to avoid repeated re-enter across scenarios
      async function ensureDungeonOnce() {
        try {
          const G = window.GameAPI || {};
          const getMode = (typeof G.getMode === "function") ? () => G.getMode() : () => null;
          const modeNow = getMode();
          // Initialize lock namespace
          try {
            window.SmokeTest = window.SmokeTest || {};
            window.SmokeTest.Runner = window.SmokeTest.Runner || {};
          } catch (_) {}
          if (window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.DUNGEON_LOCK) {
            return getMode() === "dungeon";
          }
          // If already in dungeon, set lock and return
          if (modeNow === "dungeon") {
            try { window.SmokeTest.Runner.DUNGEON_LOCK = true; } catch (_) {}
            return true;
          }
          // If in town, try returning to world first
          if (modeNow === "town") {
            try { if (typeof G.returnToWorldIfAtExit === "function") G.returnToWorldIfAtExit(); } catch (_) {}
            await sleep(260);
          }
          // Route to dungeon entrance (best-effort)
          try {
            if (typeof G.gotoNearestDungeon === "function") {
              await G.gotoNearestDungeon();
            } else if (typeof G.nearestDungeon === "function" && typeof G.routeTo === "function") {
              const nd = G.nearestDungeon();
              if (nd) {
                const adj = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
                for (const d of adj) {
                  const ax = nd.x + d.dx, ay = nd.y + d.dy;
                  const path = G.routeTo(ax, ay) || [];
                  for (const st of path) {
                    const pl = (typeof G.getPlayer === "function") ? G.getPlayer() : st;
                    const dx = Math.sign(st.x - pl.x);
                    const dy = Math.sign(st.y - pl.y);
                    key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                    await sleep(80);
                  }
                  break;
                }
              }
            }
          } catch (_) {}
          // Attempt entry once
          try { key("g"); } catch (_) {}
          await sleep(300);
          try { if (typeof G.enterDungeonIfOnEntrance === "function") G.enterDungeonIfOnEntrance(); } catch (_) {}
          await sleep(300);
          const ok = (getMode() === "dungeon");
          if (ok) { try { window.SmokeTest.Runner.DUNGEON_LOCK = true; } catch (_) {} }
          return ok;
        } catch (_) { return false; }
      }

      // Centralized, single-attempt town entry to avoid repeated re-enter across scenarios
      async function ensureTownOnce() {
        try {
          const G = window.GameAPI || {};
          const getMode = (typeof G.getMode === "function") ? () => G.getMode() : () => null;
          const modeNow = getMode();
          // Initialize lock namespace
          try {
            window.SmokeTest = window.SmokeTest || {};
            window.SmokeTest.Runner = window.SmokeTest.Runner || {};
          } catch (_) {}
          if (window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.TOWN_LOCK) {
            return getMode() === "town";
          }
          // If already in town, set lock and return
          if (modeNow === "town") {
            try { window.SmokeTest.Runner.TOWN_LOCK = true; } catch (_) {}
            return true;
          }
          // If in dungeon, try returning to world first
          if (modeNow === "dungeon") {
            try { if (typeof G.returnToWorldIfAtExit === "function") G.returnToWorldIfAtExit(); } catch (_) {}
            await sleep(260);
            if (getMode() !== "world") {
              // Fallback to New Game to guarantee world mode
              try { openGodPanel(); } catch (_) {}
              await sleep(120);
              try { const btn = document.getElementById("god-newgame-btn"); if (btn) btn.click(); } catch (_) {}
              await sleep(300);
            }
          }
          // Route to town gate (best-effort)
          try {
            if (typeof G.gotoNearestTown === "function") {
              await G.gotoNearestTown();
            } else if (typeof G.nearestTown === "function" && typeof G.routeTo === "function") {
              const nt = G.nearestTown();
              if (nt) {
                const adj = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
                for (const d of adj) {
                  const ax = nt.x + d.dx, ay = nt.y + d.dy;
                  const path = G.routeTo(ax, ay) || [];
                  for (const st of path) {
                    const pl = (typeof G.getPlayer === "function") ? G.getPlayer() : st;
                    const dx = Math.sign(st.x - pl.x);
                    const dy = Math.sign(st.y - pl.y);
                    key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                    await sleep(80);
                  }
                  break;
                }
              }
            }
          } catch (_) {}
          // Attempt entry once
          try { key("g"); } catch (_) {}
          await sleep(300);
          try { if (typeof G.enterTownIfOnTile === "function") G.enterTownIfOnTile(); } catch (_) {}
          await sleep(300);
          const ok = (getMode() === "town");
          if (ok) { try { window.SmokeTest.Runner.TOWN_LOCK = true; } catch (_) {} }
          return ok;
        } catch (_) { return false; }
      }

      const baseCtx = { key, sleep, makeBudget, ensureAllModalsClosed, CONFIG, caps, record, recordSkip, ensureDungeonOnce, ensureTownOnce };
      // Collect per-scenario results to inform runSeries skipping strategy
      let scenarioResults = [];

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

      // Dev: log selected scenarios and capabilities upfront for more comprehensive context
      try {
        if (params.dev && Banner && typeof Banner.log === "function") {
          const capsList = Object.keys(caps).filter(k => caps[k]);
          Banner.log("Caps: " + (capsList.length ? capsList.join(", ") : "(none)"), "notice");
          Banner.log("Selected scenarios: " + (sel && sel.length ? sel.join(", ") : "(none)"), "notice");
        }
      } catch (_) {}

      for (let i = 0; i < pipeline.length; i++) {
        const step = pipeline[i];
        // Selection filter
        if (sel.length && !sel.includes(step.name)) continue;
        // Skip scenarios that have reached the stable OK threshold in prior runs
        if (skipSet && skipSet.has(step.name)) {
          recordSkip("Scenario '" + step.name + "' skipped (stable OK threshold reached)");
          scenarioResults.push({ name: step.name, passed: true, skippedStable: true });
          continue;
        }
        // Availability check
        if (typeof step.fn !== "function") { recordSkip("Scenario '" + step.name + "' not available"); continue; }
        const beforeCount = steps.length;
        try {
          if (Banner && typeof Banner.log === "function") Banner.log("Running scenario: " + step.name, "info");
          await step.fn(baseCtx);
          if (Banner && typeof Banner.log === "function") Banner.log("Scenario completed: " + step.name, "good");
        } catch (e) {
          if (Banner && typeof Banner.log === "function") Banner.log("Scenario failed: " + step.name, "bad");
          record(false, step.name + " failed: " + (e && e.message ? e.message : String(e)));
        }
        // Per-scenario pass determination: pass if no failures recorded during this scenario block
        try {
          const during = steps.slice(beforeCount);
          const hasFail = during.some(s => !s.ok && !s.skipped);
          scenarioResults.push({ name: step.name, passed: !hasFail });
        } catch (_) {}
      }

      // Build report via reporting renderer
      const ok = steps.every(s => !!s.ok);
      let issuesHtml = ""; let passedHtml = ""; let skippedHtml = ""; let detailsHtml = ""; let main = "";
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
        main = R.renderMainReport({
          headerHtml,
          keyChecklistHtml,
          issuesHtml,
          passedHtml,
          skippedHtml,
          detailsTitle: `<div style="margin-top:10px;"><strong>Step Details</strong></div>`,
          detailsHtml
        });
        // Render only if not in suppress/collect mode
        if (!suppress) {
          try {
            var B = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
            if (B) {
              if (stacking && typeof B.appendToPanel === "function") {
                const title = (runIndex && runTotal) ? `<div style="margin-top:10px;"><strong>Run ${runIndex} / ${runTotal}</strong></div>` : `<div style="margin-top:10px;"><strong>Run</strong></div>`;
                B.appendToPanel(title + main);
              } else if (typeof B.panelReport === "function") {
                B.panelReport(main);
              } else {
                panelReport(main);
              }
            } else {
              panelReport(main);
            }
          } catch (_) {}
          // Export buttons only when actually rendering and non-stacking
          try {
            if (!stacking) {
              var E = window.SmokeTest && window.SmokeTest.Reporting && window.SmokeTest.Reporting.Export;
              if (E && typeof E.attachButtons === "function") {
                const summaryText = steps.map(s => (s.skipped ? "[SKIP] " : (s.ok ? "[OK] " : "[FAIL] ")) + (s.msg || "")).join("\n");
                const checklistText = (R.buildKeyChecklistHtmlFromSteps(steps) || "").replace(/<[^>]+>/g, "");
                E.attachButtons({ ok, steps, caps, version: RUNNER_VERSION }, summaryText, checklistText);
              }
            }
          } catch (_) {}
        }
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
      return { ok, steps, caps, scenarioResults };
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
    const stacking = n > 1;
    // New: skip scenarios after they have passed this many runs (0 = disabled)
    const skipAfter = (Number(params.skipokafter || 0) | 0);
    const scenarioPassCounts = new Map();

    // Guard: ensure only one runSeries executes at a time
    try {
      window.SmokeTest = window.SmokeTest || {};
      window.SmokeTest.Runner = window.SmokeTest.Runner || {};
      if (window.SmokeTest.Runner.RUN_LOCK) {
        const B = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
        if (B && typeof B.log === "function") B.log("SmokeTest already running; skipping duplicate start.", "warn");
        return { pass: 0, fail: 0, results: [], avgTurnMs: 0, avgDrawMs: 0, runnerVersion: RUNNER_VERSION };
      }
      window.SmokeTest.Runner.RUN_LOCK = true;
    } catch (_) {}

    try {
      window.SmokeTest = window.SmokeTest || {};
      window.SmokeTest.Runner = window.SmokeTest.Runner || {};
      // For multi-run, enable stacking (append each run's report) and do not suppress per-run rendering
      window.SmokeTest.Runner.STACK_LOGS = stacking;
      window.SmokeTest.Runner.COLLECT_ONLY = false;
    } catch (_) {}

    // Ensure GOD panel visible for live progress
    try { openGodPanel(); } catch (_) {}

    // Aggregation of steps across runs (union of success)
    const agg = new Map();
    const okMsgs = new Set();
    // Track seeds used within this series to guarantee uniqueness
   
    // Fresh seed helpers
    function randomUint32(runIndex) {
      let r = 0;
      try {
        if (window.crypto && typeof window.crypto.getRandomValues === "function") {
          const buf = new Uint32Array(1);
          window.crypto.getRandomValues(buf);
          r = (buf[0] >>> 0);
        } else {
          // Fallback base entropy
          r = (Date.now() >>> 0);
        }
      } catch (_) {
        r = (Date.now() >>> 0);
      }
      // Mix in run index to guarantee different values per run
      let t = (r ^ (((runIndex + 1) * 0x9e3779b1) >>> 0)) >>> 0;
      // xorshift-like scrambler
      t ^= t << 13; t >>>= 0;
      t ^= t >> 17; t >>>= 0;
      t ^= t << 5;  t >>>= 0;
      return t >>> 0;
    }
    // Deterministically derive a per-run seed from optional base param; guarantee uniqueness in-series
    function deriveSeed(runIndex) {
      const base = (params && typeof params.seed !== "undefined") ? params.seed : null;
      let s;
      if (base != null) {
        // Mix base with golden-ratio constant and run index, then scramble
        s = (base ^ (((runIndex + 1) * 0x9e3779b1) >>> 0)) >>> 0;
        s ^= s << 13; s >>>= 0;
        s ^= s >> 17; s >>>= 0;
        s ^= s << 5;  s >>>= 0;
        s >>>= 0;
      } else {
        s = randomUint32(runIndex);
      }
      // Ensure uniqueness within this runSeries
      if (usedSeeds.has(s)) {
        s = (s ^ ((Date.now() & 0xffffffff) >>> 0) ^ 0x85ebca6b) >>> 0;
        s ^= s << 13; s >>>= 0;
        s ^= s >> 17; s >>>= 0;
        s ^= s << 5;  s >>>= 0;
        s >>>= 0;
      }
      usedSeeds.add(s);
      return s >>> 0;
    }
    async function applyFreshSeedForRun(runIndex) {
      try {
        const B = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;

        // 1) Ensure we are in WORLD mode before seeding.
        try {
          const G = window.GameAPI || {};
          const getMode = (typeof G.getMode === "function") ? () => G.getMode() : () => null;
          const mode = getMode();
          if (mode !== "world") {
            // If in town/dungeon, route to gate/exit and press G to leave
            try {
              const B = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
              const routeAndExit = async (tx, ty, label) => {
                if (typeof G.routeToDungeon === "function" && Array.isArray(G.routeToDungeon(tx, ty))) {
                  const path = G.routeToDungeon(tx, ty);
                  if (path && path.length) {
                    if (B && typeof B.log === "function") B.log(`Routing to ${label} at (${tx},${ty})…`, "info");
                    for (const step of path) {
                      const dx = Math.sign(step.x - (G.getPlayer && G.getPlayer().x));
                      const dy = Math.sign(step.y - (G.getPlayer && G.getPlayer().y));
                      try { if (typeof G.moveStep === "function") G.moveStep(dx, dy); } catch (_) {}
                      await sleep(60);
                    }
                  }
                }
                // Press G to perform context action (exit)
                if (B && typeof B.log === "function") B.log(`Pressing G to exit ${label}…`, "notice");
                try { key("g"); } catch (_) {}
                await sleep(200);
                // Wait until world mode
                await waitUntilTrue(() => { try { return getMode() === "world"; } catch(_) { return false; } }, 1800, 80);
                await sleep(120);
              };

              // Close any modals first
              await ensureAllModalsClosed(2);
              if (mode === "town" && typeof G.getTownGate === "function") {
                const gate = G.getTownGate();
                if (gate && typeof gate.x === "number" && typeof gate.y === "number") {
                  await routeAndExit(gate.x, gate.y, "town gate");
                } else {
                  // Fallback: use Start New Game
                  if (B && typeof B.log === "function") B.log("Town gate unknown; starting new game.", "warn");
                  try { openGodPanel(); } catch (_) {}
                  await sleep(120);
                  const btn = document.getElementById("god-newgame-btn");
                  if (btn) btn.click();
                  await waitUntilTrue(() => { try { return getMode() === "world"; } catch(_) { return false; } }, 1800, 80);
                  await sleep(120);
                }
              } else if (mode === "dungeon" && typeof G.getDungeonExit === "function") {
                const exit = G.getDungeonExit();
                if (exit && typeof exit.x === "number" && typeof exit.y === "number") {
                  await routeAndExit(exit.x, exit.y, "dungeon entrance");
                } else {
                  // Fallback: Start New Game
                  if (B && typeof B.log === "function") B.log("Dungeon exit unknown; starting new game.", "warn");
                  try { openGodPanel(); } catch (_) {}
                  await sleep(120);
                  const btn = document.getElementById("god-newgame-btn");
                  if (btn) btn.click();
                  await waitUntilTrue(() => { try { return getMode() === "world"; } catch(_) { return false; } }, 1800, 80);
                  await sleep(120);
                }
              } else {
                // Unknown mode; fallback to Start New Game
                try { openGodPanel(); } catch (_) {}
                await sleep(120);
                const btn = document.getElementById("god-newgame-btn");
                if (btn) btn.click();
                await waitUntilTrue(() => { try { return getMode() === "world"; } catch(_) { return false; } }, 1800, 80);
                await sleep(120);
              }
            } catch (_) {}
          }
        } catch (_) {}

        // 2) Apply a fresh seed via the GOD panel controls
        const s = deriveSeed(runIndex);
        try { openGodPanel(); } catch (_) {}
        await sleep(120);
        try {
          const Dom = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Dom;
          if (Dom && typeof Dom.safeSetInput === "function") {
            Dom.safeSetInput("god-seed-input", s);
          } else {
            const inp = document.getElementById("god-seed-input");
            if (inp) {
              inp.value = String(s);
              try { inp.dispatchEvent(new Event("input", { bubbles: true })); } catch (_) {}
              try { inp.dispatchEvent(new Event("change", { bubbles: true })); } catch (_) {}
            }
          }
          if (Dom && typeof Dom.safeClick === "function") {
            Dom.safeClick("god-apply-seed-btn");
          } else {
            const ab = document.getElementById("god-apply-seed-btn");
            if (ab) ab.click();
          }
        } catch (_) {}
        // Give time for regeneration
        await sleep(420);
        try { if (B && typeof B.log === "function") B.log(`Applied fresh seed for run ${runIndex + 1}: ${s}`, "notice"); } catch (_) {}
      } catch (_) {}
    }

    // Live "matchup" scoreboard in the panel (updates after each run)
    function ensureMatchupEl() {
      try {
        const host = document.getElementById("god-check-output");
        if (!host) return null;
        let el = document.getElementById("smoke-matchup");
        if (!el) {
          el = document.createElement("div");
          el.id = "smoke-matchup";
          el.setAttribute("data-expanded", "0");
          // Stronger, pinned styling so it remains visible at the top of the panel
          el.style.position = "sticky";
          el.style.top = "0px";
          el.style.zIndex = "100";
          el.style.marginTop = "0";
          el.style.border = "1px solid rgba(122,162,247,0.35)";
          el.style.borderLeft = "4px solid rgba(122,162,247,0.9)";
          el.style.borderRadius = "6px";
          el.style.padding = "8px 10px";
          el.style.background = "rgba(15,17,24,0.95)";
          el.style.boxShadow = "0 6px 16px rgba(0,0,0,0.35)";
          // Keep the scoreboard visible at the top
          host.prepend(el);
          // Toggle expand/collapse details
          el._matchupHooked = true;
          el.addEventListener("click", (ev) => {
            const btn = ev.target && ev.target.closest && ev.target.closest("[data-act=\"toggle\"]");
            if (btn) {
              ev.preventDefault();
              const expanded = el.getAttribute("data-expanded") === "1";
              el.setAttribute("data-expanded", expanded ? "0" : "1");
              updateMatchup();
            }
          });
        }
        return el;
      } catch (_) { return null; }
    }
    function updateMatchup() {
      try {
        const R = window.SmokeTest && window.SmokeTest.Reporting && window.SmokeTest.Reporting.Render;
        // Include lastSeen for better sorting (most recent first)
        const all = Array.from(agg.values()).map(v => ({ ok: !!v.ok, skipped: (!v.ok && !!v.skippedAny), msg: v.msg, lastSeen: v.lastSeen || 0 }));
        const failed = all.filter(s => !s.ok && !s.skipped).sort((a,b) => (b.lastSeen - a.lastSeen));
        const skipped = all.filter(s => s.skipped).sort((a,b) => (b.lastSeen - a.lastSeen));
        const passed = all.filter(s => s.ok && !s.skipped).sort((a,b) => (b.lastSeen - a.lastSeen));
        const el = ensureMatchupEl();
        if (!el) return;
        // Dynamic border color based on failures present
        el.style.border = failed.length ? "1px solid rgba(239,68,68,0.6)" : "1px solid rgba(122,162,247,0.4)";
        const failColor = failed.length ? "#ef4444" : "#86efac";
        const counts = `<div style="font-weight:600;"><span style="opacity:0.9;">Matchup so far:</span> OK ${passed.length} • FAIL <span style="color:${failColor};">${failed.length}</span> • SKIP ${skipped.length}</div>`;
        // Prioritize fails, then skips, then oks; show more entries for better visibility
        const CAP = 20;
        const detailsList = [];
        const pushSome = (arr) => { for (let i = 0; i < arr.length && detailsList.length < CAP; i++) detailsList.push(arr[i]); };
        pushSome(failed); pushSome(skipped); pushSome(passed);
        const details = (R && typeof R.renderStepsPretty === "function") ? R.renderStepsPretty(detailsList) : "";
        el.innerHTML = counts + (details ? `<div style="margin-top:6px;">${details}</div>` : "");
      } catch (_) {}
    }

    for (let i = 0; i < n; i++) {
      await applyFreshSeedForRun(i);

      // Build skip list from scenarios that have already met the stable OK threshold
      let skipList = (skipAfter > 0)
        ? Array.from(scenarioPassCounts.entries()).filter(([name, cnt]) => (cnt | 0) >= skipAfter).map(([name]) => name)
        : [];
      // Force dungeon_persistence to run only once by default:
      // - "once" (default): run only in first run, skip thereafter
      // - "always": run in all runs
      // - "never": skip in all runs
      try {
        const pers = (params && params.persistence) ? params.persistence : "once";
        if (pers !== "always") {
          if (pers === "never" || i > 0) {
            if (!skipList.includes("dungeon_persistence")) skipList.push("dungeon_persistence");
          }
        }
      } catch (_) {}

      const res = await run({ index: i + 1, total: n, suppressReport: false, skipScenarios: skipList, skipSteps: Array.from(okMsgs) });
      all.push(res);
      if (res && res.ok) pass++; else fail++;

      // Update scenario pass counts
      try {
        if (res && Array.isArray(res.scenarioResults)) {
          for (const sr of res.scenarioResults) {
            if (!sr || !sr.name) continue;
            if (sr.passed && !sr.skippedStable) {
              scenarioPassCounts.set(sr.name, (scenarioPassCounts.get(sr.name) || 0) + 1);
            }
          }
        }
      } catch (_) {}

      // Accumulate step results by message (and build set of messages that have passed before)
      try {
        if (res && Array.isArray(res.steps)) {
          for (const s of res.steps) {
            const key = String(s.msg || "");
            const cur = agg.get(key) || { msg: key, ok: false, skippedAny: false, failCount: 0, lastSeen: 0 };
            if (s.skipped) cur.skippedAny = true;
            if (s.ok && !s.skipped) {
              cur.ok = true;
              okMsgs.add(key);
            }
            if (!s.ok && !s.skipped) cur.failCount += 1;
            // Track last time this step was observed for recency sorting
            cur.lastSeen = Date.now();
            agg.set(key, cur);
          }
        }
      } catch (_) {}

      // Progress snippet
      try {
        const Bprog = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
        const skippedStable = (skipList && skipList.length) ? `<div style="opacity:0.85;">Skipped (stable OK): ${skipList.join(", ")}</div>` : ``;
        const progHtml = `<div style="margin-top:6px;"><strong>Smoke Test Progress:</strong> ${i + 1} / ${n}</div><div>Pass: ${pass}  Fail: ${fail}</div>${skippedStable}`;
        if (Bprog && typeof Bprog.appendToPanel === "function") Bprog.appendToPanel(progHtml);
      } catch (_) {}

      // Update live matchup scoreboard
      updateMatchup();

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

    // Summary via reporting module and full aggregated report
    try {
      const R = window.SmokeTest && window.SmokeTest.Reporting && window.SmokeTest.Reporting.Render;

      // Build aggregated steps: if any run had OK, mark OK; else if only skipped, mark skipped; else fail.
      const aggregatedSteps = Array.from(agg.values()).map(v => {
        return { ok: !!v.ok, msg: v.msg, skipped: (!v.ok && !!v.skippedAny) };
      });
      const failedAgg = aggregatedSteps.filter(s => !s.ok && !s.skipped);
      const passedAgg = aggregatedSteps.filter(s => s.ok && !s.skipped);
      const skippedAgg = aggregatedSteps.filter(s => s.skipped);
      const okAll = aggregatedSteps.filter(s => !s.skipped).every(s => !!s.ok);

      const headerHtmlAgg = R && typeof R.renderHeader === "function"
        ? R.renderHeader({ ok: okAll, stepCount: aggregatedSteps.length, totalIssues: failedAgg.length, runnerVersion: RUNNER_VERSION, caps: [] })
        : "";
      const keyChecklistAgg = R && typeof R.buildKeyChecklistHtmlFromSteps === "function"
        ? R.buildKeyChecklistHtmlFromSteps(aggregatedSteps)
        : "";

      const issuesHtmlAgg = failedAgg.length ? (`<div style="margin-top:10px;"><strong>Aggregated Issues</strong></div>` + (R ? R.renderStepsPretty(failedAgg) : "")) : "";
      const passedHtmlAgg = passedAgg.length ? (`<div style="margin-top:10px;"><strong>Aggregated Passed</strong></div>` + (R ? R.renderStepsPretty(passedAgg) : "")) : "";
      const skippedHtmlAgg = skippedAgg.length ? (`<div style="margin-top:10px;"><strong>Aggregated Skipped</strong></div>` + (R ? R.renderStepsPretty(skippedAgg) : "")) : "";
      const detailsHtmlAgg = R ? R.renderStepsPretty(aggregatedSteps) : "";

      const mainAgg = R && typeof R.renderMainReport === "function"
        ? R.renderMainReport({
            headerHtml: headerHtmlAgg,
            keyChecklistHtml: keyChecklistAgg,
            issuesHtml: issuesHtmlAgg,
            passedHtml: passedHtmlAgg,
            skippedHtml: skippedHtmlAgg,
            detailsTitle: `<div style="margin-top:10px;"><strong>Aggregated Step Details</strong></div>`,
            detailsHtml: detailsHtmlAgg
          })
        : [headerHtmlAgg, keyChecklistAgg, issuesHtmlAgg, passedHtmlAgg, skippedHtmlAgg, detailsHtmlAgg].join("");

      const perfWarnings = [];
      try {
        if (avgTurn > CONFIG.perfBudget.turnMs) perfWarnings.push(`Avg turn ${avgTurn.toFixed ? avgTurn.toFixed(2) : avgTurn}ms exceeds budget ${CONFIG.perfBudget.turnMs}ms`);
        if (avgDraw > CONFIG.perfBudget.drawMs) perfWarnings.push(`Avg draw ${avgDraw.toFixed ? avgDraw.toFixed(2) : avgDraw}ms exceeds budget ${CONFIG.perfBudget.drawMs}ms`);
      } catch (_) {}

      const failColorSum = fail ? '#ef4444' : '#86efac';
      const summary = [
        `<div style="margin-top:8px;"><strong>Smoke Test Summary:</strong></div>`,
        `<div>Runs: ${n}  Pass: ${pass}  Fail: <span style="color:${failColorSum};">${fail}</span></div>`,
        perfWarnings.length ? `<div style="color:#ef4444; margin-top:4px;"><strong>Performance:</strong> ${perfWarnings.join("; ")}</div>` : ``,
      ].join("");

      // Append final aggregated report (keep per-run sections visible)
      try {
        const Bsum = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
        if (Bsum && typeof Bsum.appendToPanel === "function") {
          Bsum.appendToPanel(summary);
          Bsum.appendToPanel(`<div style="margin-top:10px;"><strong>Aggregated Report (Union of Success Across Runs)</strong></div>` + mainAgg);
        } else {
          panelReport(summary + mainAgg);
        }
      } catch (_) {}

      // Export buttons aggregation (final only)
      try {
        const E = window.SmokeTest && window.SmokeTest.Reporting && window.SmokeTest.Reporting.Export;
        if (E && typeof E.attachButtons === "function") {
          const rep = {
            runnerVersion: RUNNER_VERSION,
            runs: n,
            pass, fail,
            avgTurnMs: Number(avgTurn.toFixed ? avgTurn.toFixed(2) : avgTurn),
            avgDrawMs: Number(avgDraw.toFixed ? avgDraw.toFixed(2) : avgDraw),
            results: all,
            aggregatedSteps
          };
          const summaryText = [
            `Roguelike Smoke Test Summary (Runner v${rep.runnerVersion})`,
            `Runs: ${rep.runs}  Pass: ${rep.pass}  Fail: ${rep.fail}`,
            `Avg PERF: turn ${rep.avgTurnMs} ms, draw ${rep.avgDrawMs} ms`
          ].join("\n");
          const checklistText = (R && typeof R.buildKeyChecklistHtmlFromSteps === "function" ? R.buildKeyChecklistHtmlFromSteps(aggregatedSteps) : "").replace(/<[^>]+>/g, "");
          E.attachButtons(rep, summaryText, checklistText);
        }
      } catch (_) {}
    } catch (_) {}

    // Release run lock
    try { if (window.SmokeTest && window.SmokeTest.Runner) window.SmokeTest.Runner.RUN_LOCK = false; } catch (_) {}

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
    const shouldAuto = params.smoketest && !params.legacy;
    const count = params.smokecount || 1;
    if (shouldAuto) {
      const start = async () => {
        // Prevent duplicate auto-starts if something triggers twice
        try {
          window.SmokeTest = window.SmokeTest || {};
          window.SmokeTest.Runner = window.SmokeTest.Runner || {};
          if (window.SmokeTest.Runner.RUN_LOCK) {
            const B = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
            if (B && typeof B.log === "function") B.log("SmokeTest already running; auto-start suppressed.", "warn");
            return;
          }
        } catch (_) {}
        await waitUntilGameReady(6000);
        await runSeries(count);
      };
      if (document.readyState !== "loading") {
        setTimeout(() => { start(); }, 400);
      } else {
        window.addEventListener("load", () => { setTimeout(() => { start(); }, 800); });
      }
    }
  } catch (_) {}
})();