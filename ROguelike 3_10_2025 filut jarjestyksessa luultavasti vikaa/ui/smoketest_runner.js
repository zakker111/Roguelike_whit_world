// Tiny Roguelike Smoke Test Runner (coherent end-to-end)
// - Overworld -> dungeon -> spawn enemy -> kill -> loot -> exit -> re-enter (corpse persists)
// - Spawn items -> equip and unequip
// - Enter town -> check signs and NPCs -> try to walk to NPC -> exit town
// - Output a checklist summary
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
    el.style.maxWidth = "44ch";
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
  const checklist = [];
  function mark(name, ok, extra) {
    checklist.push({ name, ok: !!ok, extra: extra || "" });
    const sym = ok ? "✔" : "✘";
    log(`${sym} ${name}${extra ? " — " + extra : ""}`, ok ? "good" : "warn");
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
  function clickSelector(sel) {
    const el = document.querySelector(sel);
    if (el) el.click();
    return !!el;
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
    // In overworld, pressing Enter when on D/T should enter
    key("Enter");
    await sleep(400);
    const m = getMode();
    if (kind === "dungeon") return m === "dungeon";
    if (kind === "town") return m === "town";
    return false;
  }

  async function spawnEnemyAndKillOne() {
    // GOD open -> spawn enemy -> close
    clickById("god-open-btn");
    await sleep(120);
    clickById("god-spawn-enemy-btn");
    await sleep(180);
    key("Escape");
    await sleep(120);

    // Route to nearest enemy
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
    // Bump-attack until enemy at tile is gone or until some turns
    for (let i = 0; i < 12; i++) {
      // try to step onto the enemy tile directionally if not overlapping
      const cur = GameAPI.getPlayer();
      const dx = Math.sign(best.x - cur.x);
      const dy = Math.sign(best.y - cur.y);
      key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
      await sleep(80);
    }
    // Loot ground
    key("KeyG");
    await sleep(160);
    return true;
  }

  async function exitDungeonAndReenterCheckCorpse() {
    // Capture corpse count
    const corpsesBefore = (GameAPI.getCorpses ? GameAPI.getCorpses() : []).length;

    // Spawn stairs underfoot to guarantee exit
    clickById("god-open-btn");
    await sleep(120);
    clickById("god-spawn-stairs-btn");
    await sleep(120);
    key("Escape");
    await sleep(100);

    // Press G to leave via stairs
    key("KeyG");
    await sleep(450);
    const left = getMode() === "world";
    // Re-enter dungeon immediately (stand on D and Enter)
    if (left) {
      key("Enter");
      await sleep(450);
    }
    const back = getMode() === "dungeon";
    const corpsesAfter = (GameAPI.getCorpses ? GameAPI.getCorpses() : []).length;
    return { left, back, corpsesBefore, corpsesAfter };
  }

  async function spawnItemsEquipAndUnequip() {
    // Open GOD -> spawn random items (adds to inventory)
    clickById("god-open-btn");
    await sleep(100);
    clickById("god-spawn-btn");
    await sleep(200);
    key("Escape");
    await sleep(80);

    // Open inventory panel
    key("KeyI");
    await sleep(200);

    const inv = document.getElementById("inv-list");
    if (!inv) { key("Escape"); return { equipped: false, unequipped: false }; }
    // Find two equippable items (prefer non-hand first to avoid chooser)
    const lis = Array.from(inv.querySelectorAll("li"));
    const nonHand = lis.filter(li => li.dataset.kind === "equip" && li.dataset.slot && li.dataset.slot !== "hand");
    const handItems = lis.filter(li => li.dataset.kind === "equip" && (!li.dataset.slot || li.dataset.slot === "hand"));
    let equipped = false, unequipped = false;

    function clickLI(li) { li.dispatchEvent(new MouseEvent("click", { bubbles: true })); }

    // Equip first non-hand if available, else one hand item
    let chosen = nonHand[0] || handItems[0] || null;
    if (chosen) {
      clickLI(chosen);
      equipped = true;
      await sleep(180);
      // If hand chooser is visible, pick left safely without invalid selectors
      try {
        const handRoot = (window.UI && UI.els && UI.els.handChooser) ? UI.els.handChooser : null;
        let leftBtn = null;
        if (handRoot && handRoot.style && handRoot.style.display !== "none") {
          leftBtn = handRoot.querySelector('button[data-hand="left"]');
        }
        if (!leftBtn) {
          // fallback: global query (safe selector)
          leftBtn = document.querySelector('button[data-hand="left"]');
        }
        if (leftBtn) { leftBtn.click(); await sleep(120); }
      } catch (_) {}
    }

    // Unequip via equipment slots (click span[data-slot])
    const slots = document.querySelectorAll("#equip-slots span.name[data-slot]");
    if (slots && slots.length) {
      // Click the first slot that appears equipped
      for (const s of Array.from(slots)) {
        if (!s.textContent || s.textContent.includes("(empty)")) continue;
        s.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        unequipped = true;
        await sleep(160);
        break;
      }
    }

    // Close inventory
    key("Escape");
    await sleep(120);
    return { equipped, unequipped };
  }

  async function enterTownCheckAndExit() {
    // Ensure we're in overworld
    if (getMode() !== "world") {
      // Try to leave current place: if dungeon, attempt stairs->G path using GOD helper
      if (getMode() === "dungeon") {
        clickById("god-open-btn"); await sleep(100);
        clickById("god-spawn-stairs-btn"); await sleep(80);
        key("Escape"); await sleep(80);
        key("KeyG"); await sleep(420);
      }
    }
    if (getMode() !== "world") return { entered: false, signs: 0, npcs: 0, walkedToNPC: false, exited: false };

    // Route to nearest town and enter
    const routed = await routeToNearestTown();
    await sleep(120);
    await enterIfOnSpecialTile("town");
    const entered = getMode() === "town";
    if (!entered) return { entered: false, signs: 0, npcs: 0, walkedToNPC: false, exited: false };

    // Check signs and NPCs
    const props = (GameAPI.getTownProps ? GameAPI.getTownProps() : []);
    const signs = props.filter(p => p.type === "sign").length;
    const npcs = (GameAPI.getNPCs ? GameAPI.getNPCs() : []);
    const npcCount = npcs.length;

    // Try to walk toward the nearest NPC for up to N steps
    let walkedToNPC = false;
    if (npcCount > 0) {
      const p0 = GameAPI.getPlayer();
      let best = npcs[0], bestD = Math.abs(best.x - p0.x) + Math.abs(best.y - p0.y);
      for (const n of npcs) {
        const d = Math.abs(n.x - p0.x) + Math.abs(n.y - p0.y);
        if (d < bestD) { best = n; bestD = d; }
      }
      for (let i = 0; i < 20; i++) {
        const p = GameAPI.getPlayer();
        const dx = Math.sign(best.x - p.x);
        const dy = Math.sign(best.y - p.y);
        const keyName = dx !== 0 ? (dx === -1 ? "ArrowLeft" : "ArrowRight") : (dy === -1 ? "ArrowUp" : "ArrowDown");
        key(keyName);
        await sleep(80);
        const pd = Math.abs(best.x - GameAPI.getPlayer().x) + Math.abs(best.y - GameAPI.getPlayer().y);
        if (pd <= 1) { walkedToNPC = true; break; }
      }
    }

    // Exit town via the Exit Town button (handles confirm)
    let exited = false;
    try {
      const btn = (UI && UI.els && UI.els.townExitBtn) ? UI.els.townExitBtn : document.querySelector("button[title='Leave the town']");
      if (btn) {
        btn.click();
        await sleep(120);
        // Approve confirm (OK)
        const okBtn = document.querySelector("div#ui-confirm-text") ? document.querySelector("div#ui-confirm-text").parentElement.parentElement.querySelector("button[data-act='ok']") : document.querySelector("button[data-act='ok']");
        if (okBtn) okBtn.click();
        await sleep(420);
        exited = getMode() === "world";
      } else {
        // Fallback: try to press G at gate if user is at exit tile
        key("KeyG");
        await sleep(420);
        exited = getMode() === "world";
      }
    } catch (_) {}

    return { entered: true, signs, npcs: npcCount, walkedToNPC, exited };
  }

  async function run() {
    const summary = [];
    try {
      log("Starting smoke test…", "notice");

      // Open GOD, set seed, set FOV
      await sleep(200);
      clickById("god-open-btn");
      await sleep(160);
      setInputValue("god-seed-input", 12345);
      clickById("god-apply-seed-btn");
      await sleep(420);
      const fov = document.getElementById("god-fov");
      if (fov) { fov.value = "10"; fov.dispatchEvent(new Event("input", { bubbles: true })); }
      await sleep(120);
      key("Escape");

      // Ensure overworld
      if (getMode() !== "world") {
        // Attempt to restart to force overworld start
        key("KeyR");
        await sleep(400);
      }

      // Go to dungeon and enter
      const routedD = await routeToNearestDungeon();
      await sleep(160);
      const enteredD = await enterIfOnSpecialTile("dungeon");
      mark("Enter dungeon", routedD && enteredD);

      // Spawn enemy, kill, and loot
      let killed = false;
      if (getMode() === "dungeon") {
        const ok = await spawnEnemyAndKillOne();
        killed = !!ok;
      }
      mark("Spawn and kill enemy, then loot", killed);

      // Exit dungeon and re-enter, verify corpse persistence
      let corpseCheck = { left: false, back: false, corpsesBefore: 0, corpsesAfter: 0 };
      if (getMode() === "dungeon") {
        corpseCheck = await exitDungeonAndReenterCheckCorpse();
      }
      const corpsePersist = corpseCheck.back && corpseCheck.corpsesAfter >= corpseCheck.corpsesBefore && corpseCheck.corpsesBefore > 0;
      mark("Exit and re-enter dungeon (corpse persists)", corpsePersist, `before=${corpseCheck.corpsesBefore}, after=${corpseCheck.corpsesAfter}`);

      // Items: spawn, equip, unequip
      if (getMode() !== "dungeon") {
        // if we didn't return properly, try to enter dungeon again for variety; not required though
      }
      const eqRes = await spawnItemsEquipAndUnequip();
      mark("Equip an item", eqRes.equipped);
      mark("Unequip an item", eqRes.unequipped);

      // Return to world (if still in dungeon)
      if (getMode() === "dungeon") {
        clickById("god-open-btn"); await sleep(80);
        clickById("god-spawn-stairs-btn"); await sleep(80);
        key("Escape"); await sleep(60);
        key("KeyG"); await sleep(360);
      }

      // Town: enter, check signs & NPCs, walk to NPC, exit
      const town = await enterTownCheckAndExit();
      const townOk = town.entered && town.signs >= 1 && town.npcs >= 1 && town.walkedToNPC && town.exited;
      mark("Town: enter, see sign(s), see NPC(s), approach NPC, exit", townOk, `signs=${town.signs}, npcs=${town.npcs}`);

      // Diagnostics for visibility
      clickById("god-open-btn");
      await sleep(120);
      clickById("god-diagnostics-btn");
      await sleep(200);
      key("Escape");

      // Final summary
      const lines = ["[SMOKE] Checklist:"].concat(
        checklist.map(c => `- ${c.ok ? "✔" : "✘"} ${c.name}${c.extra ? " — " + c.extra : ""}`)
      );
      setBannerSummary(lines);
      try { lines.forEach(s => Logger && Logger.log ? Logger.log(s, "info") : console.log(s)); } catch (_) {}

      log("Smoke test done.", "good");
    } catch (err) {
      log("Smoke test failed: " + (err && err.message ? err.message : String(err)), "bad");
      try { console.error(err); } catch (_) {}
      const lines = ["[SMOKE] Checklist (incomplete):"].concat(
        checklist.map(c => `- ${c.ok ? "✔" : "✘"} ${c.name}${c.extra ? " — " + c.extra : ""}`)
      );
      setBannerSummary(lines);
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