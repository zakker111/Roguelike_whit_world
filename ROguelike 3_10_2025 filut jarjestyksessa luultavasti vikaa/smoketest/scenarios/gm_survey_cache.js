(function () {
  // SmokeTest Scenario: Survey Cache (gm.surveyCache)
  // Validates:
  // - A gm.surveyCache marker can be added underfoot.
  // - Pressing 'g' on the marker starts the Survey Cache encounter.
  // - Withdrawing keeps the marker.
  // - Winning pays out (gold delta) and removes the marker.

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
      recordSkip("Survey Cache skipped (GameAPI not available)");
      return true;
    }

    const gctx = G.getCtx();
    if (!gctx || gctx.mode !== "world") {
      recordSkip("Survey Cache skipped (not in world mode)");
      return true;
    }

    const MS = window.MarkerService || null;
    record(!!MS, "MarkerService is available");
    if (!MS || !has(MS.add) || !has(MS.remove) || !has(MS.findAtPlayer)) {
      recordSkip("Survey Cache skipped (MarkerService missing required functions)");
      return true;
    }

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

    const w = gctx.world || null;
    const ox = (w && typeof w.originX === "number") ? (w.originX | 0) : 0;
    const oy = (w && typeof w.originY === "number") ? (w.originY | 0) : 0;
    const px = (gctx.player && typeof gctx.player.x === "number") ? (gctx.player.x | 0) : 0;
    const py = (gctx.player && typeof gctx.player.y === "number") ? (gctx.player.y | 0) : 0;
    const absX = ox + px;
    const absY = oy + py;
    const instanceId = `surveyCache:${absX},${absY}`;

    // Ensure we start clean (avoid leaking from prior runs / scenarios).
    try { MS.remove(gctx, (m) => m && String(m.instanceId || "") === instanceId); } catch (_) {}

    const m = MS.add(gctx, {
      x: absX,
      y: absY,
      kind: "gm.surveyCache",
      glyph: "?",
      paletteKey: "gmMarker",
      instanceId
    });

    record(!!m, "MarkerService.add placed gm.surveyCache marker underfoot");
    if (!m) return true;

    // Attempt 1: enter and withdraw; marker remains.
    key("g");
    const entered1 = await waitUntilMode("encounter", 3500);
    const modeAfter1 = has(G.getMode) ? G.getMode() : "";
    record(entered1 && modeAfter1 === "encounter", `Pressing 'g' starts survey cache encounter (mode=${modeAfter1})`);

    if (!(entered1 && modeAfter1 === "encounter")) {
      try { MS.remove(gctx, { instanceId }); } catch (_) {}
      return true;
    }

    let withdrew = false;
    try {
      if (has(G.completeEncounter)) withdrew = !!G.completeEncounter("withdraw");
    } catch (_) { withdrew = false; }
    record(withdrew, "CompleteEncounter(withdraw) exits encounter");

    await waitUntilMode("world", 5000);

    await waitUntil(() => {
      const at = MS.findAtPlayer(gctx);
      const markers = Array.isArray(at) ? at : (at ? [at] : []);
      return !!markers.find(mm => mm && String(mm.instanceId || "") === instanceId);
    }, 1200, 80);

    const atAfterWithdraw = MS.findAtPlayer(gctx);
    const markersAfterWithdraw = Array.isArray(atAfterWithdraw) ? atAfterWithdraw : (atAfterWithdraw ? [atAfterWithdraw] : []);
    record(!!markersAfterWithdraw.find(mm => mm && String(mm.instanceId || "") === instanceId), "Survey cache marker remains after withdraw");

    // Attempt 2: re-enter and win; marker removed and gold delta in 40..70.
    const goldBefore = getGoldAmount();

    key("g");
    const entered2 = await waitUntilMode("encounter", 3500);
    const modeAfter2 = has(G.getMode) ? G.getMode() : "";
    record(entered2 && modeAfter2 === "encounter", `Re-enter survey cache encounter (mode=${modeAfter2})`);

    if (!(entered2 && modeAfter2 === "encounter")) {
      try { MS.remove(gctx, { instanceId }); } catch (_) {}
      return true;
    }

    let completed = false;
    try {
      if (has(G.completeEncounter)) completed = !!G.completeEncounter("victory");
    } catch (_) { completed = false; }
    record(completed, "CompleteEncounter(victory) exits encounter");

    await waitUntilMode("world", 5000);

    // Marker should be removed.
    await waitUntil(() => {
      const at = MS.findAtPlayer(gctx);
      const markers = Array.isArray(at) ? at : (at ? [at] : []);
      return !markers.find(mm => mm && String(mm.instanceId || "") === instanceId);
    }, 2500, 80);

    const atFinal = MS.findAtPlayer(gctx);
    const markersFinal = Array.isArray(atFinal) ? atFinal : (atFinal ? [atFinal] : []);
    const markerGone = !markersFinal.find(mm => mm && String(mm.instanceId || "") === instanceId);
    record(markerGone, "Survey cache marker removed after victory payout");

    await waitUntil(() => (getGoldAmount() - goldBefore) >= 40, 2500, 80);

    const goldAfter = getGoldAmount();
    const delta = (goldAfter | 0) - (goldBefore | 0);
    record(delta >= 40 && delta <= 70, `Gold delta after victory within 40..70 (delta=${delta})`);

    if (!markerGone) {
      try { MS.remove(gctx, { instanceId }); } catch (_) {}
    }

    return true;
  }

  window.SmokeTest.Scenarios.gm_survey_cache = { run };
})();
