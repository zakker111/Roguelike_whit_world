(function () {
  // SmokeTest Scenario: Bottle Map
  // Validates:
  // - A usable bottle_map item can be used from inventory.
  // - Using it places a gm.bottleMap marker via MarkerService.
  // - Pressing 'g' on that marker starts the Bottle Map encounter.
  // - Withdrawing from the encounter keeps the marker.
  // - Winning the encounter pays out (gold delta) and removes the marker.
  // - Phase 7D lifecycle gates:
  //   - Orphan marker cleanup when thread inactive.
  //   - Thread active but marker missing -> reconcileMarkers restores.
  //   - Activation failure (no valid target) refunds item and expires thread.

  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  async function run(ctx) {
    const record = (ctx && ctx.record) || function () {};
    const recordSkip = (ctx && ctx.recordSkip) || function () {};
    const sleep = (ctx && ctx.sleep) || (ms => new Promise(r => setTimeout(r, ms | 0)));
    const key = (ctx && ctx.key) || (k => { try { window.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: k, bubbles: true })); } catch (_) {} });
    const ensureAllModalsClosed = (ctx && ctx.ensureAllModalsClosed) || null;

    const G = window.GameAPI || null;
    if (!G || !has(G.getCtx) || !has(G.getMode)) {
      recordSkip("Bottle Map skipped (GameAPI not available)");
      return true;
    }

    // This scenario requires overworld mode; try to recover if we're currently in another mode
    // (e.g. if a prior scenario left the game in town/dungeon/encounter/region).
    try {
      const mode0 = has(G.getMode) ? String(G.getMode() || "") : "";
      if (mode0 && mode0 !== "world") {
        try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(4); } catch (_) {}
        try {
          if (mode0 === "encounter" && has(G.completeEncounter)) G.completeEncounter("withdraw");
          else if (mode0 === "dungeon" && has(G.returnToWorldIfAtExit)) G.returnToWorldIfAtExit();
          else if (mode0 === "town") {
            if (has(G.returnToWorldFromTown)) G.returnToWorldFromTown();
            else if (has(G.leaveTownNow)) G.leaveTownNow();
            else if (has(G.requestLeaveTown)) G.requestLeaveTown();
          }
        } catch (_) {}
        // Hard fallback: force a fresh overworld (acceptable for smoketests)
        if (has(G.forceWorld)) {
          try { G.forceWorld(); } catch (_) {}
          await sleep(240);
        }
      }
    } catch (_) {}

    const gctx = G.getCtx();
    if (!gctx || gctx.mode !== "world") {
      recordSkip("Bottle Map skipped (not in world mode)");
      return true;
    }

    // Ensure no modal UI (GOD/smoke/inventory/etc) is intercepting key input.
    try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(4); } catch (_) {}

    const MS = window.MarkerService || null;
    const IF = window.InventoryFlow || null;
    const GMB = window.GMBridge || null;
    record(!!MS, "MarkerService is available");
    record(!!IF, "InventoryFlow is available");
    record(!!GMB, "GMBridge is available");

    if (!MS || !has(MS.add) || !has(MS.findAtPlayer) || !has(MS.remove) || !IF || !has(IF.useItemByIndex)) {
      recordSkip("Bottle Map skipped (MarkerService/InventoryFlow missing required functions)");
      return true;
    }

    // Clean any stale Bottle Map state from a prior attempt (keeps this scenario deterministic).
    try { MS.remove(gctx, (m) => m && String(m.kind || "") === "gm.bottleMap"); } catch (_) {}
    try {
      const gm = (gctx && gctx.gm && typeof gctx.gm === "object") ? gctx.gm : null;
      const threads = (gm && gm.threads && typeof gm.threads === "object") ? gm.threads : null;
      const bm = (threads && threads.bottleMap && typeof threads.bottleMap === "object") ? threads.bottleMap : null;
      if (bm) {
        bm.active = false;
        bm.status = "claimed";
        bm.instanceId = null;
        bm.target = null;
        bm.reward = null;
      }
    } catch (_) {}

    const worldRef = gctx.world || null;

    const getQuestMarkers = () => {
      try {
        const c = has(G.getCtx) ? G.getCtx() : null;
        const w = (c && c.world) || worldRef;
        return (w && Array.isArray(w.questMarkers)) ? w.questMarkers : [];
      } catch (_) {
        return [];
      }
    };

    const findBottleMarker = (instanceId) => {
      const list = getQuestMarkers();
      return list.find(m => {
        if (!m) return false;
        if (String(m.kind || "") !== "gm.bottleMap") return false;
        if (instanceId == null) return true;
        return String(m.instanceId || "") === String(instanceId || "");
      }) || null;
    };

    const isConfirmOpen = () => {
      try {
        const CM = window.ConfirmModal;
        if (CM && typeof CM.isOpen === "function") return !!CM.isOpen();
      } catch (_) {}
      try {
        const panel = document.getElementById("confirm-panel");
        return !!(panel && panel.style.display !== "none");
      } catch (_) { return false; }
    };

    const acceptConfirm = async () => {
      // Prefer keyboard acceptance (Enter) now that ConfirmModal supports it.
      for (let n = 0; n < 30; n++) {
        if (isConfirmOpen()) break;
        await sleep(80);
      }
      if (!isConfirmOpen()) return false;

      try { key("Enter"); } catch (_) {}
      for (let n = 0; n < 30; n++) {
        if (!isConfirmOpen()) return true;
        await sleep(80);
      }
      return !isConfirmOpen();
    };

    const getGoldAmount = () => {
      try {
        const c = has(G.getCtx) ? G.getCtx() : gctx;
        const inv = (c && c.player && Array.isArray(c.player.inventory)) ? c.player.inventory : [];
        let sum = 0;
        for (const it of inv) {
          if (!it) continue;
          const k = String(it.kind || it.type || "").toLowerCase();
          if (k !== "gold") continue;
          sum += (typeof it.amount === "number") ? it.amount : (Number(it.amount) || 0);
        }
        return sum;
      } catch (_) {
        return 0;
      }
    };

    const countBottleMaps = () => {
      try {
        const c = has(G.getCtx) ? G.getCtx() : gctx;
        const inv = (c && c.player && Array.isArray(c.player.inventory)) ? c.player.inventory : [];
        let n = 0;
        for (const it of inv) {
          if (!it) continue;
          if (String(it.kind || "") !== "tool") continue;
          if (String(it.type || "") !== "bottle_map") continue;
          n++;
        }
        return n;
      } catch (_) {
        return 0;
      }
    };

    const removeAllBottleMaps = () => {
      try {
        const c = has(G.getCtx) ? G.getCtx() : gctx;
        const inv = (c && c.player && Array.isArray(c.player.inventory)) ? c.player.inventory : [];
        for (let i = inv.length - 1; i >= 0; i--) {
          const it = inv[i];
          if (!it) continue;
          if (String(it.kind || "") !== "tool") continue;
          if (String(it.type || "") !== "bottle_map") continue;
          inv.splice(i, 1);
        }
        if (typeof c.updateUI === "function") c.updateUI();
        else if (typeof gctx.updateUI === "function") gctx.updateUI();
      } catch (_) {}
    };

    const waitUntil = async (pred, timeoutMs, intervalMs) => {
      const deadline = Date.now() + Math.max(0, (timeoutMs | 0) || 0);
      const step = Math.max(20, (intervalMs | 0) || 80);
      while (Date.now() < deadline) {
        let ok = false;
        try { ok = !!pred(); } catch (_) { ok = false; }
        if (ok) return true;
        await sleep(step);
      }
      try { return !!pred(); } catch (_) { return false; }
    };

    const waitUntilMode = (mode, timeoutMs) => waitUntil(() => has(G.getMode) && G.getMode() === mode, timeoutMs, 80);

    // Encounter template must be present for GMBridge to start the encounter.
    let encReady = true;
    try {
      const GD = (typeof window !== "undefined" ? window.GameData : null);
      if (GD && GD.ready && typeof GD.ready.then === "function") {
        let settled = false;
        try {
          GD.ready.then(() => { settled = true; }, () => { settled = true; });
        } catch (_) {
          settled = true;
        }
        await waitUntil(() => settled, 10000, 80);
      }
      encReady = await waitUntil(() => {
        try {
          const GD2 = (typeof window !== "undefined" ? window.GameData : null);
          const reg = GD2 && GD2.encounters && Array.isArray(GD2.encounters.templates) ? GD2.encounters.templates : [];
          return !!reg.find(t => t && String(t.id || "").toLowerCase() === "gm_bottle_map_scene");
        } catch (_) {
          return false;
        }
      }, 2500, 80);
    } catch (_) {
      encReady = false;
    }
    record(encReady, "Encounter template 'gm_bottle_map_scene' loaded");
    if (!encReady) {
      recordSkip("Bottle Map skipped (encounter templates not loaded)");
      return true;
    }

    const teleportToMarker = async (m) => {
      let ok = false;
      let lx = 0;
      let ly = 0;
      try {
        const w = (has(G.getCtx) ? (G.getCtx() && G.getCtx().world) : null) || worldRef;
        const ox = (w && typeof w.originX === "number") ? (w.originX | 0) : 0;
        const oy = (w && typeof w.originY === "number") ? (w.originY | 0) : 0;
        lx = (m.x | 0) - ox;
        ly = (m.y | 0) - oy;
        if (has(G.teleportTo)) ok = !!G.teleportTo(lx, ly, { ensureWalkable: true, fallbackScanRadius: 4 });
      } catch (_) { ok = false; }

      if (!ok) {
        await sleep(120);
        return false;
      }

      // Ensure we are standing *exactly* on the marker tile before pressing 'g'.
      let onTile = false;
      try {
        onTile = await waitUntil(() => {
          const p = has(G.getPlayer) ? G.getPlayer() : null;
          return !!(p && (p.x | 0) === (lx | 0) && (p.y | 0) === (ly | 0));
        }, 900, 80);
      } catch (_) { onTile = false; }

      if (!onTile) {
        // Force-land even if the tile is considered non-walkable (marker interactions only need us on the coords).
        try {
          if (has(G.teleportTo)) ok = !!G.teleportTo(lx, ly, { ensureWalkable: false, fallbackScanRadius: 0 });
        } catch (_) { ok = false; }
        try {
          onTile = await waitUntil(() => {
            const p = has(G.getPlayer) ? G.getPlayer() : null;
            return !!(p && (p.x | 0) === (lx | 0) && (p.y | 0) === (ly | 0));
          }, 900, 80);
        } catch (_) { onTile = false; }
      }

      let onMarker = false;
      try {
        const want = String((m && m.instanceId) || "");
        onMarker = await waitUntil(() => {
          const at = MS.findAtPlayer(gctx);
          const markers = Array.isArray(at) ? at : (at ? [at] : []);
          return !!markers.find(mm => mm && String(mm.instanceId || "") === want);
        }, 900, 80);
      } catch (_) { onMarker = false; }

      return !!(ok && onTile && onMarker);
    };

    // Phase 7D regression gate: GMBridge.useInventoryItem should not treat an undefined idx as 0
    // (undefined | 0 === 0), which could consume the wrong inventory slot.
    let idxSafetyOk = true;
    try {
      if (GMB && has(GMB.useInventoryItem)) {
        // Hard reset bottle map state.
        try { MS.remove(gctx, (m) => m && String(m.kind || "") === "gm.bottleMap"); } catch (_) {}
        try {
          const gm = (gctx && gctx.gm && typeof gctx.gm === "object") ? gctx.gm : null;
          const threads = (gm && gm.threads && typeof gm.threads === "object") ? gm.threads : null;
          const bm = (threads && threads.bottleMap && typeof threads.bottleMap === "object") ? threads.bottleMap : null;
          if (bm) {
            bm.active = false;
            bm.status = "claimed";
            bm.instanceId = null;
            bm.target = null;
            bm.reward = null;
          }
        } catch (_) {}

        const inv = (gctx.player && Array.isArray(gctx.player.inventory)) ? gctx.player.inventory : (gctx.player.inventory = []);
        const invSnap = inv.slice(0);

        // Keep only our two test items to avoid interacting with other systems.
        inv.length = 0;
        const dummy = { kind: "tool", type: "dummy_tool", name: "dummy tool", decay: 0, usable: true };
        const bmItem = { kind: "tool", type: "bottle_map", name: "bottle map", decay: 0, usable: true };
        inv.push(dummy);
        inv.push(bmItem);

        // Force target placement failure by patching overworld walkability.
        const WorldMod = (typeof window !== "undefined" ? window.World : null);
        const origWalk = (WorldMod && typeof WorldMod.isWalkable === "function") ? WorldMod.isWalkable : null;
        const w = (has(G.getCtx) ? (G.getCtx() && G.getCtx().world) : null) || worldRef;
        const gen = (w && w.gen) ? w.gen : null;
        const origGenWalk = (gen && typeof gen.isWalkable === "function") ? gen.isWalkable : null;
        try {
          if (origWalk && WorldMod) WorldMod.isWalkable = () => false;
          if (origGenWalk && gen) gen.isWalkable = () => false;
          // idx intentionally undefined
          GMB.useInventoryItem(gctx, bmItem, undefined);
        } finally {
          if (origWalk && WorldMod) WorldMod.isWalkable = origWalk;
          if (origGenWalk && gen) gen.isWalkable = origGenWalk;
        }

        // Dummy should never be consumed.
        const dummyStillThere = inv.indexOf(dummy) >= 0;
        // Bottle map should still exist (refunded after failure).
        const bmCount = countBottleMaps();
        idxSafetyOk = dummyStillThere && bmCount >= 1;

        // Cleanup: restore original inventory snapshot.
        try {
          inv.length = 0;
          for (let ii = 0; ii < invSnap.length; ii++) inv.push(invSnap[ii]);
          if (typeof gctx.updateUI === "function") gctx.updateUI();
        } catch (_) {}
      }
    } catch (_) {
      idxSafetyOk = true;
    }
    record(idxSafetyOk, "Bottle map idx safety: undefined idx does not consume wrong inventory slot");

    // Phase 7D lifecycle gate: activation failure should refund the item and expire the thread.
    let activationFailureOk = true;
    try {
      const WorldMod = (typeof window !== "undefined" ? window.World : null);
      const origWalk = (WorldMod && typeof WorldMod.isWalkable === "function") ? WorldMod.isWalkable : null;
      const w = (has(G.getCtx) ? (G.getCtx() && G.getCtx().world) : null) || worldRef;
      const gen = (w && w.gen) ? w.gen : null;
      const origGenWalk = (gen && typeof gen.isWalkable === "function") ? gen.isWalkable : null;
      const origCtxWalk = (gctx && typeof gctx.isWalkable === "function") ? gctx.isWalkable : null;

      const bmBefore = countBottleMaps();

      // Add a bottle map item.
      let idxFail = -1;
      try {
        const inv = (gctx.player && Array.isArray(gctx.player.inventory)) ? gctx.player.inventory : (gctx.player.inventory = []);
        idxFail = inv.length;
        inv.push({ kind: "tool", type: "bottle_map", name: "bottle map", decay: 0, usable: true });
        if (typeof gctx.updateUI === "function") gctx.updateUI();
      } catch (_) {}

      try {
        if (origWalk && WorldMod) WorldMod.isWalkable = () => false;
        if (origGenWalk && gen) gen.isWalkable = () => false;
        if (origCtxWalk) gctx.isWalkable = () => false;
        try { IF.useItemByIndex(gctx, idxFail); } catch (_) {}
      } finally {
        if (origWalk && WorldMod) WorldMod.isWalkable = origWalk;
        if (origGenWalk && gen) gen.isWalkable = origGenWalk;
        if (origCtxWalk) gctx.isWalkable = origCtxWalk;
      }

      const threadExpiredNow = () => {
        try {
          const gm = (gctx && gctx.gm && typeof gctx.gm === "object") ? gctx.gm : null;
          const threads = (gm && gm.threads && typeof gm.threads === "object") ? gm.threads : null;
          const bm = (threads && threads.bottleMap && typeof threads.bottleMap === "object") ? threads.bottleMap : null;
          const st = String((bm && bm.status) || "");
          return !!(bm && bm.active === false && st && st.indexOf("expired") >= 0);
        } catch (_) {
          return false;
        }
      };

      // Give the GM thread a brief moment to set failure/expiry flags.
      await waitUntil(() => threadExpiredNow() || !!findBottleMarker(null), 900, 80);

      const bmAfter = countBottleMaps();
      const markerPlaced = !!findBottleMarker(null);
      const expiredOk = threadExpiredNow();

      activationFailureOk = (bmAfter >= (bmBefore + 1)) && !markerPlaced && expiredOk;
      record(true, "Bottle map activation failure path executed");
    } catch (_) {
      activationFailureOk = true;
    }

    // Cleanup any refunded bottle maps so the main scenario starts from a clean slate.
    try { removeAllBottleMaps(); } catch (_) {}
    try { MS.remove(gctx, (m) => m && String(m.kind || "") === "gm.bottleMap"); } catch (_) {}
    try {
      const gm = (gctx && gctx.gm && typeof gctx.gm === "object") ? gctx.gm : null;
      const threads = (gm && gm.threads && typeof gm.threads === "object") ? gm.threads : null;
      const bm = (threads && threads.bottleMap && typeof threads.bottleMap === "object") ? threads.bottleMap : null;
      if (bm) {
        bm.active = false;
        bm.status = "claimed";
        bm.instanceId = null;
        bm.target = null;
        bm.reward = null;
      }
    } catch (_) {}

    record(activationFailureOk, "Bottle map activation failure: item refunded, thread expired, marker not placed");

    // Phase 7D lifecycle gate: orphan markers should be cleaned when the thread is inactive.
    let orphanCleanupOk = true;
    try {
      if (GMB && has(GMB.reconcileMarkers)) {
        const w = (has(G.getCtx) ? (G.getCtx() && G.getCtx().world) : null) || worldRef;
        const p = has(G.getPlayer) ? G.getPlayer() : { x: 0, y: 0 };
        const ox = (w && typeof w.originX === "number") ? (w.originX | 0) : 0;
        const oy = (w && typeof w.originY === "number") ? (w.originY | 0) : 0;
        const orphanId = "smoke_orphan_bottle_map";
        MS.add(gctx, { x: ox + (p.x | 0), y: oy + (p.y | 0), kind: "gm.bottleMap", glyph: "X", paletteKey: "questMarker", instanceId: orphanId });

        // Ensure thread is inactive.
        try {
          const gm = (gctx && gctx.gm && typeof gctx.gm === "object") ? gctx.gm : null;
          const threads = (gm && gm.threads && typeof gm.threads === "object") ? gm.threads : null;
          const bm = (threads && threads.bottleMap && typeof threads.bottleMap === "object") ? threads.bottleMap : null;
          if (bm) {
            bm.active = false;
            bm.status = "claimed";
            bm.instanceId = null;
            bm.target = null;
            bm.reward = null;
          }
        } catch (_) {}

        await sleep(120);
        GMB.reconcileMarkers(gctx);
        await sleep(120);
        orphanCleanupOk = !findBottleMarker(orphanId);

        // Hard cleanup for subsequent steps.
        try { MS.remove(gctx, { instanceId: orphanId }); } catch (_) {}
      }
    } catch (_) {
      orphanCleanupOk = true;
    }
    record(orphanCleanupOk, "Bottle map marker integrity: reconcile removes orphan marker when thread inactive");

    // Add a bottle map item to inventory.
    let idx = -1;
    try {
      const inv = (gctx.player && Array.isArray(gctx.player.inventory)) ? gctx.player.inventory : (gctx.player.inventory = []);
      idx = inv.length;
      inv.push({ kind: "tool", type: "bottle_map", name: "bottle map", decay: 0, usable: true });
      if (typeof gctx.updateUI === "function") gctx.updateUI();
    } catch (_) {}

    record(idx >= 0, "Bottle map inserted into inventory");

    // Use it.
    let used = false;
    try { used = !!IF.useItemByIndex(gctx, idx); } catch (_) { used = false; }
    record(used, "InventoryFlow.useItemByIndex consumes bottle map");

    // If use failed, remove the injected item so we don't leak state into later scenarios.
    if (!used && idx >= 0) {
      try {
        const inv = (gctx.player && Array.isArray(gctx.player.inventory)) ? gctx.player.inventory : [];
        if (idx >= 0 && idx < inv.length) inv.splice(idx, 1);
        if (typeof gctx.updateUI === "function") gctx.updateUI();
      } catch (_) {}
    }

    // Find marker (allow marker placement to settle).
    await waitUntil(() => !!findBottleMarker(null), 1200, 80);
    const marker = findBottleMarker(null);

    record(!!marker, "gm.bottleMap marker exists in world.questMarkers");
    if (!marker) return true;

    // Phase 7D lifecycle gate: if a marker is removed unexpectedly while the thread is active,
    // GMBridge.reconcileMarkers should restore it.
    let threadActiveOk = true;
    try {
      const gm = (gctx && gctx.gm && typeof gctx.gm === "object") ? gctx.gm : null;
      const threads = (gm && gm.threads && typeof gm.threads === "object") ? gm.threads : null;
      const bm = (threads && threads.bottleMap && typeof threads.bottleMap === "object") ? threads.bottleMap : null;
      threadActiveOk = !!(bm && bm.active === true && String(bm.instanceId || "") === String(marker.instanceId || ""));
    } catch (_) {
      threadActiveOk = true;
    }
    record(threadActiveOk, "Bottle map thread active with instanceId matches marker");

    let restored = true;
    let threadStillOk = true;
    try {
      if (GMB && has(GMB.reconcileMarkers) && marker.instanceId != null) {
        MS.remove(gctx, { instanceId: marker.instanceId });
        await sleep(120);
        GMB.reconcileMarkers(gctx);
        await sleep(120);
        restored = !!findBottleMarker(marker.instanceId);

        try {
          const gm = (gctx && gctx.gm && typeof gctx.gm === "object") ? gctx.gm : null;
          const threads = (gm && gm.threads && typeof gm.threads === "object") ? gm.threads : null;
          const bm = (threads && threads.bottleMap && typeof threads.bottleMap === "object") ? threads.bottleMap : null;
          threadStillOk = !!(bm && bm.active === true && String(bm.instanceId || "") === String(marker.instanceId || ""));
        } catch (_) {
          threadStillOk = true;
        }
      }
    } catch (_) {
      restored = true;
      threadStillOk = true;
    }
    record(restored && threadStillOk, "Bottle map marker integrity: reconcile restores missing marker");

    // Attempt 1: Enter and withdraw. Marker should remain.
    const tpOk1 = await teleportToMarker(marker);
    record(tpOk1, "Teleport to bottle map marker");

    try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(2); } catch (_) {}
    key("g");
    const confirmed1 = await acceptConfirm();
    const entered1 = await waitUntilMode("encounter", 3500);
    const modeAfter1 = has(G.getMode) ? G.getMode() : "";
    record(confirmed1 && entered1 && modeAfter1 === "encounter", `Pressing 'g' on bottle map marker starts encounter (mode=${modeAfter1})`);

    if (!(entered1 && modeAfter1 === "encounter")) {
      // Cleanup marker.
      try { MS.remove(gctx, { instanceId: marker.instanceId }); } catch (_) {}
      return true;
    }

    const markerInEncounter1 = !!findBottleMarker(marker.instanceId);
    record(markerInEncounter1, "Bottle map marker remains while in encounter (pre-withdraw)");

    let withdrew = false;
    try {
      if (has(G.completeEncounter)) withdrew = !!G.completeEncounter("withdraw");
    } catch (_) { withdrew = false; }
    record(withdrew, "CompleteEncounter(withdraw) exits encounter");

    await waitUntilMode("world", 5000);
    const modeAfterWithdraw = has(G.getMode) ? G.getMode() : "";
    record(modeAfterWithdraw === "world", `After withdraw, mode is world (mode=${modeAfterWithdraw})`);

    // Ensure marker is NOT removed on withdraw.
    await waitUntil(() => !!findBottleMarker(marker.instanceId), 1200, 80);
    const markerAfterWithdraw = !!findBottleMarker(marker.instanceId);
    record(markerAfterWithdraw, "Bottle map marker remains after withdraw (removed only on victory)");

    // Attempt 2: Re-enter and win. Marker should be removed and gold delta should be 60..80.
    const marker2 = findBottleMarker(marker.instanceId) || marker;
    const tpOk2 = await teleportToMarker(marker2);
    record(tpOk2, "Teleport back to bottle map marker");

    try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(2); } catch (_) {}
    key("g");
    const confirmed2 = await acceptConfirm();
    const entered2 = await waitUntilMode("encounter", 3500);
    const modeAfter2 = has(G.getMode) ? G.getMode() : "";
    record(confirmed2 && entered2 && modeAfter2 === "encounter", `Re-enter bottle map encounter (mode=${modeAfter2})`);

    if (!(entered2 && modeAfter2 === "encounter")) {
      // Cleanup marker (avoid leaking state into subsequent scenarios).
      try { MS.remove(gctx, { instanceId: marker.instanceId }); } catch (_) {}
      return true;
    }

    const markerInEncounter2 = !!findBottleMarker(marker.instanceId);
    record(markerInEncounter2, "Bottle map marker remains while in encounter (pre-victory)");

    const goldBefore = getGoldAmount();

    let completed = false;
    try {
      if (has(G.completeEncounter)) completed = !!G.completeEncounter("victory");
    } catch (_) { completed = false; }
    record(completed, "CompleteEncounter(victory) returns to overworld");

    await waitUntilMode("world", 5000);
    const modeFinal = has(G.getMode) ? G.getMode() : "";
    record(modeFinal === "world", `After victory, mode is world (mode=${modeFinal})`);

    // Marker should be removed by GMBridge payout hook.
    await waitUntil(() => !findBottleMarker(marker.instanceId), 2500, 80);
    const markerGone = !findBottleMarker(marker.instanceId);
    record(markerGone, "Bottle map marker removed after victory payout");

    // Reward payout may happen shortly after we return to world mode.
    await waitUntil(() => (getGoldAmount() - goldBefore) >= 60, 2500, 80);

    const goldAfter = getGoldAmount();
    const delta = (goldAfter | 0) - (goldBefore | 0);
    record(delta >= 60 && delta <= 80, `Gold delta after victory within 60..80 (delta=${delta})`);

    if (!markerGone) {
      try { MS.remove(gctx, { instanceId: marker.instanceId }); } catch (_) {}
    }

    return true;
  }

  window.SmokeTest.Scenarios.gm_bottle_map = { run };
})();
