(function () {
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  async function run(ctx) {
    try {
      var record = ctx.record || function(){};
      var recordSkip = ctx.recordSkip || function(){};
      var sleep = ctx.sleep || (ms => new Promise(r => setTimeout(r, ms|0)));
      var key = (ctx && ctx.key) ? ctx.key : (code => {
        try { window.dispatchEvent(new KeyboardEvent("keydown", { key: code, code, bubbles: true })); } catch (_) {}
      });

      var G = window.GameAPI || {};
      if (!G || typeof G.getMode !== "function") {
        recordSkip("API scenario skipped (GameAPI/getMode not available)");
        return true;
      }

      // Presence checks (essential endpoints)
      var present = ["getMode","getPlayer","nearestTown","nearestDungeon","routeTo","routeToDungeon","gotoNearestTown","gotoNearestDungeon","getInventory","getEquipment","getStats","addGold","removeGold","equipBestFromInventory","equipItemAtIndex","equipItemAtIndexHand","unequipSlot","getPotions","drinkPotionAtIndex","teleportTo","getPerf","returnToWorldIfAtExit","restUntilMorning","restAtInn","setAlwaysCrit","setCritPart"];
      var missing = present.filter(function (k) { return typeof G[k] !== "function"; });
      record(missing.length === 0, "API presence: " + (present.length - missing.length) + "/" + present.length + " available" + (missing.length ? (" (missing: " + missing.join(", ") + ")") : ""));

      // Mode sanity
      var mode = G.getMode();
      var modeOk = (mode === "world" || mode === "town" || mode === "dungeon");
      record(modeOk, "Mode: " + String(mode || "(unknown)"));

      // Player pointer
      var p = G.getPlayer();
      var pOk = !!(p && typeof p.x === "number" && typeof p.y === "number");
      record(pOk, "Player coords: " + (pOk ? (p.x + "," + p.y) : "(invalid)"));

      // Gold add/remove round trip
      var g0 = (typeof G.getGold === "function") ? G.getGold() : null;
      var okAdd = (typeof G.addGold === "function") ? !!G.addGold(7) : false;
      await sleep(80);
      var g1 = (typeof G.getGold === "function") ? G.getGold() : null;
      var okRem = (typeof G.removeGold === "function") ? !!G.removeGold(5) : false;
      await sleep(80);
      var g2 = (typeof G.getGold === "function") ? G.getGold() : null;
      var goldDelta = (g0 != null && g1 != null && g2 != null) ? (g2 - g0) : null;
      record(okAdd && okRem, "Gold round-trip: +" + 7 + ", -" + 5 + " (Δ=" + (goldDelta != null ? goldDelta : "n/a") + ")");

      // Ensure some items exist; equip best
      try {
        var invBefore = (typeof G.getInventory === "function") ? G.getInventory() : [];
        var hasEquip = invBefore.some(function (it) { return it && it.kind === "equip"; });
        if (!hasEquip && typeof G.spawnItems === "function") { G.spawnItems(3); await sleep(160); }
        var stats0 = (typeof G.getStats === "function") ? G.getStats() : { atk: 0, def: 0 };
        var equippedNames = (typeof G.equipBestFromInventory === "function") ? G.equipBestFromInventory() : [];
        await sleep(120);
        var stats1 = (typeof G.getStats === "function") ? G.getStats() : { atk: 0, def: 0 };
        var atkDelta = (stats1.atk || 0) - (stats0.atk || 0);
        var defDelta = (stats1.def || 0) - (stats0.def || 0);
        var improved = (equippedNames.length ? ((atkDelta > 0) || (defDelta > 0)) : true);
        record(improved, "Equip best: " + (equippedNames.length ? equippedNames.join(", ") : "no changes") + " (Δ atk " + (atkDelta.toFixed ? atkDelta.toFixed(1) : atkDelta) + ", def " + (defDelta.toFixed ? defDelta.toFixed(1) : defDelta) + ")");
      } catch (e) {
        record(false, "Equip best failed: " + (e && e.message ? e.message : String(e)));
      }

      // Teleport near current position (local map only)
      try {
        if (mode === "dungeon" || mode === "town") {
          var tx = p.x + 1, ty = p.y;
          var okTp = !!G.teleportTo(tx, ty, { ensureWalkable: true });
          await sleep(120);
          var pAfter = G.getPlayer();
          var near = !!(pAfter && (Math.abs(pAfter.x - tx) + Math.abs(pAfter.y - ty) <= 1));
          record(okTp && near, "Teleport near: target (" + tx + "," + ty + "), now (" + pAfter.x + "," + pAfter.y + ")");
        } else {
          recordSkip("Teleport test skipped (world mode)");
        }
      } catch (e) {
        record(false, "Teleport failed: " + (e && e.message ? e.message : String(e)));
      }

      // Optional: route to nearest town/dungeon (smoke only; don't enforce outcome)
      try {
        if (mode === "world" && typeof G.nearestTown === "function" && typeof G.routeTo === "function") {
          var t = G.nearestTown();
          var path = t ? (G.routeTo(t.x, t.y) || []) : [];
          record(!!(path && path.length), "Route to nearest town: " + (t ? (t.x + "," + t.y) : "n/a") + " pathLen=" + (path.length || 0));
        } else {
          recordSkip("Route to nearest town skipped (not world or API missing)");
        }
      } catch (e) {
        record(false, "Route to town failed: " + (e && e.message ? e.message : String(e)));
      }

      // Potion test (if any)
      try {
        var pots = (typeof G.getPotions === "function") ? G.getPotions() : [];
        if (pots && pots.length && typeof G.drinkPotionAtIndex === "function") {
          var pi = pots[0].i;
          var hp0 = (typeof G.getStats === "function") ? G.getStats().hp : null;
          var okDrink = !!G.drinkPotionAtIndex(pi);
          await sleep(140);
          var hp1 = (typeof G.getStats === "function") ? G.getStats().hp : null;
          var dhp = (hp1 != null && hp0 != null) ? (hp1 - hp0) : null;
          record(okDrink, "Potion drink: index " + pi + " (Δ HP " + (dhp != null ? dhp : "n/a") + ")");
        } else {
          recordSkip("Potion drink skipped (no potions)");
        }
      } catch (e) {
        record(false, "Potion drink failed: " + (e && e.message ? e.message : String(e)));
      }

      return true;
    } catch (e) {
      try { (ctx.record || function(){false;})(false, "API scenario failed: " + (e && e.message ? e.message : String(e))); } catch (_) {}
      return false;
    }
  }

  window.SmokeTest.Scenarios.API = { run };
})();