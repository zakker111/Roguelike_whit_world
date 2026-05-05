(function () {
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  async function run(ctx) {
    const record = (ctx && ctx.record) || function () {};
    const recordSkip = (ctx && ctx.recordSkip) || function () {};
    const sleep = (ctx && ctx.sleep) || (ms => new Promise(r => setTimeout(r, Math.max(0, ms | 0))));

    const G = (typeof window !== "undefined") ? window.GameAPI : null;
    const TIS = (typeof window !== "undefined") ? window.TownIncidentService : null;
    const TFS = (typeof window !== "undefined") ? window.TownFlavorService : null;
    if (!G || !TIS || !has(G.getCtx) || !has(TIS.maybeArmTownIncidentFromGM) || !has(TIS.tickTownIncident)) {
      recordSkip("GM town incidents skipped (GameAPI / TownIncidentService unavailable)");
      return true;
    }

    const getStatusText = () => {
      try {
        const el = document.getElementById("town-status");
        return String((el && el.textContent) || "");
      } catch (_) {
        return "";
      }
    };

    const getLogText = () => {
      try {
        const L = (typeof window !== "undefined") ? window.Logger : null;
        const hist = L && typeof L.getHistory === "function" ? L.getHistory() : [];
        return hist.map(e => String(e && e.msg || "")).join("\n");
      } catch (_) {
        return "";
      }
    };

    const updateUI = async (gctx) => {
      try {
        if (has(G.updateUI)) G.updateUI();
        else if (gctx && typeof gctx.updateUI === "function") gctx.updateUI();
      } catch (_) {}
      await sleep(80);
    };

    const hasIncidentRumorText = (gameCtx, re) => {
      try {
        if (!TFS || typeof TFS.getTownStatusSummary !== "function") return false;
        const summary = TFS.getTownStatusSummary(gameCtx);
        const rumors = Array.isArray(summary && summary.rumors) ? summary.rumors : [];
        return rumors.some(r => r && r.source === "incident" && re.test(String(r.text || "")));
      } catch (_) {
        return false;
      }
    };

    let gctx = null;
    let town = null;
    let incidentSnapshot = null;

    try {
      try { if (ctx && typeof ctx.ensureTownOnce === "function") await ctx.ensureTownOnce(); } catch (_) {}
      try {
        const mode0 = has(G.getMode) ? G.getMode() : null;
        if (mode0 !== "town" && has(G.forceWorld)) {
          G.forceWorld();
          await sleep(180);
        }
      } catch (_) {}
      try {
        const mode1 = has(G.getMode) ? G.getMode() : null;
        if (mode1 !== "town" && has(G.gotoNearestTown)) {
          await G.gotoNearestTown();
          await sleep(220);
        }
      } catch (_) {}
      try { if (ctx && typeof ctx.ensureTownOnce === "function" && (!has(G.getMode) || G.getMode() !== "town")) await ctx.ensureTownOnce(); } catch (_) {}
      gctx = G.getCtx();
      const mode = has(G.getMode) ? G.getMode() : (gctx && gctx.mode ? String(gctx.mode) : "");
      if (mode !== "town") {
        recordSkip("GM town incidents skipped (not in town mode)");
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
        recordSkip("GM town incidents skipped (current town not found)");
        return true;
      }

      try { incidentSnapshot = town.gmIncident ? JSON.stringify(town.gmIncident) : null; } catch (_) { incidentSnapshot = null; }

      delete town.gmIncident;
      gctx.npcs = Array.isArray(gctx.npcs) ? gctx.npcs.filter(n => !(n && n.isTownIncident)) : [];

      const hasInn = !!(gctx.tavern && gctx.tavern.building);
      const firstTopic = hasInn ? "town_trouble:inn_brawl" : "town_trouble:thief_chase";
      const firstIncident = TIS.maybeArmTownIncidentFromGM(gctx, { kind: "flavor", topic: firstTopic });
      record(!!(firstIncident && firstIncident.status === "rumored"), "GM town incidents: rumor state arms from GM flavor topic");
      await updateUI(gctx);
      record(!/Rumor:/.test(getStatusText()), "GM town incidents: HUD omits rumor text");
      record(/Rumor:/.test(getLogText()) && /inn|market square|thief|guards|fight/i.test(getLogText()), "GM town incidents: log reflects rumored incident");

      TIS.tickTownIncident(gctx);
      await updateUI(gctx);
      const noEarlyActors = Array.isArray(gctx.npcs) ? gctx.npcs.filter(n => n && n.isTownIncident && n._townIncidentId === firstIncident.id) : [];
      record(noEarlyActors.length === 0, "GM town incidents: rumor does not materialize actors before escalation");

      try {
        if (gctx && gctx.time && typeof gctx.time.turnCounter === "number") {
          gctx.time.turnCounter = ((firstIncident.escalatesAtTurn | 0) + 1);
        }
      } catch (_) {}

      const liveActors = Array.isArray(gctx.npcs) ? gctx.npcs.filter(n => n && n.isTownIncident && n._townIncidentId === firstIncident.id) : [];
      TIS.tickTownIncident(gctx);
      await updateUI(gctx);
      const escalatedIncident = town.gmIncident || firstIncident;
      record(!!(escalatedIncident && escalatedIncident.status === "live"), "GM town incidents: rumor escalates into a live incident");
      const liveActorsAfterEscalation = Array.isArray(gctx.npcs) ? gctx.npcs.filter(n => n && n.isTownIncident && n._townIncidentId === firstIncident.id) : [];
      record(liveActorsAfterEscalation.length > 0, "GM town incidents: live actors materialize in town");
      record(/Rumor:/.test(getLogText()) && /inn|thief|market square|guards/i.test(getLogText()), "GM town incidents: log reflects active incident");

      TIS.resolveTownIncident(gctx, "resolved");
      await updateUI(gctx);
      record(
        /restored order|stolen goods were recovered|settling down/i.test(getStatusText())
          || hasIncidentRumorText(gctx, /restored order|stolen goods were recovered|settling down/i),
        "GM town incidents: aftermath rumor renders after resolution"
      );

      if (gctx.townPlaza || gctx.townExitAt || (gctx.tavern && gctx.tavern.door)) {
        delete town.gmIncident;
        gctx.npcs = Array.isArray(gctx.npcs) ? gctx.npcs.filter(n => !(n && n.isTownIncident)) : [];
        const thiefIncident = TIS.maybeArmTownIncidentFromGM(gctx, { kind: "flavor", topic: "town_trouble:thief_chase", forceImmediate: true });
        TIS.tickTownIncident(gctx);
        const thief = Array.isArray(gctx.npcs) ? gctx.npcs.find(n => n && n.isTownIncident && n.incidentRole === "thief" && n._townIncidentId === thiefIncident.id) : null;
        record(!!thief, "GM town incidents: thief chase spawns a thief actor");
        if (thief && gctx.townExitAt) {
          thief.x = gctx.townExitAt.x | 0;
          thief.y = gctx.townExitAt.y | 0;
          TIS.tickTownIncident(gctx);
          await updateUI(gctx);
          record(
            /got away|different story/i.test(getStatusText())
              || hasIncidentRumorText(gctx, /got away|different story/i),
            "GM town incidents: thief escape updates aftermath rumor"
          );
        }
      }

      return true;
    } catch (e) {
      record(false, "GM town incidents scenario failed: " + (e && e.message ? e.message : String(e)));
      return true;
    } finally {
      try {
        if (town) {
          if (incidentSnapshot == null) delete town.gmIncident;
          else town.gmIncident = JSON.parse(incidentSnapshot);
        }
      } catch (_) {}
      try {
        if (gctx && Array.isArray(gctx.npcs)) {
          gctx.npcs = gctx.npcs.filter(n => !(n && n.isTownIncident));
        }
      } catch (_) {}
      try { await updateUI(gctx); } catch (_) {}
    }
  }

  window.SmokeTest.Scenarios.gm_town_incidents = { run };
})();
