(function () {
  // SmokeTest Scenario: Bottle Map
  // Validates:
  // - A usable bottle_map item can be used from inventory.
  // - Using it places a gm.bottleMap marker via MarkerService.
  // - Pressing 'g' on that marker starts the Bottle Map encounter.
  // - Withdrawing from the encounter keeps the marker.
  // - Winning the encounter pays out (gold delta) and removes the marker.

  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  async function run(ctx) {
    const record = (ctx && ctx.record) || function () {};
    const recordSkip = (ctx && ctx.recordSkip) || function () {};
    const sleep = (ctx && ctx.sleep) || (ms => new Promise(r => setTimeout(r, ms | 0)));
    const key = (ctx && ctx.key) || (k => { try { window.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: k, bubbles: true })); } catch (_) {} });

    const G = window.GameAPI || null;
    if (!G || !has(G.getCtx) || !has(G.getMode)) {
      recordSkip("Bottle Map skipped (GameAPI not available)");
      return true;
    }

    const gctx = G.getCtx();
    if (!gctx || gctx.mode !== "world") {
      recordSkip("Bottle Map skipped (not in world mode)");
      return true;
    }

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

      if (ok && has(G.getPlayer)) {
        await waitUntil(() => {
          const p = G.getPlayer();
          const d = Math.abs((p.x | 0) - lx) + Math.abs((p.y | 0) - ly);
          return d <= 6;
        }, 1200, 80);
      } else {
        await sleep(120);
      }

      return ok;
    };

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

    // Find marker (allow marker placement to settle).
    await waitUntil(() => !!findBottleMarker(null), 1200, 80);
    const marker = findBottleMarker(null);

    record(!!marker, "gm.bottleMap marker exists in world.questMarkers");
    if (!marker) return true;

    // Attempt 1: Enter and withdraw. Marker should remain.
    const tpOk1 = await teleportToMarker(marker);
    record(tpOk1, "Teleport to bottle map marker");

    key("g");
    const entered1 = await waitUntilMode("encounter", 3500);
    const modeAfter1 = has(G.getMode) ? G.getMode() : "";
    record(entered1 && modeAfter1 === "encounter", `Pressing 'g' on bottle map marker starts encounter (mode=${modeAfter1})`);

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

    key("g");
    const entered2 = await waitUntilMode("encounter", 3500);
    const modeAfter2 = has(G.getMode) ? G.getMode() : "";
    record(entered2 && modeAfter2 === "encounter", `Re-enter bottle map encounter (mode=${modeAfter2})`);

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
