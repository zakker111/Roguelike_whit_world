(function () {
  // SmokeTest Scenario: Survey Cache spawn gate
  // Validates:
  // - GMBridge.ensureGuaranteedSurveyCache does NOT spawn a marker when boredom is low.
  // - It DOES spawn a marker when boredom is high and cooldown allows.

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
      recordSkip("Survey Cache spawn gate skipped (GameAPI not available)");
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

    async function ensureWorldMode() {
      try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(4); } catch (_) {}

      let mode0 = "";
      try { mode0 = has(G.getMode) ? G.getMode() : ""; } catch (_) { mode0 = ""; }
      if (mode0 === "world") return true;

      try {
        if (mode0 === "encounter" && has(G.completeEncounter)) {
          G.completeEncounter("withdraw");
        } else if (mode0 === "dungeon" && has(G.returnToWorldIfAtExit)) {
          G.returnToWorldIfAtExit();
        } else if (mode0 === "town") {
          if (has(G.returnToWorldFromTown)) G.returnToWorldFromTown();
          else if (has(G.leaveTownNow)) G.leaveTownNow();
          else if (has(G.requestLeaveTown)) G.requestLeaveTown();
        } else if (mode0 === "region") {
          try { key("Escape"); } catch (_) {}
        }
      } catch (_) {}

      await waitUntilMode("world", 2500);
      try { mode0 = has(G.getMode) ? G.getMode() : ""; } catch (_) { mode0 = ""; }
      if (mode0 === "world") return true;

      if (has(G.forceWorld)) {
        try { G.forceWorld(); } catch (_) {}
        await waitUntilMode("world", 2500);
      }

      try { return has(G.getMode) && G.getMode() === "world"; } catch (_) { return false; }
    }

    const okWorld = await ensureWorldMode();
    if (!okWorld) {
      recordSkip("Survey Cache spawn gate skipped (not in world mode)");
      return true;
    }

    let gctx = null;
    try { gctx = G.getCtx(); } catch (_) { gctx = null; }
    if (!gctx || gctx.mode !== "world") {
      recordSkip("Survey Cache spawn gate skipped (not in world mode)");
      return true;
    }

    const GMBridge = window.GMBridge || null;
    if (!GMBridge || !has(GMBridge.ensureGuaranteedSurveyCache)) {
      recordSkip("Survey Cache spawn gate skipped (GMBridge.ensureGuaranteedSurveyCache missing)");
      return true;
    }

    const MS = window.MarkerService || null;
    if (!MS || !has(MS.remove)) {
      recordSkip("Survey Cache spawn gate skipped (MarkerService missing)");
      return true;
    }

    const getGm = () => {
      try {
        const c = has(G.getCtx) ? G.getCtx() : gctx;
        if (c && c.gm && typeof c.gm === "object") return c.gm;
      } catch (_) {}
      try {
        const GM = window.GMRuntime || null;
        const c = has(G.getCtx) ? G.getCtx() : gctx;
        if (GM && typeof GM.getState === "function") return GM.getState(c);
      } catch (_) {}
      return null;
    };

    const ensureSurveyCacheThread = (gm) => {
      if (!gm || typeof gm !== "object") return null;
      if (!gm.threads || typeof gm.threads !== "object") gm.threads = {};
      if (!gm.threads.surveyCache || typeof gm.threads.surveyCache !== "object") {
        gm.threads.surveyCache = { claimed: {}, claimedOrder: [], attempts: {}, active: null, nextSpawnTurn: 0 };
      }
      const sc = gm.threads.surveyCache;
      if (typeof sc.nextSpawnTurn !== "number") sc.nextSpawnTurn = 0;
      return sc;
    };

    const hasAnySurveyCacheMarker = () => {
      try {
        const c = has(G.getCtx) ? G.getCtx() : gctx;
        const q = (c && c.world && Array.isArray(c.world.questMarkers)) ? c.world.questMarkers : [];
        return q.some(m => m && String(m.kind || "") === "gm.surveyCache");
      } catch (_) {
        return false;
      }
    };

    // Cleanup any pre-existing markers to isolate the gate behavior.
    try { MS.remove(gctx, (m) => m && String(m.kind || "") === "gm.surveyCache"); } catch (_) {}

    const gm0 = getGm();
    const sc0 = ensureSurveyCacheThread(gm0);
    if (!gm0 || !sc0) {
      recordSkip("Survey Cache spawn gate skipped (GM state unavailable)");
      return true;
    }

    // Case A: boredom low -> should not spawn.
    try { gm0.boredom = gm0.boredom && typeof gm0.boredom === "object" ? gm0.boredom : {}; } catch (_) {}
    try { gm0.boredom.level = 0.0; } catch (_) {}
    try { sc0.nextSpawnTurn = 0; } catch (_) {}

    try { GMBridge.ensureGuaranteedSurveyCache(gctx); } catch (_) {}
    await sleep(120);

    record(!hasAnySurveyCacheMarker(), "ensureGuaranteedSurveyCache does not spawn when boredom is low");

    // Case B: boredom high + cooldown ready -> should spawn.
    try { gm0.boredom.level = 1.0; } catch (_) {}
    try { sc0.nextSpawnTurn = 0; } catch (_) {}

    try { GMBridge.ensureGuaranteedSurveyCache(gctx); } catch (_) {}
    await sleep(120);

    record(hasAnySurveyCacheMarker(), "ensureGuaranteedSurveyCache spawns when boredom is high and cooldown is ready");

    // Cleanup markers so other scenarios aren't affected.
    try { MS.remove(gctx, (m) => m && String(m.kind || "") === "gm.surveyCache"); } catch (_) {}

    return true;
  }

  window.SmokeTest.Scenarios.gm_survey_cache_spawn_gate = { run };
})();
