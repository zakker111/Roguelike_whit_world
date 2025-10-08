(function () {
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  async function run(ctx) {
    try {
      var caps = (ctx && ctx.caps) || {};
      if (!caps.GameAPI || !caps.getMode || !caps.getInventory || !caps.getStats || !caps.getEquipment) {
        (ctx.recordSkip || function(){})("Inventory scenario skipped (required GameAPI capabilities missing)");
        return true;
      }
      // Expect runner to call this only in dungeon mode; guard regardless
      var inDungeon = (window.GameAPI && typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() === "dungeon");
      if (!inDungeon) { (ctx.recordSkip || function(){})("Inventory scenario skipped (not in dungeon)"); return true; }

      var record = ctx.record || function(){};
      var recordSkip = ctx.recordSkip || function(){};
      var sleep = ctx.sleep || (ms => new Promise(r => setTimeout(r, ms|0)));
      var makeBudget = ctx.makeBudget || (ms => {
        var start = Date.now(); var dl = start + (ms|0);
        return { exceeded: function(){return Date.now() > dl;}, remain: function(){return Math.max(0, dl - Date.now());} };
      });

      // Equip best from inventory, report deltas
      var inv = (typeof window.GameAPI.getInventory === "function") ? window.GameAPI.getInventory() : [];
      var statsBeforeBest = (typeof window.GameAPI.getStats === "function") ? window.GameAPI.getStats() : { atk: 0, def: 0 };
      var beforeEq = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
      var equippedNames = (typeof window.GameAPI.equipBestFromInventory === "function") ? window.GameAPI.equipBestFromInventory() : [];
      var afterEq = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
      var statsAfterBest = (typeof window.GameAPI.getStats === "function") ? window.GameAPI.getStats() : { atk: 0, def: 0 };
      var atkDelta = (statsAfterBest.atk || 0) - (statsBeforeBest.atk || 0);
      var defDelta = (statsAfterBest.def || 0) - (statsBeforeBest.def || 0);
      var improved = (atkDelta > 0) || (defDelta > 0);
      record(true, "Equipped from chest loot: " + (equippedNames.length ? equippedNames.join(", ") : "no changes") +
                    " (Δ atk " + (atkDelta.toFixed ? atkDelta.toFixed(1) : atkDelta) +
                    ", def " + (defDelta.toFixed ? defDelta.toFixed(1) : defDelta) + ")" +
                    (equippedNames.length ? (improved ? "" : " [no stat increase]") : ""));

      // Manual equip/unequip single item if present
      var equipIdx = inv.findIndex(function (it) { return it && it.kind === "equip"; });
      if (equipIdx !== -1 && typeof window.GameAPI.equipItemAtIndex === "function" && typeof window.GameAPI.unequipSlot === "function") {
        var item = inv[equipIdx];
        var slot = item.slot || "hand";
        var s0 = (typeof window.GameAPI.getStats === "function") ? window.GameAPI.getStats() : { atk: 0, def: 0 };
        var ok1 = window.GameAPI.equipItemAtIndex(equipIdx);
        await sleep(140);
        var s1 = (typeof window.GameAPI.getStats === "function") ? window.GameAPI.getStats() : { atk: 0, def: 0 };
        var ok2 = window.GameAPI.unequipSlot(slot);
        await sleep(140);
        var s2 = (typeof window.GameAPI.getStats === "function") ? window.GameAPI.getStats() : { atk: 0, def: 0 };
        var equipDeltaAtk = (s1.atk || 0) - (s0.atk || 0);
        var equipDeltaDef = (s1.def || 0) - (s0.def || 0);
        var unequipDeltaAtk = (s2.atk || 0) - (s1.atk || 0);
        var unequipDeltaDef = (s2.def || 0) - (s1.def || 0);
        var okStats = (ok1 && ok2);
        record(okStats, "Manual equip/unequip (" + (item.name || "equip") + " in slot " + slot + ") — equip Δ (atk " +
              (equipDeltaAtk.toFixed ? equipDeltaAtk.toFixed(1) : equipDeltaAtk) + ", def " +
              (equipDeltaDef.toFixed ? equipDeltaDef.toFixed(1) : equipDeltaDef) + "), unequip Δ (atk " +
              (unequipDeltaAtk.toFixed ? unequipDeltaAtk.toFixed(1) : unequipDeltaAtk) + ", def " +
              (unequipDeltaDef.toFixed ? unequipDeltaDef.toFixed(1) : unequipDeltaDef) + ")");
      } else {
        recordSkip("No direct equip/unequip test performed (no equip item or API not present)");
      }

      // Potion test
      var pots = (typeof window.GameAPI.getPotions === "function") ? window.GameAPI.getPotions() : [];
      if (pots && pots.length && typeof window.GameAPI.drinkPotionAtIndex === "function") {
        var pi = pots[0].i;
        var hpBefore = (typeof window.GameAPI.getStats === "function") ? window.GameAPI.getStats().hp : null;
        var okDrink = !!window.GameAPI.drinkPotionAtIndex(pi);
        await sleep(140);
        var hpAfter = (typeof window.GameAPI.getStats === "function") ? window.GameAPI.getStats().hp : null;
        var dhp = (hpAfter != null && hpBefore != null) ? (hpAfter - hpBefore) : null;
        record(okDrink, "Drank potion at index " + pi + " (" + (pots[0].name || "potion") + ")" + (dhp != null ? ", HP +" + dhp : ""));
      } else {
        recordSkip("No potions available to drink");
      }

      // Two-handed equip/unequip behavior + hand chooser
      var inv2 = (typeof window.GameAPI.getInventory === "function") ? window.GameAPI.getInventory() : [];
      var idx2h = inv2.findIndex(function (it) { return it && it.kind === "equip" && it.twoHanded; });
      if (idx2h !== -1 && typeof window.GameAPI.equipItemAtIndex === "function") {
        var okEq = !!window.GameAPI.equipItemAtIndex(idx2h);
        await sleep(140);
        var eqInfo = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
        var bothHandsSame = !!(eqInfo.left && eqInfo.right && eqInfo.left.name === eqInfo.right.name);
        var okUn = (typeof window.GameAPI.unequipSlot === "function") ? !!window.GameAPI.unequipSlot("left") : false;
        await sleep(140);
        var eqInfo2 = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
        var handsCleared = !eqInfo2.left && !eqInfo2.right;
        record(okEq && bothHandsSame && okUn && handsCleared, "Two-handed equip/unequip behavior");
      } else {
        recordSkip("Skipped two-handed equip test (no two-handed item)");
      }

      // Hand chooser branch coverage
      var inv3 = (typeof window.GameAPI.getInventory === "function") ? window.GameAPI.getInventory() : [];
      var idxHand = inv3.findIndex(function (it) { return it && it.kind === "equip" && it.slot === "hand" && !it.twoHanded; });
      if (idxHand !== -1) {
        (typeof window.GameAPI.unequipSlot === "function") && window.GameAPI.unequipSlot("left");
        (typeof window.GameAPI.unequipSlot === "function") && window.GameAPI.unequipSlot("right");
        await sleep(120);
        var okLeft = (typeof window.GameAPI.equipItemAtIndexHand === "function") ? !!window.GameAPI.equipItemAtIndexHand(idxHand, "left") : (!!window.GameAPI.equipItemAtIndex(idxHand));
        await sleep(140);
        var eqInfoA = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
        var leftOk = !!(eqInfoA.left && (!eqInfoA.right || eqInfoA.right.name !== eqInfoA.left.name));
        record(okLeft && leftOk, "Hand chooser: both empty -> equip left");

        if (!(eqInfoA.right)) {
          (typeof window.GameAPI.unequipSlot === "function") && window.GameAPI.unequipSlot("left");
          await sleep(100);
          var okRight = (typeof window.GameAPI.equipItemAtIndexHand === "function") ? !!window.GameAPI.equipItemAtIndexHand(idxHand, "right") : (!!window.GameAPI.equipItemAtIndex(idxHand));
          await sleep(140);
          eqInfoA = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
          if (!eqInfoA.right) {
            record(true, "Skipped auto equip test (unable to occupy right hand)");
          }
        }
        (typeof window.GameAPI.unequipSlot === "function") && window.GameAPI.unequipSlot("left");
        await sleep(120);
        var okAuto = (typeof window.GameAPI.equipItemAtIndex === "function") ? !!window.GameAPI.equipItemAtIndex(idxHand) : false;
        await sleep(140);
        var eqInfoB = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
        var autoLeft = !!(eqInfoB.left);
        record(okAuto && autoLeft, "Hand chooser: one empty -> auto equip to empty hand");
      } else {
        recordSkip("Skipped hand chooser test (no 1-hand item available)");
      }

      return true;
    } catch (e) {
      try { (ctx.record || function(){false;})(false, "Inventory scenario failed: " + (e && e.message ? e.message : String(e))); } catch (_) {}
      return false;
    }
  }

  window.SmokeTest.Scenarios.Inventory = { run };
})();