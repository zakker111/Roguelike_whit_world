(function () {
  // SmokeTest Scenario: Determinism/seed invariants (same-seed regeneration without reload)
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  async function run(ctx) {
    // ctx: { key, sleep, record, recordSkip, CONFIG, anchorTown, anchorDungeon, caps }
    try {
      var record = ctx.record || function(){};
      var recordSkip = ctx.recordSkip || function(){};
      var sleep = ctx.sleep || (ms => new Promise(r => setTimeout(r, ms|0)));
      var key = ctx.key || function(){};
      var anchorTown = ctx.anchorTown || null;
      var anchorDung = ctx.anchorDungeon || null;
      var caps = (ctx && ctx.caps) || {};
      if (!caps.nearestTown && !caps.nearestDungeon) { recordSkip("Seed invariants skipped (nearestTown/nearestDungeon not available)"); return true; }

      // Ensure we're in world to read nearestTown/nearestDungeon after reapply
      try {
        key("Escape"); await sleep(160);
        if (window.GameAPI && typeof window.GameAPI.returnToWorldIfAtExit === "function") {
          window.GameAPI.returnToWorldIfAtExit();
        }
        await sleep(240);
      } catch (_) {}

      // Read seed from persisted storage
      var seedRaw = null;
      try { seedRaw = (localStorage.getItem("SEED") || ""); } catch (_) {}
      var s = seedRaw ? (Number(seedRaw) >>> 0) : null;
      if (s == null) {
        recordSkip("Seed invariants skipped (no SEED persisted)");
        return true;
      }

      // Apply same seed via GOD panel controls
      try {
        var Dom = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Dom;
        if (Dom && typeof Dom.safeClick === "function") { Dom.safeClick("god-open-btn"); } else {
          var gbtn = document.getElementById("god-open-btn"); gbtn && gbtn.click();
        }
        await sleep(120);
        if (Dom && typeof Dom.safeSetInput === "function") {
          Dom.safeSetInput("god-seed-input", s);
        } else {
          var inp = document.getElementById("god-seed-input");
          if (inp) {
            inp.value = String(s);
            try { inp.dispatchEvent(new Event("input", { bubbles: true })); } catch (_) {}
            try { inp.dispatchEvent(new Event("change", { bubbles: true })); } catch (_) {}
          }
        }
        if (Dom && typeof Dom.safeClick === "function") { Dom.safeClick("god-apply-seed-btn"); } else {
          var abtn = document.getElementById("god-apply-seed-btn"); abtn && abtn.click();
        }
        await sleep(400);
        key("Escape"); await sleep(160);
      } catch (_) {}

      // Compare invariants
      var afterTown = (window.GameAPI && typeof window.GameAPI.nearestTown === "function") ? window.GameAPI.nearestTown() : null;
      var afterDung = (window.GameAPI && typeof window.GameAPI.nearestDungeon === "function") ? window.GameAPI.nearestDungeon() : null;
      var townSame = (!!anchorTown && !!afterTown) ? (anchorTown.x === afterTown.x && anchorTown.y === afterTown.y) : true;
      var dungSame = (!!anchorDung && !!afterDung) ? (anchorDung.x === afterDung.x && anchorDung.y === afterDung.y) : true;
      record(townSame && dungSame, "Seed invariants: nearestTown=" + (townSame ? "OK" : "MISMATCH") + " nearestDungeon=" + (dungSame ? "OK" : "MISMATCH"));

      return true;
    } catch (e) {
      try { (ctx.record || function(){}) (false, "Determinism scenario failed: " + (e && e.message ? e.message : String(e))); } catch (_) {}
      return true;
    }
  }

  window.SmokeTest.Scenarios.Determinism = { run };
})();