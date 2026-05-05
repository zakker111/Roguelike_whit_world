(function () {
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  async function run(ctx) {
    try {
      var caps = (ctx && ctx.caps) || {};
      if (!caps.GameAPI || !caps.getMode) {
        (ctx.recordSkip || function(){} )("Inventory scenario skipped (GameAPI/getMode not available)");
        return true;
      }

      // Helpers
      var record = ctx.record || function(){};
      var recordSkip = ctx.recordSkip || function(){};
      var sleep = ctx.sleep || (ms => new Promise(r => setTimeout(r, ms|0)));
      var runIndex = (ctx && ctx.index) ? (ctx.index | 0) : 1;
      var repeatRun = runIndex > 1;
      var isCursedSeppoBlade = function (item) {
        if (!item) return false;
        try {
          var id = String(item.id || "").toLowerCase();
          var name = String(item.name || "");
          return id === "seppos_true_blade" || /seppo's true blade/i.test(name);
        } catch (_) {
          return false;
        }
      };
      var makeBudget = ctx.makeBudget || (ms => {
        var start = Date.now(); var dl = start + (ms|0);
        return { exceeded: function(){return Date.now() > dl;}, remain: function(){return Math.max(0, dl - Date.now());} };
      });

      record(true, "Inventory prep: starting mode = " + (((window.GameAPI && typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : null) || "(unknown)"));

      // Ensure deterministic baseline items/potions for tests. New games intentionally
      // start empty, so the smoke test seeds only the equipment it exercises.
      try {
        var apiForSeed = window.GameAPI || {};
        var ctxForSeed = (typeof apiForSeed.getCtx === "function") ? apiForSeed.getCtx() : null;
        var seededInventory = false;
        if (ctxForSeed && ctxForSeed.player && Array.isArray(ctxForSeed.player.inventory)) {
          var invSeed = ctxForSeed.player.inventory;
          var hasEquip = invSeed.some(function (it) { return it && it.kind === "equip"; });
          var handCount = invSeed.filter(function (it) { return it && it.kind === "equip" && it.slot === "hand" && !it.twoHanded; }).length;
          var hasTwoHanded = invSeed.some(function (it) { return it && it.kind === "equip" && it.slot === "hand" && it.twoHanded && !isCursedSeppoBlade(it); });
          if (!hasEquip) {
            invSeed.push({ kind: "equip", slot: "hand", name: "smoke short sword", atk: 1.5, tier: 1, decay: 0, twoHanded: false });
            seededInventory = true;
            handCount++;
          }
          if (handCount < 2) {
            invSeed.push({ kind: "equip", slot: "hand", name: "smoke buckler", def: 1.0, tier: 1, decay: 0, twoHanded: false });
            seededInventory = true;
          }
          if (!hasTwoHanded) {
            invSeed.push({ kind: "equip", slot: "hand", name: "smoke greatsword", atk: 2.5, tier: 2, decay: 0, twoHanded: true });
            seededInventory = true;
          }
        }
        if (seededInventory) {
          try { ctxForSeed.updateUI && ctxForSeed.updateUI(); } catch (_) {}
          try { ctxForSeed.renderInventory && ctxForSeed.renderInventory(); } catch (_) {}
          record(true, "Inventory prep: seeded deterministic smoke equipment");
        }
        var potsEnsure = (typeof window.GameAPI.getPotions === "function") ? window.GameAPI.getPotions() : [];
        if (!potsEnsure || !potsEnsure.length) {
          if (typeof window.GameAPI.addPotionToInventory === "function") {
            window.GameAPI.addPotionToInventory(6, "average potion (+6 HP)");
            await sleep(140);
          }
        }
      } catch (_) {}

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
      record(true, "Equip best from inventory: " + (equippedNames.length ? equippedNames.join(", ") : "no changes") +
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
        var eqAfterManualEquip = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
        if (slot === "hand") {
          if (eqAfterManualEquip.left && eqAfterManualEquip.left.name === item.name) slot = "left";
          else if (eqAfterManualEquip.right && eqAfterManualEquip.right.name === item.name) slot = "right";
        }
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
      var idx2h = inv2.findIndex(function (it) { return it && it.kind === "equip" && it.twoHanded && !isCursedSeppoBlade(it); });
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
      } else if (inv2.some(function (it) { return it && it.kind === "equip" && it.twoHanded && isCursedSeppoBlade(it); })) {
        recordSkip("Skipped two-handed equip test (only cursed two-handed item available)");
      } else {
        recordSkip("Skipped two-handed equip test (no two-handed item)");
      }

      // Hand chooser branch coverage
      var getInventoryList = function () {
        return (typeof window.GameAPI.getInventory === "function") ? (window.GameAPI.getInventory() || []) : [];
      };
      var buildItemSignature = function (it) {
        if (!it) return null;
        return {
          kind: it.kind || "",
          slot: it.slot || "",
          name: it.name || "",
          atk: Number(it.atk || 0),
          def: Number(it.def || 0),
          decay: Number(it.decay || 0),
          count: Number(it.count || 0),
          twoHanded: !!it.twoHanded
        };
      };
      var sameItemSignature = function (a, b) {
        return !!(a && b &&
          a.kind === b.kind &&
          a.slot === b.slot &&
          a.name === b.name &&
          Number(a.atk || 0) === Number(b.atk || 0) &&
          Number(a.def || 0) === Number(b.def || 0) &&
          Number(a.decay || 0) === Number(b.decay || 0) &&
          Number(a.count || 0) === Number(b.count || 0) &&
          !!a.twoHanded === !!b.twoHanded);
      };
      var findIndicesBySignature = function (sig) {
        var cur = getInventoryList();
        var matches = [];
        for (var ii = 0; ii < cur.length; ii++) {
          if (sameItemSignature(buildItemSignature(cur[ii]), sig)) matches.push(ii);
        }
        return matches;
      };
      var resolveUniqueIndex = function (sig, label) {
        var matches = findIndicesBySignature(sig);
        if (!matches.length) return { ok: false, ambiguous: false, idx: -1 };
        if (matches.length > 1) {
          recordSkip("Skipped " + label + " (ambiguous inventory match for " + (sig && sig.name ? sig.name : "hand item") + ")");
          return { ok: false, ambiguous: true, idx: -1 };
        }
        return { ok: true, ambiguous: false, idx: matches[0] };
      };
      var equipmentMatches = function (eqIt, sig) {
        return !!(eqIt && sig &&
          (eqIt.slot || "") === (sig.slot || "") &&
          (eqIt.name || "") === (sig.name || "") &&
          Number(eqIt.atk || 0) === Number(sig.atk || 0) &&
          Number(eqIt.def || 0) === Number(sig.def || 0) &&
          Number(eqIt.decay || 0) === Number(sig.decay || 0) &&
          !!eqIt.twoHanded === !!sig.twoHanded);
      };
      var collectOneHandSignatures = function () {
        var cur = getInventoryList();
        var sigs = [];
        for (var ii = 0; ii < cur.length; ii++) {
          var it = cur[ii];
          if (!(it && it.kind === "equip" && it.slot === "hand" && !it.twoHanded)) continue;
          var sig = buildItemSignature(it);
          var seen = sigs.some(function (existing) { return sameItemSignature(existing, sig); });
          if (!seen) sigs.push(sig);
        }
        return sigs;
      };

      var handSigs = collectOneHandSignatures();
      if (handSigs.length) {
        (typeof window.GameAPI.unequipSlot === "function") && window.GameAPI.unequipSlot("left");
        (typeof window.GameAPI.unequipSlot === "function") && window.GameAPI.unequipSlot("right");
        await sleep(120);
        var eqBeforeHandChooser = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
        if (eqBeforeHandChooser.left || eqBeforeHandChooser.right) {
          recordSkip("Skipped hand chooser test (hands could not be cleared)");
        } else {

          var leftSig = handSigs[0];
          var leftIndex = resolveUniqueIndex(leftSig, "hand chooser test");
          if (!leftIndex.ok) {
            recordSkip("Skipped hand chooser test (unable to resolve unique 1-hand item)");
          } else {
            var okLeft = (typeof window.GameAPI.equipItemAtIndexHand === "function")
              ? !!window.GameAPI.equipItemAtIndexHand(leftIndex.idx, "left")
              : (!!window.GameAPI.equipItemAtIndex(leftIndex.idx));
            await sleep(140);
            var eqInfoA = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
            var leftOk = equipmentMatches(eqInfoA.left, leftSig) && !equipmentMatches(eqInfoA.right, leftSig);
            record(okLeft && leftOk, "Hand chooser: both empty -> equip left");

            if (handSigs.length > 1 && typeof window.GameAPI.equipItemAtIndexHand === "function" && typeof window.GameAPI.equipItemAtIndex === "function") {
              (typeof window.GameAPI.unequipSlot === "function") && window.GameAPI.unequipSlot("left");
              (typeof window.GameAPI.unequipSlot === "function") && window.GameAPI.unequipSlot("right");
              await sleep(120);

              var rightSig = handSigs[0];
              var autoSig = handSigs[1];
              var rightIndex = resolveUniqueIndex(rightSig, "right-hand setup");

              if (!rightIndex.ok) {
                recordSkip("Skipped hand chooser auto-equip test (unable to resolve right-hand setup item)");
              } else {
                var okRightSetup = !!window.GameAPI.equipItemAtIndexHand(rightIndex.idx, "right");
                await sleep(140);
                var eqInfoRight = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
                var rightOccupied = okRightSetup && equipmentMatches(eqInfoRight.right, rightSig) && !eqInfoRight.left;

                if (!rightOccupied) {
                  recordSkip("Skipped hand chooser auto-equip test (unable to occupy right hand)");
                } else {
                  var autoIndex = resolveUniqueIndex(autoSig, "auto hand chooser test");
                  if (!autoIndex.ok) {
                    recordSkip("Skipped hand chooser auto-equip test (unable to resolve auto-equip item)");
                  } else {
                    var okAuto = !!window.GameAPI.equipItemAtIndex(autoIndex.idx);
                    await sleep(140);
                    var eqInfoB = (typeof window.GameAPI.getEquipment === "function") ? window.GameAPI.getEquipment() : {};
                    var autoLeft = equipmentMatches(eqInfoB.left, autoSig) && equipmentMatches(eqInfoB.right, rightSig);
                    record(okAuto && autoLeft, "Hand chooser: one empty -> auto equip to empty hand");
                  }
                }
              }
            } else {
              recordSkip("Skipped hand chooser auto-equip test (need two distinct 1-hand items and hand API)");
            }
          }
        }
      } else {
        recordSkip("Skipped hand chooser test (no 1-hand item available)");
      }

      // Inventory/equipment persistence across dungeon/town transitions is covered by
      // dedicated mode scenarios. Keep this scenario focused on inventory/equipment
      // behavior so Phase 0 cannot be blocked by long route/transition helpers.
      recordSkip("Inventory persistence transition cycles skipped (covered by dungeon/town scenarios)");

      return true;
    } catch (e) {
      try { (ctx.record || function(){false;})(false, "Inventory scenario failed: " + (e && e.message ? e.message : String(e))); } catch (_) {}
      return false;
    }
  }

  window.SmokeTest.Scenarios.Inventory = { run };
})();
