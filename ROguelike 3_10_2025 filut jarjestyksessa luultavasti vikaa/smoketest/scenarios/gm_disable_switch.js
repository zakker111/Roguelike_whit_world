(function () {
  // SmokeTest Scenario: GM disable switch (gm.enabled)
  // Validates that gm.enabled=false suppresses ALL GM-driven side effects:
  // - No gm.* marker spawning during world scan (GMBridge.onWorldScanRect)
  // - No confirm prompts / encounter starts during world step (GMBridge.maybeHandleWorldStep)
  // - Marker actions on gm.* markers are consumed (so Region Map doesn't open) but do not start encounters

  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) {
    try { return typeof fn === "function"; } catch (_) { return false; }
  }

  function snapshotEnabled(gm) {
    return {
      hasOwn: !!(gm && typeof gm === "object" && Object.prototype.hasOwnProperty.call(gm, "enabled")),
      value: (gm && typeof gm === "object") ? gm.enabled : undefined,
    };
  }

  function restoreEnabled(gm, snap) {
    if (!gm || typeof gm !== "object" || !snap) return;
    if (!snap.hasOwn) {
      try { delete gm.enabled; } catch (_) { gm.enabled = undefined; }
      return;
    }
    gm.enabled = snap.value;
  }

  function getGoldAmount(c) {
    try {
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
  }

  function getPlayerAbs(ctx) {
    const w = ctx && ctx.world ? ctx.world : null;
    const ox = (w && typeof w.originX === "number") ? (w.originX | 0) : 0;
    const oy = (w && typeof w.originY === "number") ? (w.originY | 0) : 0;
    const px = (ctx && ctx.player && typeof ctx.player.x === "number") ? (ctx.player.x | 0) : 0;
    const py = (ctx && ctx.player && typeof ctx.player.y === "number") ? (ctx.player.y | 0) : 0;
    return { absX: (ox + px) | 0, absY: (oy + py) | 0 };
  }

  async function run(ctx) {
    const record = (ctx && ctx.record) || function () {};
    const recordSkip = (ctx && ctx.recordSkip) || function () {};
    const sleep = (ctx && ctx.sleep) || (ms => new Promise(r => setTimeout(r, Math.max(0, ms | 0))));
    const ensureAllModalsClosed = (ctx && ctx.ensureAllModalsClosed) || null;

    const GA = (typeof window !== "undefined" ? window.GameAPI : null);
    const GM = (typeof window !== "undefined" ? window.GMRuntime : null);
    const GB = (typeof window !== "undefined" ? window.GMBridge : null);
    const MS = (typeof window !== "undefined" ? window.MarkerService : null);
    const UIO = (typeof window !== "undefined" ? window.UIOrchestration : null);
    const ER = (typeof window !== "undefined" ? window.EncounterRuntime : null);

    if (!GA || !has(GA.getCtx) || !has(GA.getMode) || !has(GA.forceWorld) || !GM || !has(GM.getState) || !GB) {
      recordSkip("GM disable switch skipped (GameAPI/GMRuntime/GMBridge missing required functions)");
      return true;
    }

    // Avoid modal UI interfering with mode transitions.
    try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(3); } catch (_) {}

    // Ensure we're in world mode.
    try {
      if (GA.getMode() !== "world") {
        GA.forceWorld();
        await sleep(200);
      }
    } catch (_) {}

    const gctx = GA.getCtx();
    if (!gctx) {
      recordSkip("GM disable switch skipped (ctx missing)");
      return true;
    }

    // Require actual world mode; do not force ctx.mode (we want meaningful coverage).
    if (GA.getMode() !== "world" || String(gctx.mode || "") !== "world") {
      recordSkip(`GM disable switch skipped (not in world mode: GA=${String(GA.getMode())} ctx=${String(gctx.mode)})`);
      return true;
    }

    const gm = GM.getState(gctx);
    if (!gm || typeof gm !== "object") {
      record(false, "GM disable switch: GM state missing");
      return true;
    }

    const enabledSnap = snapshotEnabled(gm);

    // Patches + counters
    const origMsAdd = (MS && typeof MS.add === "function") ? MS.add : null;
    const origMsRemove = (MS && typeof MS.remove === "function") ? MS.remove : null;
    const origShowConfirm = (UIO && typeof UIO.showConfirm === "function") ? UIO.showConfirm : null;

    const origSurveyScan = (GM && typeof GM.surveyCache_worldScanRect === "function") ? GM.surveyCache_worldScanRect : null;
    const origSurveyEnsureGuaranteed = (GM && typeof GM.surveyCache_ensureGuaranteed === "function") ? GM.surveyCache_ensureGuaranteed : null;
    const origSurveyOnMarkerPlaced = (GM && typeof GM.surveyCache_onMarkerPlaced === "function") ? GM.surveyCache_onMarkerPlaced : null;
    const origGetFactionTravelEvent = (GM && typeof GM.getFactionTravelEvent === "function") ? GM.getFactionTravelEvent : null;

    const modes = (gctx && gctx.Modes && typeof gctx.Modes === "object") ? gctx.Modes : (typeof window !== "undefined" ? window.Modes : null);
    const origEnterEncounter = (modes && typeof modes.enterEncounter === "function") ? modes.enterEncounter : null;
    const origEREnter = (ER && typeof ER.enter === "function") ? ER.enter : null;

    let markerAddCalls = 0;
    let surveyScanCalls = 0;
    let surveyEnsureGuaranteedCalls = 0;
    let surveyMarkerPlacedCalls = 0;
    let getFactionTravelEventCalls = 0;
    let confirmCalls = 0;
    let enterCalls = 0;

    // Marker underfoot used to validate handleMarkerAction consumption
    let injectedMarkerInstanceId = null;

    try {
      // Disable GM via authoritative gate.
      gm.enabled = false;

      // Patch counters.
      if (MS && has(origMsAdd)) {
        MS.add = function () {
          try {
            const m = (arguments && arguments.length >= 2) ? arguments[1] : (arguments ? arguments[0] : null);
            const k = m && typeof m.kind === "string" ? String(m.kind) : "";
            if (k && k.indexOf("gm.") === 0) markerAddCalls++;
          } catch (_) {}
          return origMsAdd.apply(this, arguments);
        };
      }
      if (GM && has(origSurveyScan)) {
        GM.surveyCache_worldScanRect = function () {
          surveyScanCalls++;
          return origSurveyScan.apply(this, arguments);
        };
      }
      if (GM && has(origSurveyEnsureGuaranteed)) {
        GM.surveyCache_ensureGuaranteed = function () {
          surveyEnsureGuaranteedCalls++;
          return origSurveyEnsureGuaranteed.apply(this, arguments);
        };
      }
      if (GM && has(origSurveyOnMarkerPlaced)) {
        GM.surveyCache_onMarkerPlaced = function () {
          surveyMarkerPlacedCalls++;
          return origSurveyOnMarkerPlaced.apply(this, arguments);
        };
      }
      if (GM && has(origGetFactionTravelEvent)) {
        GM.getFactionTravelEvent = function () {
          getFactionTravelEventCalls++;
          // If GMBridge ignores gm.enabled, this would normally trigger a confirm prompt.
          return { kind: "encounter", encounterId: "gm_bandit_bounty" };
        };
      }
      if (UIO && has(origShowConfirm)) {
        UIO.showConfirm = function () {
          confirmCalls++;
          return origShowConfirm.apply(this, arguments);
        };
      }
      if (modes && has(origEnterEncounter)) {
        modes.enterEncounter = function () {
          enterCalls++;
          return origEnterEncounter.apply(this, arguments);
        };
      }
      if (ER && has(origEREnter)) {
        ER.enter = function () {
          enterCalls++;
          return origEREnter.apply(this, arguments);
        };
      }

      // ------------------------------
      // (1) Scan-time spawns are suppressed
      // ------------------------------
      if (GB && typeof GB.onWorldScanRect === "function") {
        const beforeAdd = markerAddCalls;
        const beforeScan = surveyScanCalls;
        const beforeEnsure = surveyEnsureGuaranteedCalls;
        const beforePlaced = surveyMarkerPlacedCalls;

        try {
          GB.onWorldScanRect(gctx, { x0: 0, y0: 0, w: 32, h: 32 });
        } catch (_) {}

        if (MS && has(origMsAdd)) {
          record(markerAddCalls === beforeAdd, "GM disabled: GMBridge.onWorldScanRect does not place markers");
        } else {
          recordSkip("GM disable switch: scan marker spawn check skipped (MarkerService.add missing)");
        }

        if (GM && has(origSurveyScan)) {
          record(surveyScanCalls === beforeScan, "GM disabled: GMBridge.onWorldScanRect does not consult GMRuntime.surveyCache_worldScanRect");
        } else {
          recordSkip("GM disable switch: scan Survey Cache scan probe skipped (GMRuntime.surveyCache_worldScanRect missing)");
        }

        if (GM && has(origSurveyEnsureGuaranteed)) {
          record(surveyEnsureGuaranteedCalls === beforeEnsure, "GM disabled: GMBridge.onWorldScanRect does not consult GMRuntime.surveyCache_ensureGuaranteed");
        } else {
          recordSkip("GM disable switch: scan Survey Cache guarantee probe skipped (GMRuntime.surveyCache_ensureGuaranteed missing)");
        }

        if (GM && has(origSurveyOnMarkerPlaced)) {
          record(surveyMarkerPlacedCalls === beforePlaced, "GM disabled: GMBridge.onWorldScanRect does not advance survey cache cooldown (surveyCache_onMarkerPlaced)");
        } else {
          recordSkip("GM disable switch: scan Survey Cache cooldown probe skipped (GMRuntime.surveyCache_onMarkerPlaced missing)");
        }
      } else {
        recordSkip("GM disable switch: scan spawn check skipped (GMBridge.onWorldScanRect missing)");
      }

      // ------------------------------
      // (2) World step is suppressed
      // ------------------------------
      if (GB && typeof GB.maybeHandleWorldStep === "function") {
        const beforeGetFaction = getFactionTravelEventCalls;
        const beforeConfirm = confirmCalls;
        const beforeEnter = enterCalls;
        let handled = false;
        try { handled = !!GB.maybeHandleWorldStep(gctx); } catch (_) { handled = false; }
        record(handled === false, "GM disabled: GMBridge.maybeHandleWorldStep returns false");

        if (GM && has(origGetFactionTravelEvent)) {
          record(getFactionTravelEventCalls === beforeGetFaction, "GM disabled: GMBridge.maybeHandleWorldStep does not consult GMRuntime.getFactionTravelEvent");
        } else {
          recordSkip("GM disable switch: world step intent probe skipped (GMRuntime.getFactionTravelEvent missing)");
        }

        if (UIO && has(origShowConfirm)) {
          record(confirmCalls === beforeConfirm, "GM disabled: GMBridge.maybeHandleWorldStep does not open confirm UI");
        } else {
          recordSkip("GM disable switch: world step confirm probe skipped (UIOrchestration.showConfirm missing)");
        }

        if ((modes && has(origEnterEncounter)) || (ER && has(origEREnter))) {
          record(enterCalls === beforeEnter, "GM disabled: GMBridge.maybeHandleWorldStep does not start encounters");
        } else {
          recordSkip("GM disable switch: world step encounter probe skipped (Modes.enterEncounter/EncounterRuntime.enter missing)");
        }
      } else {
        recordSkip("GM disable switch: world step check skipped (GMBridge.maybeHandleWorldStep missing)");
      }

      // ------------------------------
      // (3) Marker action is consumed but has no effect
      // ------------------------------
      if (!MS || !has(MS.add) || !GB || typeof GB.handleMarkerAction !== "function") {
        recordSkip("GM disable switch: marker action check skipped (MarkerService.add/GMBridge.handleMarkerAction missing)");
        return true;
      }

      function findGmMarkerAtPlayer() {
        try {
          if (MS && typeof MS.findAtPlayer === "function") {
            const at = MS.findAtPlayer(gctx) || [];
            const list = Array.isArray(at) ? at : [at];
            return list.find((m) => m && typeof m.kind === "string" && m.kind.indexOf("gm.") === 0) || null;
          }
        } catch (_) {}

        try {
          const { absX, absY } = getPlayerAbs(gctx);
          const arr = (gctx && gctx.world && Array.isArray(gctx.world.questMarkers)) ? gctx.world.questMarkers : [];
          return arr.find((m) => m && typeof m.kind === "string" && m.kind.indexOf("gm.") === 0 && (m.x | 0) === (absX | 0) && (m.y | 0) === (absY | 0)) || null;
        } catch (_) {}

        return null;
      }

      function markerExists(kind, instanceId, absX, absY) {
        try {
          const arr = (gctx && gctx.world && Array.isArray(gctx.world.questMarkers)) ? gctx.world.questMarkers : [];
          const k = String(kind || "");
          const iid = (instanceId != null) ? String(instanceId) : null;
          const x = (typeof absX === "number" && Number.isFinite(absX)) ? (absX | 0) : null;
          const y = (typeof absY === "number" && Number.isFinite(absY)) ? (absY | 0) : null;

          return arr.some((m) => {
            if (!m) return false;
            if (String(m.kind || "") !== k) return false;
            if (iid != null) {
              return String(m.instanceId || "") === iid;
            }
            if (x == null || y == null) return false;
            return (m.x | 0) === x && (m.y | 0) === y;
          });
        } catch (_) {
          return false;
        }
      }

      // Prefer an existing gm.* marker at the player's feet; otherwise inject a Survey Cache marker.
      let marker0 = findGmMarkerAtPlayer();
      if (!marker0) {
        const { absX, absY } = getPlayerAbs(gctx);
        const iid = `surveyCache:${absX},${absY}`;
        try {
          const placed = MS.add(gctx, {
            x: absX,
            y: absY,
            kind: "gm.surveyCache",
            glyph: "?",
            paletteKey: "gmMarker",
            instanceId: iid,
          });
          if (placed) {
            injectedMarkerInstanceId = iid;
          }
        } catch (_) {}
        marker0 = findGmMarkerAtPlayer();
      }

      if (!marker0) {
        recordSkip("GM disable switch: marker action check skipped (no gm.* marker under player)");
        return true;
      }

      const markerKind = String(marker0.kind || "");
      const markerInstanceId = (marker0.instanceId != null) ? String(marker0.instanceId) : null;
      const markerX = (typeof marker0.x === "number" && Number.isFinite(marker0.x)) ? (marker0.x | 0) : null;
      const markerY = (typeof marker0.y === "number" && Number.isFinite(marker0.y)) ? (marker0.y | 0) : null;

      if (!markerExists(markerKind, markerInstanceId, markerX, markerY)) {
        recordSkip("GM disable switch: marker action check skipped (marker presence could not be verified)");
        return true;
      }

      const gold0 = getGoldAmount(gctx);
      const confirm0 = confirmCalls;
      const enter0 = enterCalls;
      const mode0 = (has(GA.getMode) ? GA.getMode() : (gctx.mode || ""));

      let consumed = false;
      try { consumed = !!GB.handleMarkerAction(gctx); } catch (_) { consumed = false; }

      const gold1 = getGoldAmount(gctx);
      const mode1 = (has(GA.getMode) ? GA.getMode() : (gctx.mode || ""));
      const markerStillThere = markerExists(markerKind, markerInstanceId, markerX, markerY);

      record(consumed === true, "GM disabled: GMBridge.handleMarkerAction consumes gm.* marker action");

      if (UIO && has(origShowConfirm)) {
        record(confirmCalls === confirm0, "GM disabled: handleMarkerAction does not open confirm UI");
      } else {
        recordSkip("GM disable switch: marker action confirm probe skipped (UIOrchestration.showConfirm missing)");
      }

      if ((modes && has(origEnterEncounter)) || (ER && has(origEREnter))) {
        record(enterCalls === enter0, "GM disabled: handleMarkerAction does not start encounter");
      } else {
        recordSkip("GM disable switch: marker action encounter probe skipped (Modes.enterEncounter/EncounterRuntime.enter missing)");
      }

      record(markerStillThere, "GM disabled: handleMarkerAction does not remove the gm.* marker");
      record(gold1 === gold0, `GM disabled: handleMarkerAction does not grant rewards (gold ${gold0} -> ${gold1})`);
      record(mode1 === mode0, `GM disabled: handleMarkerAction does not change mode (mode=${mode1})`);

      return true;
    } catch (e) {
      record(false, "GM disable switch scenario failed: " + (e && e.message ? e.message : String(e)));
      return true;
    } finally {
      // Cleanup injected marker
      try {
        if (MS && has(origMsRemove) && injectedMarkerInstanceId) {
          MS.remove(gctx, { kind: "gm.surveyCache", instanceId: String(injectedMarkerInstanceId) });
        }
      } catch (_) {}

      // Restore patches
      try { if (MS && origMsAdd && MS.add !== origMsAdd) MS.add = origMsAdd; } catch (_) {}
      try { if (MS && origMsRemove && MS.remove !== origMsRemove) MS.remove = origMsRemove; } catch (_) {}
      try { if (GM && origSurveyScan && GM.surveyCache_worldScanRect !== origSurveyScan) GM.surveyCache_worldScanRect = origSurveyScan; } catch (_) {}
      try { if (GM && origSurveyEnsureGuaranteed && GM.surveyCache_ensureGuaranteed !== origSurveyEnsureGuaranteed) GM.surveyCache_ensureGuaranteed = origSurveyEnsureGuaranteed; } catch (_) {}
      try { if (GM && origSurveyOnMarkerPlaced && GM.surveyCache_onMarkerPlaced !== origSurveyOnMarkerPlaced) GM.surveyCache_onMarkerPlaced = origSurveyOnMarkerPlaced; } catch (_) {}
      try { if (GM && origGetFactionTravelEvent && GM.getFactionTravelEvent !== origGetFactionTravelEvent) GM.getFactionTravelEvent = origGetFactionTravelEvent; } catch (_) {}
      try { if (UIO && origShowConfirm && UIO.showConfirm !== origShowConfirm) UIO.showConfirm = origShowConfirm; } catch (_) {}
      try { if (modes && origEnterEncounter && modes.enterEncounter !== origEnterEncounter) modes.enterEncounter = origEnterEncounter; } catch (_) {}
      try { if (ER && origEREnter && ER.enter !== origEREnter) ER.enter = origEREnter; } catch (_) {}

      // Restore gm.enabled
      try { restoreEnabled(gm, enabledSnap); } catch (_) {}
    }
  }

  window.SmokeTest.Scenarios.gm_disable_switch = { run };
})();
