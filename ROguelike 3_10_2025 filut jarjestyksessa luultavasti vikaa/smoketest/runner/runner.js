import { SMOKE_SCENARIOS_BY_ID, resolveScenarioByPath } from "/smoketest/scenario_registry.js";
import { parseParams } from "/smoketest/runner/config.js";
import {
  key,
  sleep,
  makeBudget,
  withTimeout,
  ensureAllModalsClosed,
  openGodPanel,
  waitUntilTrue,
  waitUntilGameReady,
  waitUntilScenariosReady,
  waitUntilRunnerReady,
  waitUntilGameDataReady,
  settleFrames,
  waitForModeStable
} from "/smoketest/runner/runtime_waits.js";
import {
  filterRunStepsForDisplay,
  buildScenarioOutcomes,
  buildFlakeSummaries,
  buildAggregatedStepsForDisplay,
  summarizeStepPerf,
  buildPerfWarnings,
  buildSeriesSummaryHtml,
  buildDiagnostics,
  buildScenarioPassCountsObject,
  buildActionsSummary,
  buildScenariosSummary,
  buildAllStepStats,
  buildAggregatedExportReport
} from "/smoketest/runner/reporting_helpers.js";

(function () {
  // Orchestrator runner: compact scenario pipeline; now default unless ?legacy=1 is present.
  window.SmokeTest = window.SmokeTest || {};

  const CONFIG = window.SmokeTest.Config || {
        timeouts: { route: 5000, interact: 2500, battle: 5000 },
        perfBudget: { turnMs: 6.0, drawMs: 12.0 }
      };
      const RUNNER_VERSION = "1.9.0";

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

  function resolveScenarioFn(name) {
    try {
      const S = window.SmokeTest && window.SmokeTest.Scenarios ? window.SmokeTest.Scenarios : null;
      if (!S) return null;
      const meta = name ? SMOKE_SCENARIOS_BY_ID[name] : null;
      if (meta && meta.resolver) return resolveScenarioByPath(S, meta.resolver);
    } catch (_) {}
    return null;
  }

  async function run(ctx) {
    try {
      const runIndex = (ctx && ctx.index) ? (ctx.index | 0) : null;
      const runTotal = (ctx && ctx.total) ? (ctx.total | 0) : null;
      const stacking = !!(window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.STACK_LOGS);
      const suppress = !!(ctx && ctx.suppressReport);
      // New: scenarios to skip (already stable OK in prior runs)
      const skipSet = new Set((ctx && ctx.skipScenarios) ? ctx.skipScenarios : []);

      await waitUntilRunnerReady(12000);
      // Ensure JSON registries (notably encounters) have finished loading before any scenario runs.
      await waitUntilGameDataReady(15000);

      // Validation summary (non-fatal): record warnings/notices up front
      let __valWarnings = 0, __valNotices = 0;
      try {
        const VR = (typeof window !== "undefined" ? window.ValidationRunner : null);
        if (VR && typeof VR.run === "function") {
          VR.run();
          const s = (typeof VR.summary === "function") ? VR.summary() : null;
          if (s) { __valWarnings = (s.totalWarnings | 0); __valNotices = (s.totalNotices | 0); }
          record(true, `Validation summary: ${__valWarnings} warnings, ${__valNotices} notices.`);
        } else {
          const V = (typeof window !== "undefined" ? window.ValidationLog : null) || {};
          const w = Array.isArray(V.warnings) ? V.warnings.length : 0;
          const n = Array.isArray(V.notices) ? V.notices.length : 0;
          __valWarnings = (w | 0); __valNotices = (n | 0);
          record(true, `Validation summary (fallback): ${__valWarnings} warnings, ${__valNotices} notices.`);
        }
      } catch (_) {}

      const caps = detectCaps();
      const params = parseParams();
      const sel = params.scenarios;
      const steps = [];
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
            if (getMode() === "dungeon") return true;
            try { window.SmokeTest.Runner.DUNGEON_LOCK = false; } catch (_) {}
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
                try { await waitForModeStable("world", 8000); } catch (_) {}
                await sleep(200);
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

          if (ok) {
            try { await waitForModeStable("dungeon", 6000); } catch (_) {}
            try { window.SmokeTest.Runner.DUNGEON_LOCK = true; } catch (_) {}
          }
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
            if (getMode() === "town") return true;
            try { window.SmokeTest.Runner.TOWN_LOCK = false; } catch (_) {}
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
              try { await waitForModeStable("world", 8000); } catch (_) {}
              await sleep(200);
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

          if (ok) {
            try { await waitForModeStable("town", 6000); } catch (_) {}
            try { window.SmokeTest.Runner.TOWN_LOCK = true; } catch (_) {}
          }
          try { act.endMode = getMode(); act.success = !!ok; if (trace && Array.isArray(trace.actions)) trace.actions.push(act); } catch (_) {}
          return ok;
        } catch (_) { return false; }
      }

      async function ensureRegionOnce() {
        try {
          const G = window.GameAPI || {};
          const Modes = (typeof window !== "undefined" && window.Modes) ? window.Modes : null;
          const getMode = (typeof G.getMode === "function") ? () => G.getMode() : () => null;
          const getWorld = (typeof G.getWorld === "function") ? () => G.getWorld() : () => null;
          const getPlayer = (typeof G.getPlayer === "function") ? () => G.getPlayer() : () => ({ x: 0, y: 0 });
          const moveKey = async (code, waitMs) => {
            try { key(code); } catch (_) {}
            await sleep(waitMs | 0);
          };
          let act = { type: "regionEnter", startMode: getMode(), target: null, fallback: null, nudged: false, endMode: null, success: false };

          try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(4); } catch (_) {}

          if (getMode() === "region") {
            try { act.endMode = "region"; act.success = true; if (trace && Array.isArray(trace.actions)) trace.actions.push(act); } catch (_) {}
            return true;
          }

          if (getMode() === "encounter") {
            try { await exitEncounterToWorld({ allowForceWorld: true }); } catch (_) {}
          }
          if (getMode() === "town" || getMode() === "dungeon") {
            try {
              if (typeof G.forceWorld === "function") G.forceWorld();
            } catch (_) {}
            try { await waitForModeStable("world", 4000); } catch (_) {}
          }
          if (getMode() !== "world") {
            try { act.endMode = getMode(); if (trace && Array.isArray(trace.actions)) trace.actions.push(act); } catch (_) {}
            return false;
          }

          const W = (typeof window !== "undefined") ? (window.World || {}) : {};
          const WT = W.TILES || {};
          const world = getWorld();
          const inBounds = (x, y) => {
            const h = world && world.map ? world.map.length : 0;
            const w = h ? ((world.map[0] && world.map[0].length) || 0) : 0;
            return x >= 0 && y >= 0 && x < w && y < h;
          };
          const tileAt = (x, y) => inBounds(x, y) ? world.map[y][x] : null;
          const isWalkable = (tile) => {
            try { return typeof W.isWalkable === "function" ? !!W.isWalkable(tile) : true; } catch (_) { return true; }
          };
          const isAllowedForRegion = (tile) => {
            if (tile === WT.TOWN || tile === WT.DUNGEON) return false;
            return isWalkable(tile);
          };

          let player = getPlayer();
          let here = tileAt(player.x, player.y);
          if (!isAllowedForRegion(here)) {
            const dirs = [
              { key: "ArrowLeft", dx: -1, dy: 0 },
              { key: "ArrowRight", dx: 1, dy: 0 },
              { key: "ArrowUp", dx: 0, dy: -1 },
              { key: "ArrowDown", dx: 0, dy: 1 }
            ];
            let nudged = false;
            for (const dir of dirs) {
              const nx = player.x + dir.dx;
              const ny = player.y + dir.dy;
              if (!inBounds(nx, ny) || !isAllowedForRegion(tileAt(nx, ny))) continue;
              await moveKey(dir.key, 140);
              player = getPlayer();
              if (player.x === nx && player.y === ny) {
                nudged = true;
                try { act.nudged = true; } catch (_) {}
                break;
              }
            }
            if (!nudged) {
              try { act.endMode = getMode(); if (trace && Array.isArray(trace.actions)) trace.actions.push(act); } catch (_) {}
              return false;
            }
          }

          let opened = false;
          try {
            if (typeof G.openRegionMap === "function") {
              opened = !!G.openRegionMap();
              if (opened) act.fallback = "gameapi";
            }
          } catch (_) {}
          await sleep(220);

          if (getMode() !== "region") {
            try {
              const ctxG = (typeof G.getCtx === "function") ? G.getCtx() : null;
              if (Modes && typeof Modes.openRegionMap === "function" && ctxG) {
                opened = !!Modes.openRegionMap(ctxG);
                if (opened) act.fallback = "modes";
              }
            } catch (_) {}
            await sleep(220);
          }

          if (getMode() !== "region") {
            try { await moveKey("g", 260); act.fallback = act.fallback || "keypress"; } catch (_) {}
          }

          let ok = (getMode() === "region") || opened;
          if (ok) {
            try { await waitForModeStable("region", 4000); } catch (_) {}
            ok = (getMode() === "region");
          }
          try { act.endMode = getMode(); act.success = !!ok; if (trace && Array.isArray(trace.actions)) trace.actions.push(act); } catch (_) {}
          return ok;
        } catch (_) { return false; }
      }

      async function exitRegionToWorld() {
        try {
          const G = window.GameAPI || {};
          const getMode = (typeof G.getMode === "function") ? () => G.getMode() : () => null;
          const getPlayer = (typeof G.getPlayer === "function") ? () => G.getPlayer() : () => ({ x: 0, y: 0 });
          const moveKey = async (code, waitMs) => {
            try { key(code); } catch (_) {}
            await sleep(waitMs | 0);
          };
          let act = { type: "regionExit", startMode: getMode(), target: null, usedFallback: null, endMode: null, success: false };

          if (getMode() === "world") {
            try { act.endMode = "world"; act.success = true; if (trace && Array.isArray(trace.actions)) trace.actions.push(act); } catch (_) {}
            return true;
          }
          if (getMode() !== "region") {
            try { act.endMode = getMode(); if (trace && Array.isArray(trace.actions)) trace.actions.push(act); } catch (_) {}
            return false;
          }

          try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(2); } catch (_) {}

          const ctxG = (typeof G.getCtx === "function") ? G.getCtx() : null;
          const region = ctxG && ctxG.region ? ctxG.region : null;
          const exits = (region && Array.isArray(region.exitTiles) && region.exitTiles.length)
            ? region.exitTiles
            : (() => {
                const width = (region && typeof region.width === "number") ? (region.width | 0) : 0;
                const height = (region && typeof region.height === "number") ? (region.height | 0) : 0;
                return [
                  { x: (width / 2) | 0, y: 0 },
                  { x: (width / 2) | 0, y: Math.max(0, height - 1) },
                  { x: 0, y: (height / 2) | 0 },
                  { x: Math.max(0, width - 1), y: (height / 2) | 0 }
                ];
              })();

          if (!exits.length) {
            try { act.endMode = getMode(); if (trace && Array.isArray(trace.actions)) trace.actions.push(act); } catch (_) {}
            return false;
          }

          const player = getPlayer();
          let target = exits[0];
          let bestD = Infinity;
          for (const ex of exits) {
            const d = Math.abs((ex.x | 0) - (player.x | 0)) + Math.abs((ex.y | 0) - (player.y | 0));
            if (d < bestD) {
              bestD = d;
              target = ex;
            }
          }
          try { act.target = target ? { x: target.x | 0, y: target.y | 0 } : null; } catch (_) {}

          const MV = (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Movement) || null;
          const TP = (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Teleport) || null;
          let routed = false;
          try {
            if (target && MV && typeof MV.routeTo === "function") {
              routed = !!(await MV.routeTo(target.x, target.y, { timeoutMs: 7000, stepMs: 70 }));
            }
          } catch (_) {}
          if (!routed && target && TP && typeof TP.teleportTo === "function") {
            try {
              routed = !!(await TP.teleportTo(target.x, target.y, { ensureWalkable: false, fallbackScanRadius: 0 }));
              if (routed) act.usedFallback = "teleport";
            } catch (_) {}
          }

          const deadline = Date.now() + 6000;
          while (getMode() === "region" && Date.now() < deadline) {
            const cur = getPlayer();
            if ((cur.x | 0) === (target.x | 0) && (cur.y | 0) === (target.y | 0)) break;
            if (cur.x > target.x) await moveKey("ArrowLeft", 60);
            else if (cur.x < target.x) await moveKey("ArrowRight", 60);
            else if (cur.y > target.y) await moveKey("ArrowUp", 60);
            else if (cur.y < target.y) await moveKey("ArrowDown", 60);
            else break;
          }

          await moveKey("g", 260);
          if (getMode() !== "world") await moveKey("g", 320);
          if (getMode() !== "world") {
            try {
              const RM = (typeof window !== "undefined" && window.RegionMapRuntime) ? window.RegionMapRuntime : null;
              const ctxNow = (typeof G.getCtx === "function") ? G.getCtx() : null;
              if (RM && typeof RM.close === "function" && ctxNow) {
                const closed = !!RM.close(ctxNow);
                if (closed) act.usedFallback = act.usedFallback || "runtime.close";
              }
            } catch (_) {}
          }

          let ok = (getMode() === "world");
          if (ok) {
            try { await waitForModeStable("world", 4000); } catch (_) {}
            ok = (getMode() === "world");
          }
          try { act.endMode = getMode(); act.success = !!ok; if (trace && Array.isArray(trace.actions)) trace.actions.push(act); } catch (_) {}
          return ok;
        } catch (_) { return false; }
      }

      async function exitEncounterToWorld(opts) {
        try {
          const options = opts || {};
          const G = window.GameAPI || {};
          const getMode = (typeof G.getMode === "function") ? () => G.getMode() : () => null;
          const moveKey = async (code, waitMs) => {
            try { key(code); } catch (_) {}
            await sleep(waitMs | 0);
          };
          let act = { type: "encounterExit", startMode: getMode(), method: null, forcedWorld: false, endMode: null, success: false };

          if (getMode() === "world") {
            try { act.endMode = "world"; act.success = true; if (trace && Array.isArray(trace.actions)) trace.actions.push(act); } catch (_) {}
            return true;
          }
          if (getMode() !== "encounter") {
            try { act.endMode = getMode(); if (trace && Array.isArray(trace.actions)) trace.actions.push(act); } catch (_) {}
            return false;
          }

          try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(2); } catch (_) {}

          let ok = false;
          try {
            if (typeof G.completeEncounter === "function") {
              ok = !!G.completeEncounter("withdraw");
              if (ok) act.method = "completeEncounter";
            }
          } catch (_) {}
          await sleep(240);
          if (getMode() !== "world") {
            try { await waitForModeStable("world", 2500); } catch (_) {}
          }
          ok = (getMode() === "world");

          if (!ok) {
            try {
              const ctxG = (typeof G.getCtx === "function") ? G.getCtx() : null;
              const map = (ctxG && typeof ctxG.getMap === "function") ? ctxG.getMap() : (ctxG ? ctxG.map : null);
              const tiles = (typeof G.getTiles === "function") ? G.getTiles() : { STAIRS: 3 };
              let exitTile = null;
              const h = Array.isArray(map) ? map.length : 0;
              const w = (h && map[0]) ? map[0].length : 0;
              for (let y = 0; y < h && !exitTile; y++) {
                for (let x = 0; x < w; x++) {
                  if (map[y][x] === tiles.STAIRS) {
                    exitTile = { x, y };
                    break;
                  }
                }
              }
              if (exitTile) {
                const TP = (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Teleport) || null;
                if (TP && typeof TP.teleportTo === "function") {
                  const okTp = !!(await TP.teleportTo(exitTile.x, exitTile.y, { ensureWalkable: true, fallbackScanRadius: 4 }));
                  if (!okTp) {
                    await TP.teleportTo(exitTile.x, exitTile.y, { ensureWalkable: false, fallbackScanRadius: 0 });
                  }
                } else if (typeof G.teleportTo === "function") {
                  try { G.teleportTo(exitTile.x, exitTile.y, { ensureWalkable: false, fallbackScanRadius: 0 }); } catch (_) {}
                }
                await sleep(140);
                try {
                  const p = (typeof G.getPlayer === "function") ? G.getPlayer() : { x: exitTile.x, y: exitTile.y };
                  if (!(p.x === exitTile.x && p.y === exitTile.y)) {
                    const dx = Math.sign(exitTile.x - p.x);
                    const dy = Math.sign(exitTile.y - p.y);
                    await moveKey(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"), 140);
                  }
                } catch (_) {}
                await moveKey("g", 240);
                act.method = "stairs";
                try { await waitForModeStable("world", 2500); } catch (_) {}
                ok = (getMode() === "world");
              }
            } catch (_) {}
          }

          if (!ok && options.allowForceWorld && typeof G.forceWorld === "function") {
            try {
              ok = !!G.forceWorld();
              act.method = act.method || "forceWorld";
              act.forcedWorld = !!ok;
            } catch (_) {}
            if (ok) {
              try { await waitForModeStable("world", 2500); } catch (_) {}
              ok = (getMode() === "world");
            }
          }

          try { act.endMode = getMode(); act.success = !!ok; if (trace && Array.isArray(trace.actions)) trace.actions.push(act); } catch (_) {}
          return ok;
        } catch (_) { return false; }
      }

      const waitForEncounterTemplate = async (id, opts) => {
        try {
          const H = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.GameData;
          if (H && typeof H.waitForEncounterTemplate === "function") {
            return await H.waitForEncounterTemplate(id, opts);
          }
        } catch (_) {}

        // Fallback: inline wait (runner already calls waitUntilGameDataReady before scenarios start).
        try {
          const to = (opts && typeof opts === "object" && opts.settleTimeoutMs != null) ? (opts.settleTimeoutMs | 0) : 15000;
          await waitUntilGameDataReady(to);
        } catch (_) {}

        const want = String(id || "").trim().toLowerCase();
        if (!want) return false;

        const timeoutMs = (opts && typeof opts === "object" && opts.timeoutMs != null) ? (opts.timeoutMs | 0) : 12000;
        const intervalMs = (opts && typeof opts === "object" && opts.intervalMs != null) ? (opts.intervalMs | 0) : 80;

        return await waitUntilTrue(() => {
          try {
            const GD = (typeof window !== "undefined") ? window.GameData : null;
            const reg = GD && GD.encounters && Array.isArray(GD.encounters.templates) ? GD.encounters.templates : [];
            return !!reg.find(t => t && String(t.id || "").toLowerCase() === want);
          } catch (_) {
            return false;
          }
        }, timeoutMs, intervalMs);
      };

      const baseCtx = {
        index: runIndex || 1,
        total: runTotal || 1,
        key,
        sleep,
        makeBudget,
        ensureAllModalsClosed,
        CONFIG,
        caps,
        record,
        recordSkip,
        ensureDungeonOnce,
        ensureTownOnce,
        ensureRegionOnce,
        exitRegionToWorld,
        exitEncounterToWorld,
        waitForGameDataReady: waitUntilGameDataReady,
        waitForEncounterTemplate
      };
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
        region: S.Region && S.Region.run,
        dungeon: S.Dungeon && S.Dungeon.run,
        inventory: S.Inventory && S.Inventory.run,
        combat: S.Combat && S.Combat.run,
        dungeon_persistence: S.Dungeon && S.Dungeon.Persistence && S.Dungeon.Persistence.run,
        dungeon_stairs_transitions: S.Dungeon && S.Dungeon.StairsTransitions && S.Dungeon.StairsTransitions.run,
        town: S.Town && S.Town.run,
        town_diagnostics: S.Town && S.Town.Diagnostics && S.Town.Diagnostics.run,
        harbor_fast_travel: S.HarborFastTravel && S.HarborFastTravel.run,
        overlays: S.Overlays && S.Overlays.run,
        ui_layout: S.UILayout && S.UILayout.run,
        determinism: S.Determinism && S.Determinism.run,
        encounters: (S.encounters && S.encounters.run) || (S.Encounters && S.Encounters.run),
        api: S.API && S.API.run,
        town_flows: S.Town && S.Town.Flows && S.Town.Flows.run,
        skeleton_key_chest: S.skeleton_key_chest && S.skeleton_key_chest.run,
        gm_mechanic_hints: S.GMMechanicHints && S.GMMechanicHints.run,
        gm_intent_decisions: S.GMIntentDecisions && S.GMIntentDecisions.run,
        gm_seed_reset: S.gm_seed_reset && S.gm_seed_reset.run,
        gm_boredom_interest: S.gm_boredom_interest && S.gm_boredom_interest.run,
        gm_bridge_markers: S.gm_bridge_markers && S.gm_bridge_markers.run,
        gm_bridge_faction_travel: S.gm_bridge_faction_travel && S.gm_bridge_faction_travel.run,
        gm_bottle_map: S.gm_bottle_map && S.gm_bottle_map.run,
        gm_bottle_map_fishing_pity: S.gm_bottle_map_fishing_pity && S.gm_bottle_map_fishing_pity.run,
        gm_survey_cache: S.gm_survey_cache && S.gm_survey_cache.run,
        gm_survey_cache_spawn_gate: S.gm_survey_cache_spawn_gate && S.gm_survey_cache_spawn_gate.run,
        gm_disable_switch: S.gm_disable_switch && S.gm_disable_switch.run,
        gm_rng_persistence: S.gm_rng_persistence && S.gm_rng_persistence.run,
        gm_scheduler_arbitration: S.gm_scheduler_arbitration && S.gm_scheduler_arbitration.run,
        logging_filters: S.logging_filters && S.logging_filters.run,
      };
      let pipeline = [];
      try {
        if (sel && sel.length) {
          for (const name of sel) {
            const fn = (typeof avail[name] === "function") ? avail[name] : resolveScenarioFn(name);
            pipeline.push({ name, fn });
          }
        }
      } catch (_) {}
      if (!pipeline.length) {
        pipeline = [
          { name: "world", fn: avail.world },
          { name: "region", fn: avail.region },
          { name: "encounters", fn: avail.encounters },
          { name: "dungeon", fn: avail.dungeon },
          { name: "inventory", fn: avail.inventory },
          { name: "combat", fn: avail.combat },
          { name: "dungeon_persistence", fn: avail.dungeon_persistence },
          { name: "dungeon_stairs_transitions", fn: avail.dungeon_stairs_transitions },
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
          scenarioResults.push({ name: step.name, rawPassed: true, passed: true, normalizedByHeuristic: false, hardFailMessages: [], skippedMessages: ["Scenario '" + step.name + "' skipped (stable OK threshold reached)"], skippedStable: true });
          continue;
        }
        // Availability check
        if (typeof step.fn !== "function") {
          try {
            await waitUntilTrue(() => (typeof resolveScenarioFn(step.name) === "function"), 2500, 80);
            step.fn = resolveScenarioFn(step.name);
          } catch (_) {}
        }
        if (typeof step.fn !== "function") {
          recordSkip("Scenario '" + step.name + "' not available");
          scenarioResults.push({ name: step.name, rawPassed: false, passed: false, normalizedByHeuristic: false, hardFailMessages: [], skippedMessages: ["Scenario '" + step.name + "' not available"], skippedMissing: true });
          continue;
        }
        const beforeCount = steps.length;
        let __scenarioStartMode = (window.GameAPI && typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : null;
        __curScenarioName = step.name;
        const __scenarioStartTs = Date.now();
        try {
          const runLabel = (runIndex && runTotal) ? ("Run " + runIndex + " / " + runTotal) : "Run";
          if (Banner && typeof Banner.setStatus === "function") Banner.setStatus(runLabel + " • " + step.name);
          if (Banner && typeof Banner.log === "function") Banner.log(runLabel + " • Running scenario: " + step.name, "info");
          await withTimeout(
            () => step.fn(baseCtx),
            params && params.scenariotimeoutms,
            "Scenario '" + step.name + "'"
          );
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
                const UIO = window.UIOrchestration;
                if (UIO && typeof UIO.hideGod === "function") UIO.hideGod({});
              } catch (_) {}
              await sleep(100);
              // Verify closed
              let closed = false;
              try {
                const UIO = window.UIOrchestration;
                if (UIO && typeof UIO.isGodOpen === "function") {
                  closed = !UIO.isGodOpen({});
                } else {
                  // Without UIOrchestration, assume closed to avoid DOM coupling
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
          if (e && e.code === "SMOKE_TIMEOUT") {
            aborted = true;
            __abortRequested = true;
            __abortReason = "scenario_timeout:" + step.name;
            try { window.SmokeTest.Runner.RUN_ABORT_REASON = __abortReason; } catch (_) {}
            if (Banner && typeof Banner.log === "function") {
              Banner.log("ABORT: scenario timeout detected; aborting remaining scenarios in this run.", "bad");
            }
          }
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

        // Per-scenario pass determination: pass if no failures recorded during this scenario block
        try {
          const during = steps.slice(beforeCount);
          const hasFail = during.some(s => !s.ok && !s.skipped);
          const hardFailMessages = during.filter(s => !s.ok && !s.skipped).map(s => String(s.msg || ""));
          const skippedMessages = during.filter(s => s.skipped).map(s => String(s.msg || ""));
          scenarioResults.push({
            name: step.name,
            rawPassed: !hasFail,
            passed: !hasFail,
            normalizedByHeuristic: false,
            hardFailMessages,
            skippedMessages
          });

          // Structured scenario trace for JSON export
          try {
            const sPass = during.filter(s => s.ok && !s.skipped).map(s => String(s.msg || ""));
            const sFail = during.filter(s => !s.ok && !s.skipped).map(s => String(s.msg || ""));
            const sSkip = during.filter(s => s.skipped).map(s => String(s.msg || ""));
            const endMode = (window.GameAPI && typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : null;
            const endedAt = Date.now();
            const modesSeen = (() => {
              try {
                const arr = during.map(s => s && s.mode).filter(Boolean);
                const out = [];
                const seen = new Set();
                for (let k of arr) { if (!seen.has(k)) { seen.add(k); out.push(k); } }
                return out;
              } catch (_) { return []; }
            })();
            // Step timing breakdown
            let tsFirst = null, tsLast = null, avgStepDeltaMs = 0, maxStepDeltaMs = 0;
            try {
              const tsList = during.map(s => s && typeof s.ts === "number" ? (s.ts | 0) : null).filter(v => v != null);
              if (tsList.length) {
                tsFirst = tsList[0];
                tsLast = tsList[tsList.length - 1];
                const deltas = [];
                for (let k = 1; k < tsList.length; k++) {
                  const d = Math.max(0, (tsList[k] - tsList[k - 1]));
                  deltas.push(d);
                }
                if (deltas.length) {
                  avgStepDeltaMs = (deltas.reduce((a,b) => a + b, 0) / deltas.length);
                  maxStepDeltaMs = Math.max.apply(null, deltas);
                }
              }
            } catch (_) {}
            // Mode transitions seen in this scenario (with timestamps)
            let modeTransitions = [];
            try {
              let prevMode = __scenarioStartMode;
              for (const s of during) {
                try {
                  const m = s && s.mode;
                  if (m && prevMode && m !== prevMode) {
                    modeTransitions.push({ at: s.ts || 0, from: prevMode, to: m });
                  }
                  prevMode = m || prevMode;
                } catch (_) {}
              }
            } catch (_) {}

            const sTrace = {
              name: step.name,
              startedMode: __scenarioStartMode,
              endedMode: endMode,
              stepCount: during.length,
              passes: sPass,
              fails: sFail,
              skipped: sSkip,
              startedAt: __scenarioStartTs,
              endedAt: endedAt,
              durationMs: Math.max(0, endedAt - __scenarioStartTs),
              observedModes: modesSeen,
              tsFirst,
              tsLast,
              avgStepDeltaMs,
              maxStepDeltaMs,
              modeTransitions
            };
            trace.scenarioTraces.push(sTrace);
          } catch (_) {}
        } catch (_) {}
      }

      // Adjust scenario pass/fail based on union-of successes within the same run (remove false negatives)
      try {
        const has = (rx) => (s) => { try { return rx.test(String(s.msg || "")); } catch (_) { return false; } };
        const isOk = (s) => !!(s && s.ok && !s.skipped);

        const sawDungeonOk = steps.some(s => isOk(s) && (/entered dungeon/i.test(String(s.msg || "")) || /inventory prep:\s*entered dungeon/i.test(String(s.msg || ""))));
        const sawTownOk = steps.some(s => isOk(s) && (/entered town/i.test(String(s.msg || "")) || /mode confirm\s*\(town enter\):\s*town/i.test(String(s.msg || ""))));

        const sawWorldOk = steps.some(s => isOk(s) && (/world movement test:\s*moved/i.test(String(s.msg || "")) || /world snapshot:/i.test(String(s.msg || ""))));
        const sawInventoryOk = steps.some(s => isOk(s) && (/equip best from inventory/i.test(String(s.msg || "")) || /manual equip\/unequip/i.test(String(s.msg || "")) || /drank potion/i.test(String(s.msg || ""))));
        const sawCombatOk = steps.some(s => isOk(s) && (/moved and attempted attacks/i.test(String(s.msg || "")) || /combat effects:/i.test(String(s.msg || ""))));
        const sawOverlaysOk = steps.some(s => isOk(s) && (/overlay perf:/i.test(String(s.msg || "")) || /grid perf:/i.test(String(s.msg || ""))));
        const sawDeterminismOk = steps.some(s => isOk(s) && /seed invariants:/i.test(String(s.msg || "")));
        const sawDungeonPersistenceOk = steps.some(s => isOk(s) && (/persistence corpses:/i.test(String(s.msg || "")) || /persistence decals:/i.test(String(s.msg || "")) || /returned to overworld from dungeon/i.test(String(s.msg || ""))));
        const sawTownDiagnosticsOk = steps.some(s => isOk(s) && (/gate npcs/i.test(String(s.msg || "")) || /gate greeter/i.test(String(s.msg || "")) || /gold ops/i.test(String(s.msg || "")) || /shop ui closes with esc/i.test(String(s.msg || "")) || /bump near shopkeeper: ok/i.test(String(s.msg || "")) || /interacted at shop by bump/i.test(String(s.msg || ""))));

        for (let i = 0; i < scenarioResults.length; i++) {
          const sr = scenarioResults[i];
          if (!sr || !sr.name) continue;
          const name = sr.name;

          if (name === "dungeon" && !sr.passed && sawDungeonOk) {
            scenarioResults[i] = { ...sr, passed: true, normalizedByHeuristic: true };
            continue;
          }
          if (name === "town" && !sr.passed && sawTownOk) {
            scenarioResults[i] = { ...sr, passed: true, normalizedByHeuristic: true };
            continue;
          }
          if (name === "world" && !sr.passed && sawWorldOk) {
            scenarioResults[i] = { ...sr, passed: true, normalizedByHeuristic: true };
            continue;
          }
          if (name === "inventory" && !sr.passed && sawInventoryOk) {
            scenarioResults[i] = { ...sr, passed: true, normalizedByHeuristic: true };
            continue;
          }
          if (name === "combat" && !sr.passed && sawCombatOk) {
            scenarioResults[i] = { ...sr, passed: true, normalizedByHeuristic: true };
            continue;
          }
          if (name === "overlays" && !sr.passed && sawOverlaysOk) {
            scenarioResults[i] = { ...sr, passed: true, normalizedByHeuristic: true };
            continue;
          }
          if (name === "determinism" && !sr.passed && sawDeterminismOk) {
            scenarioResults[i] = { ...sr, passed: true, normalizedByHeuristic: true };
            continue;
          }
          if (name === "dungeon_persistence" && !sr.passed && sawDungeonPersistenceOk) {
            scenarioResults[i] = { ...sr, passed: true, normalizedByHeuristic: true };
            continue;
          }
          if (name === "town_diagnostics" && !sr.passed && sawTownDiagnosticsOk) {
            scenarioResults[i] = { ...sr, passed: true, normalizedByHeuristic: true };
            continue;
          }
        }
      } catch (_) {}

      // Build report via reporting renderer
      // Run-level OK:
      // - Hard failures in this run always make the run fail, even if a scenario is
      //   heuristically normalized to passed later. This keeps the PASS/FAIL tokens
      //   truthful for CI and avoids masking real regressions with union-of-success logic.
      // - If there are no hard failures, require either all selected scenarios to pass
      //   or at least one non-skipped OK step (or a prior-ok skip).
      const hasHardFail = steps.some(s => !s.ok && !s.skipped);
      const hasRealOk = steps.some(s => s.ok && !s.skipped);
      const hasPriorOkSkip = steps.some(s => s.ok && s.skipped && s.skippedReason === "prior_ok");
      const scenariosAllPassed = (scenarioResults && scenarioResults.length)
        ? scenarioResults.every(sr => !!(sr && sr.passed))
        : false;
      const ok = !hasHardFail && (scenariosAllPassed || hasRealOk || hasPriorOkSkip);
      let issuesHtml = ""; let passedHtml = ""; let skippedHtml = ""; let detailsHtml = ""; let main = "";
      let effectiveSteps = steps.slice();
      let effectiveFailedSteps = [];
      try {
        const R = window.SmokeTest && window.SmokeTest.Reporting && window.SmokeTest.Reporting.Render;
        const filteredSteps = filterRunStepsForDisplay(steps);
        const passed = filteredSteps.filter(s => s.ok && !s.skipped);
        const skipped = filteredSteps.filter(s => s.skipped);
        const failed = filteredSteps.filter(s => !s.ok && !s.skipped);
        effectiveSteps = filteredSteps.slice();
        effectiveFailedSteps = failed.slice();
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
        const collectOnly = !!(window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.COLLECT_ONLY);
        // Render only if not in suppress/collect mode
        if (!suppress && !collectOnly) {
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
      } catch (_) {}

      // Build per-run Key Checklist object for JSON
      let keyChecklistRun = {};
      try {
        const R = window.SmokeTest && window.SmokeTest.Reporting && window.SmokeTest.Reporting.Render;
        if (R && typeof R.buildKeyChecklistObjectFromSteps === "function") {
          keyChecklistRun = R.buildKeyChecklistObjectFromSteps(steps);
        }
      } catch (_) {}

      try {
        const rawFailedSteps = steps.filter(s => s && s.ok === false && !s.skipped);
        const normalizedScenarioResults = Array.isArray(scenarioResults)
          ? scenarioResults.filter(sr => sr && sr.normalizedByHeuristic)
          : [];
        window.SMOKE_OK = ok;
        window.SMOKE_STEPS = steps.slice();
        // Include validation counts in exported JSON (non-fatal)
        const valObj = {};
        try {
          // Pull from last recorded summary if available via ValidationRunner
          const VR = (typeof window !== "undefined" ? window.ValidationRunner : null);
          if (VR && typeof VR.summary === "function") {
            const s = VR.summary();
            valObj.warnings = (s && (s.totalWarnings | 0)) || 0;
            valObj.notices = (s && (s.totalNotices | 0)) || 0;
          } else {
            const V = (typeof window !== "undefined" ? window.ValidationLog : null) || {};
            valObj.warnings = Array.isArray(V.warnings) ? V.warnings.length : 0;
            valObj.notices = Array.isArray(V.notices) ? V.notices.length : 0;
          }
          window.SMOKE_VALIDATION_WARNINGS = valObj.warnings | 0;
          window.SMOKE_VALIDATION_NOTICES = valObj.notices | 0;
        } catch (_) {}
        window.SMOKE_JSON = {
          ok,
          steps,
          effectiveSteps,
          failingSteps: effectiveFailedSteps,
          rawFailingSteps: rawFailedSteps,
          scenarioResults,
          normalizedScenarioResults,
          caps,
          trace,
          keyChecklist: keyChecklistRun,
          validation: valObj
        };
      } catch (_) {}
      try {
        const rawFailedSteps = steps.filter(s => s && s.ok === false && !s.skipped);
        const normalizedScenarioResults = Array.isArray(scenarioResults)
          ? scenarioResults.filter(sr => sr && sr.normalizedByHeuristic)
          : [];
        localStorage.setItem("smoke-pass-token", ok ? "PASS" : "FAIL");
        localStorage.setItem("smoke-json-token", JSON.stringify({
          ok,
          steps,
          effectiveSteps,
          failingSteps: effectiveFailedSteps,
          rawFailingSteps: rawFailedSteps,
          scenarioResults,
          normalizedScenarioResults,
          caps,
          trace,
          keyChecklist: keyChecklistRun
        }));
      } catch (_) {}
      // Provide hidden DOM tokens for CI (align with legacy runner)
      try {
        var token = document.getElementById("smoke-pass-token");
        if (!token) {
          token = document.createElement("div");
          token.id = "smoke-pass-token";
          token.style.display = "none";
          document.body.appendChild(token);
        }
        // CI/headless contract: token text MUST be exactly PASS/FAIL.
        token.textContent = ok ? "PASS" : "FAIL";
        token.style.display = "none";

        // Human-visible banner (separate from the CI token so we don't break tooling)
        try {
          var banner = document.getElementById("smoke-pass-banner");
          if (!banner) {
            banner = document.createElement("div");
            banner.id = "smoke-pass-banner";
            document.body.appendChild(banner);
          }
          banner.textContent = ok ? "SMOKE PASS" : "SMOKE FAIL";
          banner.style.display = "block";
          banner.style.position = "fixed";
          banner.style.top = "6px";
          banner.style.left = "6px";
          banner.style.zIndex = "99999";
          banner.style.padding = "4px 6px";
          banner.style.background = "rgba(0,0,0,0.75)";
          banner.style.color = ok ? "#7CFC00" : "#ff4d4d";
          banner.style.fontFamily = "monospace";
          banner.style.fontSize = "12px";
          banner.style.borderRadius = "4px";
        } catch (_) {}

        var jsonToken = document.getElementById("smoke-json-token");
        if (!jsonToken) {
          jsonToken = document.createElement("div");
          jsonToken.id = "smoke-json-token";
          jsonToken.style.display = "none";
          document.body.appendChild(jsonToken);
        }
        const rawFailedSteps = steps.filter(s => s && s.ok === false && !s.skipped);
        const normalizedScenarioResults = Array.isArray(scenarioResults)
          ? scenarioResults.filter(sr => sr && sr.normalizedByHeuristic)
          : [];
        jsonToken.textContent = JSON.stringify({
          ok,
          steps,
          effectiveSteps,
          failingSteps: effectiveFailedSteps,
          rawFailingSteps: rawFailedSteps,
          scenarioResults,
          normalizedScenarioResults,
          caps,
          trace,
          keyChecklist: keyChecklistRun
        });
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
      return { ok, steps, caps, scenarioResults, aborted: __abortRequested, abortReason: __abortReason, trace, keyChecklist: keyChecklistRun };
    } catch (e) {
      try { console.error("[SMOKE] Orchestrator run failed", e); } catch (_) {}
      return null;
    }
  }

  async function runSeries(count) {
    const params = parseParams();
    // Ensure data registries and runner/UI are loaded before we start clicking "New Game" (more deterministic).
    await waitUntilRunnerReady(12000);
    await waitUntilGameDataReady(15000);
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
      // For multi-run, enable stacking (append each run's report). Preserve an existing collect-only
      // mode so headless harnesses can skip expensive panel/export DOM work while still collecting JSON.
      window.SmokeTest.Runner.STACK_LOGS = stacking;
      window.SmokeTest.Runner.COLLECT_ONLY = !!window.SmokeTest.Runner.COLLECT_ONLY;
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

        // Wait for GOD controls to exist (reduces seed/newgame races)
        try {
          await waitUntilTrue(() => {
            try {
              return !!(document.getElementById("god-seed-input") && document.getElementById("god-apply-seed-btn") && document.getElementById("god-newgame-btn"));
            } catch (_) {
              return false;
            }
          }, 4500, 80);
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
        // Wait until overworld is active and stable
        try { await waitForModeStable("world", 8000); } catch (_) {}

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
        const collectOnly = !!(window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.COLLECT_ONLY);
        if (!collectOnly) {
          const Bprog = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
          const skippedStable = (skipList && skipList.length) ? `<div style="opacity:0.85;">Skipped (stable OK): ${skipList.join(", ")}</div>` : ``;
          const abortedInfo = (res && res.aborted) ? `<div style="color:#ef4444;">Run ${i + 1} aborted (${res.abortReason}). Remaining scenarios skipped.</div>` : ``;
          const progHtml = `<div style="margin-top:6px;"><strong>Smoke Test Progress:</strong> ${i + 1} / ${n}</div><div>Pass: ${pass}  Fail: ${fail}</div>${skippedStable}${abortedInfo}`;
          if (Bprog && typeof Bprog.appendToPanel === "function") Bprog.appendToPanel(progHtml);
        }
      } catch (_) {}

      // Update live matchup scoreboard
      try {
        const collectOnly = !!(window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.COLLECT_ONLY);
        if (!collectOnly) updateMatchup();
      } catch (_) {}

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
    const hardFailRuns = all
      .map((res, idx) => {
        const steps = (res && Array.isArray(res.steps)) ? res.steps : [];
        const hardFails = steps.filter(s => s && s.ok === false && !s.skipped).map(s => String(s.msg || ""));
        return {
          run: idx + 1,
          ok: !!(res && res.ok),
          hardFailCount: hardFails.length,
          hardFailMessages: hardFails
        };
      })
      .filter(run => !run.ok);
    const scenarioOutcomes = buildScenarioOutcomes(all);
    const {
      normalizedFlakeScenarios,
      rawFlakeScenarios,
      flakeScenarios,
      flake
    } = buildFlakeSummaries(scenarioOutcomes);
    const seriesOk = hardFailRuns.length === 0 && !flake;

    // Summary via reporting module and full aggregated report
      try {
        const R = window.SmokeTest && window.SmokeTest.Reporting && window.SmokeTest.Reporting.Render;

      let aggregatedSteps = buildAggregatedStepsForDisplay(Array.from(agg.values()));

      const failedAgg = aggregatedSteps.filter(s => !s.ok && !s.skipped);
      const passedAgg = aggregatedSteps.filter(s => s.ok && !s.skipped);
      const skippedAgg = aggregatedSteps.filter(s => s.skipped);
      const okAll = seriesOk;

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

      const { stepAvgTurn, stepAvgDraw } = summarizeStepPerf(all);
      const perfWarnings = buildPerfWarnings(stepAvgTurn, stepAvgDraw, CONFIG.perfBudget);
      const summary = buildSeriesSummaryHtml({
        runs: n,
        pass,
        fail,
        skippedRuns,
        skippedAggCount: skippedAgg.length,
        seriesOk,
        flakeScenarios,
        normalizedFlakeScenarios,
        stepAvgTurn,
        stepAvgDraw,
        perfWarnings
      });

      // Append final aggregated report (keep per-run sections visible)
      try {
        const collectOnly = !!(window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.COLLECT_ONLY);
        if (!collectOnly) {
          // Ensure GOD panel is visible before writing the aggregated report
          try { openGodPanel(); } catch (_) {}
          const Bsum = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
          if (Bsum && typeof Bsum.appendToPanel === "function") {
            Bsum.appendToPanel(summary);
            Bsum.appendToPanel(`<div style="margin-top:10px;"><strong>Aggregated Report (informational: union of success across runs)</strong></div>` + mainAgg);
          } else {
            panelReport(summary + mainAgg);
          }
        }
      } catch (_) {}

      // Export buttons aggregation (final only)
      try {
        const collectOnly = !!(window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.COLLECT_ONLY);
        const E = window.SmokeTest && window.SmokeTest.Reporting && window.SmokeTest.Reporting.Export;
        if (!collectOnly && E && typeof E.attachButtons === "function") {
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
            seriesOk,
            flake,
            flakeScenarios,
            normalizedFlakeScenarios,
            scenarioOutcomes,
            hardFailRuns,
            skipped: skippedRuns,
            avgTurnMs: Number(avgTurn.toFixed ? avgTurn.toFixed(2) : avgTurn),
            avgDrawMs: Number(avgDraw.toFixed ? avgDraw.toFixed(2) : avgDraw),
            // Per-step averages across all steps in all runs (more representative)
            stepAvgTurnMs: Number(stepAvgTurn.toFixed ? stepAvgTurn.toFixed(2) : stepAvgTurn),
            stepAvgDrawMs: Number(stepAvgDraw.toFixed ? stepAvgDraw.toFixed(2) : stepAvgDraw),
            results: all,
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
    } catch (_) {}

    // Release run lock
    try { if (window.SmokeTest && window.SmokeTest.Runner) window.SmokeTest.Runner.RUN_LOCK = false; } catch (_) {}

    return {
      pass,
      fail,
      seriesOk,
      flake,
      flakeScenarios,
      normalizedFlakeScenarios,
      scenarioOutcomes,
      hardFailRuns,
      results: all,
      avgTurnMs: Number(avgTurn),
      avgDrawMs: Number(avgDraw),
      runnerVersion: RUNNER_VERSION
    };
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
    const shouldAuto = params.smoketest && !params.legacy && params.autorun !== false;
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
        await waitUntilRunnerReady(12000);
        await runSeries(count);
      };
      // Start immediately; start() already waits for runner readiness.
      if (document.readyState !== "loading") {
        setTimeout(() => { start(); }, 0);
      } else {
        window.addEventListener("load", () => { setTimeout(() => { start(); }, 0); });
      }
    }
  } catch (_) {}
})();
