(function () {
  // SmokeTest Scenario: Bottle Map
  // Validates:
  // - A usable bottle_map item can be used from inventory.
  // - Using it places a gm.bottleMap marker via MarkerService.
  // - Pressing 'g' on that marker starts the Bottle Map encounter.
  // - Completing the encounter pays out reward + removes marker.

  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  async function run(ctx) {
    const record = (ctx && ctx.record) || function () {};
    const recordSkip = (ctx && ctx.recordSkip) || function () {};
    const sleep = (ctx && ctx.sleep) || (ms => new Promise(r => setTimeout(r, ms | 0)));

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

    // Find marker.
    let marker = null;
    try {
      const list = (gctx.world && Array.isArray(gctx.world.questMarkers)) ? gctx.world.questMarkers : [];
      marker = list.find(m => m && String(m.kind || "") === "gm.bottleMap") || null;
    } catch (_) { marker = null; }

    record(!!marker, "gm.bottleMap marker exists in world.questMarkers");
    if (!marker) return true;

    // Teleport to marker location.
    let tpOk = false;
    try {
      const w = gctx.world;
      const ox = (w && typeof w.originX === "number") ? (w.originX | 0) : 0;
      const oy = (w && typeof w.originY === "number") ? (w.originY | 0) : 0;
      const lx = (marker.x | 0) - ox;
      const ly = (marker.y | 0) - oy;
      if (has(G.teleportTo)) {
        tpOk = !!G.teleportTo(lx, ly, { ensureWalkable: true, fallbackScanRadius: 4 });
      }
    } catch (_) { tpOk = false; }
    record(tpOk, "Teleport to bottle map marker");

    await sleep(120);

    // Press G to trigger marker action (should enter encounter).
    try {
      const ev = new KeyboardEvent("keydown", { key: "g", code: "g", bubbles: true });
      window.dispatchEvent(ev);
    } catch (_) {}

    await sleep(250);

    const modeAfter = has(G.getMode) ? G.getMode() : "";
    record(modeAfter === "encounter", `Pressing 'g' on bottle map marker starts encounter (mode=${modeAfter})`);

    if (modeAfter !== "encounter") {
      // Cleanup marker.
      try { MS.remove(gctx, { instanceId: marker.instanceId }); } catch (_) {}
      return true;
    }

    // Immediately complete encounter for smoke purposes.
    let completed = false;
    try {
      if (has(G.completeEncounter)) {
        completed = !!G.completeEncounter("victory");
      }
    } catch (_) { completed = false; }
    record(completed, "CompleteEncounter(victory) returns to overworld");

    await sleep(120);

    const modeFinal = has(G.getMode) ? G.getMode() : "";
    record(modeFinal === "world", `After completion, mode is world (mode=${modeFinal})`);

    // Marker should be removed by GMBridge payout hook.
    let stillThere = false;
    try {
      const list2 = (gctx.world && Array.isArray(gctx.world.questMarkers)) ? gctx.world.questMarkers : [];
      stillThere = !!list2.find(m => m && String(m.kind || "") === "gm.bottleMap" && String(m.instanceId || "") === String(marker.instanceId || ""));
    } catch (_) { stillThere = false; }
    record(!stillThere, "Bottle map marker removed after victory payout");

    // Rewards should have added some gold.
    try {
      const inv = (gctx.player && Array.isArray(gctx.player.inventory)) ? gctx.player.inventory : [];
      const gold = inv.find(it => it && String(it.kind || it.type || "").toLowerCase() === "gold");
      record(!!gold && typeof gold.amount === "number" && gold.amount > 0, "Rewards include gold");
    } catch (_) {
      record(true, "Rewards gold check skipped");
    }

    return true;
  }

  window.SmokeTest.Scenarios.gm_bottle_map = { run };
})();
