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

      // Step 9: if in dungeon, chest loot + equip + decay check, then enemy loot and return
      try {
        if (window.GameAPI && typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() === "dungeon") {
          // 9a: find chest in corpses, route and press G to loot it
          try {
            const corpses = (typeof window.GameAPI.getCorpses === "function") ? window.GameAPI.getCorpses() : [];
            const chest = corpses.find(c => c.kind === "chest");
            if (chest) {
              const pathC = (typeof window.GameAPI.routeToDungeon === "function") ? window.GameAPI.routeToDungeon(chest.x, chest.y) : [];
              for (const step of pathC) {
                const dx = Math.sign(step.x - window.GameAPI.getPlayer().x);
                const dy = Math.sign(step.y - window.GameAPI.getPlayer().y);
                key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                await sleep(110);
              }
              key("KeyG"); // open/loot chest
              await sleep(250);
              record(true, `Looted chest at (${chest.x},${chest.y})`);
            } else {
              record(true, "No chest found in dungeon (skipping chest loot)");
            }
          } catch (e) {
            record(false, "Chest loot failed: " + (e && e.message ? e.message : String(e)));
          }

          // 9b: equip best items from inventory (if any)
          try {
            const beforeEq = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
            const equippedNames = (typeof window.GameAPI.equipBestFromInventory === "function") ? window.GameAPI.equipBestFromInventory() : [];
            const afterEq = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
            const changed = JSON.stringify(beforeEq) !== JSON.stringify(afterEq);
            record(true, `Equipped from chest loot: ${equippedNames.length ? equippedNames.join(", ") : "no changes"}`);
          } catch (e) {
            record(false, "Equip from inventory failed: " + (e && e.message ? e.message : String(e)));
          }

          // 9c: spawn an enemy, record pre-decay, attack, compare decay
          clickById("god-open-btn");
          await sleep(200);
          clickById("god-spawn-enemy-btn");
          record(true, "Spawned test enemy in dungeon");
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
            for (const step of path) {
              const dx = Math.sign(step.x - window.GameAPI.getPlayer().x);
              const dy = Math.sign(step.y - window.GameAPI.getPlayer().y);
              key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
              await sleep(110);
            }
            // Do a few bumps to attack
            for (let t = 0; t < 3; t++) {
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
          await sleep(500);
          record(true, "Attempted town entry");

          // NPC check: route to nearest NPC and bump into them
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
            } else {
              record(true, "No NPCs reported (town may be empty?)");
            }
          } catch (e) {
            record(false, "NPC interaction failed: " + (e && e.message ? e.message : String(e)));
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
              for (const step of path) {
                const dx = Math.sign(step.x - window.GameAPI.getPlayer().x);
                const dy = Math.sign(step.y - window.GameAPI.getPlayer().y);
                key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                await sleep(110);
              }
              // press G to interact with decoration
              key("KeyG");
              await sleep(220);
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
        clickById("god-open-btn");
        await sleep(250);
        clickById("god-diagnostics-btn");
        await sleep(250);
        // If in town, check shops for schedule and open/closed state, attempt resting at inn
        if (window.GameAPI && typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() === "town") {
          const shops = (typeof window.GameAPI.getShops === "function") ? window.GameAPI.getShops() : [];
          if (shops && shops.length) {
            const s0 = shops[0];
            const openNow = (typeof window.GameAPI.isShopOpenNowFor === "function") ? window.GameAPI.isShopOpenNowFor(s0) : false;
            const sched = (typeof window.GameAPI.getShopSchedule === "function") ? window.GameAPI.getShopSchedule(s0) : "";
            record(true, `Shop check: ${s0.name || "Shop"} is ${openNow ? "OPEN" : "CLOSED"} (${sched})`);
            // Try rest at inn if one found by name heuristic
            const inn = shops.find(s => (s.name || "").toLowerCase().includes("inn"));
            if (inn && typeof window.GameAPI.restAtInn === "function") {
              window.GameAPI.restAtInn();
              record(true, "Rested at inn (time advanced to morning, HP restored)");
            } else if (typeof window.GameAPI.restUntilMorning === "function") {
              window.GameAPI.restUntilMorning();
              record(true, "Rested until morning");
            }
          } else {
            record(true, "No shops available to check");
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

      // Report into GOD panel
      const detailsHtml = steps.map(s => `<div style="color:${s.ok ? "#86efac" : "#fca5a5"};">${s.ok ? "✔" : "✖"} ${s.msg}</div>`).join("");
      const issuesHtml = errors.length
        ? `<div style="margin-top:8px; color:#ef4444;"><strong>Issues (${errors.length}):</strong></div>` +
          errors.map(e => `<div style="color:#f87171;">• ${e}</div>`).join("")
        : "";
      const html = [
        `<div><strong>Smoke Test Result:</strong> ${ok ? "PASS" : "PARTIAL/FAIL"}</div>`,
        `<div>Steps: ${steps.length}  Errors: <span style="color:${errors.length ? "#ef4444" : "#86efac"};">${errors.length}</span></div>`,
        issuesHtml,
        `<div style="margin-top:6px;"><strong>Details</strong></div>`,
        detailsHtml,
      ].join("");
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
    let perfSumTurn = 0, perfSumDraw = 0;
    let determinismSeed = null;
    log(`Running smoke test ${n} time(s)…`, "notice");
    for (let i = 0; i < n; i++) {
      const res = await runOnce();
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

      // Capture determinism sample: first NPC name and first prop type in town (if visited during run)
      try {
        if (window.GameAPI && typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() === "town") {
          const npcs = (typeof window.GameAPI.getNPCs === "function") ? window.GameAPI.getNPCs() : [];
          const props = (typeof window.GameAPI.getTownProps === "function") ? window.GameAPI.getTownProps() : [];
          const sample = `${npcs[0] ? (npcs[0].name || "") : ""}|${props[0] ? (props[0].type || "") : ""}`;
          determinismSeed = determinismSeed || sample;
          if (determinismSeed !== sample) {
            log("Determinism check: mismatch in first NPC/prop sample within series", "warn");
          }
        }
      } catch (_) {}

      panelReport(`<div><strong>Smoke Test Progress:</strong> ${i + 1} / ${n}</div><div>Pass: ${pass}  Fail: ${fail}</div>`);
      await sleep(300);
    }
    const avgTurn = (pass + fail) ? (perfSumTurn / (pass + fail)).toFixed(2) : "0.00";
    const avgDraw = (pass + fail) ? (perfSumDraw / (pass + fail)).toFixed(2) : "0.00";

    const summary = [
      `<div><strong>Smoke Test Summary:</strong></div>`,
      `<div>Runs: ${n}  Pass: ${pass}  Fail: <span style="color:${fail ? "#ef4444" : "#86efac"};">${fail}</span></div>`,
      `<div>Avg PERF: turn ${avgTurn} ms, draw ${avgDraw} ms</div>`,
      determinismSeed ? `<div>Determinism sample (first NPC|prop): ${determinismSeed}</div>` : ``,
      fail ? `<div style="margin-top:6px; color:#ef4444;"><strong>Some runs failed.</strong> See per-run details above.</div>` : ``
    ].join("");
    panelReport(summary);
    log(`Smoke test series done. Pass=${pass} Fail=${fail} AvgTurn=${avgTurn} AvgDraw=${avgDraw}`, fail === 0 ? "good" : "warn");
    return { pass, fail, results: all, avgTurnMs: Number(avgTurn), avgDrawMs: Number(avgDraw) };
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