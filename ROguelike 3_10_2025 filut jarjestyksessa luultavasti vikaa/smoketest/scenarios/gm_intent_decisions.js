(function () {
  // SmokeTest Scenario: GM intent decision logging
  // Validates that getEntranceIntent + getMechanicHint always push structured decisions into gm.debug.intentHistory.

  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  function snapshotMechanics(mech) {
    const out = {};
    const keys = ["fishing", "lockpicking", "questBoard", "followers"];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const m = mech && mech[k] && typeof mech[k] === "object" ? mech[k] : {};
      out[k] = {
        seen: m.seen | 0,
        tried: m.tried | 0,
        success: m.success | 0,
        failure: m.failure | 0,
        dismiss: m.dismiss | 0,
        firstSeenTurn: m.firstSeenTurn == null ? null : (m.firstSeenTurn | 0),
        lastUsedTurn: m.lastUsedTurn == null ? null : (m.lastUsedTurn | 0)
      };
    }
    return out;
  }

  function restoreMechanics(mech, snap) {
    if (!mech || typeof mech !== "object" || !snap || typeof snap !== "object") return;
    for (const k in snap) {
      if (!Object.prototype.hasOwnProperty.call(snap, k)) continue;
      if (!mech[k] || typeof mech[k] !== "object") mech[k] = {};
      const m = mech[k];
      const s = snap[k];
      m.seen = s.seen | 0;
      m.tried = s.tried | 0;
      m.success = s.success | 0;
      m.failure = s.failure | 0;
      m.dismiss = s.dismiss | 0;
      m.firstSeenTurn = s.firstSeenTurn == null ? null : (s.firstSeenTurn | 0);
      m.lastUsedTurn = s.lastUsedTurn == null ? null : (s.lastUsedTurn | 0);
    }
  }

  async function run(ctx) {
    try {
      const caps = (ctx && ctx.caps) || {};
      if (!caps.GameAPI || !window.GameAPI || !has(window.GameAPI.getCtx)) {
        ctx.recordSkip && ctx.recordSkip("GM intent decisions scenario skipped (GameAPI.getCtx not available)");
        return true;
      }
      if (!window.GMRuntime || !has(window.GMRuntime.getEntranceIntent) || !has(window.GMRuntime.getMechanicHint) || !has(window.GMRuntime.getState)) {
        ctx.recordSkip && ctx.recordSkip("GM intent decisions scenario skipped (GMRuntime not available)");
        return true;
      }

      const gctx = window.GameAPI.getCtx();
      const GM = window.GMRuntime;
      const gm = GM.getState(gctx);
      if (!gm || typeof gm !== "object") {
        ctx.record(false, "GM intent decisions: GM state missing");
        return true;
      }

      // Snapshot mutable fields we will touch.
      const snap = {
        ctxMode: (function () { try { return gctx.mode; } catch (_) { return null; } })(),
        ctxTurn: (function () { try { return gctx.time && typeof gctx.time.turnCounter === "number" ? (gctx.time.turnCounter | 0) : null; } catch (_) { return null; } })(),
        lastEntranceIntentTurn: gm.lastEntranceIntentTurn,
        lastHintIntentTurn: gm.lastHintIntentTurn,
        lastHintIntentTownEntry: gm.lastHintIntentTownEntry,
        lastActionTurn: gm.lastActionTurn,
        stats: gm.stats ? {
          totalTurns: gm.stats.totalTurns | 0,
          modeEntriesTown: (gm.stats.modeEntries && typeof gm.stats.modeEntries === "object") ? (gm.stats.modeEntries.town | 0) : 0
        } : null,
        families: gm.families,
        storyFlagsFirstEntrance: (gm.storyFlags && typeof gm.storyFlags === "object") ? gm.storyFlags.firstEntranceFlavorShown : undefined,
        boredom: gm.boredom && typeof gm.boredom === "object" ? {
          level: gm.boredom.level,
          turnsSinceLastInterestingEvent: gm.boredom.turnsSinceLastInterestingEvent,
          lastInterestingEvent: gm.boredom.lastInterestingEvent
        } : null,
        mood: gm.mood && typeof gm.mood === "object" ? {
          primary: gm.mood.primary,
          valence: gm.mood.valence,
          arousal: gm.mood.arousal,
          baselineValence: gm.mood.baselineValence,
          baselineArousal: gm.mood.baselineArousal,
          transientValence: gm.mood.transientValence,
          transientArousal: gm.mood.transientArousal,
          lastUpdatedTurn: gm.mood.lastUpdatedTurn
        } : null,
        debug: gm.debug && typeof gm.debug === "object" ? {
          lastIntent: gm.debug.lastIntent,
          intentHistory: Array.isArray(gm.debug.intentHistory) ? gm.debug.intentHistory.slice() : null
        } : null,
        mechanics: snapshotMechanics(gm.mechanics)
      };

      // Force stable context for decisions.
      try { gctx.mode = "town"; } catch (_) {}
      try {
        gctx.time = gctx.time && typeof gctx.time === "object" ? gctx.time : {};
        gctx.time.turnCounter = 123;
      } catch (_) {}

      try {
        gm.stats = gm.stats && typeof gm.stats === "object" ? gm.stats : {};
        gm.stats.modeEntries = gm.stats.modeEntries && typeof gm.stats.modeEntries === "object" ? gm.stats.modeEntries : {};
        gm.stats.totalTurns = 80;
      } catch (_) {}

      try {
        gm.families = {};
        gm.storyFlags = gm.storyFlags && typeof gm.storyFlags === "object" ? gm.storyFlags : {};
        gm.storyFlags.firstEntranceFlavorShown = true;
      } catch (_) {}

      try {
        gm.boredom = gm.boredom && typeof gm.boredom === "object" ? gm.boredom : {};
        gm.boredom.level = 0.95;
        gm.mood = gm.mood && typeof gm.mood === "object" ? gm.mood : {};
        gm.mood.valence = 0.0;
        gm.mood.arousal = 0.4;
      } catch (_) {}

      try {
        gm.debug = gm.debug && typeof gm.debug === "object" ? gm.debug : {};
        gm.debug.intentHistory = Array.isArray(gm.debug.intentHistory) ? gm.debug.intentHistory : [];
      } catch (_) {}

      function callEntrance(entryNo) {
        try {
          gm.stats.modeEntries = gm.stats.modeEntries && typeof gm.stats.modeEntries === "object" ? gm.stats.modeEntries : {};
          gm.stats.modeEntries.town = entryNo | 0;
        } catch (_) {}

        const beforeLen = Array.isArray(gm.debug.intentHistory) ? gm.debug.intentHistory.length : 0;
        const intent = GM.getEntranceIntent(gctx, "town");
        const afterLen = Array.isArray(gm.debug.intentHistory) ? gm.debug.intentHistory.length : 0;
        const last = Array.isArray(gm.debug.intentHistory) && gm.debug.intentHistory.length ? gm.debug.intentHistory[0] : null;

        ctx.record(afterLen === beforeLen + 1, `GM entrance intent pushes intentHistory entry (town entry ${entryNo})`);
        ctx.record(!!(last && last.channel === "entrance"), `GM entrance intentHistory entry has channel 'entrance' (town entry ${entryNo})`);
        ctx.record(!!(intent && (intent.kind === "flavor" || intent.kind === "none")), `GM entrance intent kind is flavor|none (town entry ${entryNo})`);

        if (intent && intent.kind === "none") {
          ctx.record(!!(last && typeof last.reason === "string" && last.reason), `GM entrance 'none' has populated reason (town entry ${entryNo})`);
        }

        return { intent, last };
      }

      // Simulate multiple town entries without advancing turnCounter.
      const r1 = callEntrance(1);
      ctx.record(!!(r1.intent && r1.intent.kind === "flavor"), "GM entrance intent returns flavor on 1st town entry");
      ctx.record(!!(r1.intent && r1.intent.kind === "flavor" && r1.intent.topic === "general_rumor"), "GM entrance intent #1 topic is general_rumor");

      const r2 = callEntrance(2);
      ctx.record(!!(r2.intent && r2.intent.kind === "none"), "GM entrance intent returns none on 2nd town entry");
      ctx.record(!!(r2.last && r2.last.reason === "rarity.entryPeriod"), "GM entrance intent #2 logs reason 'rarity.entryPeriod'");

      const r5 = callEntrance(5);
      ctx.record(!!(r5.intent && r5.intent.kind === "flavor"), "GM entrance intent returns flavor again on 5th town entry");
      ctx.record(!!(r5.intent && r5.intent.kind === "flavor" && r5.intent.topic === "general_rumor"), "GM entrance intent #5 topic is general_rumor");

      // Mechanic hint: early-game guard should not block once we have 2 town entries.
      const mech = gm.mechanics && typeof gm.mechanics === "object" ? gm.mechanics : (gm.mechanics = {});
      const mkeys = ["fishing", "lockpicking", "questBoard", "followers"];
      for (let i = 0; i < mkeys.length; i++) {
        const k = mkeys[i];
        if (!mech[k] || typeof mech[k] !== "object") mech[k] = {};
        mech[k].seen = 0;
        mech[k].tried = 0;
        mech[k].dismiss = 0;
        mech[k].lastUsedTurn = null;
        mech[k].firstSeenTurn = null;
      }

      try {
        gm.stats.totalTurns = 0;
        gm.stats.modeEntries.town = 2;
        gm.lastHintIntentTurn = -9999;
        gm.lastHintIntentTownEntry = -9999;
      } catch (_) {}

      const beforeMechLen = Array.isArray(gm.debug.intentHistory) ? gm.debug.intentHistory.length : 0;
      const mechIntent = GM.getMechanicHint(gctx);
      const afterMechLen = Array.isArray(gm.debug.intentHistory) ? gm.debug.intentHistory.length : 0;
      const mechLast = Array.isArray(gm.debug.intentHistory) && gm.debug.intentHistory.length ? gm.debug.intentHistory[0] : null;

      const mechLogged = (afterMechLen === beforeMechLen + 1) && !!(mechLast && mechLast.channel === "mechanicHint");
      ctx.record(mechLogged, "GM mechanicHint pushes intentHistory entry");

      const mechOk = !!(
        mechIntent &&
        (mechIntent.kind === "nudge" || mechIntent.kind === "none") &&
        (mechIntent.kind === "nudge" || (mechLast && typeof mechLast.reason === "string" && mechLast.reason))
      );
      ctx.record(mechOk, "GM mechanicHint returns a nudge when entriesTown>=2 at totalTurns=0 (or logs reason when none)");

      // Restore snapshot.
      try {
        if (snap.ctxMode != null) gctx.mode = snap.ctxMode;
        if (snap.ctxTurn != null) {
          gctx.time = gctx.time && typeof gctx.time === "object" ? gctx.time : {};
          gctx.time.turnCounter = snap.ctxTurn | 0;
        }

        gm.lastEntranceIntentTurn = snap.lastEntranceIntentTurn;
        gm.lastHintIntentTurn = snap.lastHintIntentTurn;
        gm.lastHintIntentTownEntry = snap.lastHintIntentTownEntry;
        gm.lastActionTurn = snap.lastActionTurn;

        if (snap.stats && gm.stats) {
          gm.stats.totalTurns = snap.stats.totalTurns | 0;
          gm.stats.modeEntries = gm.stats.modeEntries && typeof gm.stats.modeEntries === "object" ? gm.stats.modeEntries : {};
          gm.stats.modeEntries.town = snap.stats.modeEntriesTown | 0;
        }

        gm.families = snap.families;
        gm.storyFlags = gm.storyFlags && typeof gm.storyFlags === "object" ? gm.storyFlags : {};
        if (snap.storyFlagsFirstEntrance === undefined) {
          try { delete gm.storyFlags.firstEntranceFlavorShown; } catch (_) { gm.storyFlags.firstEntranceFlavorShown = undefined; }
        } else {
          gm.storyFlags.firstEntranceFlavorShown = snap.storyFlagsFirstEntrance;
        }

        if (snap.boredom && gm.boredom && typeof gm.boredom === "object") {
          gm.boredom.level = snap.boredom.level;
          gm.boredom.turnsSinceLastInterestingEvent = snap.boredom.turnsSinceLastInterestingEvent;
          gm.boredom.lastInterestingEvent = snap.boredom.lastInterestingEvent;
        }

        if (snap.mood && gm.mood && typeof gm.mood === "object") {
          gm.mood.primary = snap.mood.primary;
          gm.mood.valence = snap.mood.valence;
          gm.mood.arousal = snap.mood.arousal;
          gm.mood.baselineValence = snap.mood.baselineValence;
          gm.mood.baselineArousal = snap.mood.baselineArousal;
          gm.mood.transientValence = snap.mood.transientValence;
          gm.mood.transientArousal = snap.mood.transientArousal;
          gm.mood.lastUpdatedTurn = snap.mood.lastUpdatedTurn;
        }

        if (snap.debug && gm.debug && typeof gm.debug === "object") {
          gm.debug.lastIntent = snap.debug.lastIntent;
          if (snap.debug.intentHistory) gm.debug.intentHistory = snap.debug.intentHistory.slice();
        }

        restoreMechanics(gm.mechanics, snap.mechanics);
      } catch (_) {}

      return true;
    } catch (e) {
      ctx.record(false, "GM intent decisions scenario failed: " + (e && e.message ? e.message : String(e)));
      return true;
    }
  }

  window.SmokeTest.Scenarios.GMIntentDecisions = { run };
})();
