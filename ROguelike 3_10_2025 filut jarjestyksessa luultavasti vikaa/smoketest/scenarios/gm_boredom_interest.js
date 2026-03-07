(function () {
  // SmokeTest Scenario: GM boredom interest weighting (Phase 3)
  // Validates that graded interest events reduce boredom in the expected way.

  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  async function run(ctx) {
    const record = (ctx && ctx.record) || function () {};
    const recordSkip = (ctx && ctx.recordSkip) || function () {};

    const GA = (typeof window !== "undefined" ? window.GameAPI : null);
    const GM = (typeof window !== "undefined" ? window.GMRuntime : null);

    if (!GA || !has(GA.getCtx) || !GM || !has(GM.onEvent) || !has(GM.getState)) {
      recordSkip("GM boredom interest skipped (GameAPI.getCtx or GMRuntime.onEvent/getState missing)");
      return true;
    }

    const gctx = GA.getCtx();
    if (!gctx) {
      recordSkip("GM boredom interest skipped (ctx missing)");
      return true;
    }

    const gm = GM.getState(gctx);
    if (!gm || typeof gm !== "object") {
      record(false, "GM boredom interest: GM state missing");
      return true;
    }

    const boredom = (gm.boredom && typeof gm.boredom === "object") ? gm.boredom : (gm.boredom = {});

    const snap = {
      enabled: Object.prototype.hasOwnProperty.call(gm, "enabled") ? gm.enabled : undefined,
      boredom: {
        turnsSinceLastInterestingEvent: boredom.turnsSinceLastInterestingEvent,
        lastInterestingEvent: boredom.lastInterestingEvent,
        lastNudgeTurn: boredom.lastNudgeTurn,
      }
    };

    // Ensure GM enabled.
    gm.enabled = true;

    const curTurn = (function () {
      try {
        if (gctx.time && typeof gctx.time.turnCounter === "number" && Number.isFinite(gctx.time.turnCounter)) return (gctx.time.turnCounter | 0);
      } catch (_) {}
      return 0;
    })();

    function resetTo120() {
      boredom.turnsSinceLastInterestingEvent = 120;
      boredom.lastInterestingEvent = null;
      boredom.lastNudgeTurn = -1;
    }

    // MINOR
    resetTo120();
    GM.onEvent(gctx, { type: "combat.kill", interestTier: "minor", turn: curTurn });
    const afterMinor = (boredom.turnsSinceLastInterestingEvent | 0);
    const minorDecreased = afterMinor < 120;
    record(minorDecreased, `GM boredom: minor event decreases turnsSinceLastInterestingEvent (120 -> ${afterMinor})`);
    record(afterMinor >= 1, `GM boredom: minor event never reduces below 1 (got ${afterMinor})`);

    // MEDIUM
    const deltaMinor = 120 - afterMinor;
    resetTo120();
    GM.onEvent(gctx, { type: "encounter.exit", interestTier: "medium", turn: curTurn });
    const afterMedium = (boredom.turnsSinceLastInterestingEvent | 0);
    const deltaMedium = 120 - afterMedium;
    record(afterMedium < 120, `GM boredom: medium event decreases turnsSinceLastInterestingEvent (120 -> ${afterMedium})`);
    record(afterMedium >= 1, `GM boredom: medium event never reduces below 1 (got ${afterMedium})`);
    record(deltaMedium > deltaMinor, `GM boredom: medium event decreases more than minor (minor=${deltaMinor}, medium=${deltaMedium})`);

    // MAJOR
    resetTo120();
    GM.onEvent(gctx, { type: 'quest.complete', interestTier: 'major', turn: curTurn });
    const afterMajor = (boredom.turnsSinceLastInterestingEvent | 0);
    record(afterMajor === 0, `GM boredom: major event hard resets turnsSinceLastInterestingEvent to 0 (got ${afterMajor})`);

    // Restore.
    try {
      if (Object.prototype.hasOwnProperty.call(snap, "enabled")) {
        if (snap.enabled === undefined) {
          try { delete gm.enabled; } catch (_) { gm.enabled = undefined; }
        } else {
          gm.enabled = snap.enabled;
        }
      }

      boredom.turnsSinceLastInterestingEvent = snap.boredom.turnsSinceLastInterestingEvent;
      boredom.lastInterestingEvent = snap.boredom.lastInterestingEvent;
      boredom.lastNudgeTurn = snap.boredom.lastNudgeTurn;
    } catch (_) {}

    return true;
  }

  window.SmokeTest.Scenarios.gm_boredom_interest = { run };
})();
