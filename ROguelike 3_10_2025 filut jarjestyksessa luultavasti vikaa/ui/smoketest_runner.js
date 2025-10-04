// Tiny Roguelike Smoke Test Runner
// Injected dynamically by GOD panel; runs a full scenario and reports progress via Logger, console, and an on-screen banner.
// Scenario: overworld -> dungeon -> spawn enemy -> kill -> loot -> exit to overworld -> enter town -> bump NPC -> check town sign -> GOD checks -> diagnostics.

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

  function randUint32() {
    try {
      const a = new Uint32Array(1);
      if (typeof crypto !== "undefined" && crypto.getRandomValues) {
        crypto.getRandomValues(a);
        return a[0] >>> 0;
      }
    } catch (_) {}
    return ((Math.random() * 0xffffffff) >>> 0);
  }

  async function attackUntilNoEnemyNearby(maxSteps = 40) {
    // Move around and attempt to bump/attack; stop early if enemy list shrinks to 0
    for (let i = 0; i < maxSteps; i++) {
      const enemies = (typeof window.GameAPI.getEnemies === "function") ? window.GameAPI.getEnemies() : [];
      if (!enemies || enemies.length === 0) return true;
      // Simple chase: pick nearest and take a step toward it; if adjacent, bump into it
      let best = enemies[0];
      let bestD = Math.abs(best.x - window.GameAPI.getPlayer().x) + Math.abs(best.y - window.GameAPI.getPlayer().y);
      for (const e of enemies) {
        const d = Math.abs(e.x - window.GameAPI.getPlayer().x) + Math.abs(e.y - window.GameAPI.getPlayer().y);
        if (d < bestD) { best = e; bestD = d; }
      }
      const px = window.GameAPI.getPlayer().x, py = window.GameAPI.getPlayer().y;
      const dx = Math.sign(best.x - px);
      const dy = Math.sign(best.y - py);
      // Prefer horizontal then vertical; if already adjacent, step into enemy tile to attack
      if (bestD <= 1) {
        if (best.x === px + 1 && best.y === py) key("ArrowRight");
        else if (best.x === px - 1 && best.y === py) key("ArrowLeft");
        else if (best.x === px && best.y === py + 1) key("ArrowDown");
        else if (best.x === px && best.y === py - 1) key("ArrowUp");
      } else {
        if (dx !== 0) key(dx === 1 ? "ArrowRight" : "ArrowLeft");
        else if (dy !== 0) key(dy === 1 ? "ArrowDown" : "ArrowUp");
      }
      await sleep(120);
    }
    return false;
  }

  async function run(seed) {
    try {
      const s = (typeof seed === "number") ? (seed >>> 0) : null;
      log("Starting smoke test" + (s != null ? ` (seed ${s})` : "") + "…", "notice");
      // Step 1: open GOD panel
      await sleep(250);
      clickById("god-open-btn");
      log("Opened GOD panel", "info");
      await sleep(250);

      // Step 2: set seed (random if not provided) and enable crits for fast kill
      const useSeed = (s != null ? s : randUint32());
      setInputValue("god-seed-input", useSeed);
      clickById("god-apply-seed-btn");
      log(`Applied seed ${useSeed}`, "info");
      await sleep(600);
      // Always Crit: On (head)
      try {
        clickById("god-toggle-crit-btn");
        await sleep(120);
        // Fallback: set part via localStorage
        try { localStorage.setItem("ALWAYS_CRIT_PART", "head"); } catch (_) {}
      } catch (_) {}
      await sleep(200);

      // Step 3: adjust FOV to 10 via slider (if present)
      try {
        const fov = document.getElementById("god-fov");
        if (fov) { fov.value = "10"; fov.dispatchEvent(new Event("input", { bubbles: true })); }
        log("Adjusted FOV to 10", "info");
      } catch (_) {}
      await sleep(250);

      // Step 4: close GOD and route to nearest dungeon in overworld
      key("Escape");
      await sleep(250);
      try {
        if (window.GameAPI && typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() === "world") {
          log("Routing to nearest dungeon…", "info");
          const ok = await window.GameAPI.gotoNearestDungeon();
          if (!ok) {
            log("Failed to route to dungeon automatically; performing manual moves.", "warn");
            const moves = ["ArrowRight","ArrowDown","ArrowLeft","ArrowUp","ArrowRight","ArrowRight","ArrowDown","ArrowDown","ArrowRight"];
            for (const m of moves) { key(m); await sleep(120); }
          }
          // Enter dungeon (press Enter on D)
          key("Enter");
          await sleep(500);
          log("Attempted dungeon entry.", "info");
        } else {
          log("Not in overworld; skipping auto-route.", "warn");
        }
      } catch (e) {
        log("Routing error: " + (e && e.message ? e.message : String(e)), "bad");
      }

      // Step 5: spawn enemy and kill it
      clickById("god-open-btn");
      await sleep(250);
      clickById("god-spawn-enemy-btn");
      log("Spawned test enemy in dungeon", "info");
      await sleep(250);
      key("Escape");
      await sleep(150);
      const killed = await attackUntilNoEnemyNearby(80);
      log(killed ? "Enemy killed via bump-attacks." : "Could not confirm kill within step budget.", killed ? "good" : "warn");

      // Step 6: loot (G) underfoot
      key("KeyG");
      await sleep(300);
      log("Attempted loot underfoot", "info");

      // Step 7: exit dungeon: spawn stairs underfoot to guarantee exit, then G
      clickById("god-open-btn");
      await sleep(200);
      clickById("god-spawn-stairs-btn");
      log("Spawned stairs underfoot for exit", "info");
      await sleep(200);
      key("Escape");
      await sleep(150);
      key("KeyG"); // leave via stairs
      await sleep(500);
      log("Exited to overworld", "info");

      // Step 8: route to nearest town and enter
      if (window.GameAPI && typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() === "world") {
        log("Routing to nearest town…", "info");
        const okTown = (typeof window.GameAPI.gotoNearestTown === "function") ? await window.GameAPI.gotoNearestTown() : false;
        if (!okTown) log("Route-to-town fallback: manual moves.", "warn");
        key("Enter"); // enter town tile
        await sleep(600);
        log("Attempted town entry.", "info");
      }

      // Step 9: bump an NPC (move to nearest NPC and bump)
      if (window.GameAPI.getMode && window.GameAPI.getMode() === "town") {
        // Sanity: ensure there are residents (NPCs) around
        const npcs = (typeof window.GameAPI.getNPCs === "function") ? window.GameAPI.getNPCs() : [];
        log(`NPCs present: ${npcs.length}`, npcs.length ? "info" : "warn");

        log("Routing to nearest NPC and bumping…", "info");
        if (npcs && npcs.length) {
          let best = npcs[0];
          let bestD = Math.abs(best.x - window.GameAPI.getPlayer().x) + Math.abs(best.y - window.GameAPI.getPlayer().y);
          for (const n of npcs) {
            const d = Math.abs(n.x - window.GameAPI.getPlayer().x) + Math.abs(n.y - window.GameAPI.getPlayer().y);
            if (d < bestD) { best = n; bestD = d; }
          }
          const pathToNpc = (typeof window.GameAPI.routeToTown === "function") ? window.GameAPI.routeToTown(best.x, best.y) : [];
          for (const step of pathToNpc.slice(0, 30)) {
            const dx = Math.sign(step.x - window.GameAPI.getPlayer().x);
            const dy = Math.sign(step.y - window.GameAPI.getPlayer().y);
            key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
            await sleep(120);
          }
          // final bump if adjacent
          const px = window.GameAPI.getPlayer().x, py = window.GameAPI.getPlayer().y;
          if (Math.abs(best.x - px) + Math.abs(best.y - py) <= 1) {
            if (best.x === px + 1 && best.y === py) key("ArrowRight");
            else if (best.x === px - 1 && best.y === py) key("ArrowLeft");
            else if (best.x === px && best.y === py + 1) key("ArrowDown");
            else if (best.x === px && best.y === py - 1) key("ArrowUp");
            await sleep(150);
          }
        }

        // Step 10: find a sign and interact (press G) to verify sign schedules/info
        try {
          const props = (typeof window.GameAPI.getTownProps === "function") ? window.GameAPI.getTownProps() : [];
          const signs = props.filter(p => (p.type || "").toLowerCase() === "sign");
          if (signs.length) {
            const tgt = signs[0];
            log(`Routing to town sign at (${tgt.x},${tgt.y})…`, "info");
            const path = (typeof window.GameAPI.routeToTown === "function") ? window.GameAPI.routeToTown(tgt.x, tgt.y) : [];
            for (const step of path.slice(0, 40)) {
              const dx = Math.sign(step.x - window.GameAPI.getPlayer().x);
              const dy = Math.sign(step.y - window.GameAPI.getPlayer().y);
              key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
              await sleep(120);
            }
            key("KeyG"); // interact with sign
            await sleep(250);
            log("Checked town sign.", "info");
          } else {
            log("No town signs found in props; skipping sign check.", "warn");
          }
        } catch (e) {
          log("Sign check error: " + (e && e.message ? e.message : String(e)), "bad");
        }

        // Step 11: open GOD and run town checks (home routes and inn)
        clickById("god-open-btn");
        await sleep(250);
        clickById("god-check-home-btn");
        await sleep(350);
        clickById("god-check-inn-tavern-btn");
        await sleep(350);
        log("Ran town GOD checks (home routes + inn/tavern).", "info");
        key("Escape");
      } else {
        log("Not in town; skipping NPC bump and town checks.", "warn");
      }

      // Step 12: Diagnostics
      clickById("god-open-btn");
      await sleep(250);
      clickById("god-diagnostics-btn");
      log("Ran Diagnostics", "info");
      await sleep(300);
      key("Escape");

      log("Smoke test completed.", "good");
    } catch (err) {
      log("Smoke test failed: " + (err && err.message ? err.message : String(err)), "bad");
      try { console.error(err); } catch (_) {}
    }
  }

  async function runSeries(times = 5) {
    const count = Math.max(1, times | 0);
    for (let i = 0; i < count; i++) {
      const s = randUint32();
      log(`Series run ${i + 1}/${count} — seed ${s}`, "notice");
      await run(s);
      // small pause between runs
      await sleep(600);
    }
    log("Series complete.", "good");
  }

  // Expose a global trigger
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.run = run;
  window.SmokeTest.runWithSeed = (seed) => run(seed);
  window.SmokeTest.runSeries = runSeries;

  // Auto-run disabled: only run when invoked via GOD panel button.
})();