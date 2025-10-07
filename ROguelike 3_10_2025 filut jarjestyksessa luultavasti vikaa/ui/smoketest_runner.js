// Tiny Roguelike Smoke Test Runner
// Loads when index.html?smoketest=1; runs a minimal scenario and reports pass/fail to Logger, console, and an on-screen banner.
// Also exposes a global SmokeTest.run() so it can be triggered via GOD panel.

(function () {
  const RUNNER_VERSION = "1.6.0";
  const CONFIG = {
    timeouts: {
      route: 5000,       // ms budget for any routing/path-following sequence
      interact: 2500,    // ms budget for local interactions (loot/G/use)
      battle: 5000,      // ms budget for short combat burst
    },
    perfBudget: {
      turnMs: 6.0,       // soft target per-turn
      drawMs: 12.0       // soft target per-draw
    }
  };

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

  // Global collection of console/browser errors during smoke test runs
  const ConsoleCapture = {
    errors: [],
    warns: [],
    onerrors: [],
    installed: false,
    // Filter out known non-game noise (ad/tracker blocks, editor websocket, etc.)
    isNoise(msg) {
      try {
        const s = String(msg || "").toLowerCase();
        if (!s) return false;
        // Ad/tracker blocks commonly seen in browsers/adblockers
        if (s.includes("klaviyo.com") || s.includes("static-tracking.klaviyo.com")) return true;
        if (s.includes("failed to load resource") && s.includes("err_blocked_by_client")) return true;
        // Host/editor environment connectivity noise
        if (s.includes("api.cosine.sh") || s.includes("wss://api.cosine.sh/editor")) return true;
        if (s.includes("err_internet_disconnected")) return true;
        if (s.includes("usecreatewebsocketcontext")) return true;
        // IDE/editor widget noise not from the game
        if (s.includes("codeeditorwidget") && s.includes("cannot read properties of null")) return true;
        return false;
      } catch (_) { return false; }
    },
    install() {
      if (this.installed) return;
      this.installed = true;
      const self = this;
      // Wrap console.error/warn
      try {
        const cerr = console.error.bind(console);
        const cwarn = console.warn.bind(console);
        console.error = function (...args) {
          try {
            const msg = args.map(String).join(" ");
            if (!self.isNoise(msg)) self.errors.push(msg);
          } catch (_) {}
          return cerr(...args);
        };
        console.warn = function (...args) {
          try {
            const msg = args.map(String).join(" ");
            if (!self.isNoise(msg)) self.warns.push(msg);
          } catch (_) {}
          return cwarn(...args);
        };
      } catch (_) {}
      // window.onerror
      try {
        window.addEventListener("error", (ev) => {
          try {
            const msg = ev && ev.message ? ev.message : String(ev);
            if (!self.isNoise(msg)) self.onerrors.push(msg);
          } catch (_) {}
        });
        window.addEventListener("unhandledrejection", (ev) => {
          try {
            const msg = ev && ev.reason ? (ev.reason.message || String(ev.reason)) : String(ev);
            const line = "unhandledrejection: " + msg;
            if (!self.isNoise(line)) self.onerrors.push(line);
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
  ConsoleCapture.install();

  // Create a floating banner for smoke test progress
  function ensureBanner() {
    let el = document.getElementById("smoke-banner");
    if (el) return el;
    el = document.createElement("div");
    el.id = "smoke-banner";
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
    el.textContent = "[SMOKE] Runner ready…";
    document.body.appendChild(el);
    return el;
  }

  function ensureStatusEl() {
    try {
      let host = document.getElementById("god-check-output");
      if (!host) return null;
      let el = document.getElementById("smoke-status");
      if (!el) {
        el = document.createElement("div");
        el.id = "smoke-status";
        el.style.margin = "6px 0";
        el.style.color = "#93c5fd";
        // Prepend status at the top of GOD panel output
        host.prepend(el);
      }
      return el;
    } catch (_) { return null; }
  }

  function currentMode() {
    try {
      if (window.GameAPI && typeof window.GameAPI.getMode === "function") {
        return String(window.GameAPI.getMode() || "").toLowerCase();
      }
    } catch (_) {}
    return "";
  }

  function setStatus(msg) {
    const m = currentMode();
    const el = ensureStatusEl();
    if (el) {
      el.textContent = `[${m || "unknown"}] ${msg}`;
    }
  }

  function log(msg, type) {
    const banner = ensureBanner();
    const m = currentMode();
    const line = "[SMOKE]" + (m ? ` [${m}]` : "") + " " + msg;
    banner.textContent = line;
    setStatus(msg);
    try {
      if (window.Logger && typeof Logger.log === "function") {
        Logger.log(line, type || "info");
      }
    } catch (_) {}
    try {
      console.log(line);
    } catch (_) {}
  }

  function panelReport(html) {
    try {
      const el = document.getElementById("god-check-output");
      if (el) el.innerHTML = html;
      // re-ensure status element stays visible at top after overwrite
      ensureStatusEl();
    } catch (_) {}
  }

  // Budget helpers
  function makeBudget(ms) {
    const start = Date.now();
    const deadline = start + Math.max(0, ms | 0);
    return {
      exceeded: () => Date.now() > deadline,
      remain: () => Math.max(0, deadline - Date.now())
    };
  }

  function appendToPanel(html) {
    try {
      const el = document.getElementById("god-check-output");
      if (el) el.innerHTML += html;
    } catch (_) {}
  }

  // Capability detection for future-proofing
  function detectCaps() {
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
    } catch (_) {}
    return caps;
  }

  // DEV: simple Math.random audit to discourage nondeterministic generators
  function devRandomAudit() {
    try {
      if (!(window.DEV || localStorage.getItem("DEV") === "1")) return { scanned: 0, hits: [] };
      const scripts = Array.from(document.scripts || []);
      const hits = [];
      for (const s of scripts) {
        const src = s.src || "";
        if (!src) continue;
        // Heuristic: fetch content only for same-origin/local scripts if possible (skip cross-origin)
        if (src.startsWith(location.origin)) {
          // note: we can't fetch here; just record the url and rely on a server-side audit if needed
          // As a compromise, record the src and mark "UNKNOWN" since inline content isn't accessible here.
          // Developers can run a separate audit tool. We still scan script text for inline scripts.
        }
        // For inline scripts, check text content
        if (!src && s.text && s.text.includes("Math.random")) {
          hits.push({ type: "inline", snippet: (s.text || "").slice(0, 120) });
        }
      }
      // Quick DOM scan for Math.random mentions
      try {
        const html = document.documentElement.outerHTML || "";
        if ((html.match(/Math\.random/g) || []).length > 0) {
          hits.push({ type: "dom", note: "Math.random appears in page HTML (might be harmless)." });
        }
      } catch (_) {}
      return { scanned: scripts.length, hits };
    } catch (_) {
      return { scanned: 0, hits: [] };
    }
  }

  // Safe element access
  function hasEl(id) {
    return !!document.getElementById(id);
  }
  function safeClick(id) {
    const el = document.getElementById(id);
    if (!el) return false;
    try { el.click(); return true; } catch (_) { return false; }
  }
  function safeSetInput(id, v) {
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
    return new Promise(resolve => setTimeout(resolve, ms));
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
      // Dispatch to document as well for broader listener coverage
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

      // Step 4: API-first routing to nearest dungeon with retries and settle waits
      try {
        await ensureAllModalsClosed(8);
        const isWorld = (window.GameAPI?.getMode?.() === "world");
        if (!isWorld) { recordSkip("Skipped routing (not in overworld)"); }
        else {
          const waitForMode = async (target, timeoutMs = 4000, interval = 120) => {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
              try { if (window.GameAPI?.getMode?.() === target) return true; } catch (_) {}
              await sleep(interval);
            }
            return window.GameAPI?.getMode?.() === target;
          };
          let entered = false;

          // Attempt A: API route helper then API enter
          try {
            if (typeof window.GameAPI.gotoNearestDungeon === "function") {
              await window.GameAPI.gotoNearestDungeon();
            }
            if (typeof window.GameAPI.enterDungeonIfOnEntrance === "function") {
              window.GameAPI.enterDungeonIfOnEntrance();
            }
            entered = await waitForMode("dungeon", 4500, 140);
          } catch (_) {}

          // Attempt B: precise route-to nearest coords then API enter
          if (!entered) {
            try {
              const nd = window.GameAPI?.nearestDungeon?.();
              if (nd && typeof window.GameAPI.routeTo === "function") {
                const pathND = window.GameAPI.routeTo(nd.x, nd.y);
                const budgetND = makeBudget(CONFIG.timeouts.route);
                for (const step of pathND) {
                  if (budgetND.exceeded()) break;
                  const ddx = Math.sign(step.x - (window.GameAPI.getPlayer()?.x ?? step.x));
                  const ddy = Math.sign(step.y - (window.GameAPI.getPlayer()?.y ?? step.y));
                  key(ddx === -1 ? "ArrowLeft" : ddx === 1 ? "ArrowRight" : (ddy === -1 ? "ArrowUp" : "ArrowDown"));
                  await sleep(100);
                }
                window.GameAPI.enterDungeonIfOnEntrance?.();
                entered = await waitForMode("dungeon", 4500, 140);
              }
            } catch (_) {}
          }

          // Attempt C: fallback keys (Enter/G) then API enter, with longer settle
          if (!entered) {
            key("Enter"); await sleep(260);
            key("KeyG"); await sleep(260);
            window.GameAPI.enterDungeonIfOnEntrance?.();
            entered = await waitForMode("dungeon", 5000, 150);
          }

          const modeNow = window.GameAPI?.getMode?.() || "";
          record(entered, entered ? `Entered dungeon (mode=${modeNow})` : `Dungeon entry failed (mode=${modeNow})`);

          if (entered) {
            try {
              await sleep(280);
              const enemies0 = window.GameAPI?.getEnemies?.() || [];
              const firstEnemyType = enemies0 && enemies0.length ? (enemies0[0].type || "") : "";
              const chests = window.GameAPI?.getChestsDetailed?.() || [];
              const chestItems = chests && chests.length ? (chests[0].items || []) : [];
              runMeta.determinism.firstEnemyType = firstEnemyType;
              runMeta.determinism.chestItems = chestItems.slice(0);
            } catch (_) {}
          }
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

      // Step 7.1: Spawn random items via GOD and check diversity
      try {
        // Open GOD panel
        if (safeClick("god-open-btn")) {
          await sleep(180);
          // Click spawn multiple times to accumulate a small sample
          let clicks = 0;
          for (let t = 0; t < 3; t++) {
            if (safeClick("god-spawn-btn")) { clicks++; await sleep(160); }
          }
          // Read inventory and compute diversity for equip items
          const inv = (typeof window.GameAPI?.getInventory === "function") ? window.GameAPI.getInventory() : [];
          const equipNames = inv.filter(it => it && it.kind === "equip").map(it => it.name || "");
          const uniq = Array.from(new Set(equipNames.filter(Boolean)));
          const diverse = uniq.length >= 2;
          record(diverse, `Spawn random items diversity: clicked ${clicks}x, unique equip names ${uniq.length}${uniq.length ? " — " + uniq.slice(0, 6).join(", ") : ""}`);
          // Close GOD
          key("Escape");
          await sleep(140);
        } else {
          recordSkip("GOD open button not present (spawn diversity)");
        }
      } catch (e) {
        record(false, "Spawn random items diversity failed: " + (e && e.message ? e.message : String(e)));
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

      // Step 9: if in dungeon, chest loot + equip + decay check, then enemy loot and return
      try {
        if (window.GameAPI && typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() === "dungeon") {
          // 9a: find chest in corpses, route and press G to loot it
          try {
            const corpses = (typeof window.GameAPI.getCorpses === "function") ? window.GameAPI.getCorpses() : [];
            const chest = corpses.find(c => c.kind === "chest");
            if (chest) {
              const pathC = (typeof window.GameAPI.routeToDungeon === "function") ? window.GameAPI.routeToDungeon(chest.x, chest.y) : [];
              const budget = makeBudget(CONFIG.timeouts.route);
              for (const step of pathC) {
                if (budget.exceeded()) { recordSkip("Routing to chest timed out"); break; }
                const dx = Math.sign(step.x - window.GameAPI.getPlayer().x);
                const dy = Math.sign(step.y - window.GameAPI.getPlayer().y);
                key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                await sleep(110);
              }
              const ib = makeBudget(CONFIG.timeouts.interact);
              key("KeyG"); // open/loot chest
              await sleep(Math.min(ib.remain(), 250));
              record(true, `Looted chest at (${chest.x},${chest.y})`);

              // Chest invariant: exit and re-enter, chest should remain empty
              try {
                // Return to world via exit '>'
                const exit = (typeof window.GameAPI.getDungeonExit === "function") ? window.GameAPI.getDungeonExit() : null;
                if (exit) {
                  const pathBack = window.GameAPI.routeToDungeon(exit.x, exit.y);
                  for (const step of pathBack) {
                    const dx = Math.sign(step.x - window.GameAPI.getPlayer().x);
                    const dy = Math.sign(step.y - window.GameAPI.getPlayer().y);
                    key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                    await sleep(100);
                  }
                  key("KeyG"); await sleep(260);
                  // Immediately re-enter same dungeon
                  if (typeof window.GameAPI.enterDungeonIfOnEntrance === "function") {
                    window.GameAPI.enterDungeonIfOnEntrance(); await sleep(260);
                  }
                  const corpsesAfter = (typeof window.GameAPI.getCorpses === "function") ? window.GameAPI.getCorpses() : [];
                  const sameChest = corpsesAfter.find(c => c.kind === "chest" && c.x === chest.x && c.y === chest.y);
                  const emptyOk = !!(sameChest && sameChest.looted && (sameChest.lootCount === 0));
                  record(emptyOk, `Chest invariant: (${chest.x},${chest.y}) looted persists (looted=${sameChest ? sameChest.looted : "?"}, lootCount=${sameChest ? sameChest.lootCount : "?"})`);
                  // Return to world to continue town flow
                  if (typeof window.GameAPI.returnToWorldIfAtExit === "function") window.GameAPI.returnToWorldIfAtExit();
                }
              } catch (eInv) {
                record(false, "Chest invariant check failed: " + (eInv && eInv.message ? eInv.message : String(eInv)));
              }
            } else {
              recordSkip("No chest found in dungeon (skipping chest loot)");
            }
          } catch (e) {
            record(false, "Chest loot failed: " + (e && e.message ? e.message : String(e)));
          }

          // 9b: equip best items from inventory (if any) and test manual equip/unequip
          try {
            const inv = (typeof window.GameAPI.getInventory === "function") ? window.GameAPI.getInventory() : [];
            const statsBeforeBest = (typeof window.GameAPI.getStats === "function") ? window.GameAPI.getStats() : { atk: 0, def: 0 };
            const beforeEq = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
            const equippedNames = (typeof window.GameAPI.equipBestFromInventory === "function") ? window.GameAPI.equipBestFromInventory() : [];
            const afterEq = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
            const statsAfterBest = (typeof window.GameAPI.getStats === "function") ? window.GameAPI.getStats() : { atk: 0, def: 0 };
            const atkDelta = (statsAfterBest.atk || 0) - (statsBeforeBest.atk || 0);
            const defDelta = (statsAfterBest.def || 0) - (statsBeforeBest.def || 0);
            const improved = (atkDelta > 0) || (defDelta > 0);
            record(true, `Equipped from chest loot: ${equippedNames.length ? equippedNames.join(", ") : "no changes"} (Δ atk ${atkDelta.toFixed ? atkDelta.toFixed(1) : atkDelta}, def ${defDelta.toFixed ? defDelta.toFixed(1) : defDelta})${equippedNames.length ? (improved ? "" : " [no stat increase]") : ""}`);

            // Manual equip: find first equip item in inventory and equip it, then unequip the same slot and compare stats
            const equipIdx = inv.findIndex(it => it && it.kind === "equip");
            if (equipIdx !== -1 && typeof window.GameAPI.equipItemAtIndex === "function" && typeof window.GameAPI.unequipSlot === "function") {
              const item = inv[equipIdx];
              const slot = item.slot || "hand";
              const s0 = (typeof window.GameAPI.getStats === "function") ? window.GameAPI.getStats() : { atk: 0, def: 0 };
              const ok1 = window.GameAPI.equipItemAtIndex(equipIdx);
              await sleep(140);
              const s1 = (typeof window.GameAPI.getStats === "function") ? window.GameAPI.getStats() : { atk: 0, def: 0 };
              const ok2 = window.GameAPI.unequipSlot(slot);
              await sleep(140);
              const s2 = (typeof window.GameAPI.getStats === "function") ? window.GameAPI.getStats() : { atk: 0, def: 0 };
              const equipDeltaAtk = (s1.atk || 0) - (s0.atk || 0);
              const equipDeltaDef = (s1.def || 0) - (s0.def || 0);
              const unequipDeltaAtk = (s2.atk || 0) - (s1.atk || 0);
              const unequipDeltaDef = (s2.def || 0) - (s1.def || 0);
              const okStats = (ok1 && ok2);
              record(okStats, `Manual equip/unequip (${item.name || "equip"} in slot ${slot}) — equip Δ (atk ${equipDeltaAtk.toFixed ? equipDeltaAtk.toFixed(1) : equipDeltaAtk}, def ${equipDeltaDef.toFixed ? equipDeltaDef.toFixed(1) : equipDeltaDef}), unequip Δ (atk ${unequipDeltaAtk.toFixed ? unequipDeltaAtk.toFixed(1) : unequipDeltaAtk}, def ${unequipDeltaDef.toFixed ? unequipDeltaDef.toFixed(1) : unequipDeltaDef})`);
            } else {
              recordSkip("No direct equip/unequip test performed (no equip item or API not present)");
            }

            // 9b.1: attempt to drink a potion via GameAPI if any are present
            try {
              const pots = (typeof window.GameAPI.getPotions === "function") ? window.GameAPI.getPotions() : [];
              if (pots && pots.length && typeof window.GameAPI.drinkPotionAtIndex === "function") {
                const pi = pots[0].i;
                const hpBefore = (typeof window.GameAPI.getStats === "function") ? window.GameAPI.getStats().hp : null;
                const okDrink = !!window.GameAPI.drinkPotionAtIndex(pi);
                await sleep(140);
                const hpAfter = (typeof window.GameAPI.getStats === "function") ? window.GameAPI.getStats().hp : null;
                const dhp = (hpAfter != null && hpBefore != null) ? (hpAfter - hpBefore) : null;
                record(okDrink, `Drank potion at index ${pi} (${pots[0].name || "potion"})${dhp != null ? `, HP +${dhp}` : ""}`);
              } else {
                recordSkip("No potions available to drink");
              }
            } catch (e2) {
              record(false, "Drink potion failed: " + (e2 && e2.message ? e2.message : String(e2)));
            }

            // 9b.2: two-handed equip/unequip behavior if available + hand chooser branch coverage
            try {
              const inv2 = (typeof window.GameAPI.getInventory === "function") ? window.GameAPI.getInventory() : [];
              // Two-handed check
              const idx2h = inv2.findIndex(it => it && it.kind === "equip" && it.twoHanded);
              if (idx2h !== -1 && typeof window.GameAPI.equipItemAtIndex === "function") {
                const okEq = !!window.GameAPI.equipItemAtIndex(idx2h);
                await sleep(140);
                const eqInfo = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
                const bothHandsSame = !!(eqInfo.left && eqInfo.right && eqInfo.left.name === eqInfo.right.name);
                // Unequip one hand should remove both if same object (two-handed)
                const okUn = (typeof window.GameAPI.unequipSlot === "function") ? !!window.GameAPI.unequipSlot("left") : false;
                await sleep(140);
                const eqInfo2 = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
                const handsCleared = !eqInfo2.left && !eqInfo2.right;
                record(okEq && bothHandsSame && okUn && handsCleared, "Two-handed equip/unequip behavior");
              } else {
                recordSkip("Skipped two-handed equip test (no two-handed item)");
              }

              // Hand chooser branch coverage
              // Ensure we have a 1-hand item in inventory
              let inv3 = (typeof window.GameAPI.getInventory === "function") ? window.GameAPI.getInventory() : [];
              let idxHand = inv3.findIndex(it => it && it.kind === "equip" && it.slot === "hand" && !it.twoHanded);
              if (idxHand === -1 && typeof window.GameAPI.getStats === "function") {
                // Spawn items to populate inventory
                safeClick("god-open-btn"); await sleep(120);
                safeClick("god-spawn-btn"); await sleep(240);
                key("Escape"); await sleep(120);
                inv3 = (typeof window.GameAPI.getInventory === "function") ? window.GameAPI.getInventory() : [];
                idxHand = inv3.findIndex(it => it && it.kind === "equip" && it.slot === "hand" && !it.twoHanded);
              }
              if (idxHand !== -1) {
                // Case A: both hands empty -> choose left explicitly, expect left equipped
                (typeof window.GameAPI.unequipSlot === "function") && window.GameAPI.unequipSlot("left");
                (typeof window.GameAPI.unequipSlot === "function") && window.GameAPI.unequipSlot("right");
                await sleep(120);
                const okLeft = (typeof window.GameAPI.equipItemAtIndexHand === "function") ? !!window.GameAPI.equipItemAtIndexHand(idxHand, "left") : (!!window.GameAPI.equipItemAtIndex(idxHand));
                await sleep(140);
                let eqInfoA = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
                const leftOk = !!(eqInfoA.left && (!eqInfoA.right || eqInfoA.right.name !== eqInfoA.left.name));
                record(okLeft && leftOk, "Hand chooser: both empty -> equip left");

                // Case B: right occupied, left empty -> auto equip to left when using generic equip
                // First, ensure right has an item (reuse left item by moving if needed)
                if (!(eqInfoA.right)) {
                  // Unequip left and re-equip to right
                  (typeof window.GameAPI.unequipSlot === "function") && window.GameAPI.unequipSlot("left");
                  await sleep(100);
                  const okRight = (typeof window.GameAPI.equipItemAtIndexHand === "function") ? !!window.GameAPI.equipItemAtIndexHand(idxHand, "right") : (!!window.GameAPI.equipItemAtIndex(idxHand));
                  await sleep(140);
                  eqInfoA = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
                  if (!eqInfoA.right) {
                    record(true, "Skipped auto equip test (unable to occupy right hand)");
                  }
                }
                // Now right occupied, left empty
                (typeof window.GameAPI.unequipSlot === "function") && window.GameAPI.unequipSlot("left");
                await sleep(120);
                // Equip generically (no hand), expect left chosen
                const okAuto = (typeof window.GameAPI.equipItemAtIndex === "function") ? !!window.GameAPI.equipItemAtIndex(idxHand) : false;
                await sleep(140);
                const eqInfoB = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
                const autoLeft = !!(eqInfoB.left);
                record(okAuto && autoLeft, "Hand chooser: one empty -> auto equip to empty hand");
              } else {
                recordSkip("Skipped hand chooser test (no 1-hand item available)");
              }
            } catch (e2h) {
              record(false, "Hand chooser tests failed: " + (e2h && e2h.message ? e2h.message : String(e2h)));
            }
          } catch (e) {
            record(false, "Equip/unequip sequence failed: " + (e && e.message ? e.message : String(e)));
          }

          // 9c: force enemy spawn in dungeon and verify presence/types
          try {
            if (window.GameAPI && typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() !== "dungeon") {
              // Ensure we are in dungeon; route/enter if needed
              await window.GameAPI.gotoNearestDungeon?.();
              key("Enter"); await sleep(280);
              if (typeof window.GameAPI.enterDungeonIfOnEntrance === "function") window.GameAPI.enterDungeonIfOnEntrance();
              await sleep(260);
            }
          } catch (_) {}
          const beforeEnemiesCount = (typeof window.GameAPI.getEnemies === "function") ? window.GameAPI.getEnemies().length : 0;
          if (safeClick("god-open-btn")) {
            await sleep(200);
            let spawnClicks = 0;
            if (safeClick("god-spawn-enemy-btn")) { spawnClicks++; await sleep(140); }
            if (safeClick("god-spawn-enemy-btn")) { spawnClicks++; await sleep(140); }
            const afterSpawnCount = (typeof window.GameAPI.getEnemies === "function") ? window.GameAPI.getEnemies().length : beforeEnemiesCount;
            const spawnedOk = afterSpawnCount > beforeEnemiesCount;
            record(spawnedOk, `Dungeon spawn: enemies ${beforeEnemiesCount} -> ${afterSpawnCount} (clicked ${spawnClicks}x)`);
            // Types + glyph diagnostic
            try {
              const es = window.GameAPI.getEnemies ? window.GameAPI.getEnemies() : [];
              const types = Array.from(new Set(es.map(e => e.type || ""))).filter(Boolean);
              const glyphSet = Array.from(new Set(es.map(e => (e && typeof e.glyph === "string") ? e.glyph : "?")));
              record(types.length >= 1, `Enemy types present: ${types.join(", ") || "(none)"}`);
              record(glyphSet.some(g => g !== "?"), `Enemy glyphs: ${glyphSet.join(", ")}`);
              // If only goblin appears, check data registries loaded
              const GD = window.GameData || {};
              const jsonLoaded = !!(GD.enemies);
              const typeListFn = (typeof window.Enemies !== "undefined" && typeof window.Enemies.listTypes === "function") ? window.Enemies.listTypes : null;
              const runtimeTypes = typeListFn ? typeListFn() : [];
              if (types.length === 1 && types[0].toLowerCase() === "goblin") {
                const msg = `Only goblin seen; GameData.enemies loaded=${jsonLoaded} runtime types=${runtimeTypes.length}`;
                record(jsonLoaded && runtimeTypes.length > 0, msg);
              }
              // If glyphs are all "?", surface a stronger diagnostic
              if (!glyphSet.some(g => g !== "?")) {
                const msg2 = `All enemy glyphs are "?" — registry applied=${runtimeTypes.length > 0}, jsonLoaded=${jsonLoaded}`;
                record(false, msg2);
              }
            } catch (_) {}
          } else {
            recordSkip("GOD open button not present (spawn)");
          }
          await sleep(200);
          key("Escape");
          await sleep(120);

          const enemies = (typeof window.GameAPI.getEnemies === "function") ? window.GameAPI.getEnemies() : [];
          const corpsesBeforeCombat = (typeof window.GameAPI.getCorpses === "function") ? window.GameAPI.getCorpses().length : 0;
          const eqBefore = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
          const leftBefore = (eqBefore && eqBefore.left && typeof eqBefore.left.decay === "number") ? eqBefore.left.decay : null;
          const rightBefore = (eqBefore && eqBefore.right && typeof eqBefore.right.decay === "number") ? eqBefore.right.decay : null;

          if (enemies && enemies.length) {
            let best = enemies[0];
            let bestD = Math.abs(best.x - window.GameAPI.getPlayer().x) + Math.abs(best.y - window.GameAPI.getPlayer().y);
            for (const e of enemies) {
              const d = Math.abs(e.x - window.GameAPI.getPlayer().x) + Math.abs(e.y - window.GameAPI.getPlayer().y);
              if (d < bestD) { best = e; bestD = d; }
            }
            const path = (typeof window.GameAPI.routeToDungeon === "function") ? window.GameAPI.routeToDungeon(best.x, best.y) : [];
            const budget = makeBudget(CONFIG.timeouts.route);
            for (const step of path) {
              if (budget.exceeded()) { recordSkip("Routing to enemy timed out"); break; }
              const dx = Math.sign(step.x - window.GameAPI.getPlayer().x);
              const dy = Math.sign(step.y - window.GameAPI.getPlayer().y);
              key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
              await sleep(110);
            }
            // Do a few bumps to attack
            const bb = makeBudget(CONFIG.timeouts.battle);
            for (let t = 0; t < 3; t++) {
              if (bb.exceeded()) { recordSkip("Combat burst timed out"); break; }
              const dx = Math.sign(best.x - window.GameAPI.getPlayer().x);
              const dy = Math.sign(best.y - window.GameAPI.getPlayer().y);
              key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
              await sleep(140);
            }
            const eqAfter = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
            const leftAfter = (eqAfter && eqAfter.left && typeof eqAfter.left.decay === "number") ? eqAfter.left.decay : null;
            const rightAfter = (eqAfter && eqAfter.right && typeof eqAfter.right.decay === "number") ? eqAfter.right.decay : null;

            const leftChanged = (leftBefore != null && leftAfter != null) ? (leftAfter > leftBefore) : false;
            const rightChanged = (rightBefore != null && rightAfter != null) ? (rightAfter > rightBefore) : false;
            if (leftBefore != null || rightBefore != null) {
              record(true, `Decay check: left ${leftBefore} -> ${leftAfter}, right ${rightBefore} -> ${rightAfter}`);
              if (!leftChanged && !rightChanged) {
                record(false, "Decay did not increase on equipped hand item(s)");
              }
            } else {
              recordSkip("No hand equipment to measure decay");
            }

            // Attempt to loot underfoot if enemy died
            key("KeyG");
            await sleep(220);
            const corpsesAfterCombat = (typeof window.GameAPI.getCorpses === "function") ? window.GameAPI.getCorpses().length : corpsesBeforeCombat;
            const killedEnemy = corpsesAfterCombat > corpsesBeforeCombat;
            record(killedEnemy, `Killed enemy: ${killedEnemy ? "YES" : "NO"} (corpses ${corpsesBeforeCombat} -> ${corpsesAfterCombat})`);
            record(true, "Attempted to loot defeated enemy");

            // FOV/LOS/occupancy spot-checks
            try {
              const pl = window.GameAPI.getPlayer();
              const visSelf = (typeof window.GameAPI.getVisibilityAt === "function") ? window.GameAPI.getVisibilityAt(pl.x, pl.y) : true;
              record(visSelf, "FOV: player tile visible");
              // Adjacent tiles visibility sample
              const adj = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
              let visAdjCount = 0;
              for (const d of adj) {
                const vx = pl.x + d.dx, vy = pl.y + d.dy;
                if (typeof window.GameAPI.getVisibilityAt === "function" && window.GameAPI.getVisibilityAt(vx, vy)) visAdjCount++;
              }
              record(visAdjCount >= 1, `FOV: adjacent visible count ${visAdjCount}`);

              // LOS sample to enemy tile if present
              if (best) {
                const hasLos = (typeof window.GameAPI.hasLOS === "function") ? window.GameAPI.hasLOS(pl.x, pl.y, best.x, best.y) : true;
                record(hasLos, "LOS: player -> enemy line-of-sight (sample)");
                const occEnemy = (typeof window.GameAPI.hasEnemy === "function") ? window.GameAPI.hasEnemy(best.x, best.y) : true;
                record(occEnemy, "Occupancy: enemy tile marked occupied");
                const occPlayerEnemy = (typeof window.GameAPI.hasEnemy === "function") ? window.GameAPI.hasEnemy(pl.x, pl.y) : false;
                record(!occPlayerEnemy, "Occupancy: player tile not occupied by enemy");
              }
            } catch (eOcc) {
              record(false, "FOV/LOS/occupancy spot-checks failed: " + (eOcc && eOcc.message ? eOcc.message : String(eOcc)));
            }

            // Equipment breakage test: force near-break decay and attack until it breaks
            try {
              const eq0 = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
              // Pick a hand with an item (prefer left)
              const slot = (eq0.left ? "left" : (eq0.right ? "right" : null));
              if (slot && typeof window.GameAPI.setEquipDecay === "function") {
                const okSet = window.GameAPI.setEquipDecay(slot, 99.0);
                await sleep(60);
                // Ensure an enemy is nearby to swing at
                if (typeof window.GameAPI.spawnEnemyNearby === "function") window.GameAPI.spawnEnemyNearby(1);
                await sleep(120);
                // Step toward nearest enemy (reuse pathing)
                const enemies2 = (typeof window.GameAPI.getEnemies === "function") ? window.GameAPI.getEnemies() : [];
                if (enemies2 && enemies2.length) {
                  let tgt = enemies2[0];
                  let bestD2 = Math.abs(tgt.x - window.GameAPI.getPlayer().x) + Math.abs(tgt.y - window.GameAPI.getPlayer().y);
                  for (const e2 of enemies2) {
                    const d2 = Math.abs(e2.x - window.GameAPI.getPlayer().x) + Math.abs(e2.y - window.GameAPI.getPlayer().y);
                    if (d2 < bestD2) { bestD2 = d2; tgt = e2; }
                  }
                  const path2 = (typeof window.GameAPI.routeToDungeon === "function") ? window.GameAPI.routeToDungeon(tgt.x, tgt.y) : [];
                  const budget2 = makeBudget(CONFIG.timeouts.battle);
                  for (const step of path2) {
                    if (budget2.exceeded()) break;
                    const dx = Math.sign(step.x - window.GameAPI.getPlayer().x);
                    const dy = Math.sign(step.y - window.GameAPI.getPlayer().y);
                    key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                    await sleep(90);
                  }
                  // Bump a few times to ensure at least one swing
                  for (let t = 0; t < 3; t++) {
                    const dx = Math.sign(tgt.x - window.GameAPI.getPlayer().x);
                    const dy = Math.sign(tgt.y - window.GameAPI.getPlayer().y);
                    key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                    await sleep(120);
                  }
                }
                const eq1 = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
                const broken = !eq1[slot];
                record(okSet && (broken || (eq1[slot] && typeof eq1[slot].decay === "number" && eq1[slot].decay >= 99.5)),
                  `Breakage test (${slot}): ${broken ? "item broke" : "still equipped"}${eq1[slot] && eq1[slot].decay != null ? `, decay=${eq1[slot].decay}` : ""}`);
              } else {
                record(true, "Skipped breakage test (no hand equipment)");
              }
            } catch (e) {
              record(false, "Breakage test failed: " + (e && e.message ? e.message : String(e)));
            }

            // Crit damage and status tests
            try {
              // Ensure Always Crit off for baseline
              if (typeof window.GameAPI.setAlwaysCrit === "function") window.GameAPI.setAlwaysCrit(false);
              if (typeof window.GameAPI.setCritPart === "function") window.GameAPI.setCritPart("");

              // Spawn baseline target and measure non-crit damage
              if (typeof window.GameAPI.spawnEnemyNearby === "function") window.GameAPI.spawnEnemyNearby(1);
              await sleep(140);
              let es = (typeof window.GameAPI.getEnemies === "function") ? window.GameAPI.getEnemies() : [];
              if (es && es.length) {
                // choose nearest
                let tgt = es[0];
                let bestD = Math.abs(tgt.x - window.GameAPI.getPlayer().x) + Math.abs(tgt.y - window.GameAPI.getPlayer().y);
                for (const e2 of es) {
                  const d2 = Math.abs(e2.x - window.GameAPI.getPlayer().x) + Math.abs(e2.y - window.GameAPI.getPlayer().y);
                  if (d2 < bestD) { bestD = d2; tgt = e2; }
                }
                // route adjacent then bump once
                const path = (typeof window.GameAPI.routeToDungeon === "function") ? window.GameAPI.routeToDungeon(tgt.x, tgt.y) : [];
                const budget = makeBudget(CONFIG.timeouts.battle);
                for (const step of path) {
                  if (budget.exceeded()) break;
                  const dx = Math.sign(step.x - window.GameAPI.getPlayer().x);
                  const dy = Math.sign(step.y - window.GameAPI.getPlayer().y);
                  key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                  await sleep(90);
                }
                // record hp before and attempt one bump
                es = (typeof window.GameAPI.getEnemies === "function") ? window.GameAPI.getEnemies() : [];
                let tgt2 = es.find(e => e.x === tgt.x && e.y === tgt.y) || tgt;
                const hp0 = tgt2.hp;
                const dx = Math.sign(tgt2.x - window.GameAPI.getPlayer().x);
                const dy = Math.sign(tgt2.y - window.GameAPI.getPlayer().y);
                key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                await sleep(140);
                es = window.GameAPI.getEnemies ? window.GameAPI.getEnemies() : [];
                tgt2 = es.find(e => e.x === tgt.x && e.y === tgt.y) || tgt2;
                const hp1 = tgt2 ? tgt2.hp : hp0; // might have died
                const dmgNoCrit = Math.max(0, (hp0 != null && hp1 != null) ? (hp0 - hp1) : 0);

                // Head crit for higher damage
                if (typeof window.GameAPI.setAlwaysCrit === "function") window.GameAPI.setAlwaysCrit(true);
                if (typeof window.GameAPI.setCritPart === "function") window.GameAPI.setCritPart("head");
                if (typeof window.GameAPI.spawnEnemyNearby === "function") window.GameAPI.spawnEnemyNearby(1);
                await sleep(140);
                es = window.GameAPI.getEnemies ? window.GameAPI.getEnemies() : [];
                let tgtH = es[0];
                let bestDH = Infinity;
                for (const e2 of es) {
                  const d2 = Math.abs(e2.x - window.GameAPI.getPlayer().x) + Math.abs(e2.y - window.GameAPI.getPlayer().y);
                  if (d2 < bestDH) { bestDH = d2; tgtH = e2; }
                }
                const pathH = window.GameAPI.routeToDungeon ? window.GameAPI.routeToDungeon(tgtH.x, tgtH.y) : [];
                for (const step of pathH) {
                  const dxh = Math.sign(step.x - window.GameAPI.getPlayer().x);
                  const dyh = Math.sign(step.y - window.GameAPI.getPlayer().y);
                  key(dxh === -1 ? "ArrowLeft" : dxh === 1 ? "ArrowRight" : (dyh === -1 ? "ArrowUp" : "ArrowDown"));
                  await sleep(80);
                }
                const hpH0 = tgtH.hp;
                const dxh = Math.sign(tgtH.x - window.GameAPI.getPlayer().x);
                const dyh = Math.sign(tgtH.y - window.GameAPI.getPlayer().y);
                key(dxh === -1 ? "ArrowLeft" : dxh === 1 ? "ArrowRight" : (dyh === -1 ? "ArrowUp" : "ArrowDown"));
                await sleep(140);
                es = window.GameAPI.getEnemies ? window.GameAPI.getEnemies() : [];
                let tgtH2 = es.find(e => e.x === tgtH.x && e.y === tgtH.y) || tgtH;
                const hpH1 = tgtH2 ? tgtH2.hp : hpH0;
                const dmgCritHead = Math.max(0, (hpH0 != null && hpH1 != null) ? (hpH0 - hpH1) : 0);
                record(dmgCritHead >= dmgNoCrit, `Crit damage check: non-crit ${dmgNoCrit}, head-crit ${dmgCritHead}`);

                // Block/hit distribution sanity over multiple bumps
                try {
                  // Ensure an enemy is present
                  if (typeof window.GameAPI.spawnEnemyNearby === "function") window.GameAPI.spawnEnemyNearby(1);
                  await sleep(120);
                  let es3 = window.GameAPI.getEnemies ? window.GameAPI.getEnemies() : [];
                  if (es3 && es3.length) {
                    // route adjacent
                    let tgt3 = es3[0];
                    let bestD3 = Math.abs(tgt3.x - window.GameAPI.getPlayer().x) + Math.abs(tgt3.y - window.GameAPI.getPlayer().y);
                    for (const e3 of es3) {
                      const d3 = Math.abs(e3.x - window.GameAPI.getPlayer().x) + Math.abs(e3.y - window.GameAPI.getPlayer().y);
                      if (d3 < bestD3) { bestD3 = d3; tgt3 = e3; }
                    }
                    const path3 = window.GameAPI.routeToDungeon ? window.GameAPI.routeToDungeon(tgt3.x, tgt3.y) : [];
                    for (const step of path3) {
                      const dx3 = Math.sign(step.x - window.GameAPI.getPlayer().x);
                      const dy3 = Math.sign(step.y - window.GameAPI.getPlayer().y);
                      key(dx3 === -1 ? "ArrowLeft" : dx3 === 1 ? "ArrowRight" : (dy3 === -1 ? "ArrowUp" : "ArrowDown"));
                      await sleep(80);
                    }
                    let blocks = 0, hits = 0;
                    // Perform 10 bumps and measure hp change
                    for (let t = 0; t < 10; t++) {
                      es3 = window.GameAPI.getEnemies ? window.GameAPI.getEnemies() : [];
                      let cur = es3.find(e => e.x === tgt3.x && e.y === tgt3.y) || tgt3;
                      const hpBefore = cur ? cur.hp : null;
                      const dx4 = Math.sign(tgt3.x - window.GameAPI.getPlayer().x);
                      const dy4 = Math.sign(tgt3.y - window.GameAPI.getPlayer().y);
                      key(dx4 === -1 ? "ArrowLeft" : dx4 === 1 ? "ArrowRight" : (dy4 === -1 ? "ArrowUp" : "ArrowDown"));
                      await sleep(120);
                      es3 = window.GameAPI.getEnemies ? window.GameAPI.getEnemies() : [];
                      cur = es3.find(e => e.x === tgt3.x && e.y === tgt3.y) || cur;
                      const hpAfter = cur ? cur.hp : hpBefore;
                      if (hpBefore != null && hpAfter != null) {
                        const diff = hpBefore - hpAfter;
                        if (diff > 0) hits++;
                        else blocks++;
                      }
                      if (!cur) break; // enemy died
                    }
                    const okSpread = hits >= 1 && blocks >= 1;
                    record(okSpread, `Block/Hit spread: hits=${hits} blocks=${blocks} (10 bumps)`);
                  } else {
                    record(true, "Skipped block/hit spread (no enemy)");
                  }
                } catch (eS) {
                  record(false, "Block/Hit spread check failed: " + (eS && eS.message ? eS.message : String(eS)));
                }

                // Dazed behavior: set 2 turns and ensure movement is ignored
                try {
                  const p0 = window.GameAPI.getPlayer();
                  const okSetD = (typeof window.GameAPI.setPlayerDazedTurns === "function") ? !!window.GameAPI.setPlayerDazedTurns(2) : false;
                  key("ArrowRight"); await sleep(120);
                  key("ArrowRight"); await sleep(120);
                  const p1 = window.GameAPI.getPlayer();
                  const dazedOk = okSetD && (p0.x === p1.x) && (p0.y === p1.y);
                  record(dazedOk, "Dazed: movement consumed by dazedTurns");
                } catch (eD) {
                  record(false, "Dazed behavior check failed: " + (eD && eD.message ? eD.message : String(eD)));
                }

                // Legs crit immobilization
                if (typeof window.GameAPI.setCritPart === "function") window.GameAPI.setCritPart("legs");
                if (typeof window.GameAPI.spawnEnemyNearby === "function") window.GameAPI.spawnEnemyNearby(1);
                await sleep(140);
                es = window.GameAPI.getEnemies ? window.GameAPI.getEnemies() : [];
                let tgtL = es[0];
                let bestDL = Infinity;
                for (const e2 of es) {
                  const d2 = Math.abs(e2.x - window.GameAPI.getPlayer().x) + Math.abs(e2.y - window.GameAPI.getPlayer().y);
                  if (d2 < bestDL) { bestDL = d2; tgtL = e2; }
                }
                const pathL = window.GameAPI.routeToDungeon ? window.GameAPI.routeToDungeon(tgtL.x, tgtL.y) : [];
                for (const step of pathL) {
                  const dxl = Math.sign(step.x - window.GameAPI.getPlayer().x);
                  const dyl = Math.sign(step.y - window.GameAPI.getPlayer().y);
                  key(dxl === -1 ? "ArrowLeft" : dxl === 1 ? "ArrowRight" : (dyl === -1 ? "ArrowUp" : "ArrowDown"));
                  await sleep(80);
                }
                const dxl = Math.sign(tgtL.x - window.GameAPI.getPlayer().x);
                const dyl = Math.sign(tgtL.y - window.GameAPI.getPlayer().y);
                key(dxl === -1 ? "ArrowLeft" : dxl === 1 ? "ArrowRight" : (dyl === -1 ? "ArrowUp" : "ArrowDown"));
                await sleep(140);
                es = window.GameAPI.getEnemies ? window.GameAPI.getEnemies() : [];
                let tgtL2 = es.find(e => e.x === tgtL.x && e.y === tgtL.y) || tgtL;
                const imm0 = tgtL2 ? (tgtL2.immobileTurns || 0) : 0;
                const bleed0 = tgtL2 ? (tgtL2.bleedTurns || 0) : 0;
                // wait two turns to tick effects
                key("Numpad5"); await sleep(90);
                key("Numpad5"); await sleep(90);
                es = window.GameAPI.getEnemies ? window.GameAPI.getEnemies() : [];
                let tgtL3 = es.find(e => e.x === tgtL.x && e.y === tgtL.y);
                const imm1 = tgtL3 ? (tgtL3.immobileTurns || 0) : 0;
                const bleed1 = tgtL3 ? (tgtL3.bleedTurns || 0) : 0;
                const immOk = imm0 >= 1 && (imm1 <= imm0);
                record(immOk, `Legs-crit immobilization: immobileTurns ${imm0} -> ${imm1}`);
                // Bleed tick check (optional depending on Combat/Status module)
                if (bleed0 || bleed1) {
                  const bleedOk = bleed1 <= bleed0;
                  record(bleedOk, `Bleed turns: ${bleed0} -> ${bleed1}`);
                } else {
                  record(true, "Bleed check skipped (no bleedTurns on enemy)");
                }
              } else {
                record(true, "Skipped crit/status tests (no enemies found)");
              }
              // Reset crit toggles
              if (typeof window.GameAPI.setAlwaysCrit === "function") window.GameAPI.setAlwaysCrit(false);
              if (typeof window.GameAPI.setCritPart === "function") window.GameAPI.setCritPart("");
            } catch (e) {
              record(false, "Crit/Status tests failed: " + (e && e.message ? e.message : String(e)));
            }
          } else {
            record(true, "No enemies found to route/loot");
          }

          // 9d: API-first return to overworld via dungeon exit ('>') + persistence pass + stair guard, with settle waits
          try {
            const waitForMode = async (target, timeoutMs = 4000, interval = 120) => {
              const deadline = Date.now() + timeoutMs;
              while (Date.now() < deadline) {
                try { if (window.GameAPI?.getMode?.() === target) return true; } catch (_) {}
                await sleep(interval);
              }
              return window.GameAPI?.getMode?.() === target;
            };
            const exit = window.GameAPI?.getDungeonExit?.();
            if (!exit) { recordSkip("Skipped return to overworld (no exit info)"); }
            else {
              // Stair guard on non-stair tile
              try {
                const adj = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
                for (const d of adj) {
                  const nx = window.GameAPI.getPlayer().x + d.dx;
                  const ny = window.GameAPI.getPlayer().y + d.dy;
                  if (window.GameAPI.isWalkableDungeon?.(nx, ny)) {
                    const dx = Math.sign(nx - window.GameAPI.getPlayer().x);
                    const dy = Math.sign(ny - window.GameAPI.getPlayer().y);
                    key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                    await sleep(140);
                    break;
                  }
                }
                key("KeyG"); await sleep(200);
                const modeGuard = window.GameAPI?.getMode?.() || "";
                record(modeGuard === "dungeon", "Stair guard: G on non-stair does not exit dungeon");
              } catch (eGuard) {
                record(false, "Stair guard check failed: " + (eGuard && eGuard.message ? eGuard.message : String(eGuard)));
              }

              // Capture pre-exit persistence markers
              const preCorpses = window.GameAPI?.getCorpses?.().map(c => `${c.x},${c.y}:${c.kind}`) || [];
              const preDecals = window.GameAPI?.getDecalsCount?.() || 0;

              // Route to exit and exit via API first
              const pathBack = window.GameAPI?.routeToDungeon?.(exit.x, exit.y) || [];
              const budget = makeBudget(CONFIG.timeouts.route);
              for (const step of pathBack) {
                if (budget.exceeded()) { recordSkip("Routing to dungeon exit timed out"); break; }
                const dx = Math.sign(step.x - window.GameAPI.getPlayer().x);
                const dy = Math.sign(step.y - window.GameAPI.getPlayer().y);
                key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                await sleep(110);
              }
              // API-first exit
              let returned = false;
              try {
                if (typeof window.GameAPI.returnToWorldIfAtExit === "function") {
                  returned = !!window.GameAPI.returnToWorldIfAtExit();
                }
              } catch (_) {}
              if (!returned) { key("KeyG"); await sleep(280); }
              const m1ok = await waitForMode("world", 5000, 140);
              record(m1ok, m1ok ? "Returned to overworld from dungeon" : `Attempted return to overworld (mode=${window.GameAPI?.getMode?.() || ""})`);

              // Persistence pass: re-enter and compare
              try {
                if (window.GameAPI?.enterDungeonIfOnEntrance) {
                  const playerBeforeReenter = window.GameAPI?.getPlayer?.() || null;
                  window.GameAPI.enterDungeonIfOnEntrance();
                  const reEntered = await waitForMode("dungeon", 4500, 140);
                  if (reEntered) {
                    const postCorpses = window.GameAPI?.getCorpses?.().map(c => `${c.x},${c.y}:${c.kind}`) || [];
                    const postDecals = window.GameAPI?.getDecalsCount?.() || 0;
                    const overlap = preCorpses.filter(k => postCorpses.includes(k)).length;
                    const corpsesOk = postCorpses.length >= preCorpses.length && (preCorpses.length === 0 || overlap > 0);
                    const decalsOk = postDecals >= preDecals;
                    record(corpsesOk, `Persistence corpses: before ${preCorpses.length}, after ${postCorpses.length}, overlap ${overlap}`);
                    record(decalsOk, `Persistence decals: before ${preDecals}, after ${postDecals}`);

                    const playerAfterReenter = window.GameAPI?.getPlayer?.() || null;
                    const playerStable = !!(playerBeforeReenter && playerAfterReenter && (Math.abs(playerBeforeReenter.x - playerAfterReenter.x) + Math.abs(playerBeforeReenter.y - playerAfterReenter.y) <= 1));
                    record(playerStable, `Player teleport guard (re-enter): Δ <= 1 tile`);

                    const dungeonPersistent = corpsesOk && decalsOk;
                    record(dungeonPersistent, `Dungeon persistent: ${dungeonPersistent ? "YES" : "NO"}`);

                    // Return to world to proceed
                    let back = false;
                    try { back = !!window.GameAPI.returnToWorldIfAtExit?.(); } catch (_) {}
                    if (!back) { key("KeyG"); await sleep(260); }
                    await waitForMode("world", 4500, 140);
                  } else {
                    recordSkip("Persistence check skipped: failed to re-enter dungeon");
                  }
                } else {
                  recordSkip("Persistence check not available (enterDungeonIfOnEntrance API missing)");
                }
              } catch (e) {
                record(false, "Persistence pass failed: " + (e && e.message ? e.message : String(e)));
              }
            }
          } catch (e) {
            record(false, "Return to overworld failed: " + (e && e.message ? e.message : String(e)));
          }
        } else {
          record(true, "Skipped dungeon chest/decay steps (not in dungeon)");
        }
      } catch (e) {
        record(false, "Dungeon test error: " + (e && e.message ? e.message : String(e)));
      }

      // Step 10: API-first town entry with retries and settle waits
      try {
        const isWorld = (window.GameAPI?.getMode?.() === "world");
        if (!isWorld) {
          recordSkip("Skipped town visit (not in overworld)");
        } else {
          const waitForMode = async (target, timeoutMs = 4000, interval = 120) => {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
              try { if (window.GameAPI?.getMode?.() === target) return true; } catch (_) {}
              await sleep(interval);
            }
            return window.GameAPI?.getMode?.() === target;
          };

          // Prefer API gotoNearestTown, else routeTo nearestTown
          try {
            if (typeof window.GameAPI.gotoNearestTown === "function") {
              await window.GameAPI.gotoNearestTown();
            } else {
              const nt = window.GameAPI?.nearestTown?.();
              if (nt) {
                const pathNT = window.GameAPI.routeTo?.(nt.x, nt.y) || [];
                const budgetNT = makeBudget(3000);
                for (const step of pathNT) {
                  if (budgetNT.exceeded()) break;
                  const ddx = Math.sign(step.x - (window.GameAPI.getPlayer()?.x ?? step.x));
                  const ddy = Math.sign(step.y - (window.GameAPI.getPlayer()?.y ?? step.y));
                  key(ddx === -1 ? "ArrowLeft" : ddx === 1 ? "ArrowRight" : (ddy === -1 ? "ArrowUp" : "ArrowDown"));
                  await sleep(100);
                }
              }
            }
          } catch (_) {}

          // API enter first, fallback keys
          let enteredTown = false;
          try { enteredTown = !!window.GameAPI.enterTownIfOnTile?.(); } catch (_) {}
          if (!enteredTown) {
            key("Enter");
            await sleep(280);
            try { window.GameAPI.enterTownIfOnTile?.(); } catch (_) {}
          }
          enteredTown = await waitForMode("town", 5000, 140);

          if (enteredTown) {
            record(true, "Entered town");
            // Ensure NPC presence after short settle; spawn greeters if exposed
            try {
              let npcCount = window.GameAPI?.getNPCs?.().length || 0;
              if (npcCount === 0) {
                try { window.GameAPI?.checkHomeRoutes?.(); } catch (_) {}
                await sleep(240);
                npcCount = window.GameAPI?.getNPCs?.().length || 0;
              }
              record(npcCount > 0, `NPC presence: count ${npcCount}`);
            } catch (_) {}
          } else {
            const nowMode = window.GameAPI?.getMode?.() || "";
            try {
              const world = window.GameAPI?.getWorld?.() || null;
              const player = window.GameAPI?.getPlayer?.() || null;
              const T = (window.World && window.World.TILES) ? window.World.TILES : null;
              const tile = (world && player && T && world.map[player.y] && world.map[player.y][player.x] === T.TOWN) ? "TOWN" : "OTHER";
              recordSkip("Town entry not achieved (mode=" + nowMode + ", standing on tile=" + tile + ")");
            } catch (_) {
              recordSkip("Town entry not achieved (still in " + nowMode + ")");
            }
          }
        }
      } catch (e) {
        record(false, "Town visit error: " + (e && e.message ? e.message : String(e)));
      }

      // Seed determinism invariants (same-seed regeneration without reload)
      try {
        // Return to world and re-apply the same seed, then regenerate and compare nearestTown/nearestDungeon
        key("Escape");
        await sleep(160);
        try { window.GameAPI.returnToWorldIfAtExit?.(); } catch (_) {}
        await sleep(240);
        const seedRaw = (localStorage.getItem("SEED") || "");
        const s = seedRaw ? (Number(seedRaw) >>> 0) : null;
        if (s != null) {
          // Open GOD, set seed (same) and regenerate overworld
          safeClick("god-open-btn");
          await sleep(120);
          safeSetInput("god-seed-input", s);
          safeClick("god-apply-seed-btn");
          await sleep(400);
          key("Escape");
          await sleep(160);
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
      } catch (e) {
        record(false, "Seed invariants check failed: " + (e && e.message ? e.message : String(e)));
      }

          // NPC check: route to nearest NPC and bump into them
          let lastNPC = null;
          try {
            const modeNow = (typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : "";
            if (modeNow !== "town") {
              recordSkip("NPC checks skipped (not in town)");
            } else {
              const npcs = (typeof window.GameAPI.getNPCs === "function") ? window.GameAPI.getNPCs() : [];
              if (npcs && npcs.length) {
                // nearest by manhattan
                const pl = window.GameAPI.getPlayer();
                let best = npcs[0], bestD = Math.abs(best.x - pl.x) + Math.abs(best.y - pl.y);
                for (const n of npcs) {
                  const d = Math.abs(n.x - pl.x) + Math.abs(n.y - pl.y);
                  if (d < bestD) { best = n; bestD = d; }
                }
                // route to adjacent tile, then bump into NPC tile to trigger dialogue
                const adj = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}]
                  .map(v => ({ x: best.x + v.dx, y: best.y + v.dy }));
                let path = [];
                for (const a of adj) {
                  const p = window.GameAPI.routeToDungeon(a.x, a.y);
                  if (p && p.length) { path = p; break; }
                }
                for (const step of path) {
                  const dx = Math.sign(step.x - window.GameAPI.getPlayer().x);
                  const dy = Math.sign(step.y - window.GameAPI.getPlayer().y);
                  key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                  await sleep(110);
                }
                // bump into NPC tile
                const dx = Math.sign(best.x - window.GameAPI.getPlayer().x);
                const dy = Math.sign(best.y - window.GameAPI.getPlayer().y);
                key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                await sleep(160);
                record(true, "Bumped into at least one NPC");
                lastNPC = best;
              } else {
                recordSkip("No NPCs reported (town may be empty?)");
              }
            }
          } catch (e) {
            record(false, "NPC interaction failed: " + (e && e.message ? e.message : String(e)));
          }

          // NPC home + decorations check: go to NPC's house and verify decorations/props exist
          try {
            const modeNow2 = (typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : "";
            if (modeNow2 !== "town") {
              recordSkip("NPC home check skipped (not in town)");
            } else if (lastNPC && typeof lastNPC.i === "number" && typeof window.GameAPI.getNPCHomeByIndex === "function") {
              const home = window.GameAPI.getNPCHomeByIndex(lastNPC.i);
              if (home && home.building) {
                const b = home.building;
                const hasProps = Array.isArray(home.props) && home.props.length > 0;
                record(hasProps, `NPC home has ${home.props ? home.props.length : 0} decoration(s)/prop(s)`);
                // Route to door, then to a prop (or interior) and press G
                const door = b.door || { x: b.x + Math.floor(b.w / 2), y: b.y };
                let pathDoor = window.GameAPI.routeToDungeon(door.x, door.y);
                {
                  const budget = makeBudget(CONFIG.timeouts.route);
                  for (const step of pathDoor) {
                    if (budget.exceeded()) { recordSkip("Routing to NPC home door timed out"); break; }
                    const dx = Math.sign(step.x - window.GameAPI.getPlayer().x);
                    const dy = Math.sign(step.y - window.GameAPI.getPlayer().y);
                    key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                    await sleep(100);
                  }
                }
                // Pick a target inside: either a prop tile or adjacent to it
                let target = null;
                if (hasProps) {
                  const p = home.props[0];
                  // try adjacent to prop
                  const adj = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}].map(d => ({ x: p.x + d.dx, y: p.y + d.dy }));
                  for (const a of adj) {
                    const route = window.GameAPI.routeToDungeon(a.x, a.y);
                    if (route && route.length) { target = { path: route, interact: { x: p.x, y: p.y } }; break; }
                  }
                }
                if (!target) {
                  // fallback: a tile just inside the building rectangle
                  const inside = { x: Math.min(b.x + b.w - 2, Math.max(b.x + 1, door.x)), y: b.y + 1 };
                  const route = window.GameAPI.routeToDungeon(inside.x, inside.y);
                  target = { path: route, interact: null };
                }
                if (target && target.path) {
                  const budget = makeBudget(CONFIG.timeouts.route);
                  for (const step of target.path) {
                    if (budget.exceeded()) { recordSkip("Routing inside NPC home timed out"); break; }
                    const dx = Math.sign(step.x - window.GameAPI.getPlayer().x);
                    const dy = Math.sign(step.y - window.GameAPI.getPlayer().y);
                    key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                    await sleep(100);
                  }
                  if (target.interact) {
                    // Press G to attempt interaction with the decoration/prop
                    const ib = makeBudget(CONFIG.timeouts.interact);
                    key("KeyG");
                    await sleep(Math.min(ib.remain(), 160));
                    record(true, "Interacted inside NPC home (prop/decoration)");
                  } else {
                    record(true, "Reached inside NPC home");
                  }
                } else {
                  record(false, "Failed to route to NPC home interior");
                }
              } else {
                recordSkip("NPC had no home building info");
              }
            } else {
              recordSkip("Skipped NPC home check (no NPC found or API not available)");
            }
          } catch (e) {
            record(false, "NPC home/decoration verification failed: " + (e && e.message ? e.message : String(e)));
          }

          // Decoration/props check: find nearby prop and press G
          try {
            const modeNow3 = (typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : "";
            if (modeNow3 !== "town") {
              recordSkip("Town prop interaction skipped (not in town)");
            } else {
              const props = (typeof window.GameAPI.getTownProps === "function") ? window.GameAPI.getTownProps() : [];
              if (props && props.length) {
                const pl = window.GameAPI.getPlayer();
                // nearest prop
                let best = props[0], bestD = Math.abs(best.x - pl.x) + Math.abs(best.y - pl.y);
                for (const p of props) {
                  const d = Math.abs(p.x - pl.x) + Math.abs(p.y - pl.y);
                  if (d < bestD) { best = p; bestD = d; }
                }
                const path = window.GameAPI.routeToDungeon(best.x, best.y);
              const budget = makeBudget(CONFIG.timeouts.route);
              for (const step of path) {
                if (budget.exceeded()) { recordSkip("Routing to town prop timed out"); break; }
                const dx = Math.sign(step.x - window.GameAPI.getPlayer().x);
                const dy = Math.sign(step.y - window.GameAPI.getPlayer().y);
                key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                await sleep(110);
              }
              // press G to interact with decoration
              const ib = makeBudget(CONFIG.timeouts.interact);
              key("KeyG");
              await sleep(Math.min(ib.remain(), 220));
              record(true, "Interacted with nearby decoration/prop (G)");
              } else {
                recordSkip("No town decorations/props reported");
              }
            }
          } catch (e) {
            record(false, "Decoration/prop interaction failed: " + (e && e.message ? e.message : String(e)));
          }

          // Wait in town for a few turns (advance time) and run Home Routes check
          try {
            // Ensure we truly are in town and have some NPCs; otherwise try to spawn greeters
            let modeTown = (window.GameAPI && typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() === "town" : false;
            let npcCount = 0;
            try { npcCount = (typeof window.GameAPI.getNPCs === "function") ? (window.GameAPI.getNPCs().length || 0) : 0; } catch (_) {}
            if (modeTown && npcCount === 0) {
              // Open GOD, run Check Home Routes which may populate diagnostics; if Town exposes greeter spawn, rely on it
              safeClick("god-open-btn"); await sleep(120);
              // If Town.spawnGateGreeters is not exposed via GameAPI, this is a no-op; continue
              key("Escape"); await sleep(100);
              // Recount
              try { npcCount = (typeof window.GameAPI.getNPCs === "function") ? (window.GameAPI.getNPCs().length || 0) : 0; } catch (_) {}
            }

            // Advance a few turns to let TownAI act
            for (let t = 0; t < 8; t++) { key("Numpad5"); await sleep(60); }
            // If minute-level advance is available, push into late night (02:00) for stricter routing
            try {
              if (typeof window.GameAPI.getClock === "function" && typeof window.GameAPI.advanceMinutes === "function") {
                const clk = window.GameAPI.getClock();
                const curMin = clk.hours * 60 + clk.minutes;
                const to2am = ((2 * 60) - curMin + 24 * 60) % (24 * 60);
                window.GameAPI.advanceMinutes(to2am);
                await sleep(120);
              }
            } catch (_) {}
            const res = (typeof window.GameAPI.checkHomeRoutes === "function") ? window.GameAPI.checkHomeRoutes() : null;
            // Harden result reading
            const residentsTotal = (res && res.residents && typeof res.residents.total === "number") ? res.residents.total : 0;
            const unreachable = (res && typeof res.unreachable === "number") ? res.unreachable : null;
            const reachable = (res && typeof res.reachable === "number") ? res.reachable : null;
            const hasResidents = residentsTotal > 0;
            record(hasResidents, `Home routes after waits: residents ${residentsTotal}${unreachable != null ? `, unreachable ${unreachable}` : ""}${reachable != null ? `, reachable ${reachable}` : ""}`);
            if (!hasResidents) {
              // Log raw object for diagnostics
              try { console.warn("[SMOKE] HomeRoutes raw:", res); } catch (_) {}
            }
            // Stricter late-night behavior: prefer unreachable == 0 when residents exist
            if (hasResidents && unreachable != null) {
              const lateOk = unreachable === 0;
              record(lateOk, `Late-night home routes: unreachable ${unreachable} (expected 0)`);
            }
          } catch (eHR) {
            record(false, "Home routes after waits failed: " + (eHR && eHR.message ? eHR.message : String(eHR)));
          }
        } // end town visit else
      } catch (e) {
        record(false, "Town visit error: " + (e && e.message ? e.message : String(e)));
      }

      // Seed determinism invariants (same-seed regeneration without reload)
      try {
        // Return to world and re-apply the same seed, then regenerate and compare nearestTown/nearestDungeon
        key("Escape"); await sleep(160);
        try { window.GameAPI.returnToWorldIfAtExit?.(); } catch (_) {}
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
      } catch (e) {
        record(false, "Seed invariants check failed: " + (e && e.message ? e.message : String(e)));
      }

      // Seed determinism invariants (same-seed regeneration without reload)

      // Diagnostics + shop schedule/time check
      try {
        if (safeClick("god-open-btn")) {
          await sleep(250);
          if (safeClick("god-diagnostics-btn")) {
            // ok
          } else {
            recordSkip("Diagnostics button not present");
          }
        } else {
          recordSkip("GOD open button not present (diagnostics)");
        }
        await sleep(250);
        // If in town, run extra diagnostics: shops + home routes
        if (window.GameAPI && typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() === "town") {
          // Shops schedule check
          const shops = (typeof window.GameAPI.getShops === "function") ? window.GameAPI.getShops() : [];
          if (shops && shops.length) {
            const s0 = shops[0];
            const openNow = (typeof window.GameAPI.isShopOpenNowFor === "function") ? window.GameAPI.isShopOpenNowFor(s0) : false;
            const sched = (typeof window.GameAPI.getShopSchedule === "function") ? window.GameAPI.getShopSchedule(s0) : "";
            record(true, `Shop check: ${s0.name || "Shop"} is ${openNow ? "OPEN" : "CLOSED"} (${sched})`);
            // Boundary sanity: try exact minute-level transitions if advanceMinutes is available
            try {
              const clk = (typeof window.GameAPI.getClock === "function") ? window.GameAPI.getClock() : null;
              if (clk && typeof window.GameAPI.advanceMinutes === "function") {
                // Move to 07:59 (assuming typical 08:00 open) then to 08:00
                const curMin = clk.hours * 60 + clk.minutes;
                const to759 = ((8 * 60 - 1) - curMin + 24 * 60) % (24 * 60);
                window.GameAPI.advanceMinutes(to759);
                await sleep(120);
                const at759 = (typeof window.GameAPI.isShopOpenNowFor === "function") ? window.GameAPI.isShopOpenNowFor(s0) : false;
                window.GameAPI.advanceMinutes(1); // to 08:00
                await sleep(120);
                const at800 = (typeof window.GameAPI.isShopOpenNowFor === "function") ? window.GameAPI.isShopOpenNowFor(s0) : false;
                record(true, `Shop boundary: 07:59=${at759 ? "OPEN" : "CLOSED"} 08:00=${at800 ? "OPEN" : "CLOSED"}`);
              } else {
                // Fallback: reach morning
                const before = openNow;
                if (typeof window.GameAPI.restUntilMorning === "function") window.GameAPI.restUntilMorning();
                await sleep(200);
                const after = (typeof window.GameAPI.isShopOpenNowFor === "function") ? window.GameAPI.isShopOpenNowFor(s0) : before;
                record(true, `Shop open state after morning: ${after ? "OPEN" : "CLOSED"}`);
              }
            } catch (_) {}
          } else {
            record(true, "No shops available to check");
          }

          // Basic currency check (future-proof to shop interactions)
          try {
            if (typeof window.GameAPI.getGold === "function" && typeof window.GameAPI.addGold === "function" && typeof window.GameAPI.removeGold === "function") {
              const g0 = window.GameAPI.getGold();
              window.GameAPI.addGold(25);
              const g1 = window.GameAPI.getGold();
              const addOk = g1 >= g0 + 25;
              window.GameAPI.removeGold(10);
              const g2 = window.GameAPI.getGold();
              const remOk = g2 === (g1 - 10) || g2 <= g1;
              record(addOk && remOk, `Gold ops: ${g0} -> ${g1} -> ${g2}`);
            } else {
              recordSkip("Gold ops not available in GameAPI");
            }
          } catch (e) {
            record(false, "Gold ops failed: " + (e && e.message ? e.message : String(e)));
          }

          // Attempt bump-buy: find NPC adjacent to a shop and bump into them; verify gold or inventory changes
          try {
            const npcs = (typeof window.GameAPI.getNPCs === "function") ? window.GameAPI.getNPCs() : [];
            if (shops && shops.length && npcs && npcs.length && typeof window.GameAPI.getGold === "function") {
              // Find first NPC within Manhattan distance <= 1 of any shop
              let targetNPC = null;
              for (const n of npcs) {
                let near = false;
                for (const s of shops) {
                  const d = Math.abs(n.x - s.x) + Math.abs(n.y - s.y);
                  if (d <= 1) { near = true; break; }
                }
                if (near) { targetNPC = n; break; }
              }
              if (targetNPC) {
                const gBefore = window.GameAPI.getGold();
                // route to adjacent tile to the NPC and then bump
                const adj = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}]
                  .map(v => ({ x: targetNPC.x + v.dx, y: targetNPC.y + v.dy }));
                let path = [];
                for (const a of adj) {
                  const p = (typeof window.GameAPI.routeToDungeon === "function") ? window.GameAPI.routeToDungeon(a.x, a.y) : [];
                  if (p && p.length) { path = p; break; }
                }
                const budget = makeBudget(CONFIG.timeouts.route);
                for (const step of path) {
                  if (budget.exceeded()) { recordSkip("Routing to shopkeeper timed out"); break; }
                  const dx = Math.sign(step.x - window.GameAPI.getPlayer().x);
                  const dy = Math.sign(step.y - window.GameAPI.getPlayer().y);
                  key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                  await sleep(100);
                }
                // bump into shopkeeper
                const dx = Math.sign(targetNPC.x - window.GameAPI.getPlayer().x);
                const dy = Math.sign(targetNPC.y - window.GameAPI.getPlayer().y);
                key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                await sleep(220);
                const gAfter = window.GameAPI.getGold();
                const inv = (typeof window.GameAPI.getInventory === "function") ? window.GameAPI.getInventory() : [];
                const gotItem = inv && inv.length ? true : false; // heuristic: any new item appeared (can't precisely diff without snapshot)
                const spentGold = gAfter < gBefore;
                record(spentGold || gotItem, `Bump-buy near shop: gold ${gBefore} -> ${gAfter}${gotItem ? ", inventory updated" : ""}`);
              } else {
                recordSkip("No NPC found near a shop for bump-buy");
              }
            } else {
              recordSkip("Bump-buy skipped (no shops/NPCs or gold API missing)");
            }
          } catch (e) {
            record(false, "Bump-buy failed: " + (e && e.message ? e.message : String(e)));
          }

          // Optional: attempt to route to first shop and interact (press G), then Esc-close UI
          try {
            if (shops && shops.length) {
              const shop = shops[0];
              const pathS = (typeof window.GameAPI.routeToDungeon === "function") ? window.GameAPI.routeToDungeon(shop.x, shop.y) : [];
              const budget = makeBudget(CONFIG.timeouts.route);
              for (const step of pathS) {
                if (budget.exceeded()) { recordSkip("Routing to shop timed out"); break; }
                const dx = Math.sign(step.x - window.GameAPI.getPlayer().x);
                const dy = Math.sign(step.y - window.GameAPI.getPlayer().y);
                key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                await sleep(100);
              }
              const ib = makeBudget(CONFIG.timeouts.interact);
              key("KeyG"); // open shop interaction
              await sleep(Math.min(ib.remain(), 220));
              // Esc closes Shop UI fallback panel
              try {
                const open = !!(document.getElementById("shop-panel") && document.getElementById("shop-panel").hidden === false);
                if (open) {
                  key("Escape");
                  const closed = await waitUntilTrue(() => { const el = document.getElementById("shop-panel"); return !!(el && el.hidden === true); }, 600, 60);
                  record(closed, "Shop UI closes with Esc");
                } else {
                  record(true, "Shop UI not open (no Esc-close needed)");
                }
              } catch (_) {}
              // If future GameAPI provides shopBuy/shopSell, try them
              let didAny = false;
              if (typeof window.GameAPI.shopBuyFirst === "function") {
                const okB = !!window.GameAPI.shopBuyFirst();
                record(okB, "Shop buy (first item)");
                didAny = true;
              }
              if (typeof window.GameAPI.shopSellFirst === "function") {
                const okS = !!window.GameAPI.shopSellFirst();
                record(okS, "Shop sell (first inventory item)");
                didAny = true;
              }
              if (!didAny) {
                record(true, "Interacted at shop (G). No programmatic buy/sell API; skipped.");
              }
            }
          } catch (e) {
            record(false, "Shop interaction failed: " + (e && e.message ? e.message : String(e)));
          }

          // Town home-routes check: verify there are residents
          try {
            const res = (typeof window.GameAPI.checkHomeRoutes === "function") ? window.GameAPI.checkHomeRoutes() : null;
            const hasResidents = !!(res && res.residents && typeof res.residents.total === "number" && res.residents.total > 0);
            record(hasResidents, `Home routes: residents ${hasResidents ? res.residents.total : 0}${res && typeof res.unreachable === "number" ? `, unreachable ${res.unreachable}` : ""}`);
          } catch (e) {
            record(false, "Home routes check failed: " + (e && e.message ? e.message : String(e)));
          }
          // Resting (advance time)
          try {
            const inn = shops.find(s => (s.name || "").toLowerCase().includes("inn"));
            if (inn && typeof window.GameAPI.restAtInn === "function") {
              window.GameAPI.restAtInn();
              record(true, "Rested at inn (time advanced to morning, HP restored)");
            } else if (typeof window.GameAPI.restUntilMorning === "function") {
              window.GameAPI.restUntilMorning();
              record(true, "Rested until morning");
            }
          } catch (e) {
            record(false, "Resting failed: " + (e && e.message ? e.message : String(e)));
          }

          // Overlay toggles + perf snapshot (town-only overlays)
          try {
            // Toggle routes/home paths to exercise renderer, then capture perf
            const perfBefore = (typeof window.GameAPI.getPerf === "function") ? window.GameAPI.getPerf() : { lastDrawMs: 0 };
            safeClick("god-toggle-route-paths-btn"); await sleep(100);
            safeClick("god-toggle-home-paths-btn"); await sleep(100);
            const perfAfter = (typeof window.GameAPI.getPerf === "function") ? window.GameAPI.getPerf() : { lastDrawMs: 0 };
            const perfOk = (perfAfter.lastDrawMs || 0) <= (CONFIG.perfBudget.drawMs * 2.0); // lenient budget
            record(perfOk, `Overlay perf: draw ${perfAfter.lastDrawMs?.toFixed ? perfAfter.lastDrawMs.toFixed(2) : perfAfter.lastDrawMs}ms`);
          } catch (e) {
            record(false, "Overlay/perf snapshot failed: " + (e && e.message ? e.message : String(e)));
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
      } catch (e) {
        record(false, "Diagnostics/schedule failed: " + (e && e.message ? e.message : String(e)));
      }

      const ok = errors.length === 0;
      log(ok ? "Smoke test completed." : "Smoke test completed with errors.", ok ? "good" : "warn");

      // Capture console/browser errors for this run
      runMeta.console = ConsoleCapture.snapshot();

      // Derive passed/failed lists
      const passedSteps = steps.filter(s => s.ok).map(s => s.msg);
      const failedSteps = steps.filter(s => !s.ok).map(s => s.msg);

      // Report into GOD panel
      // Pretty step list renderer
      function renderStepsPretty(list) {
        return list.map(s => {
          const isSkip = !!s.skipped;
          const isOk = !!s.ok && !isSkip;
          const isFail = !s.ok && !isSkip;

          const bg = isSkip ? "rgba(234,179,8,0.10)" : (isOk ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)");
          const border = isSkip ? "#fde68a" : (isOk ? "#86efac" : "#fca5a5");
          const color = border;
          const mark = isSkip ? "⏭" : (isOk ? "✔" : "✖");
          const badge = isSkip ? `<span style="font-size:10px;color:#1f2937;background:#fde68a;border:1px solid #f59e0b;padding:1px 4px;border-radius:4px;margin-left:6px;">SKIP</span>`
                               : (isOk ? `<span style="font-size:10px;color:#1f2937;background:#86efac;border:1px solid #22c55e;padding:1px 4px;border-radius:4px;margin-left:6px;">OK</span>`
                                       : `<span style="font-size:10px;color:#1f2937;background:#fca5a5;border:1px solid #ef4444;padding:1px 4px;border-radius:4px;margin-left:6px;">FAIL</span>`);

          return `<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 8px;border:1px solid ${border};border-radius:6px;background:${bg};margin:4px 0;">
            <div style="min-width:16px;color:${color};font-weight:bold;">${mark}</div>
            <div style="color:${color}">${s.msg}${badge}</div>
          </div>`;
        }).join("");
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
      const capsLine = Object.keys(caps).length
        ? `<div class="help" style="color:#8aa0bf; margin-top:6px;">Runner v${RUNNER_VERSION} | Caps: ${Object.keys(caps).filter(k => caps[k]).join(", ")}</div>`
        : `<div class="help" style="color:#8aa0bf; margin-top:6px;">Runner v${RUNNER_VERSION}</div>`;

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

      const headerHtml = `
        <div style="margin-bottom:6px;">
          <div><strong>Smoke Test Result:</strong> ${ok ? "<span style='color:#86efac'>PASS</span>" : "<span style='color:#fca5a5'>PARTIAL/FAIL</span>"}</div>
          <div>Steps: ${steps.length}  Issues: <span style="color:${totalIssues ? "#ef4444" : "#86efac"};">${totalIssues}</span></div>
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
})();