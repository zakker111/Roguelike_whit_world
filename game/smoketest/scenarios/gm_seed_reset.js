(function () {
  // SmokeTest Scenario: GM seed reset
  // Validates that applying a new seed clears in-memory GM state and re-derives runSeed.

  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  async function run(ctx) {
    const record = (ctx && ctx.record) || function () {};
    const recordSkip = (ctx && ctx.recordSkip) || function () {};
    const sleep = (ctx && ctx.sleep) || (ms => new Promise(r => setTimeout(r, Math.max(0, ms | 0))));

    const GA = (typeof window !== "undefined" ? window.GameAPI : null);
    const GM = (typeof window !== "undefined" ? window.GMRuntime : null);
    const GC = (typeof window !== "undefined" ? window.GodControls : null);

    if (!GA || !has(GA.getCtx) || !GM || !has(GM.getState) || !GC || !has(GC.applySeed)) {
      recordSkip("GM seed reset skipped (GameAPI/GMRuntime/GodControls missing)");
      return true;
    }

    const gctx = GA.getCtx();
    if (!gctx) {
      recordSkip("GM seed reset skipped (ctx missing)");
      return true;
    }

    // Ensure GM enabled.
    try {
      const gm0 = GM.getState(gctx);
      if (gm0 && typeof gm0 === "object") gm0.enabled = true;
    } catch (_) {}

    // Add a debug probe so we can detect state carryover.
    try {
      const gm = GM.getState(gctx);
      gm.debug = gm.debug && typeof gm.debug === "object" ? gm.debug : {};
      gm.debug.intentHistory = Array.isArray(gm.debug.intentHistory) ? gm.debug.intentHistory : [];
      gm.debug.intentHistory.push({ kind: "smoketest", reason: "seed_reset_probe" });
    } catch (_) {}

    // Choose a new seed (ensure it differs from current SEED when possible).
    let newSeed = 12345;
    try {
      const cur = (typeof localStorage !== "undefined" && localStorage)
        ? (Number(localStorage.getItem("SEED")) >>> 0)
        : 0;
      newSeed = ((cur + 1) >>> 0) || 1;
    } catch (_) {}

    try { GC.applySeed(() => GA.getCtx(), newSeed); } catch (_) {}

    // Wait for GM to reflect the new seed and for debug probe to be cleared.
    const deadline = Date.now() + 2500;
    let afterRunSeed = null;
    let hasProbe = true;
    let histLen = 0;

    while (Date.now() < deadline) {
      const gm1 = (() => {
        try { return GM.getState(GA.getCtx()); } catch (_) { return null; }
      })();

      afterRunSeed = (gm1 && typeof gm1.runSeed === "number") ? (gm1.runSeed >>> 0) : null;
      const hist = (gm1 && gm1.debug && Array.isArray(gm1.debug.intentHistory)) ? gm1.debug.intentHistory : [];
      histLen = hist.length;
      hasProbe = !!hist.find(x => x && x.reason === "seed_reset_probe");

      if (afterRunSeed === (newSeed >>> 0) && !hasProbe) break;
      await sleep(120);
    }

    record(afterRunSeed === (newSeed >>> 0), `GM runSeed updates on applySeed (expected ${newSeed}, got ${afterRunSeed})`);
    record(hasProbe === false, `GM debug probe cleared on applySeed (intentHistoryLen=${histLen})`);

    return true;
  }

  window.SmokeTest.Scenarios.gm_seed_reset = { run };
})();
