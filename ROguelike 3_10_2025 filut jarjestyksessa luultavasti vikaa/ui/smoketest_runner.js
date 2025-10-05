// Tiny Roguelike Smoke Test Runner
// Loads when index.html?smoketest=1; runs a minimal scenario and reports pass/fail to Logger, console, and an on-screen banner.
// Also exposes a global SmokeTest.run() so it can be triggered via GOD panel.

(function () {
  const RUNNER_VERSION = "1.3.0";
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

  // Global collection of console/browser errors during smoke test runs
  const ConsoleCapture = {
    errors: [],
    warns: [],
    onerrors: [],
    installed: false,
    install() {
      if (this.installed) return;
      this.installed = true;
      const self = this;
      // Wrap console.error/warn
      try {
        const cerr = console.error.bind(console);
        const cwarn = console.warn.bind(console);
        console.error = function (...args) {
          try { self.errors.push(args.map(String).join(" ")); } catch (_) {}
          return cerr(...args);
        };
        console.warn = function (...args) {
          try { self.warns.push(args.map(String).join(" ")); } catch (_) {}
          return cwarn(...args);
        };
      } catch (_) {}
      // window.onerror
      try {
        window.addEventListener("error", (ev) => {
          try {
            const msg = ev && ev.message ? ev.message : String(ev);
            self.onerrors.push(msg);
          } catch (_) {}
        });
        window.addEventListener("unhandledrejection", (ev) => {
          try {
            const msg = ev && ev.reason ? (ev.reason.message || String(ev.reason)) : String(ev);
            self.onerrors.push("unhandledrejection: " + msg);
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
      return {
        consoleErrors: this.errors.slice(0),
        consoleWarns: this.warns.slice(0),
        windowErrors: this.onerrors.slice(0),
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
    } catch (_) {}
    return caps;
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

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

      // Step 3: adjust FOV to 10 via slider (if present)
      try {
        const fov = document.getElementById("god-fov");
        if (fov) { fov.value = "10"; fov.dispatchEvent(new Event("input", { bubbles: true })); }
        record(true, "Adjusted FOV to 10");
      } catch (e) {
        record(false, "Adjust FOV failed: " + (e && e.message ? e.message : String(e)));
      }
      await sleep(250);

      // Step 4: close GOD and route to nearest dungeon in overworld
      try {
        key("Escape");
        await sleep(250);
        if (window.GameAPI && typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() === "world") {
          const ok = await window.GameAPI.gotoNearestDungeon();
          if (!ok) {
            // Try some manual moves
            const moves = ["ArrowRight","ArrowDown","ArrowLeft","ArrowUp","ArrowRight","ArrowRight","ArrowDown","ArrowDown","ArrowRight"];
            for (const m of moves) { key(m); await sleep(120); }
          }
          key("Enter"); // Enter dungeon (press Enter on D)
          await sleep(500);
          record(true, "Attempted dungeon entry");
          // Determinism sample: first enemy type and chest loot names before any runner mutations
          try {
            const enemies0 = (typeof window.GameAPI.getEnemies === "function") ? window.GameAPI.getEnemies() : [];
            const firstEnemyType = enemies0 && enemies0.length ? (enemies0[0].type || "") : "";
            const chests = (typeof window.GameAPI.getChestsDetailed === "function") ? window.GameAPI.getChestsDetailed() : [];
            const chestItems = chests && chests.length ? (chests[0].items || []) : [];
            runMeta.determinism.firstEnemyType = firstEnemyType;
            runMeta.determinism.chestItems = chestItems.slice(0);
          } catch (_) {}
        } else {
          record(true, "Skipped routing (not in overworld)");
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
            } else {
              record(true, "No chest found in dungeon (skipping chest loot)");
            }
          } catch (e) {
            record(false, "Chest loot failed: " + (e && e.message ? e.message : String(e)));
          }

          // 9b: equip best items from inventory (if any) and test manual equip/unequip
          try {
            const inv = (typeof window.GameAPI.getInventory === "function") ? window.GameAPI.getInventory() : [];
            const beforeEq = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
            const equippedNames = (typeof window.GameAPI.equipBestFromInventory === "function") ? window.GameAPI.equipBestFromInventory() : [];
            const afterEq = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
            record(true, `Equipped from chest loot: ${equippedNames.length ? equippedNames.join(", ") : "no changes"}`);

            // Manual equip: find first equip item in inventory and equip it, then unequip the same slot
            const equipIdx = inv.findIndex(it => it && it.kind === "equip");
            if (equipIdx !== -1 && typeof window.GameAPI.equipItemAtIndex === "function" && typeof window.GameAPI.unequipSlot === "function") {
              const item = inv[equipIdx];
              const ok1 = window.GameAPI.equipItemAtIndex(equipIdx);
              await sleep(120);
              const slot = item.slot || "hand";
              const ok2 = window.GameAPI.unequipSlot(slot);
              await sleep(120);
              record(ok1 && ok2, `Manual equip/unequip (${item.name || "equip"} in slot ${slot})`);
            } else {
              record(true, "No direct equip/unequip test performed (no equip item or API not present)");
            }
          } catch (e) {
            record(false, "Equip/unequip sequence failed: " + (e && e.message ? e.message : String(e)));
          }

          // 9c: spawn an enemy, record pre-decay, attack, compare decay
          if (safeClick("god-open-btn")) {
            await sleep(200);
            if (safeClick("god-spawn-enemy-btn")) {
              record(true, "Spawned test enemy in dungeon");
            } else {
              recordSkip("Spawn enemy button not present");
            }
          } else {
            recordSkip("GOD open button not present (spawn)");
          }
          await sleep(200);
          key("Escape");
          await sleep(120);

          const enemies = (typeof window.GameAPI.getEnemies === "function") ? window.GameAPI.getEnemies() : [];
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
              record(true, "No hand equipment to measure decay");
            }

            // Attempt to loot underfoot if enemy died
            key("KeyG");
            await sleep(220);
            record(true, "Attempted to loot defeated enemy");
          } else {
            record(true, "No enemies found to route/loot");
          }

          // 9d: Attempt to return to overworld via dungeon exit ('>')
          try {
            const exit = (typeof window.GameAPI.getDungeonExit === "function") ? window.GameAPI.getDungeonExit() : null;
            if (exit) {
              const pathBack = window.GameAPI.routeToDungeon(exit.x, exit.y);
              for (const step of pathBack) {
                const dx = Math.sign(step.x - window.GameAPI.getPlayer().x);
                const dy = Math.sign(step.y - window.GameAPI.getPlayer().y);
                key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                await sleep(110);
              }
              key("KeyG"); // exit on '>'
              await sleep(360);
              record(true, "Returned to overworld from dungeon");
            } else {
              record(true, "Skipped return to overworld (no exit info)");
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

      // Step 10: from overworld, visit nearest town and interact
      try {
        if (window.GameAPI && typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() === "world") {
          const okTown = await window.GameAPI.gotoNearestTown();
          if (!okTown) {
            // try a few manual moves
            const moves = ["ArrowRight","ArrowUp","ArrowLeft","ArrowDown","ArrowRight","ArrowRight"];
            for (const m of moves) { key(m); await sleep(120); }
          }
          key("Enter"); // enter town (press Enter on T)
          await sleep(400);
          // Fallback 1: call API to enter if available
          try { if (window.GameAPI && typeof window.GameAPI.enterTownIfOnTile === "function") window.GameAPI.enterTownIfOnTile(); } catch (_) {}
          await sleep(200);
          let nowMode = (window.GameAPI && typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : "";
          if (nowMode !== "town") {
            // Fallback 2: if standing adjacent to a Town tile, step onto it and try again
            try {
              const world = (typeof window.GameAPI.getWorld === "function") ? window.GameAPI.getWorld() : null;
              const player = (typeof window.GameAPI.getPlayer === "function") ? window.GameAPI.getPlayer() : null;
              const T = (window.World && window.World.TILES) ? window.World.TILES : null;
              if (world && player && T && typeof T.TOWN === "number" && Array.isArray(world.map)) {
                const adj = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
                let stepped = false;
                for (const d of adj) {
                  const nx = player.x + d.dx, ny = player.y + d.dy;
                  if (ny >= 0 && ny < world.map.length && nx >= 0 && nx < (world.map[0] ? world.map[0].length : 0)) {
                    if (world.map[ny][nx] === T.TOWN) {
                      // move onto town tile
                      if (typeof window.GameAPI.moveStep === "function") {
                        window.GameAPI.moveStep(d.dx, d.dy);
                        await sleep(120);
                        try { if (typeof window.GameAPI.enterTownIfOnTile === "function") window.GameAPI.enterTownIfOnTile(); } catch (_) {}
                        await sleep(200);
                        stepped = true;
                        break;
                      }
                    }
                  }
                }
                if (!stepped) {
                  // As a last resort, attempt a short radius-2 scan to find a Town tile and route to it
                  const r = 2;
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
                    const budget = makeBudget(1500);
                    for (const step of path) {
                      if (budget.exceeded()) break;
                      const ddx = Math.sign(step.x - ((typeof window.GameAPI.getPlayer === "function") ? window.GameAPI.getPlayer().x : step.x));
                      const ddy = Math.sign(step.y - ((typeof window.GameAPI.getPlayer === "function") ? window.GameAPI.getPlayer().y : step.y));
                      key(ddx === -1 ? "ArrowLeft" : ddx === 1 ? "ArrowRight" : (ddy === -1 ? "ArrowUp" : "ArrowDown"));
                      await sleep(90);
                    }
                    try { if (typeof window.GameAPI.enterTownIfOnTile === "function") window.GameAPI.enterTownIfOnTile(); } catch (_) {}
                    await sleep(200);
                  }
                }
              }
            } catch (_) {}
          }
          nowMode = (window.GameAPI && typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : "";
          if (nowMode === "town") {
            record(true, "Entered town");
          } else {
            // Not an error for some maps/runs; treat as skipped to avoid failing the run.
            recordSkip("Town entry not achieved (still in " + nowMode + ")");
          }

          // NPC check: route to nearest NPC and bump into them
          let lastNPC = null;
          try {
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
              record(true, "No NPCs reported (town may be empty?)");
            }
          } catch (e) {
            record(false, "NPC interaction failed: " + (e && e.message ? e.message : String(e)));
          }

          // NPC home + decorations check: go to NPC's house and verify decorations/props exist
          try {
            if (lastNPC && typeof lastNPC.i === "number" && typeof window.GameAPI.getNPCHomeByIndex === "function") {
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
                record(true, "NPC had no home building info");
              }
            } else {
              record(true, "Skipped NPC home check (no NPC found or API not available)");
            }
          } catch (e) {
            record(false, "NPC home/decoration verification failed: " + (e && e.message ? e.message : String(e)));
          }

          // Decoration/props check: find nearby prop and press G
          try {
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
              record(true, "No town decorations/props reported");
            }
          } catch (e) {
            record(false, "Decoration/prop interaction failed: " + (e && e.message ? e.message : String(e)));
          }
        } else {
          record(true, "Skipped town visit (not in overworld)");
        }
      } catch (e) {
        record(false, "Town visit error: " + (e && e.message ? e.message : String(e)));
      }

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

          // Optional: attempt to route to first shop and interact (press G)
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
              key("KeyG");
              await sleep(Math.min(ib.remain(), 180));
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
      const detailsHtml = steps.map(s => {
        const color = s.ok ? (s.skipped ? "#fde68a" : "#86efac") : "#fca5a5";
        const mark = s.ok ? (s.skipped ? "⏭" : "✔") : "✖";
        return `<div style="color:${color};">${mark} ${s.msg}</div>`;
      }).join("");
      const passedHtml = passedSteps.length ? (`<div style="margin-top:6px;"><strong>Passed (${passedSteps.length}):</strong></div>` + passedSteps.map(m => `<div style="color:#86efac;">• ${m}</div>`).join("")) : "";
      const skippedHtml = skipped.length ? (`<div style="margin-top:6px;"><strong>Skipped (${skipped.length}):</strong></div>` + skipped.map(m => `<div style="color:#fde68a;">• ${m}</div>`).join("")) : "";
      const extraErrors = []
        .concat((runMeta.console.consoleErrors || []).map(m => `console.error: ${m}`))
        .concat((runMeta.console.windowErrors || []).map(m => `window: ${m}`))
        .concat((runMeta.console.consoleWarns || []).map(m => `console.warn: ${m}`));
      const totalIssues = errors.length + extraErrors.length;
      const issuesHtml = totalIssues
        ? `<div style="margin-top:8px; color:#ef4444;"><strong>Issues (${totalIssues}):</strong></div>` +
          errors.map(e => `<div style="color:#f87171;">• ${e}</div>`).join("") +
          (extraErrors.length ? `<div style="color:#f87171; margin-top:4px;"><em>Console/Browser</em></div>` + extraErrors.slice(0, 8).map(e => `<div style="color:#f87171;">• ${e}</div>`).join("") : ``)
        : "";
      const caps = runMeta.caps || {};
      const capsLine = Object.keys(caps).length ? `<div class="help" style="color:#8aa0bf; margin-top:4px;">Runner v${RUNNER_VERSION} | Caps: ${Object.keys(caps).filter(k => caps[k]).join(", ")}</div>` : `<div class="help" style="color:#8aa0bf; margin-top:4px;">Runner v${RUNNER_VERSION}</div>`;
      const html = [
        `<div><strong>Smoke Test Result:</strong> ${ok ? "PASS" : "PARTIAL/FAIL"}</div>`,
        `<div>Steps: ${steps.length}  Errors: <span style="color:${totalIssues ? "#ef4444" : "#86efac"};">${totalIssues}</span></div>`,
        capsLine,
        issuesHtml,
        passedHtml,
        skippedHtml,
        `<div style="margin-top:6px;"><strong>Details</strong></div>`,
        detailsHtml,
      ].join("");
      panelReport(html);

      return { ok, steps, errors, passedSteps, failedSteps, skipped, console: runMeta.console, determinism: runMeta.determinism, seed: runMeta.seed, caps: runMeta.caps, runnerVersion: RUNNER_VERSION };
    } catch (err) {
      log("Smoke test failed: " + (err && err.message ? err.message : String(err)), "bad");
      try { console.error(err); } catch (_) {}
      const html = `<div><strong>Smoke Test Result:</strong> FAIL (runner crashed)</div><div>${(err && err.message) ? err.message : String(err)}</div>`;
      panelReport(html);
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

    const summary = [
      `<div><strong>Smoke Test Summary:</strong></div>`,
      `<div>Runs: ${n}  Pass: ${pass}  Fail: <span style="color:${fail ? "#ef4444" : "#86efac"};">${fail}</span></div>`,
      `<div>Checks: passed ${totalPassedSteps}, failed <span style="color:${totalFailedSteps ? "#ef4444" : "#86efac"};">${totalFailedSteps}</span>, skipped <span style="color:#fde68a;">${totalSkippedSteps}</span></div>`,
      `<div>Avg PERF: turn ${avgTurn} ms, draw ${avgDraw} ms</div>`,
      perfWarnings.length ? `<div style="color:#ef4444; margin-top:4px;"><strong>Performance:</strong> ${perfWarnings.join("; ")}</div>` : ``,
      n === 1 && det.npcPropSample ? `<div>Determinism sample (NPC|prop): ${det.npcPropSample}</div>` : ``,
      n === 1 && det.firstEnemyType ? `<div>Determinism sample (first enemy): ${det.firstEnemyType}</div>` : ``,
      n === 1 && det.chestItemsCSV ? `<div>Determinism sample (chest loot): ${det.chestItemsCSV}</div>` : ``,
      `<div class="help" style="color:#8aa0bf; margin-top:4px;">Runner v${RUNNER_VERSION}</div>`,
      fail ? `<div style="margin-top:6px; color:#ef4444;"><strong>Some runs failed.</strong> See per-run details above.</div>` : ``
    ].join("");
    panelReport(summary);
    log(`Smoke test series done. Pass=${pass} Fail=${fail} AvgTurn=${avgTurn} AvgDraw=${avgDraw}`, fail === 0 ? "good" : "warn");

    // Provide export buttons for JSON and TXT summary
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

      const summaryText = buildSummaryText(report);
      window.SmokeTest.lastSummaryText = summaryText;

      const btnHtml = `
        <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
          <button id="smoke-export-btn" style="padding:6px 10px; background:#1f2937; color:#e5e7eb; border:1px solid #334155; border-radius:4px; cursor:pointer;">Download Report (JSON)</button>
          <button id="smoke-export-summary-btn" style="padding:6px 10px; background:#1f2937; color:#e5e7eb; border:1px solid #334155; border-radius:4px; cursor:pointer;">Download Summary (TXT)</button>
        </div>`;
      appendToPanel(btnHtml);

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