(function () {
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  async function run(ctx) {
    try {
      var record = ctx.record || function(){};
      var recordSkip = ctx.recordSkip || function(){};
      var sleep = ctx.sleep || (ms => new Promise(r => setTimeout(r, ms|0)));

      var mode = (window.GameAPI && typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : "";
      if (mode !== "world") {
        recordSkip("World checks skipped (not in overworld)");
        return false;
      }

      // Simple environment snapshot: nearestTown and nearestDungeon
      var nt = (typeof window.GameAPI.nearestTown === "function") ? window.GameAPI.nearestTown() : null;
      var nd = (typeof window.GameAPI.nearestDungeon === "function") ? window.GameAPI.nearestDungeon() : null;
      var msg = "World snapshot: " +
                "nearestTown=" + (nt ? (nt.x + "," + nt.y) : "n/a") + " " +
                "nearestDungeon=" + (nd ? (nd.x + "," + nd.y) : "n/a");
      record(true, msg);

      // Optional: one step movement to assert input works in world
      try {
        var before = (typeof window.GameAPI.getPlayer === "function") ? window.GameAPI.getPlayer() : { x: 0, y: 0 };
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight", bubbles: true }));
        await sleep(80);
        var after = (typeof window.GameAPI.getPlayer === "function") ? window.GameAPI.getPlayer() : { x: 0, y: 0 };
        var moved = (after.x !== before.x) || (after.y !== before.y);
        record(moved, "World movement test: " + (moved ? "moved" : "immobile"));
      } catch (e) {
        record(false, "World movement test failed: " + (e && e.message ? e.message : String(e)));
      }

      return true;
    } catch (e) {
      try { (ctx.record || function(){false;})(false, "World scenario failed: " + (e && e.message ? e.message : String(e))); } catch (_) {}
      return false;
    }
  }

  window.SmokeTest.Scenarios.World = { run };
})();