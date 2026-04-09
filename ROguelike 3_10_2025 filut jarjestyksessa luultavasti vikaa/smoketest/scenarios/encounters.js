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

      const previousInvincible = (() => {
        try {
          if (window.UI && typeof window.UI.getInvincibleState === "function") {
            return !!window.UI.getInvincibleState();
          }
        } catch (_) {}
        try {
          return !!window.GOD_INVINCIBLE;
        } catch (_) {}
        return false;
      })();

      const setInvincible = (enabled) => {
        try {
          if (window.UI && typeof window.UI.setInvincibleState === "function") {
            window.UI.setInvincibleState(!!enabled);
            return true;
          }
        } catch (_) {}
        try {
          window.GOD_INVINCIBLE = !!enabled;
          return true;
        } catch (_) {}
        return false;
      };

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
      setInvincible(true);
      record(true, "Encounter prep: invincible enabled for smoke safety");

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
        const dirs = ["ArrowRight","ArrowDown"];
        let acted = false;
        for (let i = 0; i < 2; i++) {
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
        exitOk = (typeof ctx.exitEncounterToWorld === "function")
          ? await ctx.exitEncounterToWorld({ allowForceWorld: true })
          : false;
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
    } finally {
      try {
        if (typeof window !== "undefined" && typeof window.GOD_INVINCIBLE !== "undefined") {
          if (window.UI && typeof window.UI.setInvincibleState === "function") {
            window.UI.setInvincibleState(previousInvincible);
          } else {
            window.GOD_INVINCIBLE = !!previousInvincible;
          }
        }
      } catch (_) {}
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
