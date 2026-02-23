(function () {
  // SmokeTest scenario: Encounters
  // Verifies we can enter a random encounter, act within it, and exit back to the overworld.
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  async function run(ctx) {
    try {
      const record = ctx.record || function(){};
      const recordSkip = ctx.recordSkip || function(){};
      const sleep = ctx.sleep || (ms => new Promise(r => setTimeout(r, ms | 0)));
      const key = ctx.key || (code => { try { window.dispatchEvent(new KeyboardEvent("keydown", { key: code, code, bubbles: true })); } catch (_) {} });
      const caps = (ctx && ctx.caps) || {};
      const G = window.GameAPI || {};

      if (!caps.GameAPI) {
        recordSkip("Encounter scenario skipped (GameAPI not available)");
        return true;
      }

      // Ensure we are in overworld
      try {
        if (typeof G.getMode === "function" && G.getMode() !== "world") {
          if (typeof G.forceWorld === "function") G.forceWorld();
          await sleep(120);
          // Wait until mode reports world
          await waitUntilMode("world", 2000);
        }
      } catch (_) {}
      if (typeof G.getMode === "function" && G.getMode() !== "world") {
        recordSkip("Encounter scenario skipped (not in overworld)");
        return true;
      }
      record(true, "Encounter prep: in overworld");

      // Enter an encounter explicitly (bypass prompt)
      let entered = false;
      try {
        // Use a minimal template when available; allow EncounterRuntime default if template is null
        const template = null;
        const biome = "FOREST";
        if (typeof G.enterEncounter === "function") {
          entered = !!G.enterEncounter(template, biome);
        }
      } catch (e) {
        record(false, "Encounter enter failed: " + (e && e.message ? e.message : String(e)));
        entered = false;
      }

      // Give it a moment to settle
      await sleep(200);
      const inEncounter = (typeof G.getMode === "function" && G.getMode() === "encounter");
      if (!entered || !inEncounter) {
        record(false, "Encounter enter not achieved");
        return false;
      }
      record(true, "Entered encounter");

      // Move a few steps and attempt basic actions (bump-to-attack if possible)
      try {
        const dirs = ["ArrowRight","ArrowDown","ArrowLeft","ArrowUp"];
        let acted = false;
        for (let i = 0; i < 6; i++) {
          key(dirs[i % dirs.length]);
          await sleep(120);
          // Try G to interact/loot if something is underfoot
          key("g");
          await sleep(120);
          acted = true;
        }
        if (acted) record(true, "Encounter actions: moved and interacted");
      } catch (e) {
        record(false, "Encounter actions failed: " + (e && e.message ? e.message : String(e)));
      }

      // Exit the encounter. Prefer the stable programmatic API if available.
      let exitOk = false;
      try {
        if (typeof G.completeEncounter === "function") {
          // "withdraw" is non-destructive and should always be allowed.
          exitOk = !!G.completeEncounter("withdraw");
          await sleep(240);
          await waitUntilMode("world", 3000);
          exitOk = (typeof G.getMode === "function" && G.getMode() === "world");
        }

        // Fallback: teleport to a known exit marker and press G.
        if (!exitOk) {
          const tiles = (typeof G.getTiles === "function") ? G.getTiles() : { STAIRS: 3 };
          const findExit = () => {
            try {
              const ctxG = (typeof G.getCtx === "function") ? G.getCtx() : null;
              const map = (ctxG && typeof ctxG.getMap === "function") ? ctxG.getMap() : (ctxG ? ctxG.map : null);
              const H = Array.isArray(map) ? map.length : 0;
              const W = (H && map[0]) ? map[0].length : 0;
              if (!H || !W) return null;
              for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                  if (map[y][x] === tiles.STAIRS) return { x, y };
                }
              }
            } catch (_) {}
            return null;
          };
          const exitTile = findExit();
          if (exitTile && typeof G.teleportTo === "function") {
            // Land on or near the exit
            await (async () => {
              const ok1 = !!G.teleportTo(exitTile.x, exitTile.y, { ensureWalkable: true, fallbackScanRadius: 4 });
              if (!ok1) {
                G.teleportTo(exitTile.x, exitTile.y, { ensureWalkable: false, fallbackScanRadius: 0 });
                await sleep(80);
              }
            })();
            await sleep(140);
            // If adjacent, nudge onto the exit
            try {
              const p = (typeof G.getPlayer === "function") ? G.getPlayer() : { x: exitTile.x, y: exitTile.y };
              if (!(p.x === exitTile.x && p.y === exitTile.y)) {
                const dx = Math.sign(exitTile.x - p.x);
                const dy = Math.sign(exitTile.y - p.y);
                key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
                await sleep(140);
              }
            } catch (_) {}
          }
          key("g");
          await sleep(240);
          await waitUntilMode("world", 3000);
          exitOk = (typeof G.getMode === "function" && G.getMode() === "world");
        }
      } catch (e) {
        record(false, "Encounter exit failed: " + (e && e.message ? e.message : String(e)));
        exitOk = false;
      }

      if (exitOk) {
        record(true, "Returned to overworld from encounter");
      } else {
        record(false, "Encounter exit not achieved");
        return false;
      }

      return true;
    } catch (e) {
      try { (ctx.record || function(){false;})(false, "Encounter scenario failed: " + (e && e.message ? e.message : String(e))); } catch (_) {}
      return false;
    }

    // Helpers
    async function waitUntilMode(target, timeoutMs) {
      const deadline = Date.now() + Math.max(0, (timeoutMs | 0) || 0);
      while (Date.now() < deadline) {
        try {
          if (typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() === target) return true;
        } catch (_) {}
        await new Promise(r => setTimeout(r, 80));
      }
      try { return (typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() === target); } catch (_) { return false; }
    }
  }

  window.SmokeTest.Scenarios.encounters = { run };
})();