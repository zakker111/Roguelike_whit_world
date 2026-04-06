(function () {
  // SmokeTest Scenario: GM RNG persistence (soft reload)
  // Validates:
  // - GM RNG stream (gm.rng.state + gm.rng.calls) is persisted in GM_STATE_V1.
  // - Soft reload (GMRuntime.init(ctx, { forceReload:true })) restores the stream.
  // - Next N GM RNG draws match between in-memory continuation and restored-from-LS continuation.
  // - GM RNG draws do NOT consume the run RNG (ctx.rng / window.RNG.rng).

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
      // Some contexts disallow localStorage access.
      if (typeof localStorage === "undefined") return false;
      const k = "__smoke_ls__";
      localStorage.setItem(k, "1");
      localStorage.removeItem(k);
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

    if (!GA || !has(GA.getCtx) || !GM || !has(GM.reset) || !has(GM.init) || !has(GM.getState) || !has(GM.exportState) || !has(GM.recordIntervention)) {
      recordSkip("GM RNG persistence skipped (GameAPI/GMRuntime missing required functions)");
      return true;
    }

    if (!lsAvailable()) {
      recordSkip("GM RNG persistence skipped (localStorage not available / disabled)");
      return true;
    }

    const gctx = GA.getCtx();
    if (!gctx) {
      recordSkip("GM RNG persistence skipped (ctx missing)");
      return true;
    }

    // Ensure deterministic turn context.
    try {
      if (!gctx.time || typeof gctx.time !== "object") gctx.time = { turnCounter: 0 };
      gctx.time.turnCounter = 1234;
    } catch (_) {}

    // Fresh baseline.
    try {
      GM.reset(gctx, { reason: "smoke_gm_rng_persistence" });
      GM.tick && GM.tick(gctx);
    } catch (_) {}

    // Ensure GM enabled so persistence writes are allowed.
    try {
      const gm0 = GM.getState(gctx);
      if (gm0 && typeof gm0 === "object") gm0.enabled = true;
    } catch (_) {}

    const N = 6;

    // Snapshot and persist baseline state (this is our "save" image).
    let snap0 = null;
    try {
      snap0 = GM.exportState(gctx);
    } catch (_) {
      snap0 = null;
    }

    record(!!snap0, "GM.exportState returns a snapshot");
    if (!snap0) return true;

    try {
      localStorage.setItem("GM_STATE_V1", JSON.stringify(snap0));
    } catch (_) {
      recordSkip("GM RNG persistence skipped (failed to write GM_STATE_V1)");
      return true;
    }

    // Instrument run RNG calls, but only during the critical section (armed).
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
      if (hasCtxRng) {
        gctx.rng = wrapIfFn(origCtxRng, () => { ctxRngCalls++; });
      }
      if (rngSvc && typeof origGlobalRng === "function") {
        rngSvc.rng = wrapIfFn(origGlobalRng, () => { globalRngCalls++; });
      }

      // ---- Path A: continue in-memory ----
      const cooldownA = [];
      for (let i = 0; i < N; i++) {
        armed = true;
        const ok = !!GM.recordIntervention(gctx, { kind: "confirm", channel: "smoke", id: "gm_rng_persistence" });
        armed = false;

        record(ok, `recordIntervention ok (A#${i + 1})`);

        const gm = GM.getState(gctx);
        const p = (gm && gm.pacing && typeof gm.pacing === "object") ? gm.pacing : {};
        cooldownA.push((p.lastCooldownTurns | 0) || 0);
      }

      // Restore the persisted baseline image.
      localStorage.setItem("GM_STATE_V1", JSON.stringify(snap0));

      // ---- Soft reload from GM_STATE_V1 ----
      try {
        GM.init(gctx, { forceReload: true });
      } catch (_) {}

      const gmAfterReload = GM.getState(gctx);
      const rngAfter = gmAfterReload && gmAfterReload.rng ? gmAfterReload.rng : null;
      const rngBefore = snap0 && snap0.rng ? snap0.rng : null;

      const restoredCalls = rngAfter && typeof rngAfter.calls === "number" ? (rngAfter.calls | 0) : null;
      const restoredState = rngAfter && typeof rngAfter.state === "number" ? (rngAfter.state >>> 0) : null;
      const savedCalls = rngBefore && typeof rngBefore.calls === "number" ? (rngBefore.calls | 0) : null;
      const savedState = rngBefore && typeof rngBefore.state === "number" ? (rngBefore.state >>> 0) : null;

      record(restoredCalls === savedCalls, `GM RNG calls restored (saved=${savedCalls}, got=${restoredCalls})`);
      record(restoredState === savedState, `GM RNG state restored (saved=${savedState}, got=${restoredState})`);

      // ---- Path B: continue after reload ----
      const cooldownB = [];
      for (let i = 0; i < N; i++) {
        armed = true;
        const ok = !!GM.recordIntervention(gctx, { kind: "confirm", channel: "smoke", id: "gm_rng_persistence" });
        armed = false;

        record(ok, `recordIntervention ok (B#${i + 1})`);

        const gm = GM.getState(gctx);
        const p = (gm && gm.pacing && typeof gm.pacing === "object") ? gm.pacing : {};
        cooldownB.push((p.lastCooldownTurns | 0) || 0);
      }

      const sameSeq = JSON.stringify(cooldownA) === JSON.stringify(cooldownB);
      record(sameSeq, `Cooldown sequence matches after soft reload (N=${N})`);

      record(ctxRngCalls === 0, `GM RNG draws do not call ctx.rng (calls=${ctxRngCalls})`);
      // This may be the same as ctx.rng (often wraps RNG.service), but we still track separately.
      record(globalRngCalls === 0, `GM RNG draws do not call window.RNG.rng (calls=${globalRngCalls})`);

      return true;
    } finally {
      try {
        if (hasCtxRng) gctx.rng = origCtxRng;
      } catch (_) {}
      try {
        if (rngSvc && typeof origGlobalRng === "function") rngSvc.rng = origGlobalRng;
      } catch (_) {}
      try {
        armed = false;
      } catch (_) {}
    }
  }

  window.SmokeTest.Scenarios.gm_rng_persistence = { run };
})();
