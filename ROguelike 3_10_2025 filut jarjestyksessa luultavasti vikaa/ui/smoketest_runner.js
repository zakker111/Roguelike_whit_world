// Tiny Roguelike Smoke Test Runner
// Loads when index.html?smoketest=1; runs a minimal scenario and reports pass/fail to Logger, console, and an on-screen banner.

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

  async function run() {
    try {
      log("Starting smoke test…", "notice");
      // Step 1: open GOD panel
      await sleep(250);
      clickById("god-open-btn");
      log("Opened GOD panel", "info");
      await sleep(250);

      // Step 2: set seed
      setInputValue("god-seed-input", 12345);
      clickById("god-apply-seed-btn");
      log("Applied seed 12345", "info");
      await sleep(500);

      // Step 3: adjust FOV to 10 via slider (if present)
      try {
        const fov = document.getElementById("god-fov");
        if (fov) { fov.value = "10"; fov.dispatchEvent(new Event("input", { bubbles: true })); }
        log("Adjusted FOV to 10", "info");
      } catch (_) {}
      await sleep(250);

      // Step 4: spawn an enemy nearby
      clickById("god-spawn-enemy-btn");
      log("Spawned enemy nearby", "info");
      await sleep(350);

      // Step 5: close GOD (Esc)
      key("Escape");
      log("Closed GOD panel", "info");
      await sleep(250);

      // Step 6: move towards enemy (try a few steps) and attack by bump
      const moves = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowRight", "ArrowDown"];
      for (const m of moves) { key(m); await sleep(140); }
      log("Moved and attempted attacks", "info");

      // Step 7: open inventory, then close
      key("KeyI");
      await sleep(300);
      key("Escape");
      log("Opened and closed inventory", "info");
      await sleep(250);

      // Step 8: loot (G) any corpse beneath player (if present)
      key("KeyG");
      await sleep(300);
      log("Attempted loot underfoot", "info");

      // Step 9: open GOD Diagnostics and log output
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

  // Delay to ensure game modules initialized
  window.addEventListener("load", () => {
    setTimeout(() => { run(); }, 800);
  });
})();