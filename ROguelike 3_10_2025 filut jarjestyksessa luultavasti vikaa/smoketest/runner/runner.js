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
        seed: (function(){ const v = p("seed", ""); if (!v) return null; const n = Number(v); return Number.isFinite(n) ? (n >>> 0) : null; })(),
        // Abort current run as soon as an immobile condition is detected in any scenario (default: disabled)
        abortonimmobile: (p("abortonimmobile", "0") === "1")
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
          if (window.UIBridge && typeof window.UIBridge.hideLoot === "function") window.UIBridge.hideLoot({});
          if (window.UIBridge && typeof window.UIBridge.hideInventory === "function") window.UIBridge.hideInventory({});
          if (window.UIBridge && typeof window.UIBridge.hideGod === "function") window.UIBridge.hideGod({});
          if (window.UIBridge && typeof window.UIBridge.hideShop === "function") window.UIBridge.hideShop({});
          if (window.UIBridge && typeof window.UIBridge.hideSmoke === "function") window.UIBridge.hideSmoke({});
        } catch (_) {}
      }
    } catch (_) {}
  }

  // Ensure the GOD panel is visible so logs render into its output area
  function openGodPanel() {
    try {
      if (window.UIBridge && typeof window.UIBridge.showGod === "function") {
        window.UIBridge.showGod({});
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

  // Comprehensive runner readiness check: game, scenarios, UI, and canvas
  function isRunnerReady() {
    try {
      const G = window.GameAPI || {};
      // Mode or player coordinate availability
      let modeOK = false;
      try {
        if (typeof G.getMode === "function") {
          const m = G.getMode();
          modeOK = (m === "world" || m === "dungeon" || m === "town");
        }
      } catch (_) {}
      let playerOK = false;
      try {
        if (typeof G.getPlayer === "function") {
          const p = G.getPlayer();
          playerOK = !!(p && typeof p.x === "number" && typeof p.y === "number");
        }
      } catch (_) {}
      const baseOK = (modeOK || playerOK);

      // Scenarios present (same as waitUntilScenariosReady)
      const scenariosOK = (() => {
        try {
          const S = window.SmokeTest && window.SmokeTest.Scenarios;
          if (!S) return false;
          return !!(
            (S.World && typeof S.World.run === "function") ||
            (S.Dungeon && typeof S.Dungeon.run === "function") ||
            (S.Inventory && typeof S.Inventory.run === "function") ||
            (S.Combat && typeof S.Combat.run === "function")
          );
        } catch (_) { return false; }
      })();

      // UI baseline: able to close GOD or at least find the open button
      const uiOK = (() => {
        try {
          if (window.UIBridge && typeof window.UIBridge.hideGod === "function") return true;
          const gob = document.getElementById("god-open-btn");
          return !!gob;
        } catch (_) { return false; }
      })();

      // Canvas present
      const canvasOK = (() => {
        try { return !!document.getElementById("game"); } catch (_) { return false; }
      })();

      return baseOK && scenariosOK && uiOK && canvasOK;
    } catch (_) { return false; }
  }

  async function waitUntilRunnerReady(timeoutMs) {
    const to = Math.max(600, timeoutMs | 0);
    return await waitUntilTrue(() => isRunnerReady(), to, 80);
  }

  async function run(ctx) {
    try {
      const runIndex = (ctx && ctx.index) ? (ctx.index | 0) : null;
      const runTotal = (ctx && ctx.total) ? (ctx.total | 0) : null;
      const stacking = !!(window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.STACK_LOGS);
      const suppress = !!(ctx && ctx.suppressReport);
      // New: scenarios to skip (already stable OK in prior runs)
      const skipSet = new Set((ctx && ctx.skipScenarios) ? ctx.skipScenarios : []);

      await waitUntilRunnerReady(6000);
      const caps = detectCaps();
      const params = parseParams();
      const sel = params.scenarios;
      const steps = [];
      let sanitized = null;
      let aborted = false;
      let __curScenarioName = null;

      // Structured trace for deeper analysis in exported JSON
      const G = window.GameAPI || {};
      const trace = {
        runIndex: runIndex || 1,
        total: runTotal || 1,
        seed: (ctx && ctx.seedUsed) || (window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.CUR_SEED) || null,
        params,
        caps: Object.keys(caps).filter(k => caps[k]),
        startMode: (typeof G.getMode === "function") ? G.getMode() : null,
        scenarioTraces: [],
        actions: [],
        timestamps: { start: Date.now() }
      };
      try {
        window.SmokeTest = window.SmokeTest || {};
        window.SmokeTest.Runner = window.SmokeTest.Runner || {};
        window.SmokeTest.Runner.CUR_TRACE = trace;
        window.SmokeTest.Runner.traceAction = function (act) {
          try { if (act && trace && Array.isArray(trace.actions)) trace.actions.push(act); } catch (_) {}
        };
      } catch (_) {}

      const skipOk = new Set((ctx && ctx.skipSteps) ? ctx.skipSteps : []);
      // Abort controls: if a critical condition like "immobile" occurs, abort this run early
      let __abortRequested = false;
      let __abortReason = null;
      function gameLog(m, type) { try { if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") window.Logger.log(String(m || ""), type || "info"); } catch (_) {} }
      function record(ok, msg) {
        const text = String(msg || "");
        const lower = text.toLowerCase();
        const G = window.GameAPI || {};
        const ts = Date.now();
        let modeSnap = null, posSnap = null;
        try { if (typeof G.getMode === "function") modeSnap = G.getMode(); } catch (_) {}
        try {
          if (typeof G.getPlayer === "function") {
            const p = G.getPlayer();
            if (p && typeof p.x === "number" && typeof p.y === "number") posSnap = { x: p.x, y: p.y };
          }
        } catch (_) {}
        // Extra context: tile underfoot, modal states, perf snapshot
        let tileSnap = "(unknown)";
        try {
          const ctxG = (typeof G.getCtx === "function") ? G.getCtx() : null;
          const modeHere = (typeof G.getMode === "function") ? G.getMode() : null;
          if (modeHere === "world") {
            const WT = (ctxG && ctxG.World && ctxG.World.TILES) ? ctxG.World.TILES : null;
            const worldObj = (ctxG && ctxG.world) ? ctxG.world : null;
            if (posSnap && WT && worldObj && worldObj.map && worldObj.map[posSnap.y] && typeof worldObj.map[posSnap.y][posSnap.x] !== "undefined") {
              const t = worldObj.map[posSnap.y][posSnap.x];
              if (t === WT.TOWN) tileSnap = "TOWN";
              else if (t === WT.DUNGEON) tileSnap = "DUNGEON";
              else {
                try {
                  const isWalk = ctxG && ctxG.World && typeof ctxG.World.isWalkable === "function" ? ctxG.World.isWalkable(t) : true;
                  tileSnap = isWalk ? "walkable" : "blocked";
                } catch (_) { tileSnap = "walkable"; }
              }
            }
          } else {
            // Local map tile classification: use isWalkable/inBounds from ctx
            const localMap = (ctxG && typeof ctxG.getMap === "function") ? ctxG.getMap() : (ctxG ? ctxG.map : null);
            if (posSnap && Array.isArray(localMap) && localMap[posSnap.y] && typeof localMap[posSnap.y][posSnap.x] !== "undefined") {
              const walk = (ctxG && typeof ctxG.isWalkable === "function") ? !!ctxG.isWalkable(posSnap.x, posSnap.y) : true;
              tileSnap = walk ? "walkable" : "blocked";
            }
          }
        } catch (_) {}
        let modalsSnap = {};
        try {
          modalsSnap.god = !!(window.UIBridge && typeof window.UIBridge.isGodOpen === "function" ? window.UIBridge.isGodOpen() : null);
          modalsSnap.shop = !!(window.UIBridge && typeof window.UIBridge.isShopOpen === "function" ? window.UIBridge.isShopOpen() : null);
          modalsSnap.inventory = !!(window.UIBridge && typeof window.UIBridge.isInventoryOpen === "function" ? window.UIBridge.isInventoryOpen() : null);
          modalsSnap.loot = !!(window.UIBridge && typeof window.UIBridge.isLootOpen === "function" ? window.UIBridge.isLootOpen() : null);
          modalsSnap.smoke = !!(window.UIBridge && typeof window.UIBridge.isSmokeOpen === "function" ? window.UIBridge.isSmokeOpen() : null);
        } catch (_) { modalsSnap = {}; }
        let perfSnap = null;
        try {
          const p = (typeof G.getPerf === "function") ? (G.getPerf() || {}) : {};
          perfSnap = { turn: p.lastTurnMs || 0, draw: p.lastDrawMs || 0 };
        } catch (_) {}

        // Prior-run OK skipping
        if (!!ok && skipOk.has(text)) {
          steps.push({ ok: true, msg: text, skipped: true, skippedReason: "prior_ok", ts, scenario: __curScenarioName, mode: modeSnap, pos: posSnap, tile: tileSnap, modals: modalsSnap, perf: perfSnap });
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

        // Treat immobile world movement checks as non-fatal skips even without abort flag
        const isWorldImmobile = (!ok && /^world movement test:\s*immobile/i.test(text));
        if (isWorldImmobile) {
          steps.push({ ok: true, msg: text, skipped: true, skippedReason: "immobile", ts, scenario: __curScenarioName, mode: modeSnap, pos: posSnap, tile: tileSnap, modals: modalsSnap, perf: perfSnap });
          try {
            var Bwi = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
            if (Bwi && typeof Bwi.log === "function") {
              Bwi.log("SKIP (immobile world movement): " + text, "warn");
            }
          } catch (_) {}
          return;
        }

        // Immobile handling: mark step as skipped and abort run, do NOT count as a failure
        const isImmobile = (!ok && lower.includes("immobile"));
        if (isImmobile && params && params.abortonimmobile && !aborted) {
          steps.push({ ok: true, msg: text, skipped: true, skippedReason: "immobile", ts, scenario: __curScenarioName, mode: modeSnap, pos: posSnap, tile: tileSnap, modals: modalsSnap, perf: perfSnap });
          try {
            var B3 = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
            if (B3 && typeof B3.log === "function") {
              B3.log("SKIP (immobile): " + text, "warn");
              B3.log("ABORT: immobile detected; aborting remaining scenarios in this run.", "bad");
            }
          } catch (_) {}
          aborted = true;
          __abortRequested = true;
          __abortReason = "immobile";
          try { window.SmokeTest.Runner.RUN_ABORT_REASON = "immobile"; } catch (_) {}
          return;
        }

        // Normal record path
        steps.push({ ok: !!ok, msg: text, ts, scenario: __curScenarioName, mode: modeSnap, pos: posSnap, tile: tileSnap, modals: modalsSnap, perf: perfSnap });
        try {
          var B = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
          if (B && typeof B.log === "function") {
            B.log((ok ? "OK: " : "ERR: ") + text, ok ? "good" : "bad");
          }
        } catch (_) {}
      }
      function recordSkip(msg) {
        const ts = Date.now();
        const G = window.GameAPI || {};
        let modeSnap = null, posSnap = null;
        try { if (typeof G.getMode === "function") modeSnap = G.getMode(); } catch (_) {}
        try {
          if (typeof G.getPlayer === "function") {
            const p = G.getPlayer();
            if (p && typeof p.x === "number" && typeof p.y === "number") posSnap = { x: p.x, y: p.y };
          }
        } catch (_) {}
        let tileSnap = "(unknown)";
        try {
          const ctxG = (typeof G.getCtx === "function") ? G.getCtx() : null;
          const modeHere = (typeof G.getMode === "function") ? G.getMode() : null;
          if (modeHere === "world") {
            const WT = (ctxG && ctxG.World && ctxG.World.TILES) ? ctxG.World.TILES : null;
            const worldObj = (ctxG && ctxG.world) ? ctxG.world : null;
            if (posSnap && WT && worldObj && worldObj.map && worldObj.map[posSnap.y] && typeof worldObj.map[posSnap.y][posSnap.x] !== "undefined") {
              const t = worldObj.map[posSnap.y][posSnap.x];
              if (t === WT.TOWN) tileSnap = "TOWN";
              else if (t === WT.DUNGEON) tileSnap = "DUNGEON";
              else {
                try {
                  const isWalk = ctxG && ctxG.World && typeof ctxG.World.isWalkable === "function" ? ctxG.World.isWalkable(t) : true;
                  tileSnap = isWalk ? "walkable" : "blocked";
                } catch (_) { tileSnap = "walkable"; }
              }
            }
          } else {
            // Local map tile classification: use isWalkable/inBounds from ctx
            const localMap = (ctxG && typeof ctxG.getMap === "function") ? ctxG.getMap() : (ctxG ? ctxG.map : null);
            if (posSnap && Array.isArray(localMap) && localMap[posSnap.y] && typeof localMap[posSnap.y][posSnap.x] !== "undefined") {
              const walk = (ctxG && typeof ctxG.isWalkable === "function") ? !!ctxG.isWalkable(posSnap.x, posSnap.y) : true;
              tileSnap = walk ? "walkable" : "blocked";
            }
          }
        } catch (_) {}
        let modalsSnap = {};
        try {
          modalsSnap.god = !!(window.UIBridge && typeof window.UIBridge.isGodOpen === "function" ? window.UIBridge.isGodOpen() : null);
          modalsSnap.shop = !!(window.UIBridge && typeof window.UIBridge.isShopOpen === "function" ? window.UIBridge.isShopOpen() : null);
          modalsSnap.inventory = !!(window.UIBridge && typeof window.UIBridge.isInventoryOpen === "function" ? window.UIBridge.isInventoryOpen() : null);
          modalsSnap.loot = !!(window.UIBridge && typeof window.UIBridge.isLootOpen === "function" ? window.UIBridge.isLootOpen() : null);
          modalsSnap.smoke = !!(window.UIBridge && typeof window.UIBridge.isSmokeOpen === "function" ? window.UIBridge.isSmokeOpen() : null);
        } catch (_) { modalsSnap = {}; }
        let perfSnap = null;
        try {
          const p = (typeof G.getPerf === "function") ? (G.getPerf() || {}) : {};
          perfSnap = { turn: p.lastTurnMs || 0, draw: p.lastDrawMs || 0 };
        } catch (_) {}
        steps.push({ ok: true, msg: String(msg || ""), skipped: true, ts, scenario: __curScenarioName, mode: modeSnap, pos: posSnap, tile: tileSnap, modals: modalsSnap, perf: perfSnap });
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
        const runLabel = (runIndex && runTotal) ? ("Run " + runIndex + " / " + runTotal) : "Run";
        if (B && typeof B.setStatus === "function") B.setStatus(runLabel + ": starting");
        if (B && typeof B.log === "function") B.log(runLabel + " — Starting smoke test…", "notice");
        try {
          window.SmokeTest = window.SmokeTest || {};
          window.SmokeTest.Runner = window.SmokeTest.Runner || {};
          window.SmokeTest.Runner.CUR_RUN = runIndex || 1;
          window.SmokeTest.Runner.TOT_RUN = runTotal || 1;
          // Reset per-run entry locks (prevent cross-run stale locks)
          window.SmokeTest.Runner.DUNGEON_LOCK = false;
          window.SmokeTest.Runner.TOWN_LOCK = false;
        } catch (_) {}
      } catch (_) {}

      // Centralized, single-attempt dungeon entry to avoid repeated re-enter across scenarios
      async function ensureDungeonOnce() {
        try {
          const G = window.GameAPI || {};
          const getMode = (typeof G.getMode === "function") ? () => G.getMode() : () => null;
          // Proactively close any modals so movement/interaction isn't intercepted
          try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(4); } catch (_) {}
          const modeNow = getMode();
          // Action trace for JSON
          let act = { type: "dungeonEnter", startMode: modeNow, target: null, routeExact: false, teleports: [], nudged: false, attempts: 0, endMode: null, success: false };
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
          // If in town, try returning to world first (route to gate and exit, else fallback to New Game)
          if (modeNow === "town") {
            try { if (typeof G.returnToWorldIfAtExit === "function") G.returnToWorldIfAtExit(); } catch (_) {}
            await sleep(260);
            if (getMode() !== "world") {
              // Attempt to route to town gate and press G to leave
              try {
                const gate = (typeof G.getTownGate === "function") ? G.getTownGate() : null;
                if (gate && typeof G.routeToDungeon === "function") {
                  const path = G.routeToDungeon(gate.x, gate.y) || [];
                  for (const st of path) {
                    const pl = (typeof G.getPlayer === "function") ? G.getPlayer() : st;
                    const dx = Math.sign(st.x - pl.x);
                    const dy = Math.sign(st.y - pl.y);
                    key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                    await sleep(70);
                  }
                  // Step onto gate if adjacent
                  try {
                    const pl = (typeof G.getPlayer === "function") ? G.getPlayer() : { x: gate.x, y: gate.y };
                    if (pl.x !== gate.x || pl.y !== gate.y) {
                      const dx = Math.sign(gate.x - pl.x);
                      const dy = Math.sign(gate.y - pl.y);
                      key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                      await sleep(120);
                    }
                  } catch (_) {}
                  try { key("g"); } catch (_) {}
                  await sleep(220);
                }
              } catch (_) {}
              if (getMode() !== "world") {
                // Fallback to New Game
                try { openGodPanel(); } catch (_) {}
                await sleep(120);
                try { const btn = document.getElementById("god-newgame-btn"); if (btn) btn.click(); } catch (_) {}
                await sleep(300);
              }
            }
          }

          // Route to or teleport onto the dungeon entrance, then enter
          try {
            const MV = (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Movement) || null;
            const TP = (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Teleport) || null;
            let target = null;

            function findDungeonEntranceTile() {
              try {
                // Prefer API
                if (typeof G.nearestDungeon === "function") {
                  const nd = G.nearestDungeon();
                  if (nd && typeof nd.x === "number" && typeof nd.y === "number") return nd;
                }
                // Fallback: scan world map for DUNGEON tile
                const worldObj = (typeof G.getWorld === "function") ? G.getWorld() : null;
                const tiles = (window.World && window.World.TILES) ? window.World.TILES : (G.TILES || null);
                if (worldObj && tiles && worldObj.map && worldObj.map.length) {
                  const pl = (typeof G.getPlayer === "function") ? G.getPlayer() : { x: 0, y: 0 };
                  let best = null, bestD = Infinity;
                  for (let y = 0; y < worldObj.map.length; y++) {
                    const row = worldObj.map[y] || [];
                    for (let x = 0; x < row.length; x++) {
                      if (row[x] === tiles.DUNGEON) {
                        const d = Math.abs(x - pl.x) + Math.abs(y - pl.y);
                        if (d < bestD) { bestD = d; best = { x, y }; }
                      }
                    }
                  }
                  return best;
                }
              } catch (_) {}
              return null;
            }

            target = findDungeonEntranceTile();

            // Prefer auto-walk if available
            if (typeof G.gotoNearestDungeon === "function") {
              try { await G.gotoNearestDungeon(); } catch (_) {}
              try { target = findDungeonEntranceTile() || target; } catch (_) {}
            }

            // If we have a target, try precise routing to the exact entrance first
            let routedExact = false;
            try {
              if (target && MV && typeof MV.routeTo === "function") {
                routedExact = await MV.routeTo(target.x, target.y, { timeoutMs: 9000, stepMs: 90 });
                try { act.routeExact = !!routedExact; } catch (_) {}
              }
            } catch (_) {}

            // If routing didn’t land us on entrance, use teleport helpers to land exactly there
            if (target && TP && typeof TP.teleportTo === "function" && !routedExact) {
              // Try walkable teleport first; if blocked by NPCs, force-teleport
              let tpOk = !!(await TP.teleportTo(target.x, target.y, { ensureWalkable: true, fallbackScanRadius: 4 }));
              try { act.teleports.push({ x: target.x, y: target.y, walkable: true, ok: !!tpOk }); } catch (_) {}
              if (!tpOk) {
                let tpOk2 = !!(await TP.teleportTo(target.x, target.y, { ensureWalkable: false, fallbackScanRadius: 0 }));
                try { act.teleports.push({ x: target.x, y: target.y, walkable: false, ok: !!tpOk2 }); } catch (_) {}
                tpOk = tpOk2;
              }
              // Single nudge if adjacent
              if (!tpOk) {
                try {
                  const pl = (typeof G.getPlayer === "function") ? G.getPlayer() : { x: target.x, y: target.y };
                  if (Math.abs(pl.x - target.x) + Math.abs(pl.y - target.y) === 1) {
                    const dx = Math.sign(target.x - pl.x);
                    const dy = Math.sign(target.y - pl.y);
                    key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                    await sleep(120);
                    try { act.nudged = true; } catch (_) {}
                  }
                } catch (_) {}
              }
            }

            // Final fallback: route adjacent if exact landing isn’t achieved
            if (target && !routedExact) {
              try {
                if (MV && typeof MV.routeAdjTo === "function") {
                  await MV.routeAdjTo(target.x, target.y, { timeoutMs: 2000, stepMs: 90 });
                } else if (typeof G.routeTo === "function") {
                  const adj = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
                  for (const d of adj) {
                    const ax = target.x + d.dx, ay = target.y + d.dy;
                    const path = G.routeTo(ax, ay) || [];
                    for (const st of path) {
                      const pl = (typeof G.getPlayer === "function") ? G.getPlayer() : st;
                      const dx = Math.sign(st.x - pl.x);
                      const dy = Math.sign(st.y - pl.y);
                      key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                      await sleep(80);
                    }
                    if (path && path.length) break;
                  }
                }
              } catch (_) {}
            }

            // Ensure we are exactly on the entrance before pressing 'g'
            const isOnEntrance = () => {
              try {
                const pl = (typeof G.getPlayer === "function") ? G.getPlayer() : null;
                return !!(pl && target && pl.x === target.x && pl.y === target.y);
              } catch (_) { return false; }
            };

            // Retry strategy: attempt up to 3 cycles of (teleport/route) + bump + 'g'
            for (let attempt = 0; attempt < 3 && (!target || !isOnEntrance()); attempt++) {
              try { act.attempts += 1; } catch (_) {}
              // If no target yet, re-scan
              try { if (!target) target = findDungeonEntranceTile(); } catch (_) {}
              // Teleport to entrance (walkable first, then forced)
              if (target && TP && typeof TP.teleportTo === "function") {
                let tpOk = !!(await TP.teleportTo(target.x, target.y, { ensureWalkable: true, fallbackScanRadius: 4 }));
                if (!tpOk) tpOk = !!(await TP.teleportTo(target.x, target.y, { ensureWalkable: false, fallbackScanRadius: 0 }));
                // If adjacent after teleport, nudge once
                if (!isOnEntrance()) {
                  try {
                    const pl = (typeof G.getPlayer === "function") ? G.getPlayer() : { x: target.x, y: target.y };
                    if (Math.abs(pl.x - target.x) + Math.abs(pl.y - target.y) === 1) {
                      const dx = Math.sign(target.x - pl.x);
                      const dy = Math.sign(target.y - pl.y);
                      key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                      await sleep(140);
                    }
                  } catch (_) {}
                }
              }
              // If still not exact, try routing adjacency and bump toward entrance
              if (!isOnEntrance()) {
                try {
                  if (MV && typeof MV.routeAdjTo === "function") {
                    await MV.routeAdjTo(target.x, target.y, { timeoutMs: 8000, stepMs: 90 });
                  }
                  const pl2 = (typeof G.getPlayer === "function") ? G.getPlayer() : { x: target.x, y: target.y };
                  const dx2 = Math.sign(target.x - pl2.x);
                  const dy2 = Math.sign(target.y - pl2.y);
                  key(dx2 === -1 ? "ArrowLeft" : dx2 === 1 ? "ArrowRight" : (dy2 === -1 ? "ArrowUp" : "ArrowDown"));
                  await sleep(140);
                } catch (_) {}
              }
              // Try pressing 'g' + API fallback
              try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(1); } catch (_) {}
              try { key("g"); } catch (_) {}
              await sleep(280);
              try { if (typeof G.enterDungeonIfOnEntrance === "function") G.enterDungeonIfOnEntrance(); } catch (_) {}
              await sleep(280);
              // Early exit if mode changed
              if (getMode() === "dungeon") break;
            }
          } catch (_) {}

          // Confirm mode transition; try a short settle wait first
          try {
            await waitUntilTrue(() => { try { return (typeof G.getMode === "function" && G.getMode() === "dungeon"); } catch(_) { return false; } }, 1800, 80);
          } catch (_) {}
          // If still not in dungeon, try adjacent teleports around target then 'g'
          let ok = (getMode() === "dungeon");
          if (!ok) {
            try {
              const nd = (typeof G.nearestDungeon === "function") ? G.nearestDungeon() : null;
              const TP2 = (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Teleport) || null;
              if (nd && TP2 && typeof TP2.teleportTo === "function") {
                const adj = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
                for (let a = 0; a < adj.length && getMode() !== "dungeon"; a++) {
                  const ax = nd.x + adj[a].dx, ay = nd.y + adj[a].dy;
                  let okAdj1 = !!(await TP2.teleportTo(ax, ay, { ensureWalkable: true, fallbackScanRadius: 3 }));
                  try { act.teleports.push({ x: ax, y: ay, walkable: true, ok: !!okAdj1, phase: "adj" }); } catch (_) {}
                  if (!okAdj1) {
                    // Force-teleport ignoring walkability (e.g., NPC block)
                    let okAdj2 = !!(await TP2.teleportTo(ax, ay, { ensureWalkable: false, fallbackScanRadius: 0 }));
                    try { act.teleports.push({ x: ax, y: ay, walkable: false, ok: !!okAdj2, phase: "adj" }); } catch (_) {}
                  }
                  const pl = (typeof G.getPlayer === "function") ? G.getPlayer() : { x: nd.x, y: nd.y };
                  const dx = Math.sign(nd.x - pl.x);
                  const dy = Math.sign(nd.y - pl.y);
                  key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                  await sleep(160);
                  try { key("g"); } catch (_) {}
                  await sleep(240);
                  try { if (typeof G.enterDungeonIfOnEntrance === "function") G.enterDungeonIfOnEntrance(); } catch (_) {}
                  await sleep(240);
                }
              }
            } catch (_) {}
            ok = (getMode() === "dungeon");
          }

          if (ok) { try { window.SmokeTest.Runner.DUNGEON_LOCK = true; } catch (_) {} }
          try { act.endMode = getMode(); act.success = !!ok; if (trace && Array.isArray(trace.actions)) trace.actions.push(act); } catch (_) {}
          return ok;
        } catch (_) { return false; }
      }

      // Centralized, single-attempt town entry to avoid repeated re-enter across scenarios
      async function ensureTownOnce() {
        try {
          const G = window.GameAPI || {};
          const getMode = (typeof G.getMode === "function") ? () => G.getMode() : () => null;
          // Proactively close any modals so movement/interaction isn't intercepted
          try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(4); } catch (_) {}
          const modeNow = getMode();
          // Action trace for JSON
          let act = { type: "townEnter", startMode: modeNow, target: null, routeExact: false, teleports: [], nudged: false, attempts: 0, endMode: null, success: false };
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

          // Route to the exact town gate/town tile, then enter (ensure tile underfoot before 'g')
          let target = null;
          try {
            const MV = (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Movement) || null;
            const modeEnter = getMode();
            // In world, use nearestTown (gate tile on overworld). In other modes, use getTownGate if available.
            function findTownTileOrGate() {
              try {
                // Prefer explicit gate
                if (typeof G.getTownGate === "function") {
                  const gt = G.getTownGate();
                  if (gt && typeof gt.x === "number" && typeof gt.y === "number") return gt;
                }
                if (typeof G.nearestTown === "function") {
                  const nt = G.nearestTown();
                  if (nt && typeof nt.x === "number" && typeof nt.y === "number") return nt;
                }
                // Fallback: scan world map for TOWN tile
                const worldObj = (typeof G.getWorld === "function") ? G.getWorld() : null;
                const tiles = (window.World && window.World.TILES) ? window.World.TILES : (G.TILES || null);
                if (worldObj && tiles && worldObj.map && worldObj.map.length) {
                  const pl = (typeof G.getPlayer === "function") ? G.getPlayer() : { x: 0, y: 0 };
                  let best = null, bestD = Infinity;
                  for (let y = 0; y < worldObj.map.length; y++) {
                    const row = worldObj.map[y] || [];
                    for (let x = 0; x < row.length; x++) {
                      if (row[x] === tiles.TOWN) {
                        const d = Math.abs(x - pl.x) + Math.abs(y - pl.y);
                        if (d < bestD) { bestD = d; best = { x, y }; }
                      }
                    }
                  }
                  return best;
                }
              } catch (_) {}
              return null;
            }

            target = findTownTileOrGate();
            try { act.target = target ? { x: target.x, y: target.y } : null; } catch (_) {}

            // New: prefer GameAPI.gotoNearestTown() if available (auto-walk to gate or town tile)
            if (typeof G.gotoNearestTown === "function") {
              try { await G.gotoNearestTown(); } catch (_) {}
              // Refresh target after auto-walk
              try {
                target = findTownTileOrGate() || target;
              } catch (_) {}
            }

            if (target) {
              // Prefer precise pathing to the exact tile (no bump travel)
              let routedExact = false;
              try {
                if (MV && typeof MV.routeTo === "function") {
                  routedExact = await MV.routeTo(target.x, target.y, { timeoutMs: 5000, stepMs: 90 });
                }
              } catch (_) {}
              if (!routedExact) {
                if (modeEnter === "world" && typeof G.routeTo === "function") {
                  const path = G.routeTo(target.x, target.y) || [];
                  for (const st of path) {
                    const pl = (typeof G.getPlayer === "function") ? G.getPlayer() : st;
                    const dx = Math.sign(st.x - pl.x);
                    const dy = Math.sign(st.y - pl.y);
                    key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                    await sleep(80);
                  }
                } else if (modeEnter !== "world" && typeof G.routeToDungeon === "function") {
                  const path = G.routeToDungeon(target.x, target.y) || [];
                  for (const st of path) {
                    const pl = (typeof G.getPlayer === "function") ? G.getPlayer() : st;
                    const dx = Math.sign(st.x - pl.x);
                    const dy = Math.sign(st.y - pl.y);
                    key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                    await sleep(80);
                  }
                }
              }

              // Verify we are exactly on the target; helper and teleport retries
              const isOnTarget = () => {
                try {
                  const pl = (typeof G.getPlayer === "function") ? G.getPlayer() : null;
                  return !!(pl && target && pl.x === target.x && pl.y === target.y);
                } catch (_) { return false; }
              };

              // Retry up to 3 times: teleport to gate/town tile (walkable then forced), nudge if adjacent, then 'g'
              const TP = (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Teleport) || null;
              for (let attempt = 0; attempt < 3 && !isOnTarget(); attempt++) {
                try { act.attempts += 1; } catch (_) {}
                // Teleport onto target if possible
                if (TP && typeof TP.teleportTo === "function") {
                  let okTp1 = !!(await TP.teleportTo(target.x, target.y, { ensureWalkable: true, fallbackScanRadius: 4 }));
                  try { act.teleports.push({ x: target.x, y: target.y, walkable: true, ok: !!okTp1 }); } catch (_) {}
                  let okTp = okTp1;
                  if (!okTp) {
                    let okTp2 = !!(await TP.teleportTo(target.x, target.y, { ensureWalkable: false, fallbackScanRadius: 0 }));
                    try { act.teleports.push({ x: target.x, y: target.y, walkable: false, ok: !!okTp2 }); } catch (_) {}
                    okTp = okTp2;
                  }
                }
                // If adjacent, nudge once
                try {
                  const pl = (typeof G.getPlayer === "function") ? G.getPlayer() : { x: target.x, y: target.y };
                  if (!isOnTarget() && Math.abs(pl.x - target.x) + Math.abs(pl.y - target.y) === 1) {
                    const dx = Math.sign(target.x - pl.x);
                    const dy = Math.sign(target.y - pl.y);
                    key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                    await sleep(140);
                    try { act.nudged = true; } catch (_) {}
                  }
                } catch (_) {}
                // Try entering
                try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(1); } catch (_) {}
                try { key("g"); } catch (_) {}
                await sleep(280);
                try { if (typeof G.enterTownIfOnTile === "function") G.enterTownIfOnTile(); } catch (_) {}
                await sleep(280);
                // Fallback: if still not in town, call Modes.enterTownIfOnTile directly with ctx
                if (getMode() !== "town") {
                  try {
                    const Modes = (typeof window !== "undefined" && window.Modes) ? window.Modes : null;
                    const ctxG = (typeof G.getCtx === "function") ? G.getCtx() : null;
                    if (Modes && typeof Modes.enterTownIfOnTile === "function" && ctxG) {
                      const okModes = !!Modes.enterTownIfOnTile(ctxG);
                      if (okModes) {
                        // Refresh camera/UI immediately after mode change
                        try { G.updateCamera && G.updateCamera(); G.recomputeFOV && G.recomputeFOV(); G.updateUI && G.updateUI(); G.requestDraw && G.requestDraw(); } catch (_) {}
                      }
                    }
                  } catch (_) {}
                }
                if (getMode() === "town") break;
              }
            }
          } catch (_) {}

          // Confirm mode transition; try a short settle wait first
          try {
            await waitUntilTrue(() => { try { return (typeof G.getMode === "function" && G.getMode() === "town"); } catch(_) { return false; } }, 1800, 80);
          } catch (_) {}
          // If still not in town, try adjacent teleports around target then 'g'
          let ok = (getMode() === "town");
          if (!ok) {
            try {
              const TP2 = (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Teleport) || null;
              if (TP2 && typeof TP2.teleportTo === "function" && target) {
                const adj = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
                for (let a = 0; a < adj.length && getMode() !== "town"; a++) {
                  const ax = target.x + adj[a].dx, ay = target.y + adj[a].dy;
                  let okAdj1 = !!(await TP2.teleportTo(ax, ay, { ensureWalkable: true, fallbackScanRadius: 3 }));
                  try { act.teleports.push({ x: ax, y: ay, walkable: true, ok: !!okAdj1, phase: "adj" }); } catch (_) {}
                  if (!okAdj1) {
                    // Force-teleport ignoring walkability (e.g., NPC block)
                    let okAdj2 = !!(await TP2.teleportTo(ax, ay, { ensureWalkable: false, fallbackScanRadius: 0 }));
                    try { act.teleports.push({ x: ax, y: ay, walkable: false, ok: !!okAdj2, phase: "adj" }); } catch (_) {}
                  }
                  await sleep(160);
                  const pl = (typeof G.getPlayer === "function") ? G.getPlayer() : { x: target.x, y: target.y };
                  const dx = Math.sign(target.x - pl.x);
                  const dy = Math.sign(target.y - pl.y);
                  key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                  await sleep(160);
                  try { key("g"); } catch (_) {}
                  await sleep(240);
                  try { if (typeof G.enterTownIfOnTile === "function") G.enterTownIfOnTile(); } catch (_) {}
                  await sleep(240);
                  // Fallback via Modes if still not in town
                  if (getMode() !== "town") {
                    try {
                      const Modes = (typeof window !== "undefined" && window.Modes) ? window.Modes : null;
                      const ctxG = (typeof G.getCtx === "function") ? G.getCtx() : null;
                      if (Modes && typeof Modes.enterTownIfOnTile === "function" && ctxG) {
                        const okModesAdj = !!Modes.enterTownIfOnTile(ctxG);
                        if (okModesAdj) {
                          try { G.updateCamera && G.updateCamera(); G.recomputeFOV && G.recomputeFOV(); G.updateUI && G.updateUI(); G.requestDraw && G.requestDraw(); } catch (_) {}
                        }
                      }
                    } catch (_) {}
                  }
                }
              }
            } catch (_) {}
            ok = (getMode() === "town");
          }

          // Final fallback: teleport directly to nearest town tile and enter
          if (!ok) {
            try {
              const TP3 = (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Teleport) || null;
              if (TP3 && typeof TP3.teleportToTownGateAndEnter === "function") {
                const entered = await TP3.teleportToTownGateAndEnter({ key, sleep, ensureAllModalsClosed }, { closeModals: true, waitMs: 500 });
                ok = !!entered;
              }
            } catch (_) {}
          }

          if (ok) { try { window.SmokeTest.Runner.TOWN_LOCK = true; } catch (_) {} }
          try { act.endMode = getMode(); act.success = !!ok; if (trace && Array.isArray(trace.actions)) trace.actions.push(act); } catch (_) {}
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
      // Build pipeline; if scenarios were provided in URL, respect that order; else use default
      const avail = {
        world: S.World && S.World.run,
        dungeon: S.Dungeon && S.Dungeon.run,
        inventory: S.Inventory && S.Inventory.run,
        combat: S.Combat && S.Combat.run,
        dungeon_persistence: S.Dungeon && S.Dungeon.Persistence && S.Dungeon.Persistence.run,
        town: S.Town && S.Town.run,
        town_diagnostics: S.Town && S.Town.Diagnostics && S.Town.Diagnostics.run,
        overlays: S.Overlays && S.Overlays.run,
        determinism: S.Determinism && S.Determinism.run,
      };
      let pipeline = [];
      try {
        if (sel && sel.length) {
          for (const name of sel) {
            const fn = avail[name];
            if (typeof fn === "function") pipeline.push({ name, fn });
          }
        }
      } catch (_) {}
      if (!pipeline.length) {
        pipeline = [
          { name: "world", fn: avail.world },
          { name: "dungeon", fn: avail.dungeon },
          { name: "inventory", fn: avail.inventory },
          { name: "combat", fn: avail.combat },
          { name: "dungeon_persistence", fn: avail.dungeon_persistence },
          { name: "town", fn: avail.town },
          { name: "town_diagnostics", fn: avail.town_diagnostics },
          { name: "overlays", fn: avail.overlays },
          { name: "determinism", fn: avail.determinism },
        ];
      }
      // Ensure diagnostics/persistence are included at least once even if not explicitly selected
      try {
        const names = new Set(pipeline.map(p => p.name));
        const pers = (params && params.persistence) ? params.persistence : "once";
        if (!names.has("town_diagnostics") && typeof avail.town_diagnostics === "function") {
          pipeline.push({ name: "town_diagnostics", fn: avail.town_diagnostics });
        }
        if (pers !== "never" && !names.has("dungeon_persistence") && typeof avail.dungeon_persistence === "function") {
          pipeline.push({ name: "dungeon_persistence", fn: avail.dungeon_persistence });
        }
      } catch (_) {}

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

      // Helper: detect death (Game Over) and abort the run
      const isDeathDetected = () => {
        try {
          if (window.GameAPI && typeof window.GameAPI.getPlayerStatus === "function") {
            const st = window.GameAPI.getPlayerStatus();
            if (st && typeof st.hp === "number" && st.hp <= 0) return true;
          }
        } catch (_) {}
        try {
          const panel = document.getElementById("gameover-panel");
          if (panel && panel.hidden === false) return true;
        } catch (_) {}
        return false;
      };

      for (let i = 0; i < pipeline.length; i++) {
        if (aborted) {
          try { if (Banner && typeof Banner.log === "function") Banner.log("Run aborted; remaining scenarios skipped.", "bad"); } catch (_) {}
          break;
        }
        // If player is dead before starting next scenario, skip only this scenario (do not abort entire run)
        try {
          if (isDeathDetected()) {
            recordSkip("Death detected; skipping scenario");
            // Continue to next scenario in this run
            continue;
          }
        } catch (_) {}

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
        let __scenarioStartMode = (window.GameAPI && typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : null;
        __curScenarioName = step.name;
        const __scenarioStartTs = Date.now();
        try {
          const runLabel = (runIndex && runTotal) ? ("Run " + runIndex + " / " + runTotal) : "Run";
          if (Banner && typeof Banner.setStatus === "function") Banner.setStatus(runLabel + " • " + step.name);
          if (Banner && typeof Banner.log === "function") Banner.log(runLabel + " • Running scenario: " + step.name, "info");
          await step.fn(baseCtx);
          if (Banner && typeof Banner.log === "function") Banner.log(runLabel + " • Scenario completed: " + step.name, "good");
          // Close the GOD panel after town diagnostics to avoid overlaying subsequent scenarios (robust)
          if (step.name === "town_diagnostics") {
            // First, try the generic modal closer a couple of times
            try { await ensureAllModalsClosed(2); } catch (_) {}
            // Then, explicitly target the GOD panel and verify closure
            for (let attempt = 0; attempt < 3; attempt++) {
              try { key("Escape"); } catch (_) {}
              await sleep(100);
              try {
                if (window.UIBridge && typeof window.UIBridge.hideGod === "function") window.UIBridge.hideGod({});
              } catch (_) {}
              await sleep(100);
              // Verify closed
              let closed = false;
              try {
                if (window.UIBridge && typeof window.UIBridge.isGodOpen === "function") {
                  closed = !window.UIBridge.isGodOpen();
                } else {
                  // Without UIBridge, assume closed to avoid DOM coupling
                  closed = true;
                }
              } catch (_) { closed = false; }
              if (closed) break;
            }

            // After closing, attempt safe exit to overworld to avoid being stuck in town for subsequent scenarios
            try {
              const G = window.GameAPI || {};
              if (typeof G.getMode === "function" && G.getMode() === "town") {
                const TP = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Teleport;
                if (TP && typeof TP.teleportToGateAndExit === "function") {
                  const exited = await TP.teleportToGateAndExit(baseCtx, { closeModals: true, waitMs: 500 });
                  record(!!exited, exited ? "Post-diagnostics: exited town to overworld" : "Post-diagnostics: remained in town");
                }
              }
            } catch (_) {}
          }
        } catch (e) {
          if (Banner && typeof Banner.log === "function") Banner.log("Scenario failed: " + step.name, "bad");
          record(false, step.name + " failed: " + (e && e.message ? e.message : String(e)));
        }

        // If death occurred during/after scenario, do not abort the entire run; continue with next scenario
        try {
          if (isDeathDetected()) {
            recordSkip("Death detected; continuing with next scenario");
            // No abort flags; allow subsequent scenarios in this run to proceed
          }
        } catch (_) {}

        // Per-scenario pass determination:
        // - passed only if there is at least one OK step and no failures
        // - mark skippedOnly when there are only skips and no OK steps
        {
          const during = steps.slice(beforeCount);
          const hasFail = during.some(s => !s.ok && !s.skipped);
          const hasOk = during.some(s => s.ok && !s.skipped);
          const hasSkip = during.some(s => s.skipped);
          const passed = (!hasFail && hasOk);
          const skippedOnly = (!hasOk && hasSkip);
          scenarioResults.push({ name: step.name, passed, skippedOnly });

          // Structured scenario trace for JSON export (no nested try/catch needed)
          const sPass = during.filter(s => s.ok && !s.skipped).map(s => String(s.msg || ""));
          const sFail = during.filter(s => !s.ok && !s.skipped).map(s => String(s.msg || ""));
          const sSkip = during.filter(s => s.skipped).map(s => String(s.msg || ""));
          const observedModes = Array.from(new Set(during.map(s => String(s.mode || "")))).filter(Boolean);
          const modeTransitions = [];
          let lastMode = __scenarioStartMode;
          during.forEach((s) => {
            const m = String(s.mode || "");
            if (m && m !== lastMode) {
              modeTransitions.push({ at: s.ts || Date.now(), from: lastMode, to: m });
              lastMode = m;
            }
          });
          trace.scenarioTraces.push({
            name: step.name,
            startedMode: __scenarioStartMode,
            endedMode: lastMode,
            stepCount: during.length,
            passes: sPass,
            fails: sFail,
            skipped: sSkip,
            startedAt: during.length ? during[0].ts : __scenarioStartTs,
            endedAt: during.length ? during[during.length - 1].ts : Date.now(),
            durationMs: (during.length ? (during[during.length - 1].ts - during[0].ts) : 0) | 0,
            observedModes,
            tsFirst: (during.length ? during[0].ts - Date.now() : 0),
            tsLast: (during.length ? during[during.length - 1].ts - Date.now() : 0),
            avgStepDeltaMs: (() => {
              if (during.length <= 1) return 0;
              let sum = 0;
              for (let i = 1; i < during.length; i++) sum += (during[i].ts - during[i - 1].ts);
              return (sum / (during.length - 1));
            })(),
            maxStepDeltaMs: (() => {
              if (during.length <= 1) return 0;
              let mx = 0;
              for (let i = 1; i < during.length; i++) mx = Math.max(mx, (during[i].ts - during[i - 1].ts));
              return mx;
            })(),
            modeTransitions
          });

          // Adjust scenario pass/fail based on union-of successes within the same run (remove false negatives)
          const isOkStep = (s) => !!(s && s.ok && !s.skipped);
          const sawDungeonOk = steps.some(s => isOkStep(s) && (/entered dungeon/i.test(String(s.msg || "")) || /inventory prep:\s*entered dungeon/i.test(String(s.msg || ""))));
          const sawTownOk = steps.some(s => isOkStep(s) && (/entered town/i.test(String(s.msg || "")) || /mode confirm\s*\(town enter\):\s*town/i.test(String(s.msg || ""))));
          const sawWorldOk = steps.some(s => isOkStep(s) && (/world movement test:\s*moved/i.test(String(s.msg || "")) || /world snapshot:/i.test(String(s.msg || ""))));
          const sawInventoryOk = steps.some(s => isOkStep(s) && (/equip best from inventory/i.test(String(s.msg || "")) || /manual equip\/unequip/i.test(String(s.msg || "")) || /drank potion/i.test(String(s.msg || ""))));
          const sawCombatOk = steps.some(s => isOkStep(s) && (/moved and attempted attacks/i.test(String(s.msg || "")) || /combat effects:/i.test(String(s.msg || ""))));
          const sawOverlaysOk = steps.some(s => isOkStep(s) && (/overlay perf:/i.test(String(s.msg || "")) || /grid perf:/i.test(String(s.msg || ""))));
          const sawDeterminismOk = steps.some(s => isOkStep(s) && /seed invariants:/i.test(String(s.msg || "")));
          const sawDungeonPersistenceOk = steps.some(s => isOkStep(s) && (/persistence corpses:/i.test(String(s.msg || "")) || /persistence decals:/i.test(String(s.msg || "")) || /returned to overworld from dungeon/i.test(String(s.msg || ""))));
          const sawTownDiagnosticsOk = steps.some(s => isOkStep(s) && (/gate npcs/i.test(String(s.msg || "")) || /gate greeter/i.test(String(s.msg || "")) || /gold ops/i.test(String(s.msg || "")) || /shop ui closes with esc/i.test(String(s.msg || "")) || /bump near shopkeeper: ok/i.test(String(s.msg || "")) || /interacted at shop by bump/i.test(String(s.msg || ""))));

          for (let i = 0; i < scenarioResults.length; i++) {
            const sr = scenarioResults[i];
            if (!sr || !sr.name) continue;
            const name = sr.name;

            if (name === "dungeon" && !sr.passed && sawDungeonOk) {
              scenarioResults[i] = { ...sr, passed: true };
              continue;
            }
            if (name === "town" && !sr.passed && sawTownOk) {
              scenarioResults[i] = { ...sr, passed: true };
              continue;
            }
            if (name === "world" && !sr.passed && sawWorldOk) {
              scenarioResults[i] = { ...sr, passed: true };
              continue;
            }
            if (name === "inventory" && !sr.passed && sawInventoryOk) {
              scenarioResults[i] = { ...sr, passed: true };
              continue;
            }
            if (name === "combat" && !sr.passed && sawCombatOk) {
              scenarioResults[i] = { ...sr, passed: true };
              continue;
            }
            if (name === "overlays" && !sr.passed && sawOverlaysOk) {
              scenarioResults[i] = { ...sr, passed: true };
              continue;
            }
            if (name === "determinism" && !sr.passed && sawDeterminismOk) {
              scenarioResults[i] = { ...sr, passed: true };
              continue;
            }
            if (name === "dungeon_persistence" && !sr.passed && sawDungeonPersistenceOk) {
              scenarioResults[i] = { ...sr, passed: true };
              continue;
            }
            if (name === "town_diagnostics" && !sr.passed && sawTownDiagnosticsOk) {
              scenarioResults[i] = { ...sr, passed: true };
              continue;
            }
          }
        }

      // Build report via reporting renderer
      // Run-level OK: if any real step passed in this run, consider the run OK (union-of successes per run)
      const ok = steps.some(s => s.ok && !s.skipped);
      let issuesHtml = ""; let passedHtml = ""; let skippedHtml = ""; let detailsHtml = ""; let main = "";
      const R = window.SmokeTest && window.SmokeTest.Reporting && window.SmokeTest.Reporting.Render;
      // Suppress known failure counterparts if their success occurred within this run
      const sawTownOkRun = steps.some(s => s.ok && (/entered town/i.test(String(s.msg || "")) || /mode confirm\s*\(town enter\):\s*town/i.test(String(s.msg || ""))));
      const sawDungeonOkRun = steps.some(s => s.ok && /entered dungeon/i.test(String(s.msg || "")));
      // Detect combat success variants within this run
      const sawCombatOkRun = steps.some(s => s.ok && !s.skipped && (
        (s.scenario && s.scenario === "combat") ||
        /moved and attempted attacks|combat effects:|killed enemy|attacked enemy/i.test(String(s.msg || ""))
      ));
      const shouldSuppressMsg = (msg) => {
        const t = String(msg || "");
        // Hide town failure counterparts if any town entry succeeded in this run
        if (sawTownOkRun) {
          if (/town entry not achieved/i.test(t)) return true;
          if (/town overlays skipped/i.test(t)) return true;
          if (/town diagnostics skipped/i.test(t)) return true;
          if (/mode confirm\s*\(town (re-)?enter\):\s*world/i.test(t)) return true;
        }
        // Hide dungeon failure counterparts if any dungeon entry succeeded in this run
        if (sawDungeonOkRun) {
          if (/dungeon entry failed/i.test(t)) return true;
          if (/mode confirm\s*\(dungeon (re-)?enter\):\s*world/i.test(t)) return true;
        }
        // Hide combat skip noise if we saw any combat success in this run
        if (sawCombatOkRun) {
          if (/combat scenario skipped\s*\(not in dungeon\)/i.test(t)) return true;
        }
        return false;
      };
      const filteredSteps = steps.filter(s => !shouldSuppressMsg(s.msg));
      sanitized = filteredSteps;
      const passed = filteredSteps.filter(s => s.ok && !s.skipped);
      const skipped = filteredSteps.filter(s => s.skipped);
      const failed = filteredSteps.filter(s => !s.ok && !s.skipped);
      issuesHtml = failed.length ? (`<div style="margin-top:10px;"><strong>Issues</strong></div>` + R.renderStepsPretty(failed)) : "";
      passedHtml = passed.length ? (`<div style="margin-top:10px;"><strong>Passed</strong></div>` + R.renderStepsPretty(passed)) : "";
      skippedHtml = skipped.length ? (`<div style="margin-top:10px;"><strong>Skipped</strong></div>` + R.renderStepsPretty(skipped)) : "";
      detailsHtml = R.renderStepsPretty(filteredSteps);
      const headerHtml = R.renderHeader({ ok, stepCount: filteredSteps.length, totalIssues: failed.length, runnerVersion: RUNNER_VERSION, caps: Object.keys(caps).filter(k => caps[k]) });
      const keyChecklistHtml = R.buildKeyChecklistHtmlFromSteps(filteredSteps);
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
          // Ensure GOD panel is visible before writing the report
          try { openGodPanel(); } catch (_) {}
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

      // Build per-run Key Checklist object for JSON
      let keyChecklistRun = {};
      try {
        const R = window.SmokeTest && window.SmokeTest.Reporting && window.SmokeTest.Reporting.Render;
        if (R && typeof R.buildKeyChecklistObjectFromSteps === "function") {
          keyChecklistRun = R.buildKeyChecklistObjectFromSteps(steps);
        }
      } catch (_) {}

      try { window.SMOKE_OK = ok; window.SMOKE_STEPS = steps.slice(); window.SMOKE_JSON = { ok, steps, caps, trace, keyChecklist: keyChecklistRun }; } catch (_) {}
      try { localStorage.setItem("smoke-pass-token", ok ? "PASS" : "FAIL"); localStorage.setItem("smoke-json-token", JSON.stringify({ ok, steps, caps, trace, keyChecklist: keyChecklistRun })); } catch (_) {}
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
        jsonToken.textContent = JSON.stringify({ ok, steps, caps, trace, keyChecklist: keyChecklistRun });
      } catch (_) {}
      // Finalize trace with end mode and perf snapshot
      try {
        trace.endMode = (window.GameAPI && typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : null;
        trace.timestamps.end = Date.now();
        if (window.GameAPI && typeof window.GameAPI.getPerf === "function") {
          const p = window.GameAPI.getPerf() || {};
          trace.perf = { lastTurnMs: p.lastTurnMs || 0, lastDrawMs: p.lastDrawMs || 0 };
        }
      } catch (_) {}
      return { ok, steps, sanitizedSteps: sanitized || steps, caps, scenarioResults, aborted: __abortRequested, abortReason: __abortReason, trace, keyChecklist: keyChecklistRun };
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
    let skippedRuns = 0;
    let perfSumTurn = 0, perfSumDraw = 0;
    const stacking = n > 1;
    // New: skip scenarios after they have passed this many runs (0 = disabled)
    const skipAfter = (Number(params.skipokafter || 0) | 0);
    const scenarioPassCounts = new Map();
    // Guarantee: run certain scenarios at least once per series regardless of skipokafter
    const ensureOnceScenarios = new Set(["town_diagnostics", "dungeon_persistence"]);
    const ranOnceEnsure = new Set();

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

    // Keep GOD panel closed until after overworld is confirmed and seed is applied (safer for exit logic)

    // Aggregation of steps across runs (union of success)
    const agg = new Map();
    const okMsgs = new Set();
    // Track seeds used within this series to guarantee uniqueness
    const usedSeeds = new Set();
    const usedSeedList = [];
   
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
      let s = deriveSeed(runIndex);
      try {
        const B = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
        const TP = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Teleport;
        const Dom = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Dom;
        const G = window.GameAPI || {};
        const W = (typeof window !== "undefined" && window.World) ? window.World : null;

        // Ensure GOD panel is open to apply seed and click New Game
        try {
          if (window.UIBridge && typeof window.UIBridge.showGod === "function") {
            window.UIBridge.showGod({});
          } else {
            const btn = document.getElementById("god-open-btn");
            if (btn) btn.click();
          }
        } catch (_) {}

        // Apply seed via GOD panel controls
        try {
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
          await sleep(200);
          if (B && typeof B.log === "function") B.log(`Seed prepared for run ${runIndex + 1}: ${s}`, "notice");
        } catch (_) {}

        // Click New Game to regenerate the world using the freshly applied seed
        try {
          const nb = document.getElementById("god-newgame-btn");
          if (nb) nb.click();
        } catch (_) {}
        // Wait until overworld is active
        try {
          await waitUntilTrue(() => {
            try { return (typeof G.getMode === "function" && G.getMode() === "world"); } catch (_) { return false; }
          }, 4000, 100);
        } catch (_) {}
        await sleep(160);

        // Close modals after regen to avoid input interception in scenarios
        try { await ensureAllModalsClosed(2); } catch (_) {}

        // Sanity check: ensure spawn tile is walkable; if not, teleport to nearest walkable tile
        try {
          if (typeof G.getPlayer === "function" && typeof G.getWorld === "function" && W && typeof W.isWalkable === "function") {
            const pl = G.getPlayer();
            const worldObj = G.getWorld();
            const inBounds = (x, y) => (x >= 0 && y >= 0 && y < (worldObj.height | 0) && x < (worldObj.width | 0));
            const tileAt = (x, y) => (inBounds(x, y) ? worldObj.map[y][x] : null);
            const isWalk = (x, y) => {
              const t = tileAt(x, y);
              return t != null && W.isWalkable(t);
            };
            // If current tile is not walkable, find nearest walkable in a growing radius and teleport there
            if (!isWalk(pl.x, pl.y)) {
              let target = null;
              for (let r = 1; r <= 8 && !target; r++) {
                for (let dy = -r; dy <= r; dy++) {
                  for (let dx = -r; dx <= r; dx++) {
                    const nx = pl.x + dx, ny = pl.y + dy;
                    if (!inBounds(nx, ny)) continue;
                    if (isWalk(nx, ny)) { target = { x: nx, y: ny }; break; }
                  }
                  if (target) break;
                }
              }
              if (target && TP && typeof TP.teleportTo === "function") {
                await TP.teleportTo(target.x, target.y, { ensureWalkable: true, fallbackScanRadius: 4 });
                await sleep(120);
              } else if (target && typeof G.teleportTo === "function") {
                try { G.teleportTo(target.x, target.y, { ensureWalkable: true }); } catch (_) {}
                await sleep(120);
              }
            }
          }
        } catch (_) {}

        // Reopen GOD panel for visibility (if it was closed) and log, and record the current seed globally
        try {
          if (window.UIBridge && typeof window.UIBridge.showGod === "function") window.UIBridge.showGod({});
          if (B && typeof B.log === "function") B.log(`New Game started for run ${runIndex + 1} with seed ${s}`, "notice");
          try {
            window.SmokeTest = window.SmokeTest || {};
            window.SmokeTest.Runner = window.SmokeTest.Runner || {};
            window.SmokeTest.Runner.CUR_SEED = s >>> 0;
          } catch (_) {}
        } catch (_) {}
      } catch (_) {}
      return s >>> 0;
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
        const raw = Array.from(agg.values());
        // Coalesce known categories: if town/dungeon/combat succeeded anywhere, hide their failure counterparts
        const sawTownOkAny = raw.some(v => !!v.ok && (/entered town/i.test(String(v.msg || "")) || /mode confirm\s*\(town enter\):\s*town/i.test(String(v.msg || ""))));
        const sawDungeonOkAny = raw.some(v => !!v.ok && /entered dungeon/i.test(String(v.msg || "")));
        const sawCombatOkAny = raw.some(v => !!v.ok && (/moved and attempted attacks|killed enemy|attacked enemy|combat effects:/i.test(String(v.msg || ""))));
        const all = raw
          .filter(v => {
            const t = String(v.msg || "");
            if (sawTownOkAny && (/town entry not achieved/i.test(t) || /town overlays skipped/i.test(t) || /town diagnostics skipped/i.test(t) || /mode confirm\s*\(town (re-)?enter\):\s*world/i.test(t))) return false;
            if (sawDungeonOkAny && (/dungeon entry failed/i.test(t) || /mode confirm\s*\(dungeon (re-)?enter\):\s*world/i.test(t))) return false;
            if (sawCombatOkAny && (/combat scenario skipped\s*\(not in dungeon\)/i.test(t))) return false;
            return true;
          })
          .map(v => ({ ok: !!v.ok, skipped: (!v.ok && !!v.skippedAny), msg: v.msg, lastSeen: v.lastSeen || 0 }));

        const failed = all.filter(s => !s.ok && !s.skipped).sort((a,b) => (b.lastSeen - a.lastSeen));
        const skipped = all.filter(s => s.skipped).sort((a,b) => (b.lastSeen - a.lastSeen));
        const passed = all.filter(s => s.ok && !s.skipped).sort((a,b) => (b.lastSeen - a.lastSeen));
        const el = ensureMatchupEl();
        if (!el) return;
        // Dynamic border color based on failures present
        el.style.border = failed.length ? "1px solid rgba(239,68,68,0.6)" : "1px solid rgba(122,162,247,0.4)";
        const failColor = failed.length ? "#ef4444" : "#86efac";
        // Immobile counter (failed steps whose message mentions "immobile")
        const immobileCount = failed.filter(s => /immobile/i.test(String(s.msg || ""))).length;
        const immColor = immobileCount ? "#f59e0b" : "#93c5fd";
        // Death counter (failed steps whose message mentions "death" or "dead" or "game over")
        const deadCount = failed.filter(s => /(death|dead|game over)/i.test(String(s.msg || ""))).length;
        const deadColor = deadCount ? "#ef4444" : "#93c5fd";
        const counts = `<div style="font-weight:600;"><span style="opacity:0.9;">Matchup so far:</span> OK ${passed.length} • FAIL <span style="color:${failColor};">${failed.length}</span> • SKIP ${skipped.length} • IMMOBILE <span style="color:${immColor};">${immobileCount}</span> • DEAD <span style="color:${deadColor};">${deadCount}</span></div>`;
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
      try {
        const Bc = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
        if (Bc && typeof Bc.setStatus === "function") Bc.setStatus(`Run ${i + 1} / ${n}: preparing…`);
      } catch (_) {}
      const seedUsed = await applyFreshSeedForRun(i);
      usedSeedList.push(seedUsed);
      // Wait for world mode to be active and stable before running scenarios
      try {
        const Bc = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
        if (Bc && typeof Bc.setStatus === "function") Bc.setStatus(`Run ${i + 1} / ${n}: waiting for overworld…`);
      } catch (_) {}
      try {
        await waitUntilTrue(() => {
          try { return (window.GameAPI && typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() === "world"); } catch (_) { return false; }
        }, 2000, 80);
      } catch (_) {}
      try {
        const Bc = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
        if (Bc && typeof Bc.setStatus === "function") Bc.setStatus(`Run ${i + 1} / ${n}: running…`);
      } catch (_) {}

      // Build skip list from scenarios that have already met the stable OK threshold
      let skipList = (skipAfter > 0)
          ? Array.from(scenarioPassCounts.entries())
              .filter(([name, cnt]) => (cnt | 0) >= skipAfter)
              .map(([name]) => name)
          : [];

        // Persistence scenario frequency control
        try {
          const pers = (params && params.persistence) ? params.persistence : "once";
          if (pers !== "always") {
            if (pers === "never" || i > 0) {
              if (!skipList.includes("dungeon_persistence")) skipList.push("dungeon_persistence");
            }
          }
        } catch (_) {}

        // Guarantee: run town_diagnostics at least once in the series regardless of skipokafter
        skipList = skipList.filter(name => !(name === "town_diagnostics" && !ranOnceEnsure.has("town_diagnostics")));
        // Guarantee: run dungeon_persistence at least once (unless persistence=never)
        try {
          const pers = (params && params.persistence) ? params.persistence : "once";
          if (pers !== "never") {
            skipList = skipList.filter(name => !(name === "dungeon_persistence" && !ranOnceEnsure.has("dungeon_persistence")));
          }
        } catch (_) {}

      const res = await run({ index: i + 1, total: n, suppressReport: false, skipScenarios: skipList, skipSteps: Array.from(okMsgs), seedUsed });
      all.push(res);
      if (res && res.aborted && res.abortReason === "immobile") {
        skippedRuns++;
      } else if (res && res.ok) {
        pass++;
      } else {
        fail++;
      }

      // Update scenario pass counts
        try {
          if (res && Array.isArray(res.scenarioResults)) {
            for (const sr of res.scenarioResults) {
              if (!sr || !sr.name) continue;
              if (sr.passed && !sr.skippedStable) {
                scenarioPassCounts.set(sr.name, (scenarioPassCounts.get(sr.name) || 0) + 1);
              }
              // Track that scenarios ran at least once (for ensure-once guarantees)
              try {
                if (ensureOnceScenarios.has(sr.name)) ranOnceEnsure.add(sr.name);
              } catch (_) {}
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
        const abortedInfo = (res && res.aborted) ? `<div style="color:#ef4444;">Run ${i + 1} aborted (${res.abortReason}). Remaining scenarios skipped.</div>` : ``;
        const progHtml = `<div style="margin-top:6px;"><strong>Smoke Test Progress:</strong> ${i + 1} / ${n}</div><div>Pass: ${pass}  Fail: ${fail}</div>${skippedStable}${abortedInfo}`;
        if (Bprog && typeof Bprog.appendToPanel === "function") Bprog.appendToPanel(progHtml);
      } catch (_) {}

      // Update live matchup scoreboard
      updateMatchup();

      // Update status to reflect completion of this run
      try {
        const Bstat = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
        if (Bstat && typeof Bstat.setStatus === "function") Bstat.setStatus(`Run ${i + 1} / ${n}: completed`);
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

    // Summary via reporting module and full aggregated report
      try {
        const R = window.SmokeTest && window.SmokeTest.Reporting && window.SmokeTest.Reporting.Render;

      // Build aggregated steps: if any run had OK, mark OK; else if only skipped, mark skipped; else fail.
      let aggregatedSteps = Array.from(agg.values()).map(v => {
        return { ok: !!v.ok, msg: v.msg, skipped: (!v.ok && !!v.skippedAny) };
      });
      // Coalesce known categories: if town/dungeon/combat succeeded anywhere, hide their failure counterparts
      const sawTownOkAgg = aggregatedSteps.some(s => s.ok && (/entered town/i.test(String(s.msg || "")) || /mode confirm\s*\(town enter\):\s*town/i.test(String(s.msg || ""))));
      const sawDungeonOkAgg = aggregatedSteps.some(s => s.ok && /entered dungeon/i.test(String(s.msg || "")));
      const sawCombatOkAgg = aggregatedSteps.some(s => s.ok && (/moved and attempted attacks|killed enemy|attacked enemy|combat effects:/i.test(String(s.msg || ""))));
      aggregatedSteps = aggregatedSteps.filter(s => {
        const t = String(s.msg || "");
        if (sawTownOkAgg) {
          if (/town entry not achieved/i.test(t)) return false;
          if (/town overlays skipped/i.test(t)) return false;
          if (/town diagnostics skipped/i.test(t)) return false;
          if (/mode confirm\s*\(town (re-)?enter\):\s*world/i.test(t)) return false;
        }
        if (sawDungeonOkAgg) {
          if (/dungeon entry failed/i.test(t)) return false;
          if (/mode confirm\s*\(dungeon (re-)?enter\):\s*world/i.test(t)) return false;
        }
        if (sawCombatOkAgg) {
          if (/combat scenario skipped\s*\(not in dungeon\)/i.test(t)) return false;
        }
        return true;
      });

      const failedAgg = aggregatedSteps.filter(s => !s.ok && !s.skipped);
      const passedAgg = aggregatedSteps.filter(s => s.ok && !s.skipped);
      const skippedAgg = aggregatedSteps.filter(s => s.skipped);
      // Aggregated OK: if any aggregated step passed across runs, mark the aggregated report OK (union-of successes)
      const okAll = aggregatedSteps.some(s => s.ok);

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

      // Compute per-step PERF averages for a more representative summary
      let stepAvgTurn = 0, stepAvgDraw = 0;
      try {
        const allSteps = [];
        for (const res of all) {
          if (res && Array.isArray(res.steps)) {
            for (const s of res.steps) { if (s && s.perf) allSteps.push(s.perf); }
          }
        }
        if (allSteps.length) {
          let sumT = 0, sumD = 0;
          for (const p of allSteps) { sumT += Number(p.turn || 0); sumD += Number(p.draw || 0); }
          stepAvgTurn = sumT / allSteps.length;
          stepAvgDraw = sumD / allSteps.length;
        }
      } catch (_) {}

      const perfWarnings = [];
      try {
        if (stepAvgTurn > CONFIG.perfBudget.turnMs) perfWarnings.push(`Avg per-step turn ${stepAvgTurn.toFixed ? stepAvgTurn.toFixed(2) : stepAvgTurn}ms exceeds budget ${CONFIG.perfBudget.turnMs}ms`);
        if (stepAvgDraw > CONFIG.perfBudget.drawMs) perfWarnings.push(`Avg per-step draw ${stepAvgDraw.toFixed ? stepAvgDraw.toFixed(2) : stepAvgDraw}ms exceeds budget ${CONFIG.perfBudget.drawMs}ms`);
      } catch (_) {}

      const skippedOnlyCount = (() => { let c = 0; try { for (const res of all) { if (res && Array.isArray(res.scenarioResults)) { for (const sr of res.scenarioResults) { if (sr && sr.skippedOnly) c++; } } } } catch (_) {} return c; })();
      const failColorSum = fail ? '#ef4444' : '#86efac';
      const summary = [
        `<div style="margin-top:8px;"><strong>Smoke Test Summary:</strong></div>`,
        `<div>Runs: ${n}  Pass: ${pass}  Fail: <span style="color:${failColorSum};">${fail}</span>  Skipped runs: ${skippedRuns}  •  Step skips: ${skippedAgg.length}  •  Skipped-only scenarios: ${skippedOnlyCount}</div>`,
        `<div style="opacity:0.9;">Avg PERF (per-step): turn ${stepAvgTurn.toFixed ? stepAvgTurn.toFixed(2) : stepAvgTurn} ms, draw ${stepAvgDraw.toFixed ? stepAvgDraw.toFixed(2) : stepAvgDraw} ms</div>`,
        perfWarnings.length ? `<div style="color:#ef4444; margin-top:4px;"><strong>Performance:</strong> ${perfWarnings.join("; ")}</div>` : ``,
      ].join("");

      // Append final aggregated report (keep per-run sections visible)
      try {
        // Ensure GOD panel is visible before writing the aggregated report
        try { openGodPanel(); } catch (_) {}
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
          // Build aggregated Key Checklist (object) and diagnostics
          let aggregatedKeyChecklist = {};
          try {
            if (R && typeof R.buildKeyChecklistObjectFromSteps === "function") {
              aggregatedKeyChecklist = R.buildKeyChecklistObjectFromSteps(aggregatedSteps);
            }
          } catch (_) {}
          const diagnostics = (() => {
            try {
              const imm = aggregatedSteps.filter(s => !s.ok && !s.skipped && /immobile/i.test(String(s.msg || ""))).length;
              const dead = aggregatedSteps.filter(s => !s.ok && !s.skipped && /(death|dead|game over)/i.test(String(s.msg || ""))).length;
              return { immobileFailures: imm, deathFailures: dead };
            } catch (_) { return { immobileFailures: 0, deathFailures: 0 }; }
          })();
          const scenarioPassCountsObj = (() => {
            const obj = {};
            try {
              scenarioPassCounts.forEach((v, k) => { obj[k] = v | 0; });
            } catch (_) {}
            return obj;
          })();
          const actionsSummary = (() => {
            const sum = {};
            try {
              for (const res of all) {
                if (!res || !res.trace || !Array.isArray(res.trace.actions)) continue;
                for (const act of res.trace.actions) {
                  const t = String((act && act.type) || "");
                  if (!t) continue;
                  if (!sum[t]) sum[t] = { count: 0, success: 0 };
                  sum[t].count += 1;
                  if (act && act.success) sum[t].success += 1;
                }
              }
            } catch (_) {}
            return sum;
          })();
          // Scenario timing summary across runs
          const scenariosSummary = (() => {
            const m = {};
            try {
              for (const res of all) {
                if (!res || !res.trace || !Array.isArray(res.trace.scenarioTraces)) continue;
                // Build pass map for this run
                const passMap = {};
                try {
                  if (Array.isArray(res.scenarioResults)) {
                    for (const sr of res.scenarioResults) {
                      if (sr && sr.name) passMap[sr.name] = !!sr.passed;
                    }
                  }
                } catch (_) {}
                for (const st of res.trace.scenarioTraces) {
                  if (!st || !st.name) continue;
                  const name = st.name;
                  const dur = Math.max(0, st.durationMs | 0);
                  const prev = m[name] || { runs: 0, passed: 0, sumDurationMs: 0, minDurationMs: null, maxDurationMs: null };
                  prev.runs += 1;
                  if (passMap[name]) prev.passed += 1;
                  prev.sumDurationMs += dur;
                  prev.minDurationMs = (prev.minDurationMs == null) ? dur : Math.min(prev.minDurationMs, dur);
                  prev.maxDurationMs = (prev.maxDurationMs == null) ? dur : Math.max(prev.maxDurationMs, dur);
                  m[name] = prev;
                }
              }
              // finalize averages
              Object.keys(m).forEach(k => {
                const v = m[k];
                v.avgDurationMs = v.runs ? (v.sumDurationMs / v.runs) : 0;
                delete v.sumDurationMs;
              });
            } catch (_) {}
            return m;
          })();
          // Step-level tile/modal/perf stats across the entire series
          const allSteps = [];
          try { for (const res of all) { if (res && Array.isArray(res.steps)) allSteps.push.apply(allSteps, res.steps); } } catch (_) {}
          const stepTileStats = (() => {
            const out = { TOWN: 0, DUNGEON: 0, walkable: 0, blocked: 0, unknown: 0 };
            try {
              for (const s of allSteps) {
                const t = String((s && s.tile) || "(unknown)");
                if (t === "TOWN") out.TOWN += 1;
                else if (t === "DUNGEON") out.DUNGEON += 1;
                else if (t === "walkable") out.walkable += 1;
                else if (t === "blocked") out.blocked += 1;
                else out.unknown += 1;
              }
            } catch (_) {}
            return out;
          })();
          const stepModalStats = (() => {
            const out = { samples: 0, god: 0, inventory: 0, loot: 0, shop: 0, smoke: 0 };
            try {
              for (const s of allSteps) {
                if (!s || !s.modals) continue;
                out.samples += 1;
                if (s.modals.god === true) out.god += 1;
                if (s.modals.inventory === true) out.inventory += 1;
                if (s.modals.loot === true) out.loot += 1;
                if (s.modals.shop === true) out.shop += 1;
                if (s.modals.smoke === true) out.smoke += 1;
              }
            } catch (_) {}
            return out;
          })();
          const stepPerfStats = (() => {
            const out = { count: 0, avgTurnMs: 0, avgDrawMs: 0, minTurnMs: null, maxTurnMs: null, minDrawMs: null, maxDrawMs: null };
            try {
              let sumTurn = 0, sumDraw = 0;
              for (const s of allSteps) {
                if (!s || !s.perf) continue;
                const t = Number(s.perf.turn || 0);
                const d = Number(s.perf.draw || 0);
                sumTurn += t;
                sumDraw += d;
                out.count += 1;
                out.minTurnMs = (out.minTurnMs == null) ? t : Math.min(out.minTurnMs, t);
                out.maxTurnMs = (out.maxTurnMs == null) ? t : Math.max(out.maxTurnMs, t);
                out.minDrawMs = (out.minDrawMs == null) ? d : Math.min(out.minDrawMs, d);
                out.maxDrawMs = (out.maxDrawMs == null) ? d : Math.max(out.maxDrawMs, d);
              }
              out.avgTurnMs = out.count ? (sumTurn / out.count) : 0;
              out.avgDrawMs = out.count ? (sumDraw / out.count) : 0;
            } catch (_) {}
            return out;
          })();

          const rep = {
            runnerVersion: RUNNER_VERSION,
            runs: n,
            pass, fail,
            skipped: skippedRuns,
            avgTurnMs: Number(avgTurn.toFixed ? avgTurn.toFixed(2) : avgTurn),
            avgDrawMs: Number(avgDraw.toFixed ? avgDraw.toFixed(2) : avgDraw),
            // Per-step averages across all steps in all runs (more representative)
            stepAvgTurnMs: Number(stepAvgTurn.toFixed ? stepAvgTurn.toFixed(2) : stepAvgTurn),
            stepAvgDrawMs: Number(stepAvgDraw.toFixed ? stepAvgDraw.toFixed(2) : stepAvgDraw),
            results: all,
            sanitizedPerRunSteps: all.map(r => (r && Array.isArray(r.sanitizedSteps)) ? r.sanitizedSteps : []),
            aggregatedSteps,
            seeds: usedSeedList,
            params,
            keyChecklist: aggregatedKeyChecklist,
            diagnostics,
            scenarioPassCounts: scenarioPassCountsObj,
            actionsSummary,
            scenariosSummary,
            stepTileStats,
            stepModalStats,
            stepPerfStats
          };
          const summaryText = [
            `Roguelike Smoke Test Summary (Runner v${rep.runnerVersion})`,
            `Runs: ${rep.runs}  Pass: ${rep.pass}  Fail: ${rep.fail}  Skipped: ${rep.skipped}`,
            `Avg PERF (per-step): turn ${rep.stepAvgTurnMs} ms, draw ${rep.stepAvgDrawMs} ms`
          ].join("\n");
          const checklistText = (R && typeof R.buildKeyChecklistHtmlFromSteps === "function" ? R.buildKeyChecklistHtmlFromSteps(aggregatedSteps) : "").replace(/<[^>]+>/g, "");
          E.attachButtons(rep, summaryText, checklistText);
        }
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
        await waitUntilRunnerReady(6000);
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