(function () {
  // SmokeTest Scenario: Town rumor/status HUD
  // Validates:
  // - Town HUD line renders district header + rumor in town mode.
  // - bandits_farm state changes alter the visible rumor text.

  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  async function run(ctx) {
    const record = (ctx && ctx.record) || function () {};
    const recordSkip = (ctx && ctx.recordSkip) || function () {};
    const sleep = (ctx && ctx.sleep) || (ms => new Promise(r => setTimeout(r, Math.max(0, ms | 0))));

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

    const G = (typeof window !== "undefined") ? window.GameAPI : null;
    const QS = (typeof window !== "undefined") ? window.QuestService : null;
    if (!G || !QS || !has(G.getCtx) || !has(QS.listForCurrentTown)) {
      recordSkip("Town rumor status skipped (GameAPI / QuestService unavailable)");
      return true;
    }

    let gctx = null;
    let town = null;
    let snapshot = null;

    const getStatusEl = () => {
      try { return document.getElementById("town-status"); } catch (_) { return null; }
    };

    const updateUI = async () => {
      try {
        if (has(G.updateUI)) G.updateUI();
        else if (gctx && typeof gctx.updateUI === "function") gctx.updateUI();
      } catch (_) {}
      await sleep(80);
    };

    try {
      try { if (ctx && typeof ctx.ensureTownOnce === "function") await ctx.ensureTownOnce(); } catch (_) {}
      gctx = G.getCtx();
      const mode = has(G.getMode) ? G.getMode() : (gctx && gctx.mode ? String(gctx.mode) : null);
      if (mode !== "town") {
        recordSkip("Town rumor status skipped (not in town mode)");
        return true;
      }

      town = (function () {
        try {
          if (!gctx || !gctx.worldReturnPos || !Array.isArray(gctx.world?.towns)) return null;
          const wx = gctx.worldReturnPos.x | 0;
          const wy = gctx.worldReturnPos.y | 0;
          return gctx.world.towns.find(t => t && (t.x | 0) === wx && (t.y | 0) === wy) || null;
        } catch (_) {
          return null;
        }
      })();

      if (!town) {
        recordSkip("Town rumor status skipped (current town not found)");
        return true;
      }

      try { snapshot = JSON.stringify(town.quests || null); } catch (_) { snapshot = null; }

      QS.listForCurrentTown(gctx);
      town.quests = town.quests || { available: [], active: [], completed: [], lastRerollTurn: 0 };
      town.quests.available = (town.quests.available || []).filter(q => q && q.templateId !== "bandits_farm");
      town.quests.active = (town.quests.active || []).filter(q => q && q.templateId !== "bandits_farm");
      town.quests.completed = (town.quests.completed || []).filter(q => q && q.templateId !== "bandits_farm");

      const now = (gctx.time && typeof gctx.time.turnCounter === "number") ? (gctx.time.turnCounter | 0) : 0;
      town.quests.available.push({
        templateId: "bandits_farm",
        kind: "encounter",
        title: "Bandits near the farm",
        desc: "A bandit group is harassing a nearby farm. Drive them off.",
        offerAtTurn: now,
        expiresAtTurn: now + 360
      });

      await updateUI();
      await waitUntil(() => {
        const el = getStatusEl();
        return !!(el && el.hidden === false && /Town of|Harbor town of|Castle of/.test(String(el.textContent || "")));
      }, 2500, 80);

      const offerText = String((getStatusEl() && getStatusEl().textContent) || "");
      record(/Districts:/.test(offerText), "Town rumor status: district header renders");
      record(/farm is being harassed|Farmers east of town are still under pressure|nearby farm/i.test(offerText), "Town rumor status: offer rumor renders");

      town.quests.available = [];
      town.quests.completed.push({
        templateId: "bandits_farm",
        kind: "encounter",
        title: "Bandits near the farm",
        completedAtTurn: now + 1,
        finalStatus: "completed"
      });

      await updateUI();
      await waitUntil(() => {
        const text = String((getStatusEl() && getStatusEl().textContent) || "");
        return /road is clear|traders have started using the road again|worst of the trouble has passed/i.test(text);
      }, 2500, 80);

      const resolvedText = String((getStatusEl() && getStatusEl().textContent) || "");
      record(/traders have started using the road again|road is clear|worst of the trouble has passed/i.test(resolvedText), "Town rumor status: resolved aftermath renders");
      return true;
    } catch (e) {
      record(false, "Town rumor status scenario failed: " + (e && e.message ? e.message : String(e)));
      return true;
    } finally {
      try {
        if (town) {
          if (snapshot == null) delete town.quests;
          else town.quests = JSON.parse(snapshot);
        }
      } catch (_) {}
      try { await updateUI(); } catch (_) {}
      try {
        const TP = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Teleport;
        const mode2 = has(G.getMode) ? G.getMode() : (gctx && gctx.mode ? String(gctx.mode) : null);
        if (mode2 === "town" && TP && typeof TP.teleportToGateAndExit === "function") {
          await TP.teleportToGateAndExit(ctx, { closeModals: true, waitMs: 500 });
        }
      } catch (_) {}
    }
  }

  window.SmokeTest.Scenarios.town_rumor_status = { run };
})();
