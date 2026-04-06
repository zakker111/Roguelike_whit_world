(function () {
  // SmokeTest Scenario: Survey Cache (gm.surveyCache)
  // Validates:
  // - A gm.surveyCache marker can be added underfoot.
  // - Pressing 'g' on the marker prompts confirm and starts the Survey Cache encounter.
  // - Withdrawing consumes the cache (marker removed + claimed state set).
  // - A consumed cache is not re-enterable.
  // - Winning pays out (gold delta) and consumes the marker.

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
      recordSkip("Survey Cache skipped (GameAPI not available)");
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

    const isConfirmOpen = () => {
      try {
        const CM = window.ConfirmModal;
        if (CM && typeof CM.isOpen === "function") return !!CM.isOpen();
      } catch (_) {}
      try {
        const panel = document.getElementById("confirm-panel");
        return !!(panel && panel.style.display !== "none");
      } catch (_) { return false; }
    };

    const acceptConfirm = async () => {
      const opened = await waitUntil(() => isConfirmOpen(), 2000, 80);
      if (!opened) return false;
      try { key("Enter"); } catch (_) {}
      const closed = await waitUntil(() => !isConfirmOpen(), 2000, 80);
      return !!closed;
    };

    async function ensureWorldMode() {
      try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(4); } catch (_) {}

      let mode0 = "";
      try { mode0 = has(G.getMode) ? G.getMode() : ""; } catch (_) { mode0 = ""; }
      if (mode0 === "world") return true;

      // Best-effort graceful exit depending on current mode.
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
          // Region map exit is positional; fall back to forceWorld below.
          try { key("Escape"); } catch (_) {}
        }
      } catch (_) {}

      await waitUntilMode("world", 2500);
      try { mode0 = has(G.getMode) ? G.getMode() : ""; } catch (_) { mode0 = ""; }
      if (mode0 === "world") return true;

      // Hard fallback: re-init the overworld. This is acceptable for marker tests.
      if (has(G.forceWorld)) {
        try { G.forceWorld(); } catch (_) {}
        await waitUntilMode("world", 2500);
      }

      try { return has(G.getMode) && G.getMode() === "world"; } catch (_) { return false; }
    }

    const okWorld = await ensureWorldMode();
    if (!okWorld) {
      recordSkip("Survey Cache skipped (not in world mode)");
      return true;
    }

    let gctx = G.getCtx();
    if (!gctx || gctx.mode !== "world") {
      recordSkip("Survey Cache skipped (not in world mode)");
      return true;
    }

    // Ensure no modal UI (GOD/smoke/inventory/etc) is intercepting key input.
    try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(4); } catch (_) {}

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

    const getSurveyCacheThread = () => {
      try {
        const c = has(G.getCtx) ? G.getCtx() : gctx;
        const gm = (c && c.gm && typeof c.gm === "object") ? c.gm : null;
        const threads = (gm && gm.threads && typeof gm.threads === "object") ? gm.threads : null;
        return (threads && threads.surveyCache && typeof threads.surveyCache === "object") ? threads.surveyCache : null;
      } catch (_) {
        return null;
      }
    };

    const clearSurveyCacheState = (id) => {
      try {
        const sc = getSurveyCacheThread();
        if (!sc) return;

        if (sc.active && sc.active.instanceId && String(sc.active.instanceId) === String(id)) sc.active = null;

        if (sc.claimed && typeof sc.claimed === "object") {
          try { delete sc.claimed[String(id)]; } catch (_) {}
        }
        if (Array.isArray(sc.claimedOrder)) {
          sc.claimedOrder = sc.claimedOrder.filter((x) => String(x || "") !== String(id));
        }
        if (sc.attempts && typeof sc.attempts === "object") {
          try { delete sc.attempts[String(id)]; } catch (_) {}
        }
      } catch (_) {}
    };

    const isSurveyCacheClaimed = (id) => {
      try {
        const sc = getSurveyCacheThread();
        const claimed = (sc && sc.claimed && typeof sc.claimed === "object") ? sc.claimed : null;
        if (!claimed) return false;
        const k = String(id);
        return Object.prototype.hasOwnProperty.call(claimed, k);
      } catch (_) {
        return false;
      }
    };

    const getPlayerAbs = () => {
      const c = has(G.getCtx) ? G.getCtx() : gctx;
      const w = c.world || null;
      const ox = (w && typeof w.originX === "number") ? (w.originX | 0) : 0;
      const oy = (w && typeof w.originY === "number") ? (w.originY | 0) : 0;
      const px = (c.player && typeof c.player.x === "number") ? (c.player.x | 0) : 0;
      const py = (c.player && typeof c.player.y === "number") ? (c.player.y | 0) : 0;
      const absX = ox + px;
      const absY = oy + py;
      return { c, absX, absY, instanceId: `surveyCache:${absX},${absY}` };
    };

    // Encounter templates are required for GMBridge to start the encounter.
    let encReady = true;
    try {
      if (ctx && typeof ctx.waitForEncounterTemplate === "function") {
        encReady = await ctx.waitForEncounterTemplate("gm_survey_cache_scene", { timeoutMs: 12000, settleTimeoutMs: 15000, intervalMs: 80 });
      } else {
        const H = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.GameData;
        if (H && typeof H.waitForEncounterTemplate === "function") {
          encReady = await H.waitForEncounterTemplate("gm_survey_cache_scene", { timeoutMs: 12000, settleTimeoutMs: 15000, intervalMs: 80 });
        } else {
          const GD = (typeof window !== "undefined" ? window.GameData : null);
          if (GD && GD.ready && typeof GD.ready.then === "function") {
            let settled = false;
            try {
              GD.ready.then(() => { settled = true; }, () => { settled = true; });
            } catch (_) {
              settled = true;
            }
            await waitUntil(() => settled, 15000, 80);
          }

          encReady = await waitUntil(() => {
            const GD2 = (typeof window !== "undefined" ? window.GameData : null);
            const reg = GD2 && GD2.encounters && Array.isArray(GD2.encounters.templates) ? GD2.encounters.templates : [];
            return !!reg.find(t => t && String(t.id || "").toLowerCase() === "gm_survey_cache_scene");
          }, 12000, 80);
        }
      }
    } catch (_) {
      encReady = false;
    }
    record(encReady, "Encounter template 'gm_survey_cache_scene' loaded");
    if (!encReady) {
      recordSkip("Survey Cache skipped (encounter templates not loaded)");
      return true;
    }

    // -----------------------------
    // Flow A: withdraw consumes cache
    // -----------------------------

    const p0 = getPlayerAbs();
    gctx = p0.c;

    const absX0 = p0.absX;
    const absY0 = p0.absY;
    const instanceId0 = p0.instanceId;

    // Ensure we start clean (avoid leaking from prior runs / scenarios).
    try { MS.remove(gctx, (m) => m && String(m.instanceId || "") === instanceId0); } catch (_) {}
    clearSurveyCacheState(instanceId0);

    const m0 = MS.add(gctx, {
      x: absX0,
      y: absY0,
      kind: "gm.surveyCache",
      glyph: "?",
      paletteKey: "gmMarker",
      instanceId: instanceId0
    });

    record(!!m0, "MarkerService.add placed gm.surveyCache marker underfoot");
    if (!m0) return true;

    await waitUntil(() => {
      const at = MS.findAtPlayer(gctx);
      const markers = Array.isArray(at) ? at : (at ? [at] : []);
      return !!markers.find(mm => mm && String(mm.instanceId || "") === instanceId0);
    }, 1200, 80);

    try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(2); } catch (_) {}
    key("g");
    const confirmed0 = await acceptConfirm();
    const entered0 = await waitUntilMode("encounter", 3500);
    const modeAfter0 = has(G.getMode) ? G.getMode() : "";
    record(confirmed0 && entered0 && modeAfter0 === "encounter", `Pressing 'g' starts survey cache encounter (mode=${modeAfter0})`);

    if (!(entered0 && modeAfter0 === "encounter")) {
      try { MS.remove(gctx, { instanceId: instanceId0 }); } catch (_) {}
      return true;
    }

    // New invariant: cache is consumed immediately on successful encounter start.
    // Use absolute coords rather than findAtPlayer (player is now in encounter coords).
    let goneOnStart = false;
    try {
      const cEnc = has(G.getCtx) ? G.getCtx() : gctx;
      const atAbs = MS.findAt(cEnc, absX0, absY0);
      const markersAbs = Array.isArray(atAbs) ? atAbs : (atAbs ? [atAbs] : []);
      goneOnStart = !markersAbs.find(mm => mm && String(mm.instanceId || "") === instanceId0);
    } catch (_) { goneOnStart = false; }
    record(goneOnStart, "Survey cache marker removed immediately on encounter start");

    let withdrew = false;
    try {
      if (has(G.completeEncounter)) withdrew = !!G.completeEncounter("withdraw");
    } catch (_) { withdrew = false; }
    record(withdrew, "CompleteEncounter(withdraw) exits encounter");

    await waitUntilMode("world", 5000);
    try { gctx = G.getCtx(); } catch (_) {}

    // After withdraw, marker should be gone.
    await waitUntil(() => {
      const at = MS.findAtPlayer(gctx);
      const markers = Array.isArray(at) ? at : (at ? [at] : []);
      return !markers.find(mm => mm && String(mm.instanceId || "") === instanceId0);
    }, 2500, 80);

    const atAfterWithdraw = MS.findAtPlayer(gctx);
    const markersAfterWithdraw = Array.isArray(atAfterWithdraw) ? atAfterWithdraw : (atAfterWithdraw ? [atAfterWithdraw] : []);
    const goneAfterWithdraw = !markersAfterWithdraw.find(mm => mm && String(mm.instanceId || "") === instanceId0);
    record(goneAfterWithdraw, "Survey cache marker removed after withdraw (cache consumed)");

    await waitUntil(() => isSurveyCacheClaimed(instanceId0), 2500, 80);
    record(isSurveyCacheClaimed(instanceId0), "Survey cache instance is marked claimed after withdraw");

    // A consumed cache should not be enterable again even if a marker re-appears.
    // (We re-add the marker to simulate deterministic respawns or stale state.)
    try { MS.remove(gctx, { instanceId: instanceId0 }); } catch (_) {}

    const mRe = MS.add(gctx, {
      x: absX0,
      y: absY0,
      kind: "gm.surveyCache",
      glyph: "?",
      paletteKey: "gmMarker",
      instanceId: instanceId0
    });

    await sleep(140);

    const atRe = MS.findAtPlayer(gctx);
    const markersRe = Array.isArray(atRe) ? atRe : (atRe ? [atRe] : []);
    const markerReadded = !!markersRe.find(mm => mm && String(mm.instanceId || "") === instanceId0);
    record(!!mRe, "MarkerService.add can re-add marker for consumed cache (test harness)");

    if (markerReadded) {
      try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(2); } catch (_) {}
      key("g");

      const opened = await waitUntil(() => isConfirmOpen(), 500, 50);
      if (opened) {
        try { key("Enter"); } catch (_) {}
        await waitUntil(() => !isConfirmOpen(), 2000, 80);
      }

      const enteredRe = await waitUntilMode("encounter", 900);
      const modeAfterRe = has(G.getMode) ? G.getMode() : "";
      record(!opened, "Consumed cache does not show confirm modal");
      record(!enteredRe, `Consumed cache cannot be entered again (mode=${modeAfterRe})`);

      // Cleanup any UI state (e.g. Region Map) if we fell through.
      await ensureWorldMode();

      try { MS.remove(gctx, { instanceId: instanceId0 }); } catch (_) {}
    } else {
      record(true, "Consumed cache marker did not persist when re-added (not re-enterable)");
    }

    // -----------------------------
    // Flow B: victory pays out
    // -----------------------------

    if (!has(G.teleportTo) || !has(G.getPlayer) || !has(G.getWorld)) {
      recordSkip("Survey Cache victory portion skipped (teleport helpers missing)");
      return true;
    }

    // Pick a safe nearby walkable tile that is not the original tile.
    let moved = false;
    try {
      const p = has(G.getPlayer) ? G.getPlayer() : { x: 0, y: 0 };
      const w = has(G.getWorld) ? G.getWorld() : null;
      const WT = (typeof window !== "undefined" && window.World && window.World.TILES) ? window.World.TILES : null;

      let target = null;
      if (w && w.map && WT && typeof window.World.isWalkable === "function") {
        const W = w.width | 0;
        const H = w.height | 0;
        for (let r = 1; r <= 10 && !target; r++) {
          for (let dy = -r; dy <= r && !target; dy++) {
            for (let dx = -r; dx <= r && !target; dx++) {
              const x = (p.x | 0) + dx;
              const y = (p.y | 0) + dy;
              if (x < 0 || y < 0 || x >= W || y >= H) continue;
              const t = w.map[y] && w.map[y][x];
              if (t == null) continue;
              if (t === WT.TOWN || t === WT.DUNGEON) continue;
              if (!window.World.isWalkable(t)) continue;
              target = { x, y };
            }
          }
        }
      }

      if (target) {
        moved = !!G.teleportTo(target.x, target.y, { ensureWalkable: true, fallbackScanRadius: 4 });
        record(moved, `Teleport to safe tile for victory test (${target.x},${target.y})`);
        await sleep(160);
      } else {
        recordSkip("Survey Cache victory portion skipped (no safe tile found)");
        return true;
      }
    } catch (_) {
      recordSkip("Survey Cache victory portion skipped (teleport failed)");
      return true;
    }

    if (!moved) {
      recordSkip("Survey Cache victory portion skipped (teleport unsuccessful)");
      return true;
    }

    await ensureWorldMode();

    const p1 = getPlayerAbs();
    gctx = p1.c;

    const absX1 = p1.absX;
    const absY1 = p1.absY;
    const instanceId1 = p1.instanceId;

    // If teleport didn't move us in absolute coords, we can't safely test a new cache instance.
    if (instanceId1 === instanceId0) {
      recordSkip("Survey Cache victory portion skipped (could not move to distinct tile)");
      return true;
    }

    // Ensure we start clean for the second instance.
    try { MS.remove(gctx, (m) => m && String(m.instanceId || "") === instanceId1); } catch (_) {}
    clearSurveyCacheState(instanceId1);

    const m1 = MS.add(gctx, {
      x: absX1,
      y: absY1,
      kind: "gm.surveyCache",
      glyph: "?",
      paletteKey: "gmMarker",
      instanceId: instanceId1
    });

    record(!!m1, "Placed second gm.surveyCache marker underfoot for victory path");
    if (!m1) return true;

    const goldBefore = getGoldAmount();

    try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(2); } catch (_) {}
    key("g");
    const confirmed1 = await acceptConfirm();
    const entered1 = await waitUntilMode("encounter", 3500);
    const modeAfter1 = has(G.getMode) ? G.getMode() : "";
    record(confirmed1 && entered1 && modeAfter1 === "encounter", `Enter survey cache encounter for victory test (mode=${modeAfter1})`);

    if (!(entered1 && modeAfter1 === "encounter")) {
      try { MS.remove(gctx, { instanceId: instanceId1 }); } catch (_) {}
      return true;
    }

    let completed = false;
    try {
      if (has(G.completeEncounter)) completed = !!G.completeEncounter("victory");
    } catch (_) { completed = false; }
    record(completed, "CompleteEncounter(victory) exits encounter");

    await waitUntilMode("world", 5000);
    try { gctx = G.getCtx(); } catch (_) {}

    // Marker should be removed.
    await waitUntil(() => {
      const at = MS.findAtPlayer(gctx);
      const markers = Array.isArray(at) ? at : (at ? [at] : []);
      return !markers.find(mm => mm && String(mm.instanceId || "") === instanceId1);
    }, 2500, 80);

    const atFinal = MS.findAtPlayer(gctx);
    const markersFinal = Array.isArray(atFinal) ? atFinal : (atFinal ? [atFinal] : []);
    const markerGone = !markersFinal.find(mm => mm && String(mm.instanceId || "") === instanceId1);
    record(markerGone, "Survey cache marker removed after victory payout");

    await waitUntil(() => (getGoldAmount() - goldBefore) >= 40, 2500, 80);

    const goldAfter = getGoldAmount();
    const delta = (goldAfter | 0) - (goldBefore | 0);
    record(delta >= 40 && delta <= 70, `Gold delta after victory within 40..70 (delta=${delta})`);

    if (!markerGone) {
      try { MS.remove(gctx, { instanceId: instanceId1 }); } catch (_) {}
    }

    return true;
  }

  window.SmokeTest.Scenarios.gm_survey_cache = { run };
})();
