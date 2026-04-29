(function () {
  // SmokeTest Scenario: GM scheduler arbitration (no RNG)
  // Validates:
  // - Scheduler selection is deterministic and RNG-free.
  // - Choosing a faction travel event does not consume GM RNG (`gm.rng.calls`)
  //   and does not consume run RNG (`ctx.rng` / `window.RNG.rng`).

  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) {
    try {
      return typeof fn === "function";
    } catch (_) {
      return false;
    }
  }

  function lsAvailable() {
    try {
      if (typeof window !== "undefined" && window.NO_LOCALSTORAGE) return false;
    } catch (_) {}
    try {
      if (typeof localStorage === "undefined") return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  async function run(ctx) {
    const record = (ctx && ctx.record) || function () {};
    const recordSkip = (ctx && ctx.recordSkip) || function () {};

    const GA = (typeof window !== "undefined" ? window.GameAPI : null);
    const GM = (typeof window !== "undefined" ? window.GMRuntime : null);

    if (!GA || !has(GA.getCtx) || !GM || !has(GM.reset) || !has(GM.getState) || !has(GM.getFactionTravelEvent)) {
      recordSkip("GM scheduler arbitration skipped (GameAPI/GMRuntime missing required functions)");
      return true;
    }

    if (!lsAvailable()) {
      // Not strictly required, but avoids surprises when GMRuntime persistence is disabled.
      recordSkip("GM scheduler arbitration skipped (localStorage not available / disabled)");
      return true;
    }

    const gctx = GA.getCtx();
    if (!gctx) {
      recordSkip("GM scheduler arbitration skipped (ctx missing)");
      return true;
    }

    // Ensure deterministic turn context.
    try {
      if (!gctx.time || typeof gctx.time !== "object") gctx.time = { turnCounter: 0 };
      gctx.time.turnCounter = 2000;
    } catch (_) {}

    // Fresh baseline.
    try {
      GM.reset(gctx, { reason: "smoke_gm_scheduler_arbitration" });
      GM.tick && GM.tick(gctx);
    } catch (_) {}

    // Ensure GM enabled.
    try {
      const gm0 = GM.getState(gctx);
      if (gm0 && typeof gm0 === "object") gm0.enabled = true;
    } catch (_) {}

    // Prepare three scheduler actions with identical priority/turn fields so tie-break
    // falls to lexicographic id order.
    // Expected lexicographic: fe:banditBounty < fe:guardFine < fe:trollHunt
    const ids = ["fe:banditBounty", "fe:guardFine", "fe:trollHunt"];

    const gm = GM.getState(gctx);
    if (!gm || typeof gm !== "object") {
      record(false, "GM state available");
      return true;
    }

    // Ensure containers exist.
    gm.scheduler = gm.scheduler && typeof gm.scheduler === "object" ? gm.scheduler : { actions: {}, queue: [], history: [], nextId: 1 };
    gm.scheduler.actions = gm.scheduler.actions && typeof gm.scheduler.actions === "object" ? gm.scheduler.actions : {};
    gm.scheduler.queue = Array.isArray(gm.scheduler.queue) ? gm.scheduler.queue : [];
    gm.scheduler.history = Array.isArray(gm.scheduler.history) ? gm.scheduler.history : [];

    // Clear existing faction event actions to avoid interference.
    for (const id of ids) {
      try { delete gm.scheduler.actions[id]; } catch (_) {}
    }
    try {
      gm.scheduler.queue = gm.scheduler.queue.filter(x => ids.indexOf(String(x || "")) === -1);
    } catch (_) {}

    // Reset cadence rails.
    gm.lastActionTurn = -9999;
    gm.scheduler.lastAutoTurn = -9999;

    const turn = (gctx && gctx.time && typeof gctx.time.turnCounter === "number") ? (gctx.time.turnCounter | 0) : 0;

    // Create actions.
    // Make them eligible *this* turn so schedulerPickNext can consider them.
    const common = {
      status: "scheduled",
      priority: 100,
      createdTurn: turn,
      earliestTurn: turn,
      latestTurn: turn,
      // Prevent auto-spacing rails from interfering.
      delivery: "confirm",
      allowMultiplePerTurn: false,
      bypassCadence: true,
      bypassPacing: true,
      payload: {}
    };

    gm.scheduler.actions["fe:banditBounty"] = Object.assign({ id: "fe:banditBounty", kind: "travel.banditBounty" }, common, {
      payload: { encounterId: "gm_bandit_bounty" }
    });

    gm.scheduler.actions["fe:guardFine"] = Object.assign({ id: "fe:guardFine", kind: "travel.guardFine" }, common, {
      payload: { kind: "guard_fine" }
    });

    gm.scheduler.actions["fe:trollHunt"] = Object.assign({ id: "fe:trollHunt", kind: "travel.trollHunt" }, common, {
      payload: { encounterId: "gm_troll_hunt" }
    });

    gm.scheduler.queue.push("fe:banditBounty", "fe:guardFine", "fe:trollHunt");

    // Instrument RNG calls only while calling getFactionTravelEvent.
    const origCtxRng = gctx.rng;
    const hasCtxRng = typeof origCtxRng === "function";

    const rngSvc = (typeof window !== "undefined" && window.RNG && typeof window.RNG.rng === "function") ? window.RNG : null;
    const origGlobalRng = rngSvc ? rngSvc.rng : null;

    let armed = false;
    let ctxRngCalls = 0;
    let globalRngCalls = 0;

    function wrapIfFn(fn, onCall) {
      return function () {
        try {
          if (armed) onCall();
        } catch (_) {}
        return fn.apply(this, arguments);
      };
    }

    try {
      if (hasCtxRng) gctx.rng = wrapIfFn(origCtxRng, () => { ctxRngCalls++; });
      if (rngSvc && typeof origGlobalRng === "function") rngSvc.rng = wrapIfFn(origGlobalRng, () => { globalRngCalls++; });

      const beforeCalls = (gm && gm.rng && typeof gm.rng.calls === "number") ? (gm.rng.calls | 0) : 0;

      armed = true;
      const intent = GM.getFactionTravelEvent(gctx);
      armed = false;

      const afterCalls = (gm && gm.rng && typeof gm.rng.calls === "number") ? (gm.rng.calls | 0) : 0;

      record(!!intent, "GM.getFactionTravelEvent returns an intent");
      record(intent && intent.kind === "encounter" && String(intent.encounterId || "") === "gm_bandit_bounty", "Tie-break selects bandit bounty (lexicographic id)");

      record(afterCalls === beforeCalls, `GM RNG calls unchanged by scheduler arbitration (before=${beforeCalls}, after=${afterCalls})`);
      record(ctxRngCalls === 0, `Scheduler arbitration does not call ctx.rng (calls=${ctxRngCalls})`);
      record(globalRngCalls === 0, `Scheduler arbitration does not call window.RNG.rng (calls=${globalRngCalls})`);

      return true;
    } finally {
      try { if (hasCtxRng) gctx.rng = origCtxRng; } catch (_) {}
      try { if (rngSvc && typeof origGlobalRng === "function") rngSvc.rng = origGlobalRng; } catch (_) {}
      try { armed = false; } catch (_) {}
    }
  }

  window.SmokeTest.Scenarios.gm_scheduler_arbitration = { run };
})();
