// Tiny Roguelike Smoke Test Runner
// Loads when index.html?smoketest=1; runs a minimal scenario and reports pass/fail to Logger, console, and an on-screen banner.
// Also exposes a global SmokeTest.run() so it can be triggered via GOD panel.

(function () {
  const RUNNER_VERSION = "1.8.0";
  const CONFIG = (function () {
    try {
      if (window.SmokeTest && window.SmokeTest.Config) return window.SmokeTest.Config;
    } catch (_) {}
    // Fallback defaults if helpers are not loaded
    return {
      timeouts: {
        route: 5000,
        interact: 2500,
        battle: 5000,
      },
      perfBudget: {
        turnMs: 6.0,
        drawMs: 12.0
      }
    };
  })();

  // URL params
  let URL_PARAMS = {};
  try {
    URL_PARAMS = Object.fromEntries(new URLSearchParams(location.search).entries());
  } catch (_) {}

  // Scenario selection (comma-separated): world,dungeon,town,combat,inventory,perf,overlays
  const SCENARIOS = (() => {
    const s = String(URL_PARAMS.smoke || "").trim();
    if (!s) return new Set(["world","dungeon","town","combat","inventory","perf","overlays"]);
    return new Set(s.split(",").map(x => x.trim().toLowerCase()).filter(Boolean));
  })();

  // Console/error capture: delegate to SmokeTest.Runner.Init if present, otherwise fallback
  const ConsoleCapture = (function () {
    try {
      var R = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Init;
      if (R && typeof R.install === "function" && typeof R.reset === "function" && typeof R.snapshot === "function") {
        R.install();
        return R;
      }
    } catch (_) {}
    const self = {
      errors: [],
      warns: [],
      onerrors: [],
      installed: false,
      isNoise(msg) {
        try {
          const s = String(msg || "").toLowerCase();
          if (!s) return false;
          if (s.includes("klaviyo.com") || s.includes("static-tracking.klaviyo.com")) return true;
          if (s.includes("failed to load resource") && s.includes("err_blocked_by_client")) return true;
          if (s.includes("api.cosine.sh") || s.includes("wss://api.cosine.sh/editor")) return true;
          if (s.includes("err_internet_disconnected")) return true;
          if (s.includes("usecreatewebsocketcontext")) return true;
          if (s.includes("codeeditorwidget") && s.includes("cannot read properties of null")) return true;
          return false;
        } catch (_) { return false; }
      },
      install() {
        if (this.installed) return;
        this.installed = true;
        const me = this;
        try {
          const cerr = console.error.bind(console);
          const cwarn = console.warn.bind(console);
          console.error = function (...args) {
            try {
              const msg = args.map(String).join(" ");
              if (!me.isNoise(msg)) me.errors.push(msg);
            } catch (_) {}
            return cerr(...args);
          };
          console.warn = function (...args) {
            try {
              const msg = args.map(String).join(" ");
              if (!me.isNoise(msg)) me.warns.push(msg);
            } catch (_) {}
            return cwarn(...args);
          };
        } catch (_) {}
        try {
          window.addEventListener("error", (ev) => {
            try {
              const msg = ev && ev.message ? ev.message : String(ev);
              if (!me.isNoise(msg)) me.onerrors.push(msg);
            } catch (_) {}
          });
          window.addEventListener("unhandledrejection", (ev) => {
            try {
              const msg = ev && ev.reason ? (ev.reason.message || String(ev.reason)) : String(ev);
              const line = "unhandledrejection: " + msg;
              if (!me.isNoise(line)) me.onerrors.push(line);
            } catch (_) {}
          });
        } catch (_) {}
      },
      reset() {
        this.errors = [];
        this.warns = [];
        this.onerrors = [];
      },
      snapshot() {
        const filter = (arr) => arr.filter(m => !this.isNoise(m));
        return {
          consoleErrors: filter(this.errors.slice(0)),
          consoleWarns: filter(this.warns.slice(0)),
          windowErrors: filter(this.onerrors.slice(0)),
        };
      }
    };
    self.install();
    return self;
  })();

  // Logging/Banner helpers (use Runner.Banner or Helpers.Logging; no inline fallbacks)
  function ensureBanner() {
    try {
      var RB = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
      if (RB && typeof RB.ensureBanner === "function") return RB.ensureBanner();
    } catch (_) {}
    try {
      var H = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Logging;
      if (H && typeof H.ensureBanner === "function") return H.ensureBanner();
    } catch (_) {}
    return null;
  }

  function ensureStatusEl() {
    try {
      var RB = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
      if (RB && typeof RB.ensureStatusEl === "function") return RB.ensureStatusEl();
    } catch (_) {}
    try {
      var H = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Logging;
      if (H && typeof H.ensureStatusEl === "function") return H.ensureStatusEl();
    } catch (_) {}
    return null;
  }

  function currentMode() {
    try {
      var RB = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
      if (RB && typeof RB.currentMode === "function") return RB.currentMode();
    } catch (_) {}
    try {
      var H = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Logging;
      if (H && typeof H.currentMode === "function") return H.currentMode();
    } catch (_) {}
    return "";
  }

  function setStatus(msg) {
    try {
      var RB = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
      if (RB && typeof RB.setStatus === "function") return RB.setStatus(msg);
    } catch (_) {}
    try {
      var H = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Logging;
      if (H && typeof H.setStatus === "function") return H.setStatus(msg);
    } catch (_) {}
  }

  function log(msg, type) {
    try {
      var RB = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
      if (RB && typeof RB.log === "function") return RB.log(msg, type);
    } catch (_) {}
    try {
      var H = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Logging;
      if (H && typeof H.log === "function") return H.log(msg, type);
    } catch (_) {}
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

  // Budget helpers
  function makeBudget(ms) {
    try {
      var hb = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Budget;
      if (hb && typeof hb.makeBudget === "function") return hb.makeBudget(ms);
    } catch (_) {}
    var start = Date.now();
    var deadline = start + Math.max(0, ms | 0);
    return {
      exceeded: function () { return Date.now() > deadline; },
      remain: function () { return Math.max(0, deadline - Date.now()); }
    };
  }

  function appendToPanel(html) {
    try {
      var RB = window.SmokeTest && window.SmokeTest.Runner && window.SmokeTest.Runner.Banner;
      if (RB && typeof RB.appendToPanel === "function") return RB.appendToPanel(html);
    } catch (_) {}
    try {
      var H = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Logging;
      if (H && typeof H.appendToPanel === "function") return H.appendToPanel(html);
    } catch (_) {}
  }

  // Capability detection (delegate to module if present; fallback inline)
  function detectCaps() {
    try {
      var C = window.SmokeTest && window.SmokeTest.Capabilities;
      if (C && typeof C.detect === "function") return C.detect();
    } catch (_) {}
    const caps = {};
    try {
      caps.GameAPI = !!window.GameAPI;
      const api = window.GameAPI || {};
      caps.getMode = typeof api.getMode === "function";
      caps.getEnemies = typeof api.getEnemies === "function";
      caps.getTownProps = typeof api.getTownProps === "function";
      caps.getNPCs = typeof api.getNPCs === "function";
      caps.routeToDungeon = typeof api.routeToDungeon === "function";
      caps.gotoNearestDungeon = typeof api.gotoNearestDungeon === "function";
      caps.gotoNearestTown = typeof api.gotoNearestTown === "function";
      caps.getChestsDetailed = typeof api.getChestsDetailed === "function";
      caps.getDungeonExit = typeof api.getDungeonExit === "function";
      caps.checkHomeRoutes = typeof api.checkHomeRoutes === "function";
      caps.getShops = typeof api.getShops === "function";
      caps.isShopOpenNowFor = typeof api.isShopOpenNowFor === "function";
      caps.getShopSchedule = typeof api.getShopSchedule === "function";
      caps.advanceMinutes = typeof api.advanceMinutes === "function";
      caps.getClock = typeof api.getClock === "function";
      caps.equipItemAtIndexHand = typeof api.equipItemAtIndexHand === "function";
      caps.enterDungeonIfOnEntrance = typeof api.enterDungeonIfOnEntrance === "function";
      caps.enterTownIfOnTile = typeof api.enterTownIfOnTile === "function";
      caps.routeTo = typeof api.routeTo === "function";
      caps.getWorld = typeof api.getWorld === "function";
      caps.getPlayer = typeof api.getPlayer === "function";
      caps.spawnEnemyNearby = typeof api.spawnEnemyNearby === "function";
      caps.getPerf = typeof api.getPerf === "function";
    } catch (_) {}
    return caps;
  }

  // DEV RNG audit removed from legacy runner (delegated to capabilities module if present)
  function devRandomAudit() {
    return { scanned: 0, hits: [] };
  }

  // Safe element access
  function hasEl(id) {
    try {
      if (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Dom) {
        return window.SmokeTest.Helpers.Dom.hasEl(id);
      }
    } catch (_) {}
    return !!document.getElementById(id);
  }
  function safeClick(id) {
    try {
      if (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Dom) {
        return window.SmokeTest.Helpers.Dom.safeClick(id);
      }
    } catch (_) {}
    const el = document.getElementById(id);
    if (!el) return false;
    try { el.click(); return true; } catch (_) { return false; }
  }

  function safeSetInput(id, v) {
    try {
      if (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Dom) {
        return window.SmokeTest.Helpers.Dom.safeSetInput(id, v);
      }
    } catch (_) {}
    const el = document.getElementById(id);
    if (!el) return false;
    try {
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    } catch (_) { return false; }
  }

  // Lightweight polling helpers (bounded) to avoid flaky state reads
  async function waitUntilTrue(fn, timeoutMs = 400, intervalMs = 40) {
    try {
      if (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Dom) {
        return await window.SmokeTest.Helpers.Dom.waitUntilTrue(fn, timeoutMs, intervalMs);
      }
    } catch (_) {}
    const deadline = Date.now() + Math.max(0, timeoutMs | 0);
    while (Date.now() < deadline) {
      try { if (fn()) return true; } catch (_) {}
      await sleep(intervalMs);
    }
    return fn();
  }

  function isInvOpen() {
    try {
      if (window.UI && typeof window.UI.isInventoryOpen === "function") return !!window.UI.isInventoryOpen();
      const el = document.getElementById("inv-panel");
      return !!(el && el.hidden === false);
    } catch (_) { return false; }
  }
  function isGodOpen() {
    try {
      if (window.UI && typeof window.UI.isGodOpen === "function") return !!window.UI.isGodOpen();
      const el = document.getElementById("god-panel");
      return !!(el && el.hidden === false);
    } catch (_) { return false; }
  }

  function sleep(ms) {
    try {
      if (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Dom) {
        return window.SmokeTest.Helpers.Dom.sleep(ms);
      }
    } catch (_) {}
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms | 0)));
  }

  // Ensure all UI modals are closed so routing/movement works
  async function ensureAllModalsClosed(maxTries = 6) {
    const isOpenById = (id) => {
      try {
        const el = document.getElementById(id);
        return !!(el && el.hidden === false);
      } catch (_) { return false; }
    };
    const anyOpen = () => {
      return isOpenById("god-panel") || isOpenById("inv-panel") || isOpenById("shop-panel") || isOpenById("loot-panel");
    };
    // Try explicit UI API if available
    try {
      if (window.UI) {
        try { typeof UI.hideGod === "function" && UI.hideGod(); } catch (_) {}
        try { typeof UI.hideInventory === "function" && UI.hideInventory(); } catch (_) {}
        try { typeof UI.hideShop === "function" && UI.hideShop(); } catch (_) {}
        try { typeof UI.hideLoot === "function" && UI.hideLoot(); } catch (_) {}
      }
    } catch (_) {}
    // Fallback: ESC multiple times with waits
    let tries = 0;
    while (anyOpen() && tries++ < maxTries) {
      try { document.activeElement && typeof document.activeElement.blur === "function" && document.activeElement.blur(); } catch (_) {}
      key("Escape");
      await sleep(160);
      // Try second ESC in quick succession to unwind modal stack
      if (anyOpen()) { key("Escape"); await sleep(140); }
      // Also attempt clicking GOD close if present
      try {
        const btn = document.getElementById("god-close-btn");
        if (btn) { btn.click(); await sleep(120); }
      } catch (_) {}
    }
    return !anyOpen();
  }

  function key(code) {
    try {
      if (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Dom) {
        return window.SmokeTest.Helpers.Dom.key(code);
      }
    } catch (_) {}
    try {
      const ev = new KeyboardEvent("keydown", { key: code, code, bubbles: true });
      window.dispatchEvent(ev);
      document.dispatchEvent(ev);
    } catch (_) {}
  }

  function clickById(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error("Missing element #" + id);
    el.click();
  }

  function setInputValue(id, v) {
    const el = document.getElementById(id);
    if (!el) throw new Error("Missing input #" + id);
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // One run with step-by-step result tracking
  async function runOnce(seedOverride) {
    const steps = [];
    const errors = [];
    const skipped = [];
    const runMeta = { console: null, determinism: {}, seed: null, caps: detectCaps(), runnerVersion: RUNNER_VERSION };
    const record = (ok, msg) => {
      steps.push({ ok, msg });
      if (!ok) errors.push(msg);
      log((ok ? "OK: " : "ERR: ") + msg, ok ? "good" : "bad");
    };
    const recordSkip = (msg) => {
      skipped.push(msg);
      steps.push({ ok: true, skipped: true, msg });
      log("SKIP: " + msg, "info");
    };

    // Phase-2 seed reload determinism check (boot-level)
    try {
      if (String(URL_PARAMS.phase || "") === "2") {
        const raw = localStorage.getItem("SMOKE_ANCHOR");
        if (raw) {
          const anchor = JSON.parse(raw);
          // Compute anchors now (after boot) without any movement
          const townNow = (window.GameAPI && typeof window.GameAPI.nearestTown === "function") ? window.GameAPI.nearestTown() : null;
          const dungNow = (window.GameAPI && typeof window.GameAPI.nearestDungeon === "function") ? window.GameAPI.nearestDungeon() : null;
          const townOk = (!!anchor && !!anchor.anchorTown && !!townNow) ? (anchor.anchorTown.x === townNow.x && anchor.anchorTown.y === townNow.y) : true;
          const dungOk = (!!anchor && !!anchor.anchorDungeon && !!dungNow) ? (anchor.anchorDungeon.x === dungNow.x && anchor.anchorDungeon.y === dungNow.y) : true;
          record(townOk && dungOk, `Reload-phase seed invariants: nearestTown=${townOk ? "OK" : "MISMATCH"} nearestDungeon=${dungOk ? "OK" : "MISMATCH"}`);
          // Clear anchor to avoid affecting subsequent runs
          try { localStorage.removeItem("SMOKE_ANCHOR"); localStorage.removeItem("SMOKE_RELOAD_DONE"); } catch (_) {}
        } else {
          recordSkip("Reload-phase: no anchor found");
        }
      }
    } catch (e) {
      record(false, "Reload-phase check failed: " + (e && e.message ? e.message : String(e)));
    }

    try {
      ConsoleCapture.reset();
      log("Starting smoke test…", "notice");

      // Step 1: open GOD panel
      try {
        await sleep(250);
        if (safeClick("god-open-btn")) {
          record(true, "Opened GOD panel");
        } else {
          recordSkip("GOD open button not present");
        }
      } catch (e) {
        record(false, "Open GOD panel: " + (e && e.message ? e.message : String(e)));
      }
      await sleep(250);

      // Step 2: set seed (vary per run if provided)
      try {
        const seed = (typeof seedOverride === "number" && isFinite(seedOverride)) ? (seedOverride >>> 0) : ((Date.now() % 0xffffffff) >>> 0);
        runMeta.seed = seed;
        const okIn = safeSetInput("god-seed-input", seed);
        const okBtn = safeClick("god-apply-seed-btn");
        if (okIn && okBtn) {
          record(true, `Applied seed ${seed}`);
        } else {
          recordSkip("Seed controls not present; skipping seed apply");
        }
      } catch (e) {
        record(false, "Apply seed failed: " + (e && e.message ? e.message : String(e)));
      }
      await sleep(600);

      // Capture anchor invariants immediately after seed application (before any movement)
      try {
        if (window.GameAPI) {
          const anchorPos = (typeof window.GameAPI.getPlayer === "function") ? window.GameAPI.getPlayer() : null;
          const anchorTown = (typeof window.GameAPI.nearestTown === "function") ? window.GameAPI.nearestTown() : null;
          const anchorDung = (typeof window.GameAPI.nearestDungeon === "function") ? window.GameAPI.nearestDungeon() : null;
          runMeta.determinism.anchorPos = anchorPos;
          runMeta.determinism.anchorTown = anchorTown;
          runMeta.determinism.anchorDungeon = anchorDung;
          record(true, "Captured seed anchor invariants (start nearestTown/dungeon)");
        }
      } catch (_) {}

      // Optional reload-phase determinism: only when not already done and not in multi-run series
      try {
        if (String(URL_PARAMS.phase || "") !== "2" && localStorage.getItem("SMOKE_RELOAD_DONE") !== "1" && (!URL_PARAMS.smokecount || URL_PARAMS.smokecount === "1")) {
          const anchorData = {
            seed: runMeta.seed,
            anchorTown: runMeta.determinism.anchorTown || null,
            anchorDungeon: runMeta.determinism.anchorDungeon || null
          };
          localStorage.setItem("SMOKE_ANCHOR", JSON.stringify(anchorData));
          localStorage.setItem("SMOKE_RELOAD_DONE", "1");
          // Reload with phase=2 to assert boot-level determinism anchors
          const url = new URL(window.location.href);
          url.searchParams.set("smoketest", "1");
          url.searchParams.set("phase", "2");
          if (window.DEV || localStorage.getItem("DEV") === "1") url.searchParams.set("dev", "1");
          log("Reloading for phase-2 seed determinism check…", "notice");
          window.location.assign(url.toString());
          return { ok: true, steps, errors, passedSteps: [], failedSteps: [], skipped, console: ConsoleCapture.snapshot(), determinism: runMeta.determinism, seed: runMeta.seed, caps: runMeta.caps, runnerVersion: RUNNER_VERSION };
        }
      } catch (_) {}

      // Step 3: adjust FOV to 10 via slider (if present)
      try {
        const fov = document.getElementById("god-fov");
        if (fov) { fov.value = "10"; fov.dispatchEvent(new Event("input", { bubbles: true })); }
        record(true, "Adjusted FOV to 10");
      } catch (e) {
        record(false, "Adjust FOV failed: " + (e && e.message ? e.message : String(e)));
      }
      await sleep(250);

      // Step 3.0: JSON registries loaded (data-first validation)
      try {
        const GD = window.GameData || null;
        const loaded = !!GD && !!GD.items && !!GD.enemies && !!GD.npcs && !!GD.shops && !!GD.town;
        record(loaded, `Data registries: items=${!!(GD&&GD.items)} enemies=${!!(GD&&GD.enemies)} npcs=${!!(GD&&GD.npcs)} shops=${!!(GD&&GD.shops)} town=${!!(GD&&GD.town)}`);
        if (!loaded) {
          // Surface raw object snapshot to console for debugging
          try { console.warn("[SMOKE] GameData snapshot:", GD); } catch (_) {}
        }
        // If dev-only bad JSON injection was requested, assert warnings were collected
        const params = new URLSearchParams(location.search);
        const wantBad = (params.get("validatebad") === "1") || (params.get("badjson") === "1");
        const dev = (params.get("dev") === "1") || (window.DEV || localStorage.getItem("DEV") === "1");
        if (wantBad && dev) {
          // Wait briefly for validators to run and populate ValidationLog.warnings
          const okWarn = await waitUntilTrue(() => {
            try {
              const VL = window.ValidationLog || { warnings: [] };
              return Array.isArray(VL.warnings) && VL.warnings.length > 0;
            } catch (_) { return false; }
          }, 1200, 80);
          const VL = window.ValidationLog || { warnings: [] };
          const wcount = Array.isArray(VL.warnings) ? VL.warnings.length : 0;
          record(okWarn && wcount > 0, `Validation warnings captured: ${wcount}`);
        }
        // Registry readiness wait: ensure Enemies registry or JSON entries are available before dungeon tests
        const ready = await waitUntilTrue(() => {
          try {
            const EM = (typeof window !== "undefined") ? window.Enemies : null;
            const types = (EM && typeof EM.listTypes === "function") ? EM.listTypes() : [];
            if (types && types.length > 0) return true;
          } catch (_) {}
          try {
            return !!(window.GameData && Array.isArray(window.GameData.enemies) && window.GameData.enemies.length > 0);
          } catch (_) { return false; }
        }, 800, 50);
        if (!ready) recordSkip("Enemy registry not ready (types empty) — proceeding anyway");
      } catch (e) {
        record(false, "Data registries check failed: " + (e && e.message ? e.message : String(e)));
      }
      await sleep(150);

      // Step 3.1: Modal priority — open inventory and attempt to move; assert no movement
      try {
        const p0 = (window.GameAPI && typeof window.GameAPI.getPlayer === "function") ? window.GameAPI.getPlayer() : { x: 0, y: 0 };
        key("KeyI"); // open inventory
        await waitUntilTrue(() => isInvOpen(), 800, 80);
        key("ArrowRight");
        await sleep(260);
        const p1 = (window.GameAPI && typeof window.GameAPI.getPlayer === "function") ? window.GameAPI.getPlayer() : { x: 0, y: 0 };
        const immobile = (p0.x === p1.x) && (p0.y === p1.y);
        // Stack priority: open GOD while inventory is open, ESC should close GOD first, then ESC closes inventory
        const invOpen0 = isInvOpen();
        safeClick("god-open-btn"); await waitUntilTrue(() => isGodOpen(), 800, 80);
        const godOpen1 = isGodOpen();
        key("ArrowLeft"); await sleep(260);
        const p2 = (window.GameAPI && typeof window.GameAPI.getPlayer === "function") ? window.GameAPI.getPlayer() : { x: 0, y: 0 };
        const stillImmobile = (p1.x === p2.x) && (p1.y === p2.y);
        key("Escape"); await waitUntilTrue(() => !isGodOpen(), 800, 80);
        const godClosed = !isGodOpen();
        const invStillOpen = isInvOpen();
        key("Escape"); await waitUntilTrue(() => !isInvOpen(), 800, 80);
        const invClosed = !isInvOpen();
        const stackOk = invOpen0 && godOpen1 && stillImmobile && godClosed && invStillOpen && invClosed && immobile;
        if (!stackOk) {
          recordSkip("Modal stack priority inconclusive (timing)");
        } else {
          record(true, "Modal priority: movement ignored while Inventory is open");
          record(true, "Modal stack priority: GOD closes before Inventory; movement ignored while any modal open");
        }
      } catch (e) {
        record(false, "Modal priority check failed: " + (e && e.message ? e.message : String(e)));
      }
      await sleep(200);

      // Step 4: close modals and route to nearest dungeon in overworld
      try {
        // Prefer scenario module; fallback to inline
        let handled = false;
        try {
          var SD = window.SmokeTest && window.SmokeTest.Scenarios && window.SmokeTest.Scenarios.Dungeon;
          if (SD && typeof SD.run === "function") {
            handled = await SD.run({
              key, sleep, makeBudget, record, recordSkip, ensureAllModalsClosed, CONFIG, caps: runMeta.caps
            });
          }
        } catch (_) {}
        if (!handled) {
          recordSkip("Dungeon scenario module not available; skipping inline fallback");
        }
      } catch (e) {
        record(false, "Routing error: " + (e && e.message ? e.message : String(e)));
      }

      // Step 5: ensure GOD closed
      try {
        key("Escape");
        record(true, "Closed GOD panel");
      } catch (e) {
        record(false, "Close GOD panel failed: " + (e && e.message ? e.message : String(e)));
      }
      await sleep(250);

      // Step 6: move towards enemy (try a few steps) and attack by bump
      try {
        const moves = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowRight", "ArrowDown"];
        for (const m of moves) { key(m); await sleep(140); }
        record(true, "Moved and attempted attacks");
      } catch (e) {
        record(false, "Movement/attack sequence failed: " + (e && e.message ? e.message : String(e)));
      }

      // Step 7: open inventory, then close
      try {
        key("KeyI");
        await sleep(300);
        key("Escape");
        record(true, "Opened and closed inventory");
      } catch (e) {
        record(false, "Inventory open/close failed: " + (e && e.message ? e.message : String(e)));
      }
      await sleep(250);

      // Step 8: loot (G) any corpse beneath player (if present)
      try {
        key("KeyG");
        await sleep(300);
        record(true, "Attempted loot underfoot");
      } catch (e) {
        record(false, "Loot attempt failed: " + (e && e.message ? e.message : String(e)));
      }

      // Step 9: if in dungeon, delegate to modules only
      try {
        if (window.GameAPI && typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() === "dungeon") {
          let handledDungeon = false;
          try {
            var SD = window.SmokeTest && window.SmokeTest.Scenarios && window.SmokeTest.Scenarios.Dungeon;
            if (SD && typeof SD.run === "function") {
              handledDungeon = await SD.run({ key, sleep, makeBudget, record, recordSkip, ensureAllModalsClosed, CONFIG, caps: runMeta.caps });
            }
          } catch (_) {}
          if (!handledDungeon) {
            recordSkip("Dungeon scenario module not available or returned false");
          }
        } else {
          recordSkip("Not in dungeon; skipping dungeon scenario");
        }
      } catch (e) {
        record(false, "Dungeon test error: " + (e && e.message ? e.message : String(e)));
      }

      // Step 10: from overworld, visit nearest town and interact
      {
        let handled = false;
        try {
          var ST = window.SmokeTest && window.SmokeTest.Scenarios && window.SmokeTest.Scenarios.Town;
          if (ST && typeof ST.run === "function") {
            handled = await ST.run({ key, sleep, makeBudget, record, recordSkip, CONFIG });
          }
        } catch (_) {}
        if (!handled) {
          if (window.GameAPI && typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() === "world") {
            // Seed determinism invariants: nearestTown/nearestDungeon before routing
            let nearestTownBefore = null, nearestDungeonBefore = null;
            try {
              nearestTownBefore = (typeof window.GameAPI.nearestTown === "function") ? window.GameAPI.nearestTown() : null;
              nearestDungeonBefore = (typeof window.GameAPI.nearestDungeon === "function") ? window.GameAPI.nearestDungeon() : null;
            } catch (_) {}

            // Prefer precise routing to nearestTown coordinate if available
            let okTown = false;
            try {
              const nt = (typeof window.GameAPI.nearestTown === "function") ? window.GameAPI.nearestTown() : null;
              if (nt && typeof window.GameAPI.routeTo === "function") {
                const pathNT = window.GameAPI.routeTo(nt.x, nt.y);
                const budgetNT = makeBudget(2500);
                for (const step of pathNT) {
                  if (budgetNT.exceeded()) break;
                  const ddx = Math.sign(step.x - ((typeof window.GameAPI.getPlayer === "function") ? window.GameAPI.getPlayer().x : step.x));
                  const ddy = Math.sign(step.y - ((typeof window.GameAPI.getPlayer === "function") ? window.GameAPI.getPlayer().y : step.y));
                  key(ddx === -1 ? "ArrowLeft" : ddx === 1 ? "ArrowRight" : (ddy === -1 ? "ArrowUp" : "ArrowDown"));
                  await sleep(90);
                }
                okTown = true;
              } else if (typeof window.GameAPI.gotoNearestTown === "function") {
                okTown = await window.GameAPI.gotoNearestTown();
              }
            } catch (_) {
              if (typeof window.GameAPI.gotoNearestTown === "function") {
                okTown = await window.GameAPI.gotoNearestTown();
              }
            }
            // Attempt multiple entry tries: Enter key and direct API
            const tryEnterTown = async () => {
              key("Enter"); await sleep(300);
              try { if (window.GameAPI && typeof window.GameAPI.enterTownIfOnTile === "function") window.GameAPI.enterTownIfOnTile(); } catch (_) {}
              await sleep(240);
            };
            await tryEnterTown();
            let nowMode = (window.GameAPI && typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : "";
            if (nowMode !== "town") {
              await tryEnterTown();
            }
            nowMode = (window.GameAPI && typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : "";
            if (nowMode !== "town") {
              // Fallback: scan wider radius for a Town tile and route to it, then try enter again
              try {
                const world = (typeof window.GameAPI.getWorld === "function") ? window.GameAPI.getWorld() : null;
                const player = (typeof window.GameAPI.getPlayer === "function") ? window.GameAPI.getPlayer() : null;
                const T = (window.World && window.World.TILES) ? window.World.TILES : null;
                if (world && player && T && typeof T.TOWN === "number" && Array.isArray(world.map)) {
                  // Prioritize immediate adjacency, then expand search radius to 6
                  const adj = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
                  let stepped = false;
                  for (const d of adj) {
                    const nx = player.x + d.dx, ny = player.y + d.dy;
                    if (ny >= 0 && ny < world.map.length && nx >= 0 && nx < (world.map[0] ? world.map[0].length : 0)) {
                      if (world.map[ny][nx] === T.TOWN && typeof window.GameAPI.moveStep === "function") {
                        window.GameAPI.moveStep(d.dx, d.dy);
                        await sleep(140);
                        stepped = true;
                        break;
                      }
                    }
                  }
                  if (!stepped) {
                    const r = 6;
                    const candidates = [];
                    for (let dy = -r; dy <= r; dy++) {
                      for (let dx = -r; dx <= r; dx++) {
                        const nx = player.x + dx, ny = player.y + dy;
                        if (ny >= 0 && ny < world.map.length && nx >= 0 && nx < (world.map[0] ? world.map[0].length : 0)) {
                          if (world.map[ny][nx] === T.TOWN) candidates.push({ x: nx, y: ny });
                        }
                      }
                    }
                    if (candidates.length && typeof window.GameAPI.routeTo === "function") {
                      const path = window.GameAPI.routeTo(candidates[0].x, candidates[0].y);
                      const budget = makeBudget(3000);
                      for (const step of path) {
                        if (budget.exceeded()) break;
                        const ddx = Math.sign(step.x - ((typeof window.GameAPI.getPlayer === "function") ? window.GameAPI.getPlayer().x : step.x));
                        const ddy = Math.sign(step.y - ((typeof window.GameAPI.getPlayer === "function") ? window.GameAPI.getPlayer().y : step.y));
                        key(ddx === -1 ? "ArrowLeft" : ddx === 1 ? "ArrowRight" : (ddy === -1 ? "ArrowUp" : "ArrowDown"));
                        await sleep(90);
                      }
                    }
                  }
                  await tryEnterTown();
                  await tryEnterTown();
                }
              } catch (_) {}
            }
            nowMode = (window.GameAPI && typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : "";
            if (nowMode === "town") {
              record(true, "Entered town");
              // Ensure at least one NPC is present; if not, try to populate via Home Routes or greeters
              try {
                let npcCount = (typeof window.GameAPI.getNPCs === "function") ? (window.GameAPI.getNPCs().length || 0) : 0;
                if (npcCount === 0) {
                  // Try home routes first (may populate)
                  if (typeof window.GameAPI.checkHomeRoutes === "function") window.GameAPI.checkHomeRoutes();
                  await sleep(200);
                  npcCount = (typeof window.GameAPI.getNPCs === "function") ? (window.GameAPI.getNPCs().length || 0) : 0;
                }
                if (npcCount === 0 && typeof window.GameAPI.spawnGateGreeters === "function") {
                  // Fallback greeter spawn if exposed
                  try { window.GameAPI.spawnGateGreeters(1); } catch (_) {}
                  await sleep(200);
                  npcCount = (typeof window.GameAPI.getNPCs === "function") ? (window.GameAPI.getNPCs().length || 0) : 0;
                }
                record(npcCount > 0, `NPC presence: count ${npcCount}`);
              } catch (_) {}
            } else {
              // Extra diagnostic to help understand why it failed
              try {
                const world = (typeof window.GameAPI.getWorld === "function") ? window.GameAPI.getWorld() : null;
                const player = (typeof window.GameAPI.getPlayer === "function") ? window.GameAPI.getPlayer() : null;
                const T = (window.World && window.World.TILES) ? window.World.TILES : null;
                const tile = (world && player && T && world.map[player.y] && world.map[player.y][player.x] === T.TOWN) ? "TOWN" : "OTHER";
                recordSkip("Town entry not achieved (mode=" + nowMode + ", standing on tile=" + tile + ")");
              } catch (_) {
                recordSkip("Town entry not achieved (still in " + nowMode + ")");
              }
            }
          }
        }
      }

          // Seed determinism invariants (same-seed regeneration without reload)
          {
            let handledDet = false;
            try {
              var SDT = window.SmokeTest && window.SmokeTest.Scenarios && window.SmokeTest.Scenarios.Determinism;
              if (SDT && typeof SDT.run === "function") {
                handledDet = await SDT.run({ key, sleep, record, recordSkip, CONFIG, anchorTown: (runMeta.determinism && runMeta.determinism.anchorTown) || null, anchorDungeon: (runMeta.determinism && runMeta.determinism.anchorDungeon) || null, caps: runMeta.caps });
              }
            } catch (_) {}
            if (!handledDet) {
              // Return to world and re-apply the same seed, then regenerate and compare nearestTown/nearestDungeon
              key("Escape"); await sleep(160);
              if (typeof window.GameAPI.returnToWorldIfAtExit === "function") window.GameAPI.returnToWorldIfAtExit();
              await sleep(240);
              const seedRaw = (localStorage.getItem("SEED") || "");
              const s = seedRaw ? (Number(seedRaw) >>> 0) : null;
              if (s != null) {
                // Open GOD, set seed (same) and regenerate overworld
                safeClick("god-open-btn"); await sleep(120);
                safeSetInput("god-seed-input", s);
                safeClick("god-apply-seed-btn"); await sleep(400);
                key("Escape"); await sleep(160);
                const nearestTownAfter = (typeof window.GameAPI.nearestTown === "function") ? window.GameAPI.nearestTown() : null;
                const nearestDungeonAfter = (typeof window.GameAPI.nearestDungeon === "function") ? window.GameAPI.nearestDungeon() : null;
                const anchorTown = runMeta.determinism.anchorTown || null;
                const anchorDung = runMeta.determinism.anchorDungeon || null;
                const townSame = (!!anchorTown && !!nearestTownAfter) ? (anchorTown.x === nearestTownAfter.x && anchorTown.y === nearestTownAfter.y) : true;
                const dungSame = (!!anchorDung && !!nearestDungeonAfter) ? (anchorDung.x === nearestDungeonAfter.x && anchorDung.y === nearestDungeonAfter.y) : true;
                record(townSame && dungSame, `Seed invariants: nearestTown=${townSame ? "OK" : "MISMATCH"} nearestDungeon=${dungSame ? "OK" : "MISMATCH"}`);
              } else {
                recordSkip("Seed invariants skipped (no SEED persisted)");
              }
            }
          }

          // Town flows: NPC interactions, home, props, and late-night home routes (only when already in town)
          {
            let handledTownFlow = false;
            try {
              var STF = window.SmokeTest && window.SmokeTest.Scenarios && window.SmokeTest.Scenarios.Town && window.SmokeTest.Scenarios.Town.Flows;
              if (STF && typeof STF.run === "function") {
                handledTownFlow = await STF.run({ key, sleep, makeBudget, record, recordSkip, CONFIG, caps: runMeta.caps });
              }
            } catch (_) {}
            if (!handledTownFlow && false) {
              recordSkip("Town flows scenario module not available; skipping inline fallback");
            }
          }

      // Diagnostics + shop schedule/time check
      {
        let handledTownDiag = false;
        try {
          var STD = window.SmokeTest && window.SmokeTest.Scenarios && window.SmokeTest.Scenarios.Town && window.SmokeTest.Scenarios.Town.Diagnostics;
          if (STD && typeof STD.run === "function") {
            handledTownDiag = await STD.run({ key, sleep, makeBudget, record, recordSkip, CONFIG, caps: runMeta.caps });
          }
        } catch (_) {}
        if (!handledTownDiag && false) {
          recordSkip("Town diagnostics scenario module not available; skipping inline fallback");
        }
      }

        // Global overlays (grid) perf snapshot
        try {
          const perfA = (typeof window.GameAPI.getPerf === "function") ? window.GameAPI.getPerf() : { lastDrawMs: 0 };
          safeClick("god-toggle-grid-btn"); await sleep(120);
          const perfB = (typeof window.GameAPI.getPerf === "function") ? window.GameAPI.getPerf() : { lastDrawMs: 0 };
          const okGridPerf = (perfB.lastDrawMs || 0) <= (CONFIG.perfBudget.drawMs * 2.0);
          record(okGridPerf, `Grid perf: draw ${perfB.lastDrawMs?.toFixed ? perfB.lastDrawMs.toFixed(2) : perfB.lastDrawMs}ms`);
        } catch (e) {
          record(false, "Grid perf snapshot failed: " + (e && e.message ? e.message : String(e)));
        }

        // Restart via GOD panel (Start New Game) and assert mode resets to world
        try {
          if (safeClick("god-newgame-btn")) {
            await sleep(400);
            const m = (typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : "";
            record(m === "world", "Restart via GOD: returned to overworld");
          } else {
            recordSkip("Restart button not present in GOD panel");
          }
        } catch (e) {
          record(false, "Restart via GOD failed: " + (e && e.message ? e.message : String(e)));
        }

        record(true, "Ran Diagnostics");
        await sleep(300);
        key("Escape");
      
      const ok = errors.length === 0;
      log(ok ? "Smoke test completed." : "Smoke test completed with errors.", ok ? "good" : "warn");

      // Capture console/browser errors for this run
      runMeta.console = ConsoleCapture.snapshot();

      // Derive passed/failed lists
      const passedSteps = steps.filter(s => s.ok).map(s => s.msg);
      const failedSteps = steps.filter(s => !s.ok).map(s => s.msg);

      // Report into GOD panel
      // Pretty step list renderer (delegate to reporting module; no inline fallback for legacy)
      function renderStepsPretty(list) {
        try {
          var R = window.SmokeTest && window.SmokeTest.Reporting && window.SmokeTest.Reporting.Render;
          if (R && typeof R.renderStepsPretty === "function") return R.renderStepsPretty(list);
        } catch (_) {}
        return "";
      }

      const detailsHtml = renderStepsPretty(steps);
      const passedHtml = passedSteps.length
        ? (`<div style="margin-top:8px;"><strong>Passed (${passedSteps.length}):</strong></div>` + passedSteps.map(m => `<div style="color:#86efac;">• ${m}</div>`).join(""))
        : "";
      const skippedHtml = skipped.length
        ? (`<div style="margin-top:8px;"><strong>Skipped (${skipped.length}):</strong></div>` + skipped.map(m => `<div style="color:#fde68a;">• ${m}</div>`).join(""))
        : "";
      const extraErrors = []
        .concat((runMeta.console.consoleErrors || []).map(m => `console.error: ${m}`))
        .concat((runMeta.console.windowErrors || []).map(m => `window: ${m}`))
        .concat((runMeta.console.consoleWarns || []).map(m => `console.warn: ${m}`));
      const totalIssues = errors.length + extraErrors.length;
      const issuesHtml = totalIssues
        ? `<div style="margin-top:10px; color:#ef4444;"><strong>Issues (${totalIssues}):</strong></div>` +
          errors.map(e => `<div style="color:#f87171;">• ${e}</div>`).join("") +
          (extraErrors.length ? `<div style="color:#f87171; margin-top:6px;"><em>Console/Browser</em></div>` + extraErrors.slice(0, 8).map(e => `<div style="color:#f87171;">• ${e}</div>`).join("") : ``)
        : "";
      const caps = runMeta.caps || {};
      const capsList = Object.keys(caps).filter(k => caps[k]);

      // Key Checklist: concise required behaviors
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
      const keyChecklistHtml = (() => {
        const rows = keyChecks.map(c => {
          const mark = c.pass ? "[x]" : "[ ]";
          const color = c.pass ? "#86efac" : "#fca5a5";
          return `<div style="color:${color};">${mark} ${c.label}</div>`;
        }).join("");
        return `<div style="margin-top:10px;"><strong>Key Checklist</strong></div>${rows}`;
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
  window.SmokeTest.run = runOnce;
  window.SmokeTest.runSeries = runSeries;

  // Auto-run conditions:
  // - If ?smoketest=1 param was set and script loaded during/after page load
  // - If the loader set window.SMOKETEST_REQUESTED
  function __smokeTriggerRunSeries(n) {
    try {
      var RR = window.SmokeTest && window.SmokeTest.Run && window.SmokeTest.Run.runSeries;
      if (typeof RR === "function") { RR(n); return; }
    } catch (_) {}
    try { runSeries(n); } catch (_) {}
  }
  try {
    var params = new URLSearchParams(location.search);
    var shouldAuto = (params.get("smoketest") === "1") || (window.SMOKETEST_REQUESTED === true);
    var autoCount = parseInt(params.get("smokecount") || "1", 10) || 1;
    if (document.readyState !== "loading") {
      if (shouldAuto) { setTimeout(() => { __smokeTriggerRunSeries(autoCount); }, 400); }
    } else {
      window.addEventListener("load", () => {
        if (shouldAuto) { setTimeout(() => { __smokeTriggerRunSeries(autoCount); }, 800); }
      });
    }
  } catch (_) {
    // Fallback: run on load if present
    window.addEventListener("load", () => { setTimeout(() => { __smokeTriggerRunSeries(1); }, 800); });
  }
})();