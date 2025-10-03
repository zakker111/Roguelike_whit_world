// Tiny Roguelike Smoke Test Runner
// Loads when index.html?smoketest=1; runs a minimal scenario and reports pass/fail to Logger, console, and an on-screen banner.
// Also exposes a global SmokeTest.run() so it can be triggered via GOD panel.

(function () {
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

  function log(msg, type) {
    const banner = ensureBanner();
    const line = "[SMOKE] " + msg;
    banner.textContent = line;
    try {
      if (window.Logger && typeof Logger.log === "function") {
        Logger.log(line, type || "info");
      }
    } catch (_) {}
    try {
      console.log(line);
    } catch (_) {}
  }

  // Detailed checklist logging
  function logChecklist(checks) {
    const order = [
      "openedGodPanel",
      "appliedSeed",
      "adjustedFov",
      "routedToDungeon",
      "enteredDungeonAttempted",
      "closedGodPanel",
      "movedAndAttacked",
      "inventoryOpenedClosed",
      "lootedUnderfootAttempted",
      "spawnedEnemyIfDungeon",
      "routedToEnemy",
      "lootedEnemyAttempted",
      "ranDiagnostics",
    ];
    log("Checklist summary:", "notice");
    for (const key of order) {
      const v = checks[key];
      let status = "SKIPPED";
      let tone = "warn";
      if (v === true) { status = "OK"; tone = "good"; }
      else if (v === false) { status = "FAILED"; tone = "bad"; }
      else if (typeof v === "string") {
        status = v.toUpperCase();
        tone = v.toLowerCase().includes("fail") ? "bad" : (v.toLowerCase().includes("skip") ? "warn" : "info");
      }
      const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
      try {
        if (window.Logger && typeof Logger.log === "function") {
          Logger.log(`[SMOKE] CHECK: ${label}: ${status}`, tone);
        }
      } catch (_) {}
      try { console.log(`[SMOKE] CHECK: ${label}: ${status}`); } catch (_) {}
    }
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

  async function run() {
    const checks = Object.create(null);
    try {
      log("Starting smoke test…", "notice");
      // Step 1: open GOD panel
      await sleep(250);
      try {
        clickById("god-open-btn");
        checks.openedGodPanel = true;
        log("Opened GOD panel", "info");
      } catch (e) {
        checks.openedGodPanel = false;
        log("Failed to open GOD panel: " + (e && e.message ? e.message : String(e)), "bad");
      }
      await sleep(250);

      // Step 2: set seed
      try {
        setInputValue("god-seed-input", 12345);
        clickById("god-apply-seed-btn");
        checks.appliedSeed = true;
        log("Applied seed 12345", "info");
      } catch (e) {
        checks.appliedSeed = false;
        log("Failed to apply seed: " + (e && e.message ? e.message : String(e)), "bad");
      }
      await sleep(600);

      // Step 3: adjust FOV to 10 via slider (if present)
      try {
        const fov = document.getElementById("god-fov");
        if (fov) { fov.value = "10"; fov.dispatchEvent(new Event("input", { bubbles: true })); checks.adjustedFov = true; }
        else { checks.adjustedFov = "skipped (no slider)"; }
        log("Adjusted FOV to 10", "info");
      } catch (e) {
        checks.adjustedFov = false;
        log("Failed to adjust FOV: " + (e && e.message ? e.message : String(e)), "bad");
      }
      await sleep(250);

      // Step 4: close GOD and route to nearest dungeon in overworld
      key("Escape");
      await sleep(250);
      try {
        const inWorld = (window.GameAPI && typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() === "world");
        if (inWorld) {
          log("Routing to nearest dungeon…", "info");
          const ok = await window.GameAPI.gotoNearestDungeon();
          checks.routedToDungeon = !!ok;
          if (!ok) {
            log("Failed to route to dungeon automatically; performing manual moves.", "warn");
            const moves = ["ArrowRight","ArrowDown","ArrowLeft","ArrowUp","ArrowRight","ArrowRight","ArrowDown","ArrowDown","ArrowRight"];
            for (const m of moves) { key(m); await sleep(120); }
            checks.routedToDungeon = "fallback-manual";
          }
          // Enter dungeon (press Enter on D)
          key("Enter");
          checks.enteredDungeonAttempted = true;
          await sleep(500);
          log("Attempted dungeon entry.", "info");
        } else {
          checks.routedToDungeon = "skipped (not in overworld)";
          checks.enteredDungeonAttempted = "skipped";
          log("Not in overworld; skipping auto-route.", "warn");
        }
      } catch (e) {
        checks.routedToDungeon = false;
        checks.enteredDungeonAttempted = false;
        log("Routing error: " + (e && e.message ? e.message : String(e)), "bad");
      }

      // Step 5: close GOD (Esc)
      key("Escape");
      checks.closedGodPanel = true;
      log("Closed GOD panel", "info");
      await sleep(250);

      // Step 6: move towards enemy (try a few steps) and attack by bump
      try {
        const moves = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowRight", "ArrowDown"];
        for (const m of moves) { key(m); await sleep(140); }
        checks.movedAndAttacked = true;
        log("Moved and attempted attacks", "info");
      } catch (e) {
        checks.movedAndAttacked = false;
        log("Movement/attack simulation failed: " + (e && e.message ? e.message : String(e)), "bad");
      }

      // Step 7: open inventory, then close
      try {
        key("KeyI");
        await sleep(300);
        key("Escape");
        checks.inventoryOpenedClosed = true;
        log("Opened and closed inventory", "info");
      } catch (e) {
        checks.inventoryOpenedClosed = false;
        log("Inventory open/close failed: " + (e && e.message ? e.message : String(e)), "bad");
      }
      await sleep(250);

      // Step 8: loot (G) any corpse beneath player (if present)
      try {
        key("KeyG");
        await sleep(300);
        checks.lootedUnderfootAttempted = true;
        log("Attempted loot underfoot", "info");
      } catch (e) {
        checks.lootedUnderfootAttempted = false;
        log("Loot underfoot failed: " + (e && e.message ? e.message : String(e)), "bad");
      }

      // Step 9: if in dungeon, spawn low-level enemy nearby and try to loot it
      try {
        const inDungeon = (window.GameAPI && typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() === "dungeon");
        if (inDungeon) {
          // Open GOD and spawn enemy
          clickById("god-open-btn");
          await sleep(250);
          clickById("god-spawn-enemy-btn"); // uses default count=1, level scales with floor; floor 1 is low
          checks.spawnedEnemyIfDungeon = true;
          log("Spawned test enemy in dungeon", "info");
          await sleep(250);
          key("Escape");
          await sleep(150);
          // Move towards nearest enemy and bump to attack
          const enemies = (typeof window.GameAPI.getEnemies === "function") ? window.GameAPI.getEnemies() : [];
          if (enemies && enemies.length) {
            // Pick nearest
            let best = enemies[0];
            let bestD = Math.abs(best.x - window.GameAPI.getPlayer().x) + Math.abs(best.y - window.GameAPI.getPlayer().y);
            for (const e of enemies) {
              const d = Math.abs(e.x - window.GameAPI.getPlayer().x) + Math.abs(e.y - window.GameAPI.getPlayer().y);
              if (d < bestD) { best = e; bestD = d; }
            }
            const path = (typeof window.GameAPI.routeToDungeon === "function") ? window.GameAPI.routeToDungeon(best.x, best.y) : [];
            for (const step of path) {
              const dx = Math.sign(step.x - window.GameAPI.getPlayer().x);
              const dy = Math.sign(step.y - window.GameAPI.getPlayer().y);
              key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
              await sleep(120);
            }
            checks.routedToEnemy = true;
            // Attempt to loot underfoot
            key("KeyG");
            await sleep(250);
            checks.lootedEnemyAttempted = true;
            log("Attempted to loot defeated enemy", "info");
          } else {
            checks.routedToEnemy = "skipped (no enemies)";
            checks.lootedEnemyAttempted = "skipped";
            log("No enemies found to route/loot.", "warn");
          }
        } else {
          checks.spawnedEnemyIfDungeon = "skipped (not in dungeon)";
          checks.routedToEnemy = "skipped";
          checks.lootedEnemyAttempted = "skipped";
        }
      } catch (e) {
        checks.spawnedEnemyIfDungeon = false;
        log("Dungeon test error: " + (e && e.message ? e.message : String(e)), "bad");
      }

      // Step 10: open GOD Diagnostics and log output
      try {
        clickById("god-open-btn");
        await sleep(250);
        clickById("god-diagnostics-btn");
        checks.ranDiagnostics = true;
        log("Ran Diagnostics", "info");
        await sleep(300);
        key("Escape");
      } catch (e) {
        checks.ranDiagnostics = false;
        log("Diagnostics failed: " + (e && e.message ? e.message : String(e)), "bad");
      }

      logChecklist(checks);
      log("Smoke test completed.", "good");
    } catch (err) {
      log("Smoke test failed: " + (err && err.message ? err.message : String(err)), "bad");
      try { console.error(err); } catch (_) {}
    }
  }

  // Expose a global trigger
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.run = run;

  // Auto-run conditions:
  // - If ?smoketest=1 param was set and script loaded during/after page load
  // - If the loader set window.SMOKETEST_REQUESTED
  try {
    var params = new URLSearchParams(location.search);
    var shouldAuto = (params.get("smoketest") === "1") || (window.SMOKETEST_REQUESTED === true);
    if (document.readyState !== "loading") {
      if (shouldAuto) { setTimeout(() => { run(); }, 400); }
    } else {
      window.addEventListener("load", () => {
        if (shouldAuto) { setTimeout(() => { run(); }, 800); }
      });
    }
  } catch (_) {
    // Fallback: run on load if present
    window.addEventListener("load", () => { setTimeout(() => { run(); }, 800); });
  }
})();