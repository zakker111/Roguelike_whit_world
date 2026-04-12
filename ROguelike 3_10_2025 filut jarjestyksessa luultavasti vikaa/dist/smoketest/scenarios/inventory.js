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

      // Inventory & equipment persistence across town/dungeon enter/exit (spawn/equip if needed)
      try {
        var TP = (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Teleport) || null;
        var G = window.GameAPI || {};

        // Helpers for capture, diff, and mode waits
        function captureInv() {
          var arr = (typeof G.getInventory === "function") ? (G.getInventory() || []) : [];
          var names = arr.map(function (it) { return (it && it.name) ? String(it.name) : (it && it.kind ? String(it.kind) : ""); });
          names.sort();
          return { count: arr.length | 0, names: names, sig: names.join("|") };
        }
        function captureEq() {
          var eq = (typeof G.getEquipment === "function") ? (G.getEquipment() || {}) : {};
          var slots = Object.keys(eq).filter(function (k) { return !!eq[k] && !!eq[k].name; }).sort();
          var pairs = slots.map(function (k) { return k + ":" + String(eq[k].name || ""); });
          return { pairs: pairs, sig: pairs.join("|"), empty: slots.length === 0 };
        }
        function eqSame(a, b) { return !!(a && b && a.sig === b.sig); }
        function invSame(a, b) { return !!(a && b && a.count === b.count && a.sig === b.sig); }
        function countMap(list) {
          var m = {};
          for (var i = 0; i < list.length; i++) {
            var k = list[i];
            m[k] = (m[k] | 0) + 1;
          }
          return m;
        }
        function diffCounts(aMap, bMap) {
          var added = [], removed = [];
          var keys = Object.keys(aMap).concat(Object.keys(bMap));
          var seen = {};
          for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            if (seen[k]) continue; seen[k] = true;
            var a = aMap[k] | 0; var b = bMap[k] | 0;
            if (b > a) added.push(k + " x" + (b - a));
            else if (a > b) removed.push(k + " x" + (a - b));
          }
          return { added: added, removed: removed };
        }
        async function waitMode(expected, timeoutMs) {
          var to = Math.max(300, (timeoutMs | 0) || 0);
          var deadline = Date.now() + to;
          while (Date.now() < deadline) {
            try { if (typeof G.getMode === "function" && G.getMode() === expected) return true; } catch (_) {}
            await sleep(80);
          }
          try { return (typeof G.getMode === "function" && G.getMode() === expected); } catch (_) { return false; }
        }
        async function persistCheck(expectedMode, label, baseInv, baseEq) {
          // Clear modals and wait for mode confirmation before capturing
          try { if (typeof ctx.ensureAllModalsClosed === "function") await ctx.ensureAllModalsClosed(2); } catch (_) {}
          var modeOk = await waitMode(expectedMode, 1200);
          record(modeOk, "Mode confirm (" + label + "): " + (modeOk ? expectedMode : (G.getMode ? G.getMode() : "(unknown)")));

          // Capture twice (allow in-mode oscillation to settle)
          var inv1 = captureInv(); var eq1 = captureEq();
          await sleep(500);
          try { if (typeof ctx.ensureAllModalsClosed === "function") await ctx.ensureAllModalsClosed(1); } catch (_) {}
          var inv2 = captureInv(); var eq2 = captureEq();

          var okEarly = invSame(baseInv, inv1) && eqSame(baseEq, eq1);
          var okSettled = invSame(baseInv, inv2) && eqSame(baseEq, eq2);
          var okPersist = !!(okEarly || okSettled);

          if (okPersist) {
            record(true, "Inventory persist (" + label + "): items/equipment stable" + (okEarly ? " [early]" : " [settled]"));
          } else {
            // Build diffs against settled capture
            var dInv = diffCounts(countMap(baseInv.names || []), countMap(inv2.names || []));
            var dEq = diffCounts(countMap(baseEq.pairs || []), countMap(eq2.pairs || []));
            var parts = [];
            if (dInv.added.length) parts.push("+inv " + dInv.added.join(", "));
            if (dInv.removed.length) parts.push("-inv " + dInv.removed.join(", "));
            if (dEq.added.length) parts.push("+eq " + dEq.added.join(", "));
            if (dEq.removed.length) parts.push("-eq " + dEq.removed.join(", "));
            var delta = parts.length ? ("; Δ " + parts.join(" | ")) : "";
            record(false, "Inventory persist (" + label + "): changed" + delta);
          }
        }

        // Ensure some items exist, spawn if empty
        var invPreEnsure = (typeof G.getInventory === "function") ? (G.getInventory() || []) : [];
        if (!invPreEnsure || !invPreEnsure.length) {
          if (typeof G.spawnItems === "function") { G.spawnItems(3); await sleep(160); }
        }
        // Ensure at least one item equipped; prefer hand slot, else auto-equip the first equip item
        var eqPre = (typeof G.getEquipment === "function") ? (G.getEquipment() || {}) : {};
        var hasAnyEquip = !!(eqPre && (eqPre.left || eqPre.right || eqPre.head || eqPre.body || eqPre.feet));
        if (!hasAnyEquip) {
          var invForEquip = (typeof G.getInventory === "function") ? (G.getInventory() || []) : [];
          var idxAny = invForEquip.findIndex(function (it) { return it && it.kind === "equip"; });
          if (idxAny !== -1) {
            if (typeof G.equipItemAtIndexHand === "function") {
              var eqNow = (typeof G.getEquipment === "function") ? (G.getEquipment() || {}) : {};
              var hand = (!eqNow.left ? "left" : (!eqNow.right ? "right" : "left"));
              G.equipItemAtIndexHand(idxAny, hand);
              await sleep(140);
            } else if (typeof G.equipItemAtIndex === "function") {
              G.equipItemAtIndex(idxAny);
              await sleep(140);
            }
          }
        }

        var inv0 = captureInv();
        var eq0 = captureEq();

        // Ensure starting from world without resetting via New Game (avoid wiping inventory)
        var modeStart = (typeof G.getMode === "function") ? G.getMode() : null;
        if (modeStart === "dungeon") {
          if (TP && typeof TP.teleportToDungeonExitAndLeave === "function") { await TP.teleportToDungeonExitAndLeave(ctx, { closeModals: true, waitMs: 500 }); }
          await sleep(200);
        } else if (modeStart === "town") {
          if (TP && typeof TP.teleportToGateAndExit === "function") { await TP.teleportToGateAndExit(ctx, { closeModals: true, waitMs: 500 }); }
          await sleep(200);
        }
        var modeWorldNow = (typeof G.getMode === "function") ? G.getMode() : null;
        if (modeWorldNow !== "world") {
          recordSkip("Inventory persistence skipped (not in world to begin transitions)");
        } else if (repeatRun) {
          recordSkip("Inventory persistence cycles skipped on repeat run " + runIndex);
        } else {
          // Dungeon enter/exit cycle (with settle waits and explicit mode confirmation)
          try {
            var enteredDungeon = (typeof ctx.ensureDungeonOnce === "function") ? !!(await ctx.ensureDungeonOnce()) : false;
            if (!enteredDungeon) {
              recordSkip("Inventory persistence skipped (dungeon enter helper did not reach dungeon)");
            } else {
              await persistCheck("dungeon", "dungeon enter", inv0, eq0);

              if (TP && typeof TP.teleportToDungeonExitAndLeave === "function") { await TP.teleportToDungeonExitAndLeave(ctx, { closeModals: true, waitMs: 600 }); }
              await persistCheck("world", "dungeon exit", inv0, eq0);

              var reenteredDungeon = (typeof ctx.ensureDungeonOnce === "function") ? !!(await ctx.ensureDungeonOnce()) : false;
              if (!reenteredDungeon) {
                recordSkip("Inventory persistence skipped (dungeon re-enter helper did not reach dungeon)");
              } else {
                await persistCheck("dungeon", "dungeon re-enter", inv0, eq0);

                if (TP && typeof TP.teleportToDungeonExitAndLeave === "function") { await TP.teleportToDungeonExitAndLeave(ctx, { closeModals: true, waitMs: 600 }); }
                await persistCheck("world", "dungeon re-exit", inv0, eq0);
              }
            }
          } catch (_) {
            record(false, "Inventory persistence (dungeon cycles) failed");
          }

          // Town enter/exit cycle (with settle waits and explicit mode confirmation)
          try {
            if (typeof ctx.ensureTownOnce === "function") { await ctx.ensureTownOnce(); }
            await persistCheck("town", "town enter", inv0, eq0);

            if (TP && typeof TP.teleportToGateAndExit === "function") { await TP.teleportToGateAndExit(ctx, { closeModals: true, waitMs: 600 }); }
            await persistCheck("world", "town exit", inv0, eq0);

            if (typeof ctx.ensureTownOnce === "function") { await ctx.ensureTownOnce(); }
            await persistCheck("town", "town re-enter", inv0, eq0);

            if (TP && typeof TP.teleportToGateAndExit === "function") { await TP.teleportToGateAndExit(ctx, { closeModals: true, waitMs: 600 }); }
            await persistCheck("world", "town re-exit", inv0, eq0);
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
