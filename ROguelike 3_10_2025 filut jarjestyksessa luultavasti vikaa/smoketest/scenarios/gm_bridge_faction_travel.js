(function () {
  // SmokeTest Scenario: GMBridge faction travel events
  // Validates:
  // - GMRuntime.forceFactionTravelEvent can schedule a guard fine.
  // - GMBridge.maybeHandleWorldStep displays a ConfirmModal.
  // - Pressing Escape cancels the confirm without crashing.
  // - GM encounter travel intents enter encounter mode (gm_bandit_bounty, gm_troll_hunt).
  // - Encounter can exit deterministically via GameAPI.completeEncounter("withdraw").
  // - Cleanup leaves the game in world mode.

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

    const ensureWorld = async () => {
      const mode = has(G.getMode) ? G.getMode() : "";
      if (mode === "world") return true;
      if (mode === "encounter") {
        try {
          if (has(G.completeEncounter)) G.completeEncounter("withdraw");
        } catch (_) {}
        await waitUntilMode("world", 5000);
      }
      const mode2 = has(G.getMode) ? G.getMode() : "";
      if (mode2 === "world") return true;
      try {
        if (has(G.forceWorld)) G.forceWorld();
      } catch (_) {}
      await waitUntilMode("world", 2000);
      return (has(G.getMode) ? G.getMode() : "") === "world";
    };

    const inWorld = await ensureWorld();
    if (!inWorld) {
      recordSkip("GM bridge faction travel skipped (not in world mode)");
      return true;
    }

    const worldCtx0 = G.getCtx();

    try {
      // Ensure player has enough gold so the confirm dialog can show.
      try {
        const inv = (worldCtx0.player && Array.isArray(worldCtx0.player.inventory)) ? worldCtx0.player.inventory : (worldCtx0.player.inventory = []);
        let gold = inv.find(it => it && String(it.kind || it.type || "").toLowerCase() === "gold");
        if (!gold) { gold = { kind: "gold", amount: 0, name: "gold" }; inv.push(gold); }
        if (typeof gold.amount !== "number") gold.amount = 0;
        if (gold.amount < 500) gold.amount = 500;
        if (typeof worldCtx0.updateUI === "function") worldCtx0.updateUI();
      } catch (_) {}

      // Force the guard fine, then process it via GMBridge.
      let forced = null;
      try { forced = GM.forceFactionTravelEvent(worldCtx0, "guard_fine"); } catch (_) { forced = null; }
      record(!!forced, "GMRuntime.forceFactionTravelEvent returns an intent (guard_fine)");

      let handled = false;
      try { handled = !!GMB.maybeHandleWorldStep(worldCtx0); } catch (_) { handled = false; }
      record(handled, "GMBridge.maybeHandleWorldStep handles forced travel event");

      // Confirm should be open if UI is present. (Fallback path is auto-pay).
      const canCheck = !!(CM && has(CM.isOpen));
      if (!canCheck) {
        record(true, "ConfirmModal.isOpen not available; cannot assert modal open state (non-fatal)");
      } else {
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
      }

      // Sanity: still in world mode.
      const modeAfter = has(G.getMode) ? G.getMode() : "";
      record(modeAfter === "world", `Mode remains world after cancel (mode=${modeAfter})`);

      // Cleanup: ensure confirm is closed.
      try { if (UIO && has(UIO.cancelConfirm)) UIO.cancelConfirm(worldCtx0); } catch (_) {}

      // GM encounter travel events -> encounter mode -> withdraw -> world.
      if (!has(G.completeEncounter)) {
        recordSkip("GM encounter travel skipped (GameAPI.completeEncounter missing)");
        return true;
      }

      const encounterIntents = ["gm_bandit_bounty", "gm_troll_hunt"];
      for (const intent of encounterIntents) {
        await ensureWorld();

        // Ensure any confirm modal isn't interfering.
        try { if (UIO && has(UIO.cancelConfirm)) UIO.cancelConfirm(G.getCtx()); } catch (_) {}
        let confirmStillOpen = false;
        try { confirmStillOpen = !!(CM && has(CM.isOpen) && CM.isOpen()); } catch (_) { confirmStillOpen = false; }
        if (confirmStillOpen) {
          record(true, `ConfirmModal was open before ${intent}; attempting to close (non-fatal)`);
          try { if (UIO && has(UIO.cancelConfirm)) UIO.cancelConfirm(G.getCtx()); } catch (_) {}
          await sleep(100);
        }

        const worldCtx = G.getCtx();

        let forced2 = null;
        try { forced2 = GM.forceFactionTravelEvent(worldCtx, intent); } catch (_) { forced2 = null; }
        record(!!forced2, `GMRuntime.forceFactionTravelEvent returns an intent (${intent})`);

        let handled2 = false;
        try { handled2 = !!GMB.maybeHandleWorldStep(worldCtx); } catch (_) { handled2 = false; }
        record(handled2, `GMBridge.maybeHandleWorldStep handles forced travel event (${intent})`);

        const entered = await waitUntilMode("encounter", 3500);
        const modeNow = has(G.getMode) ? G.getMode() : "";
        record(entered && modeNow === "encounter", `Mode enters encounter (${intent}) (mode=${modeNow})`);

        let withdrew = false;
        try { withdrew = !!G.completeEncounter("withdraw"); } catch (_) { withdrew = false; }
        record(withdrew, `CompleteEncounter(withdraw) exits encounter (${intent})`);

        const returned = await waitUntilMode("world", 5000);
        const modeAfterWithdraw = has(G.getMode) ? G.getMode() : "";
        record(returned && modeAfterWithdraw === "world", `Returned to world after withdraw (${intent}) (mode=${modeAfterWithdraw})`);
      }

      return true;
    } finally {
      // Best-effort cleanup so subsequent scenarios start from world mode.
      await ensureWorld();
      try { if (UIO && has(UIO.cancelConfirm)) UIO.cancelConfirm(G.getCtx()); } catch (_) {}
    }
  }

  window.SmokeTest.Scenarios.gm_bridge_faction_travel = { run };
})();
