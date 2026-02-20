(function () {
  // SmokeTest Scenario: GM mechanic hint eligibility
  // Verifies that GMRuntime.getMechanicHint only nudges mechanics the player has NOT used (tried===0).

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
        ctx.recordSkip && ctx.recordSkip("GM mechanic hints scenario skipped (GameAPI.getCtx not available)");
        return true;
      }
      if (!window.GMRuntime || !has(window.GMRuntime.getMechanicHint) || !has(window.GMRuntime.getState)) {
        ctx.recordSkip && ctx.recordSkip("GM mechanic hints scenario skipped (GMRuntime not available)");
        return true;
      }

      const gctx = window.GameAPI.getCtx();
      const GM = window.GMRuntime;
      const gm = GM.getState(gctx);
      if (!gm || typeof gm !== "object") {
        ctx.record(false, "GM mechanic hints: GM state missing");
        return true;
      }

      // Snapshot mutable fields we will touch.
      const snap = {
        lastHintIntentTurn: gm.lastHintIntentTurn,
        lastActionTurn: gm.lastActionTurn,
        stats: gm.stats ? {
          totalTurns: gm.stats.totalTurns | 0,
          modeEntriesTown: (gm.stats.modeEntries && typeof gm.stats.modeEntries === "object") ? (gm.stats.modeEntries.town | 0) : 0
        } : null,
        mechanics: snapshotMechanics(gm.mechanics)
      };

      try {
        gm.stats = gm.stats && typeof gm.stats === "object" ? gm.stats : {};
        gm.stats.modeEntries = gm.stats.modeEntries && typeof gm.stats.modeEntries === "object" ? gm.stats.modeEntries : {};
        gm.stats.totalTurns = 100;
        gm.stats.modeEntries.town = 10;
      } catch (_) {}

      // Force "town" scoring context.
      try { gctx.mode = "town"; } catch (_) {}
      try {
        if (gctx.time && typeof gctx.time === "object") {
          gctx.time.turnCounter = 200;
        }
      } catch (_) {}

      const mech = gm.mechanics && typeof gm.mechanics === "object" ? gm.mechanics : (gm.mechanics = {});
      const keys = ["fishing", "lockpicking", "questBoard", "followers"];
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (!mech[k] || typeof mech[k] !== "object") mech[k] = {};
        mech[k].seen = 0;
        mech[k].tried = 0;
        mech[k].dismiss = 0;
        mech[k].lastUsedTurn = null;
        mech[k].firstSeenTurn = null;
      }

      // Case A: all unused -> town preference should pick questBoard first.
      gm.lastHintIntentTurn = -9999;
      let intent = GM.getMechanicHint(gctx);
      ctx.record(!!(intent && intent.kind === "nudge" && intent.target === "mechanic:questBoard"), "GM mechanic hint picks questBoard first when all mechanics unused (town)");

      // Case B: questBoard used (tried>0) but never seen -> must not be hinted; followers should win next.
      mech.questBoard.tried = 1;
      mech.questBoard.seen = 0;
      mech.questBoard.lastUsedTurn = 200;
      gm.lastHintIntentTurn = -9999;
      intent = GM.getMechanicHint(gctx);
      ctx.record(!!(intent && intent.kind === "nudge" && intent.target === "mechanic:followers"), "GM mechanic hint skips used questBoard (even if unseen) and prefers followers next");

      // Case C: followers also used -> should fall back to first non-town mechanic in fixed order (fishing).
      mech.followers.tried = 1;
      mech.followers.seen = 0;
      mech.followers.lastUsedTurn = 200;
      gm.lastHintIntentTurn = -9999;
      intent = GM.getMechanicHint(gctx);
      ctx.record(!!(intent && intent.kind === "nudge" && intent.target === "mechanic:fishing"), "GM mechanic hint skips used town mechanics and suggests another unused mechanic");

      // Case D: all used recently -> should return none.
      mech.fishing.tried = 1;
      mech.fishing.lastUsedTurn = 200;
      mech.lockpicking.tried = 1;
      mech.lockpicking.lastUsedTurn = 200;
      gm.lastHintIntentTurn = -9999;
      intent = GM.getMechanicHint(gctx);
      ctx.record(!!(intent && intent.kind === "none"), "GM mechanic hint returns none when all mechanics have been used");

      // Restore snapshot.
      try {
        gm.lastHintIntentTurn = snap.lastHintIntentTurn;
        gm.lastActionTurn = snap.lastActionTurn;
        if (snap.stats && gm.stats) {
          gm.stats.totalTurns = snap.stats.totalTurns | 0;
          gm.stats.modeEntries = gm.stats.modeEntries && typeof gm.stats.modeEntries === "object" ? gm.stats.modeEntries : {};
          gm.stats.modeEntries.town = snap.stats.modeEntriesTown | 0;
        }
        restoreMechanics(gm.mechanics, snap.mechanics);
      } catch (_) {}

      return true;
    } catch (e) {
      ctx.record(false, "GM mechanic hints scenario failed: " + (e && e.message ? e.message : String(e)));
      return true;
    }
  }

  window.SmokeTest.Scenarios.GMMechanicHints = { run };
})();
