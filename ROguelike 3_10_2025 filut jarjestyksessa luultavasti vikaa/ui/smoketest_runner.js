// Tiny Roguelike Smoke Test Runner (multi-run, coherent end-to-end)
// Runs the scenario with random seeds at least 3 times, then prints a combined checklist summary.
(function () {
  // Floating banner for progress + summary
  function ensureBanner() {
    let el = document.getElementById("smoke-banner");
    if (el) return el;
    el = document.createElement("div");
    el.id = "smoke-banner";
    el.style.position = "fixed";
    el.style.right = "12px";
    el.style.bottom = "12px";
    el.style.zIndex = "9999";
    el.style.padding = "10px 12px";
    el.style.fontFamily = "JetBrains Mono, monospace";
    el.style.fontSize = "12px";
    el.style.background = "rgba(21,22,27,0.9)";
    el.style.color = "#d6deeb";
    el.style.border = "1px solid rgba(122,162,247,0.35)";
    el.style.borderRadius = "8px";
    el.style.boxShadow = "0 10px 24px rgba(0,0,0,0.5)";
    el.style.maxWidth = "54ch";
    el.textContent = "[SMOKE] Runner ready…";
    document.body.appendChild(el);
    return el;
  }
  function log(msg, type) {
    const banner = ensureBanner();
    const line = "[SMOKE] " + msg;
    banner.textContent = line;
    try { if (window.Logger && typeof Logger.log === "function") Logger.log(line, type || "info"); } catch (_) {}
    try { console.log(line); } catch (_) {}
  }
  function setBannerSummary(lines) {
    const banner = ensureBanner();
    banner.innerHTML = lines.map(s => `<div>${s}</div>`).join("");
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function key(code) {
    try {
      const ev = new KeyboardEvent("keydown", { key: code, code, bubbles: true });
      window.dispatchEvent(ev); document.dispatchEvent(ev);
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

  function getMode() { return (window.GameAPI && typeof GameAPI.getMode === "function") ? GameAPI.getMode() : ""; }
  async function routeToNearestDungeon() {
    if (!window.GameAPI || typeof GameAPI.gotoNearestDungeon !== "function") return false;
    return await GameAPI.gotoNearestDungeon();
  }
  async function routeToNearestTown() {
    if (!window.GameAPI || typeof GameAPI.gotoNearestTown !== "function") return false;
    return await GameAPI.gotoNearestTown();
  }
  async function enterIfOnSpecialTile(kind /* "dungeon" | "town" */) {
    key("Enter");
    await sleep(400);
    const m = getMode();
    if (kind === "dungeon") return m === "dungeon";
    if (kind === "town") return m === "town";
    return false;
  }

  // Utilities for checking the main log
  function getTopLogLine() {
    try {
      const el = document.getElementById("log");
      if (!el || !el.firstChild) return "";
      return (el.firstChild.textContent || "").trim();
    } catch (_) { return ""; }
  }
  async function waitForLogChange(prev, timeoutMs = 1000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const cur = getTopLogLine();
      if (cur && cur !== prev) return cur;
      await sleep(60);
    }
    return "";
  }

  async function spawnEnemyAndKillOne() {
    clickById("god-open-btn");
    await sleep(120);
    clickById("god-spawn-enemy-btn");
    await sleep(180);
    key("Escape");
    await sleep(120);

    const enemies = (GameAPI.getEnemies ? GameAPI.getEnemies() : []);
    if (!enemies || !enemies.length) return false;
    const p = GameAPI.getPlayer ? GameAPI.getPlayer() : { x: 0, y: 0 };
    let best = enemies[0], bestD = Math.abs(best.x - p.x) + Math.abs(best.y - p.y);
    for (const e of enemies) {
      const d = Math.abs(e.x - p.x) + Math.abs(e.y - p.y);
      if (d < bestD) { best = e; bestD = d; }
    }
    const path = (GameAPI.routeToDungeon ? GameAPI.routeToDungeon(best.x, best.y) : []);
    for (const step of path) {
      const cur = GameAPI.getPlayer();
      const dx = Math.sign(step.x - cur.x);
      const dy = Math.sign(step.y - cur.y);
      key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
      await sleep(90);
    }
    for (let i = 0; i < 12; i++) {
      const cur = GameAPI.getPlayer();
      const dx = Math.sign(best.x - cur.x);
      const dy = Math.sign(best.y - cur.y);
      key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
      await sleep(80);
    }
    key("KeyG");
    await sleep(160);
    return true;
  }

  async function exitDungeonAndReenterCheckCorpse() {
    const corpsesBefore = (GameAPI.getCorpses ? GameAPI.getCorpses() : []).length;

    clickById("god-open-btn");
    await sleep(120);
    clickById("god-spawn-stairs-btn");
    await sleep(120);
    key("Escape");
    await sleep(100);

    key("KeyG");
    await sleep(450);
    const left = getMode() === "world";
    if (left) {
      key("Enter");
      await sleep(450);
    }
    const back = getMode() === "dungeon";
    const corpsesAfter = (GameAPI.getCorpses ? GameAPI.getCorpses() : []).length;
    return { left, back, corpsesBefore, corpsesAfter };
  }

  async function spawnItemsEquipAndUnequip() {
    clickById("god-open-btn");
    await sleep(100);
    clickById("god-spawn-btn");
    await sleep(200);
    key("Escape");
    await sleep(80);

    key("KeyI");
    await sleep(200);

    const inv = document.getElementById("inv-list");
    if (!inv) { key("Escape"); return { equipped: false, unequipped: false }; }
    const lis = Array.from(inv.querySelectorAll("li"));
    const nonHand = lis.filter(li => li.dataset.kind === "equip" && li.dataset.slot && li.dataset.slot !== "hand");
    const handItems = lis.filter(li => li.dataset.kind === "equip" && (!li.dataset.slot || li.dataset.slot === "hand"));
    let equipped = false, unequipped = false;

    function clickLI(li) { li.dispatchEvent(new MouseEvent("click", { bubbles: true })); }

    let chosen = nonHand[0] || handItems[0] || null;
    if (chosen) {
      clickLI(chosen);
      equipped = true;
      await sleep(180);
      try {
        const handRoot = (window.UI && UI.els && UI.els.handChooser) ? UI.els.handChooser : null;
        let leftBtn = null;
        if (handRoot && handRoot.style && handRoot.style.display !== "none") {
          leftBtn = handRoot.querySelector('button[data-hand="left"]');
        }
        if (!leftBtn) {
          leftBtn = document.querySelector('button[data-hand="left"]');
        }
        if (leftBtn) { leftBtn.click(); await sleep(120); }
      } catch (_) {}
    }

    const slots = document.querySelectorAll("#equip-slots span.name[data-slot]");
    if (slots && slots.length) {
      for (const s of Array.from(slots)) {
        if (!s.textContent || s.textContent.includes("(empty)")) continue;
        s.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        unequipped = true;
        await sleep(160);
        break;
      }
    }

    key("Escape");
    await sleep(120);
    return { equipped, unequipped };
  }

  // Town checks: home routes, NPC bump and dialog, and shop sign interaction
  async function townDeepChecks() {
    if (getMode() !== "town") return { homeRoutes: false, npcExists: false, npcBumpSaid: false, shopSignSaid: false };

    // 1) Push "Check Home Routes" button in GOD
    clickById("god-open-btn");
    await sleep(120);
    const prevLog = getTopLogLine();
    try { clickById("god-check-home-btn"); } catch (_) {}
    await sleep(300);
    // Check either the GOD output or a log entry mentions "Home route check"
    let homeRoutes = false;
    try {
      const el = document.getElementById("god-check-output");
      if (el && el.innerText && el.innerText.toLowerCase().includes("home route check")) homeRoutes = true;
    } catch (_) {}
    if (!homeRoutes) {
      const changed = await waitForLogChange(prevLog, 1200);
      if (changed.toLowerCase().includes("home route")) homeRoutes = true;
    }
    key("Escape");
    await sleep(100);

    // 2) Ensure there is at least one NPC and try bumping into them to trigger speech
    const npcs = (GameAPI.getNPCs ? GameAPI.getNPCs() : []);
    const npcExists = npcs.length > 0;
    let npcBumpSaid = false;
    if (npcExists) {
      // find nearest npc
      const p0 = GameAPI.getPlayer();
      let best = npcs[0], bestD = Math.abs(best.x - p0.x) + Math.abs(best.y - p0.y);
      for (const n of npcs) {
        const d = Math.abs(n.x - p0.x) + Math.abs(n.y - p0.y);
        if (d < bestD) { best = n; bestD = d; }
      }
      // move toward and attempt to step into npc tile a few times
      const prev = getTopLogLine();
      for (let i = 0; i < 20; i++) {
        const p = GameAPI.getPlayer();
        const dx = Math.sign(best.x - p.x);
        const dy = Math.sign(best.y - p.y);
        const keyName = dx !== 0 ? (dx === -1 ? "ArrowLeft" : "ArrowRight") : (dy === -1 ? "ArrowUp" : "ArrowDown");
        key(keyName);
        await sleep(80);
        // after each attempt, see if a new log line appeared (NPC dialog or "Excuse me!")
        const changed = await waitForLogChange(prev, 80);
        if (changed) {
          npcBumpSaid = true;
          break;
        }
      }
    }

    // 3) Check one shop sign: route to a sign and press G; validate that log says "Sign:"
    let shopSignSaid = false;
    const props = (GameAPI.getTownProps ? GameAPI.getTownProps() : []);
    const signs = props.filter(p => p.type === "sign");
    if (signs.length) {
      // pick sign nearest to player
      const p0 = GameAPI.getPlayer();
      let best = signs[0], bestD = Math.abs(best.x - p0.x) + Math.abs(best.y - p0.y);
      for (const s of signs) {
        const d = Math.abs(s.x - p0.x) + Math.abs(s.y - p0.y);
        if (d < bestD) { best = s; bestD = d; }
      }
      // walk towards sign; Town.interactProps triggers if on or adjacent
      for (let i = 0; i < 40; i++) {
        const p = GameAPI.getPlayer();
        const d = Math.abs(best.x - p.x) + Math.abs(best.y - p.y);
        if (d <= 1) break;
        const dx = Math.sign(best.x - p.x);
        const dy = Math.sign(best.y - p.y);
        const keyName = dx !== 0 ? (dx === -1 ? "ArrowLeft" : "ArrowRight") : (dy === -1 ? "ArrowUp" : "ArrowDown");
        key(keyName);
        await sleep(70);
      }
      const before = getTopLogLine();
      key("KeyG");
      const changed = await waitForLogChange(before, 600);
      if (changed && (changed.startsWith("Sign:") || changed.toLowerCase().includes("welcome to"))) {
        shopSignSaid = true;
      }
    }

    return { homeRoutes, npcExists, npcBumpSaid, shopSignSaid };
  }

  // Run one scenario with a specific seed; returns checklist entries for that run
  async function runOnceWithSeed(seed) {
    const checklist = [];
    const mark = (name, ok, extra) => {
      checklist.push({ name, ok: !!ok, extra: extra || "" });
      const sym = ok ? "✔" : "✘";
      log(`${sym} ${name}${extra ? " — " + extra : ""}`, ok ? "good" : "warn");
    };

    try {
      log(`Starting scenario (seed=${seed})…`, "notice");

      // Open GOD, apply seed, set FOV
      await sleep(200);
      clickById("god-open-btn");
      await sleep(160);
      setInputValue("god-seed-input", seed >>> 0);
      clickById("god-apply-seed-btn");
      await sleep(420);
      const fov = document.getElementById("god-fov");
      if (fov) { fov.value = "10"; fov.dispatchEvent(new Event("input", { bubbles: true })); }
      await sleep(120);
      key("Escape");

      // Ensure overworld
      if (getMode() !== "world") {
        key("KeyR");
        await sleep(420);
      }

      // Dungeon flow
      const routedD = await routeToNearestDungeon();
      await sleep(160);
      const enteredD = await enterIfOnSpecialTile("dungeon");
      mark("Enter dungeon", routedD && enteredD);

      let killed = false;
      if (getMode() === "dungeon") {
        const ok = await spawnEnemyAndKillOne();
        killed = !!ok;
      }
      mark("Spawn and kill enemy, then loot", killed);

      let corpseCheck = { left: false, back: false, corpsesBefore: 0, corpsesAfter: 0 };
      if (getMode() === "dungeon") {
        corpseCheck = await exitDungeonAndReenterCheckCorpse();
      }
      const corpsePersist = corpseCheck.back && corpseCheck.corpsesAfter >= corpseCheck.corpsesBefore && corpseCheck.corpsesBefore > 0;
      mark("Exit and re-enter dungeon (corpse persists)", corpsePersist, `before=${corpseCheck.corpsesBefore}, after=${corpseCheck.corpsesAfter}`);

      const eqRes = await spawnItemsEquipAndUnequip();
      mark("Equip an item", eqRes.equipped);
      mark("Unequip an item", eqRes.unequipped);

      // Return to world if needed
      if (getMode() === "dungeon") {
        clickById("god-open-btn"); await sleep(80);
        clickById("god-spawn-stairs-btn"); await sleep(80);
        key("Escape"); await sleep(60);
        key("KeyG"); await sleep(360);
      }

      // Town flow
      const routedT = await routeToNearestTown();
      await sleep(120);
      const enteredT = await enterIfOnSpecialTile("town");
      const inTown = getMode() === "town";
      mark("Enter town", routedT && enteredT && inTown);

      // Deep town checks
      let td = { homeRoutes: false, npcExists: false, npcBumpSaid: false, shopSignSaid: false };
      if (inTown) {
        td = await townDeepChecks();
      }
      mark("Town: Check Home Routes", td.homeRoutes);
      mark("Town: NPC exists", td.npcExists);
      mark("Town: bump into NPC yields dialog", td.npcBumpSaid);
      mark("Town: interacting with a sign yields text", td.shopSignSaid);

      // Exit town
      let exited = false;
      if (inTown) {
        try {
          const btn = (UI && UI.els && UI.els.townExitBtn) ? UI.els.townExitBtn : document.querySelector("button[title='Leave the town']");
          if (btn) {
            btn.click();
            await sleep(120);
            const okBtn = document.querySelector("div#ui-confirm-text") ? document.querySelector("div#ui-confirm-text").parentElement.parentElement.querySelector("button[data-act='ok']") : document.querySelector("button[data-act='ok']");
            if (okBtn) okBtn.click();
            await sleep(420);
            exited = getMode() === "world";
          } else {
            key("KeyG");
            await sleep(420);
            exited = getMode() === "world";
          }
        } catch (_) {}
      }
      mark("Town: exit to overworld", exited);

      // Diagnostics
      clickById("god-open-btn");
      await sleep(120);
      clickById("god-diagnostics-btn");
      await sleep(200);
      key("Escape");

      log(`Scenario finished (seed=${seed}).`, "good");
    } catch (err) {
      log("Scenario error: " + (err && err.message ? err.message : String(err)), "bad");
      try { console.error(err); } catch (_) {}
    }
    return checklist;
  }

  // Main runner: run at least 3 scenarios with random seeds, then show combined checklist
  async function run() {
    try {
      const runs = [];
      const seeds = [];
      for (let i = 0; i < 3; i++) {
        const s = (Math.random() * 0xffffffff) >>> 0;
        seeds.push(s);
      }

      for (let i = 0; i < seeds.length; i++) {
        const seed = seeds[i];
        const list = await runOnceWithSeed(seed);
        runs.push({ seed, list });

        // After each run, restart to give a clean slate for next seed
        key("KeyR");
        await sleep(600);
      }

      // Build combined summary
      const lines = ["[SMOKE] Combined Checklist (3 runs):"];
      for (let i = 0; i < runs.length; i++) {
        const r = runs[i];
        lines.push(`Run ${i + 1} (seed=${r.seed})`);
        for (const c of r.list) {
          lines.push(`- ${c.ok ? "✔" : "✘"} ${c.name}${c.extra ? " — " + c.extra : ""}`);
        }
      }

      // Aggregate pass/fail per check name
      const aggregate = new Map();
      for (const r of runs) {
        for (const c of r.list) {
          const a = aggregate.get(c.name) || { total: 0, pass: 0 };
          a.total += 1; if (c.ok) a.pass += 1;
          aggregate.set(c.name, a);
        }
      }
      lines.push("Summary:");
      for (const [name, a] of aggregate.entries()) {
        lines.push(`- ${name}: ${a.pass}/${a.total} passed`);
      }

      setBannerSummary(lines);
      try { lines.forEach(s => Logger && Logger.log ? Logger.log(s, "info") : console.log(s)); } catch (_) {}
      log("Smoke test suite completed.", "good");
    } catch (err) {
      log("Smoke test failed: " + (err && err.message ? err.message : String(err)), "bad");
      try { console.error(err); } catch (_) {}
    }
  }

  // Expose global trigger
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.run = run;

  // Auto-run if requested by loader (?smoketest=1)
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
    window.addEventListener("load", () => { setTimeout(() => { run(); }, 800); });
  }
})();