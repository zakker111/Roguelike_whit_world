(function () {
  // SmokeTest Scenario: GMBridge faction travel events (Guard Fine)
  // Validates:
  // - GMRuntime.forceFactionTravelEvent can schedule a guard fine.
  // - GMBridge.maybeHandleWorldStep displays a ConfirmModal.
  // - Pressing Escape cancels the confirm without crashing.

  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  async function run(ctx) {
    const record = (ctx && ctx.record) || function () {};
    const recordSkip = (ctx && ctx.recordSkip) || function () {};
    const sleep = (ctx && ctx.sleep) || (ms => new Promise(r => setTimeout(r, ms | 0)));

    const G = window.GameAPI || null;
    if (!G || !has(G.getCtx) || !has(G.getMode)) {
      recordSkip("GM bridge faction travel skipped (GameAPI not available)");
      return true;
    }

    const gctx = G.getCtx();
    if (!gctx || gctx.mode !== "world") {
      recordSkip("GM bridge faction travel skipped (not in world mode)");
      return true;
    }

    const GM = window.GMRuntime || null;
    const GMB = window.GMBridge || null;
    const UIO = window.UIOrchestration || null;
    const CM = window.ConfirmModal || null;

    record(!!GM, "GMRuntime is available");
    record(!!GMB, "GMBridge is available");
    if (!GM || !GMB || !has(GM.forceFactionTravelEvent) || !has(GMB.maybeHandleWorldStep)) {
      recordSkip("GM bridge faction travel skipped (GMRuntime.forceFactionTravelEvent or GMBridge.maybeHandleWorldStep missing)");
      return true;
    }

    // Ensure player has enough gold so the confirm dialog can show.
    try {
      const inv = (gctx.player && Array.isArray(gctx.player.inventory)) ? gctx.player.inventory : (gctx.player.inventory = []);
      let gold = inv.find(it => it && String(it.kind || it.type || "").toLowerCase() === "gold");
      if (!gold) { gold = { kind: "gold", amount: 0, name: "gold" }; inv.push(gold); }
      if (typeof gold.amount !== "number") gold.amount = 0;
      if (gold.amount < 500) gold.amount = 500;
      if (typeof gctx.updateUI === "function") gctx.updateUI();
    } catch (_) {}

    // Force the guard fine, then process it via GMBridge.
    let forced = null;
    try { forced = GM.forceFactionTravelEvent(gctx, "guard_fine"); } catch (_) { forced = null; }
    record(!!forced, "GMRuntime.forceFactionTravelEvent returns an intent (guard_fine)");

    let handled = false;
    try { handled = !!GMB.maybeHandleWorldStep(gctx); } catch (_) { handled = false; }
    record(handled, "GMBridge.maybeHandleWorldStep handles forced travel event");

    // Confirm should be open if UI is present. (Fallback path is auto-pay).
    const canCheck = !!(CM && has(CM.isOpen));
    if (!canCheck) {
      record(true, "ConfirmModal.isOpen not available; cannot assert modal open state (non-fatal)");
      return true;
    }

    // Give UI time to render.
    await sleep(150);

    const open1 = !!CM.isOpen();
    record(open1, "ConfirmModal opened for guard fine");

    // Press Escape to cancel.
    try {
      const ev = new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true });
      window.dispatchEvent(ev);
    } catch (_) {}

    await sleep(150);

    const open2 = !!CM.isOpen();
    record(!open2, "Pressing Escape closes the confirm without crashing");

    // Sanity: still in world mode.
    const modeAfter = has(G.getMode) ? G.getMode() : "";
    record(modeAfter === "world", `Mode remains world after cancel (mode=${modeAfter})`);

    // Cleanup: ensure confirm is closed.
    try { if (UIO && has(UIO.cancelConfirm)) UIO.cancelConfirm(gctx); } catch (_) {}

    return true;
  }

  window.SmokeTest.Scenarios.gm_bridge_faction_travel = { run };
})();
