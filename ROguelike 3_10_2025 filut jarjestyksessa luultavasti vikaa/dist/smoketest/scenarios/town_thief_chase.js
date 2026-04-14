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
      recordSkip("Town thief chase skipped (GameAPI / TownIncidentService unavailable)");
      return true;
    }

    const updateUI = async (gctx) => {
      try {
        if (has(G.updateUI)) G.updateUI();
        else if (gctx && typeof gctx.updateUI === "function") gctx.updateUI();
      } catch (_) {}
      await sleep(80);
    };

    const getIncidentRumor = (gameCtx) => {
      try {
        if (!TFS || typeof TFS.getTownStatusSummary !== "function") return null;
        const summary = TFS.getTownStatusSummary(gameCtx);
        const rumors = Array.isArray(summary && summary.rumors) ? summary.rumors : [];
        return rumors.find(r => r && r.source === "incident") || null;
      } catch (_) {
        return null;
      }
    };

    let gctx = null;
    let town = null;
    let incidentSnapshot = null;
    let savedNpcSnapshot = null;

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
        recordSkip("Town thief chase skipped (not in town mode)");
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
        recordSkip("Town thief chase skipped (current town not found)");
        return true;
      }

      if (!(gctx.townPlaza || gctx.townExitAt || (gctx.tavern && gctx.tavern.door))) {
        recordSkip("Town thief chase skipped (no valid chase anchors in this town)");
        return true;
      }

      try { incidentSnapshot = town.gmIncident ? JSON.stringify(town.gmIncident) : null; } catch (_) { incidentSnapshot = null; }
      try { savedNpcSnapshot = JSON.stringify(Array.isArray(gctx.npcs) ? gctx.npcs : []); } catch (_) { savedNpcSnapshot = null; }

      delete town.gmIncident;
      gctx.npcs = Array.isArray(gctx.npcs) ? gctx.npcs.filter(n => !(n && n.isTownIncident)) : [];
      try {
        const TR = window.TownRuntime || null;
        if (TR && typeof TR.rebuildOccupancy === "function") TR.rebuildOccupancy(gctx);
      } catch (_) {}

      const incident = TIS.maybeArmTownIncidentFromGM(gctx, { kind: "flavor", topic: "town_trouble:thief_chase", forceImmediate: true });
      record(!!(incident && incident.status === "live"), "Town thief chase: immediate live thief incident arms");

      TIS.tickTownIncident(gctx);
      await updateUI(gctx);

      const thief = Array.isArray(gctx.npcs)
        ? gctx.npcs.find(n => n && n.isTownIncident && n.incidentRole === "thief" && n._townIncidentId === incident.id)
        : null;
      const responders = Array.isArray(gctx.npcs)
        ? gctx.npcs.filter(n => n && n.isTownIncident && n.incidentRole === "guard_responder" && n._townIncidentId === incident.id)
        : [];
      record(!!thief, "Town thief chase: thief actor materializes");
      record(responders.length > 0, "Town thief chase: guard responders materialize");

      const rumorBefore = getIncidentRumor(gctx);
      record(!!(rumorBefore && /thief|market square|guards/i.test(String(rumorBefore.text || ""))), "Town thief chase: active rumor text reflects the chase");

      if (thief && gctx.townExitAt) {
        thief.x = gctx.townExitAt.x | 0;
        thief.y = gctx.townExitAt.y | 0;
        TIS.tickTownIncident(gctx);
        await updateUI(gctx);
        const rumorAfter = getIncidentRumor(gctx);
        record(!!(rumorAfter && rumorAfter.status === "escaped"), "Town thief chase: reaching the gate resolves as escaped");
        record(!!(rumorAfter && /got away|different story/i.test(String(rumorAfter.text || ""))), "Town thief chase: escaped aftermath rumor renders");
      } else {
        recordSkip("Town thief chase: escape resolution skipped (thief or gate unavailable)");
      }

      return true;
    } catch (e) {
      record(false, "Town thief chase scenario failed: " + (e && e.message ? e.message : String(e)));
      return true;
    } finally {
      try {
        if (town) {
          if (incidentSnapshot == null) delete town.gmIncident;
          else town.gmIncident = JSON.parse(incidentSnapshot);
        }
      } catch (_) {}
      try {
        if (gctx) {
          if (savedNpcSnapshot == null) {
            gctx.npcs = Array.isArray(gctx.npcs) ? gctx.npcs.filter(n => !(n && n.isTownIncident)) : [];
          } else {
            gctx.npcs = JSON.parse(savedNpcSnapshot);
          }
          const TR = window.TownRuntime || null;
          if (TR && typeof TR.rebuildOccupancy === "function") TR.rebuildOccupancy(gctx);
        }
      } catch (_) {}
      try { await updateUI(gctx); } catch (_) {}
    }
  }

  window.SmokeTest.Scenarios.town_thief_chase = { run };
})();
