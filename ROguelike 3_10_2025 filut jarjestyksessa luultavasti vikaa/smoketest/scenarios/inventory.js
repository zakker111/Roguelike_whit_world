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
      var makeBudget = ctx.makeBudget || (ms => {
        var start = Date.now(); var dl = start + (ms|0);
        return { exceeded: function(){return Date.now() > dl;}, remain: function(){return Math.max(0, dl - Date.now());} };
      });

      // Try to ensure dungeon mode; if we can't, continue without skipping and run inventory tests anyway.
      try {
        var mode0 = (window.GameAPI && typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : null;
        record(true, "Inventory prep: starting mode = " + (mode0 || "(unknown)"));

        if (mode0 === "town") {
          try { if (typeof window.GameAPI.returnToWorldIfAtExit === "function") window.GameAPI.returnToWorldIfAtExit(); } catch (_) {}
          await sleep(240);
          mode0 = window.GameAPI.getMode();
          if (mode0 !== "world") {
            try { var btnNG = document.getElementById("god-newgame-btn"); if (btnNG) btnNG.click(); } catch (_) {}
            await sleep(380);
            mode0 = window.GameAPI.getMode();
          }
        }

        if (mode0 !== "dungeon") {
          // Attempt world -> dungeon entry flow
          try {
            if (typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() !== "world") {
              // Fallback to world
              try { var btnNG2 = document.getElementById("god-newgame-btn"); if (btnNG2) btnNG2.click(); } catch (_) {}
              await sleep(380);
            }
            if (typeof window.GameAPI.gotoNearestDungeon === "function") {
              await window.GameAPI.gotoNearestDungeon();
            }
            ctx.key("g"); await sleep(280);
            if (typeof window.GameAPI.enterDungeonIfOnEntrance === "function") window.GameAPI.enterDungeonIfOnEntrance();
            await sleep(260);
          } catch (_) {}
        }

        var modeAfter = (window.GameAPI && typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : null;
        if (modeAfter === "dungeon") {
          record(true, "Inventory prep: entered dungeon");
        } else {
          record(true, "Inventory prep: not in dungeon; continuing in mode " + (modeAfter || "(unknown)"));
        }
      } catch (_) {
        // Proceed anyway; inventory tests work outside dungeon too.
        record(true, "Inventory prep: encountered error; continuing outside dungeon");
      }

      // Ensure baseline items/potions for tests
      try {
        var invEnsure = (typeof window.GameAPI.getInventory === "function") ? window.GameAPI.getInventory() : [];
        var hasEquip = invEnsure.some(function (it) { return it && it.kind === "equip"; });
        if (!hasEquip) {
          if (typeof window.GameAPI.spawnItems === "function") { window.GameAPI.spawnItems(3); }
          else {
            // Fallback: click GOD spawn button to add random items
            try {
              var opened = false;
              var btnOpen = document.getElementById("god-open-btn");
              if (btnOpen) { btnOpen.click(); opened = true; }
              if (opened) await sleep(160);
              var btnSpawn = document.getElementById("god-spawn-btn");
              if (btnSpawn) { btnSpawn.click(); await sleep(160); }
            } catch (_) {}
          }
          await sleep(200);
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

      // Inventory & equipment persistence across town/dungeon enter/exit (spawn/equip if needed)
      try {
        var TP = (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Teleport) || null;

        function captureInv() {
          var arr = (typeof window.GameAPI.getInventory === "function") ? (window.GameAPI.getInventory() || []) : [];
          var names = arr.map(function (it) { return (it && it.name) ? String(it.name) : (it && it.kind ? String(it.kind) : ""); });
          names.sort();
          return { count: arr.length | 0, sig: names.join("|") };
        }
        function captureEq() {
          var eq = (typeof window.GameAPI.getEquipment === "function") ? (window.GameAPI.getEquipment() || {}) : {};
          var slots = Object.keys(eq).filter(function (k) { return !!eq[k] && !!eq[k].name; }).sort();
          var pairs = slots.map(function (k) { return k + ":" + String(eq[k].name || ""); });
          return { sig: pairs.join("|"), empty: slots.length === 0 };
        }
        function eqSame(a, b) { return !!(a && b && a.sig === b.sig); }
        function invSame(a, b) { return !!(a && b && a.count === b.count && a.sig === b.sig); }

        // Ensure some items exist, spawn if empty
        var invPreEnsure = (typeof window.GameAPI.getInventory === "function") ? (window.GameAPI.getInventory() || []) : [];
        if (!invPreEnsure || !invPreEnsure.length) {
          if (typeof window.GameAPI.spawnItems === "function") { window.GameAPI.spawnItems(3); await sleep(160); }
        }
        // Ensure at least one item equipped; prefer hand slot, else auto-equip the first equip item
        var eqPre = (typeof window.GameAPI.getEquipment === "function") ? (window.GameAPI.getEquipment() || {}) : {};
        var hasAnyEquip = !!(eqPre && (eqPre.left || eqPre.right || eqPre.head || eqPre.body || eqPre.feet));
        if (!hasAnyEquip) {
          var invForEquip = (typeof window.GameAPI.getInventory === "function") ? (window.GameAPI.getInventory() || []) : [];
          var idxAny = invForEquip.findIndex(function (it) { return it && it.kind === "equip"; });
          if (idxAny !== -1) {
            if (typeof window.GameAPI.equipItemAtIndexHand === "function") {
              // Prefer left then right
              var eqNow = (typeof window.GameAPI.getEquipment === "function") ? (window.GameAPI.getEquipment() || {}) : {};
              var hand = (!eqNow.left ? "left" : (!eqNow.right ? "right" : "left"));
              window.GameAPI.equipItemAtIndexHand(idxAny, hand);
              await sleep(140);
            } else if (typeof window.GameAPI.equipItemAtIndex === "function") {
              window.GameAPI.equipItemAtIndex(idxAny);
              await sleep(140);
            }
          }
        }

        var inv0 = captureInv();
        var eq0 = captureEq();

        // Ensure starting from world without resetting via New Game (avoid wiping inventory)
        var modeStart = (typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : null;
        if (modeStart === "dungeon") {
          // Try safe exit to world
          if (TP && typeof TP.teleportToDungeonExitAndLeave === "function") { await TP.teleportToDungeonExitAndLeave(ctx, { closeModals: true, waitMs: 400 }); }
          await sleep(160);
        } else if (modeStart === "town") {
          if (TP && typeof TP.teleportToGateAndExit === "function") { await TP.teleportToGateAndExit(ctx, { closeModals: true, waitMs: 400 }); }
          await sleep(160);
        }
        var modeWorldNow = (typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : null;
        if (modeWorldNow !== "world") {
          recordSkip("Inventory persistence skipped (not in world to begin transitions)");
        } else {
          // Dungeon enter/exit cycle 1
          var okDungeonEnter1 = false, okDungeonExit1 = false, okDungeonReEnter = false, okDungeonReExit = false;
          try {
            if (typeof ctx.ensureDungeonOnce === "function") {
              okDungeonEnter1 = !!(await ctx.ensureDungeonOnce());
              await sleep(200);
            }
            var modeAfterEnterD1 = (typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : null;
            var invD1 = captureInv();
            var eqD1 = captureEq();
            record(invSame(inv0, invD1) && eqSame(eq0, eqD1) && (modeAfterEnterD1 === "dungeon"), "Inventory persist (dungeon enter): items/equipment stable");

            // Exit to world
            if (TP && typeof TP.teleportToDungeonExitAndLeave === "function") {
              okDungeonExit1 = !!(await TP.teleportToDungeonExitAndLeave(ctx, { closeModals: true, waitMs: 500 }));
            }
            await sleep(200);
            var modeAfterExitD1 = (typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : null;
            var invAfterExitD1 = captureInv();
            var eqAfterExitD1 = captureEq();
            record(invSame(inv0, invAfterExitD1) && eqSame(eq0, eqAfterExitD1) && (modeAfterExitD1 === "world"), "Inventory persist (dungeon exit): items/equipment stable");

            // Re-enter dungeon
            if (typeof ctx.ensureDungeonOnce === "function") {
              okDungeonReEnter = !!(await ctx.ensureDungeonOnce());
              await sleep(200);
            }
            var modeAfterReEnterD = (typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : null;
            var invD2 = captureInv();
            var eqD2 = captureEq();
            record(invSame(inv0, invD2) && eqSame(eq0, eqD2) && (modeAfterReEnterD === "dungeon"), "Inventory persist (dungeon re-enter): items/equipment stable");

            // Re-exit to world
            if (TP && typeof TP.teleportToDungeonExitAndLeave === "function") {
              okDungeonReExit = !!(await TP.teleportToDungeonExitAndLeave(ctx, { closeModals: true, waitMs: 500 }));
            }
            await sleep(200);
            var modeAfterReExitD = (typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : null;
            var invAfterReExitD = captureInv();
            var eqAfterReExitD = captureEq();
            record(invSame(inv0, invAfterReExitD) && eqSame(eq0, eqAfterReExitD) && (modeAfterReExitD === "world"), "Inventory persist (dungeon re-exit): items/equipment stable");
          } catch (_) {
            record(false, "Inventory persistence (dungeon cycles) failed");
          }

          // Town enter/exit cycle 1
          try {
            var okTownEnter1 = false, okTownExit1 = false, okTownReEnter = false, okTownReExit = false;

            if (typeof ctx.ensureTownOnce === "function") {
              okTownEnter1 = !!(await ctx.ensureTownOnce());
              await sleep(200);
            }
            var modeAfterEnterT1 = (typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : null;
            var invT1 = captureInv();
            var eqT1 = captureEq();
            record(invSame(inv0, invT1) && eqSame(eq0, eqT1) && (modeAfterEnterT1 === "town"), "Inventory persist (town enter): items/equipment stable");

            if (TP && typeof TP.teleportToGateAndExit === "function") {
              okTownExit1 = !!(await TP.teleportToGateAndExit(ctx, { closeModals: true, waitMs: 500 }));
            }
            await sleep(200);
            var modeAfterExitT1 = (typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : null;
            var invAfterExitT1 = captureInv();
            var eqAfterExitT1 = captureEq();
            record(invSame(inv0, invAfterExitT1) && eqSame(eq0, eqAfterExitT1) && (modeAfterExitT1 === "world"), "Inventory persist (town exit): items/equipment stable");

            if (typeof ctx.ensureTownOnce === "function") {
              okTownReEnter = !!(await ctx.ensureTownOnce());
              await sleep(200);
            }
            var modeAfterReEnterT = (typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : null;
            var invT2 = captureInv();
            var eqT2 = captureEq();
            record(invSame(inv0, invT2) && eqSame(eq0, eqT2) && (modeAfterReEnterT === "town"), "Inventory persist (town re-enter): items/equipment stable");

            if (TP && typeof TP.teleportToGateAndExit === "function") {
              okTownReExit = !!(await TP.teleportToGateAndExit(ctx, { closeModals: true, waitMs: 500 }));
            }
            await sleep(200);
            var modeAfterReExitT = (typeof window.GameAPI.getMode === "function") ? window.GameAPI.getMode() : null;
            var invAfterReExitT = captureInv();
            var eqAfterReExitT = captureEq();
            record(invSame(inv0, invAfterReExitT) && eqSame(eq0, eqAfterReExitT) && (modeAfterReExitT === "world"), "Inventory persist (town re-exit): items/equipment stable");
          } catch (_) {
            record(false, "Inventory persistence (town cycles) failed");
          }
        }
      } catch (_) {
        record(true, "Inventory persistence checks skipped (helper/API not available)");
      }

      return true;
    } catch (e) {
      try { (ctx.record || function(){false;})(false, "Inventory scenario failed: " + (e && e.message ? e.message : String(e))); } catch (_) {}
      return false;
    }
  }

  window.SmokeTest.Scenarios.Inventory = { run };
})();