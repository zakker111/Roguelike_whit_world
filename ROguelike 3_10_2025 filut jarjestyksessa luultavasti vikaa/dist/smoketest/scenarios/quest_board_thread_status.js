(function () {
  // SmokeTest Scenario: Quest board thread status
  // Validates:
  // - Bandits near the farm surfaces a town-situation banner on the Quest Board.
  // - The banner advances through offer -> active -> turn-in -> resolved states.

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
    const QB = (typeof window !== "undefined") ? window.QuestBoardUI : null;
    const QS = (typeof window !== "undefined") ? window.QuestService : null;

    if (!G || !QB || !QS || !has(G.getCtx) || !has(QB.open) || !has(QB.hide) || !has(QS.listForCurrentTown) || !has(QS.accept) || !has(QS.claim)) {
      recordSkip("Quest board thread status skipped (GameAPI / QuestBoardUI / QuestService unavailable)");
      return true;
    }

    let gctx = null;
    let town = null;
    let snapshot = null;
    let panelOpened = false;

    const findCurrentTown = function (gameCtx) {
      try {
        if (!gameCtx || !gameCtx.worldReturnPos || !Array.isArray(gameCtx.world?.towns)) return null;
        const wx = gameCtx.worldReturnPos.x | 0;
        const wy = gameCtx.worldReturnPos.y | 0;
        return gameCtx.world.towns.find(t => t && (t.x | 0) === wx && (t.y | 0) === wy) || null;
      } catch (_) {
        return null;
      }
    };

    const getStoryNode = function () {
      try { return document.getElementById("questboard-town-situation"); } catch (_) { return null; }
    };

    const readStoryStage = function () {
      try {
        const el = getStoryNode();
        return el ? String(el.getAttribute("data-story-stage") || "") : "";
      } catch (_) {
        return "";
      }
    };

    try {
      try { if (ctx && typeof ctx.ensureTownOnce === "function") await ctx.ensureTownOnce(); } catch (_) {}

      gctx = G.getCtx();
      const mode = has(G.getMode) ? G.getMode() : (gctx && gctx.mode ? String(gctx.mode) : null);
      if (mode !== "town") {
        recordSkip("Quest board thread status skipped (not in town mode)");
        return true;
      }

      town = findCurrentTown(gctx);
      if (!town) {
        recordSkip("Quest board thread status skipped (current town not found)");
        return true;
      }

      try {
        snapshot = JSON.stringify(town.quests || null);
      } catch (_) {
        snapshot = null;
      }

      // Initialize quest state and force a clean bandits_farm offer for deterministic checks.
      const listed = QS.listForCurrentTown(gctx);
      record(!!listed, "Quest board thread status: quest state available");

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

      QB.open(gctx);
      panelOpened = true;
      await waitUntil(() => !!getStoryNode(), 2500, 80);

      record(readStoryStage() === "offer", "Quest board thread status: offer banner renders");

      const accepted = !!QS.accept(gctx, "bandits_farm");
      record(accepted, "Quest board thread status: accepted bandits_farm");
      QB.open(gctx);
      await waitUntil(() => readStoryStage() === "active", 2500, 80);
      record(readStoryStage() === "active", "Quest board thread status: active banner renders");

      const active = (town.quests.active || []).find(q => q && q.templateId === "bandits_farm");
      if (!active) {
        record(false, "Quest board thread status: active quest missing after accept");
        return true;
      }

      active.status = "completedPendingTurnIn";
      active.marker = null;
      QB.open(gctx);
      await waitUntil(() => readStoryStage() === "turnin", 2500, 80);
      record(readStoryStage() === "turnin", "Quest board thread status: turn-in banner renders");

      const claimed = !!QS.claim(gctx, active.instanceId);
      record(claimed, "Quest board thread status: resolved claim succeeds");
      QB.open(gctx);
      await waitUntil(() => readStoryStage() === "resolved", 2500, 80);
      record(readStoryStage() === "resolved", "Quest board thread status: resolved aftermath banner renders");

      return true;
    } catch (e) {
      record(false, "Quest board thread status scenario failed: " + (e && e.message ? e.message : String(e)));
      return true;
    } finally {
      try {
        if (town) {
          if (snapshot == null) delete town.quests;
          else town.quests = JSON.parse(snapshot);
        }
      } catch (_) {}

      try {
        if (panelOpened) QB.hide();
      } catch (_) {}

      try {
        const mode2 = has(G.getMode) ? G.getMode() : (gctx && gctx.mode ? String(gctx.mode) : null);
        if (mode2 === "town") {
          const TP = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Teleport;
          if (TP && typeof TP.teleportToGateAndExit === "function") {
            await TP.teleportToGateAndExit(ctx, { closeModals: true, waitMs: 500 });
          }
        }
      } catch (_) {}
    }
  }

  window.SmokeTest.Scenarios.quest_board_thread_status = { run };
})();
