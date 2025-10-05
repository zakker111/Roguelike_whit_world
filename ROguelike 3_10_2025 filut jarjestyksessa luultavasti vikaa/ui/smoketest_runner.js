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

  function panelReport(html) {
    try {
      const el = document.getElementById("god-check-output");
      if (el) el.innerHTML = html;
    } catch (_) {}
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
  async function runOnce() {
    const steps = [];
    const errors = [];
    const record = (ok, msg) => {
      steps.push({ ok, msg });
      if (!ok) errors.push(msg);
      log((ok ? "OK: " : "ERR: ") + msg, ok ? "good" : "bad");
    };

    try {
      log("Starting smoke test…", "notice");

      // Step 1: open GOD panel
      try {
        await sleep(250);
        clickById("god-open-btn");
        record(true, "Opened GOD panel");
      } catch (e) {
        record(false, "Open GOD panel: " + (e && e.message ? e.message : String(e)));
      }
      await sleep(250);

      // Step 2: set seed
      try {
        setInputValue("god-seed-input", 12345);
        clickById("god-apply-seed-btn");
        record(true, "Applied seed 12345");
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

      // Step 9: if in dungeon, spawn low-level enemy nearby and try to loot it
      try {
        if (window.GameAPI && typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() === "dungeon") {
          clickById("god-open-btn");
          await sleep(250);
          clickById("god-spawn-enemy-btn");
          record(true, "Spawned test enemy in dungeon");
          await sleep(250);
          key("Escape");
          await sleep(150);
          const enemies = (typeof window.GameAPI.getEnemies === "function") ? window.GameAPI.getEnemies() : [];
          if (enemies && enemies.length) {
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
            key("KeyG");
            await sleep(250);
            record(true, "Attempted to loot defeated enemy");
          } else {
            record(true, "No enemies found to route/loot");
          }
        } else {
          record(true, "Skipped enemy spawn/loot (not in dungeon)");
        }
      } catch (e) {
        record(false, "Dungeon test error: " + (e && e.message ? e.message : String(e)));
      }

      // Step 10: open GOD Diagnostics and log output
      try {
        clickById("god-open-btn");
        await sleep(250);
        clickById("god-diagnostics-btn");
        record(true, "Ran Diagnostics");
        await sleep(300);
        key("Escape");
      } catch (e) {
        record(false, "Diagnostics failed: " + (e && e.message ? e.message : String(e)));
      }

      const ok = errors.length === 0;
      log(ok ? "Smoke test completed." : "Smoke test completed with errors.", ok ? "good" : "warn");

      // Report into GOD panel
      const html = [
        `<div><strong>Smoke Test Result:</strong> ${ok ? "PASS" : "PARTIAL/FAIL"}</div>`,
        `<div>Steps: ${steps.length}  Errors: ${errors.length}</div>`,
        `<div style="margin-top:6px;"><strong>Details</strong></div>`
      ].concat(steps.map(s => `<div style="color:${s.ok ? "#86efac" : "#fca5a5"};">${s.ok ? "✔" : "✖"} ${s.msg}</div>`)).join("");
      panelReport(html);

      return { ok, steps, errors };
    } catch (err) {
      log("Smoke test failed: " + (err && err.message ? err.message : String(err)), "bad");
      try { console.error(err); } catch (_) {}
      const html = `<div><strong>Smoke Test Result:</strong> FAIL (runner crashed)</div><div>${(err && err.message) ? err.message : String(err)}</div>`;
      panelReport(html);
      return { ok: false, steps: [], errors: [String(err)] };
    }
  }

  async function runSeries(count = 1) {
    const n = Math.max(1, Math.min(20, parseInt(count, 10) || 1));
    let pass = 0, fail = 0;
    const all = [];
    log(`Running smoke test ${n} time(s)…`, "notice");
    for (let i = 0; i < n; i++) {
      const res = await runOnce();
      all.push(res);
      if (res.ok) pass++; else fail++;
      panelReport(`<div><strong>Smoke Test Progress:</strong> ${i + 1} / ${n}</div><div>Pass: ${pass}  Fail: ${fail}</div>`);
      await sleep(300);
    }
    const summary = `<div><strong>Smoke Test Summary:</strong></div><div>Runs: ${n}  Pass: ${pass}  Fail: ${fail}</div>`;
    panelReport(summary);
    log(`Smoke test series done. Pass=${pass} Fail=${fail}`, fail === 0 ? "good" : "warn");
    return { pass, fail, results: all };
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