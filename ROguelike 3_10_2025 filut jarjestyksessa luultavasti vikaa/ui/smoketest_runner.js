// Tiny Roguelike Smoke Test Runner
// Loads when index.html?smoketest=1; runs a minimal scenario and reports pass/fail to Logger and console.

(function () {
  function log(msg, type) {
    try {
      if (window.Logger && typeof Logger.log === "function") {
        Logger.log("[SMOKE] " + msg, type || "info");
      } else {
        console.log("[SMOKE] " + msg);
      }
    } catch (_) {
      console.log("[SMOKE] " + msg);
    }
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function key(code) {
    try {
      const ev = new KeyboardEvent("keydown", { key: code, code, bubbles: true });
      window.dispatchEvent(ev);
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
  }

  async function run() {
    try {
      log("Starting smoke test...", "notice");
      // Step 1: open GOD panel
      await sleep(200);
      clickById("god-open-btn");
      await sleep(200);

      // Step 2: set seed
      setInputValue("god-seed-input", 12345);
      clickById("god-apply-seed-btn");
      log("Applied seed 12345", "info");
      await sleep(400);

      // Step 3: adjust FOV to 10 via slider (if present)
      try {
        const fov = document.getElementById("god-fov");
        if (fov) { fov.value = "10"; fov.dispatchEvent(new Event("input", { bubbles: true })); }
        log("Adjusted FOV to 10", "info");
      } catch (_) {}
      await sleep(200);

      // Step 4: spawn an enemy nearby
      clickById("god-spawn-enemy-btn");
      log("Spawned enemy nearby", "info");
      await sleep(300);

      // Step 5: close GOD (Esc)
      key("Escape");
      await sleep(200);

      // Step 6: move towards enemy (try a few steps) and attack by bump
      // We'll try a few directions to ensure some movement; the AI spawns near.
      const moves = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowRight", "ArrowDown"];
      for (const m of moves) { key(m); await sleep(120); }

      // Step 7: open inventory, then close
      key("KeyI");
      await sleep(250);
      key("Escape");
      await sleep(200);

      // Step 8: loot (G) any corpse beneath player (if present)
      key("KeyG");
      await sleep(250);

      // Step 9: open GOD Diagnostics and log output
      clickById("god-open-btn");
      await sleep(200);
      clickById("god-diagnostics-btn");
      await sleep(250);
      key("Escape");

      log("Smoke test completed.", "good");
    } catch (err) {
      log("Smoke test failed: " + (err && err.message ? err.message : String(err)), "bad");
      console.error(err);
    }
  }

  // Delay to ensure game modules initialized
  window.addEventListener("load", () => {
    setTimeout(() => { run(); }, 600);
  });
})();