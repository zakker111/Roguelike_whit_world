(function () {
  // SmokeTest Scenario: Quest board GM markers
  // Validates:
  // - MarkerService gm.* markers render in QuestBoard UI.

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
    if (!G) {
      recordSkip("Quest board GM markers skipped (GameAPI not available)");
      return true;
    }

    const MS = (typeof window !== "undefined") ? window.MarkerService : null;
    const UIO = (typeof window !== "undefined") ? window.UIOrchestration : null;
    const QB = (typeof window !== "undefined") ? window.QuestBoardUI : null;

    let gctx = null;
    let markerAdded = false;
    let opened = false;

    const instanceId = "testQuestBoard";
    const kind = "gm.testQuestBoard";

    try {
      // Step 2: ensure town
      try { if (ctx && typeof ctx.ensureTownOnce === "function") await ctx.ensureTownOnce(); } catch (_) {}

      try { if (has(G.getCtx)) gctx = G.getCtx(); } catch (_) { gctx = null; }

      const modeNow = (function () {
        try { if (has(G.getMode)) return G.getMode(); } catch (_) {}
        try { return gctx && gctx.mode ? String(gctx.mode) : null; } catch (_) {}
        return null;
      })();

      if (modeNow !== "town") {
        recordSkip("Quest board GM markers skipped (not in town mode)");
        return true;
      }

      if (!gctx || !gctx.world) {
        recordSkip("Quest board GM markers skipped (ctx/world not available)");
        return true;
      }

      if (!MS || !has(MS.add) || !has(MS.remove)) {
        recordSkip("Quest board GM markers skipped (MarkerService unavailable)");
        return true;
      }

      // Step 3: add synthetic marker
      const pos = (function () {
        try {
          if (gctx.worldReturnPos && typeof gctx.worldReturnPos.x === "number" && typeof gctx.worldReturnPos.y === "number") {
            return { x: gctx.worldReturnPos.x | 0, y: gctx.worldReturnPos.y | 0 };
          }
        } catch (_) {}

        try {
          const ox = (gctx.world && typeof gctx.world.originX === "number") ? (gctx.world.originX | 0) : 0;
          const oy = (gctx.world && typeof gctx.world.originY === "number") ? (gctx.world.originY | 0) : 0;
          const px = (gctx.player && typeof gctx.player.x === "number") ? (gctx.player.x | 0) : 0;
          const py = (gctx.player && typeof gctx.player.y === "number") ? (gctx.player.y | 0) : 0;
          return { x: ox + px, y: oy + py };
        } catch (_) {
          return { x: 0, y: 0 };
        }
      })();

      try { MS.remove(gctx, { instanceId, kind }); } catch (_) {}

      const m = (function () {
        try {
          return MS.add(gctx, {
            x: pos.x,
            y: pos.y,
            kind,
            glyph: "!",
            paletteKey: "gmMarker",
            instanceId
          });
        } catch (_) {
          return null;
        }
      })();

      markerAdded = !!m;
      record(markerAdded, "Quest board GM markers: added synthetic marker");

      // Step 4: open quest board
      try {
        if (UIO && has(UIO.showQuestBoard)) {
          UIO.showQuestBoard(gctx);
          opened = true;
        } else if (QB && has(QB.open)) {
          QB.open(gctx);
          opened = true;
        }
      } catch (_) {}

      if (!opened) {
        recordSkip("Quest board GM markers skipped (QuestBoard open API missing)");
        return true;
      }

      await waitUntil(() => {
        try {
          const p = document.getElementById("questboard-panel");
          return !!(p && p.hidden === false);
        } catch (_) {
          return false;
        }
      }, 2500, 80);

      // Step 5: assert DOM elements
      await waitUntil(() => {
        try { return !!document.getElementById("questboard-gm-markers"); } catch (_) { return false; }
      }, 2500, 80);

      const host = (function () {
        try { return document.getElementById("questboard-gm-markers"); } catch (_) { return null; }
      })();

      record(!!host, "Quest board GM markers container exists (#questboard-gm-markers)");

      const item = (function () {
        try { return host ? host.querySelector('[data-gm-marker-kind="' + kind + '"]') : null; } catch (_) { return null; }
      })();

      record(!!item, "Quest board GM markers contains synthetic marker (gm.testQuestBoard)");

      return true;
    } catch (e) {
      record(false, "Quest board GM markers scenario failed: " + (e && e.message ? e.message : String(e)));
      return true;
    } finally {
      // Step 6: close quest board + remove marker
      try {
        if (opened) {
          if (UIO && has(UIO.hideQuestBoard)) UIO.hideQuestBoard(gctx || {});
          else if (QB && has(QB.hide)) QB.hide();
        }
      } catch (_) {}

      try {
        if (markerAdded && MS && has(MS.remove) && gctx) {
          MS.remove(gctx, { instanceId, kind });
        }
      } catch (_) {}

      // Step 7: leave town (best-effort), but never fail if missing
      try {
        const mode = (function () {
          try { if (G && has(G.getMode)) return G.getMode(); } catch (_) {}
          try { return gctx && gctx.mode ? String(gctx.mode) : null; } catch (_) {}
          return null;
        })();

        if (mode === "town") {
          try { if (G && has(G.returnToWorldFromTown)) G.returnToWorldFromTown(); } catch (_) {}
          try { if (G && has(G.leaveTownNow)) G.leaveTownNow(); } catch (_) {}
          try { if (G && has(G.returnToWorldIfAtExit)) G.returnToWorldIfAtExit(); } catch (_) {}

          // If helper exists, try deterministic exit via gate.
          try {
            const TP = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Teleport;
            if (TP && typeof TP.teleportToGateAndExit === "function") {
              await TP.teleportToGateAndExit(ctx, { closeModals: true, waitMs: 500 });
            }
          } catch (_) {}

          await sleep(220);
        }
      } catch (_) {}

      // Leave the game in world mode if we can.
      try {
        if (G && has(G.forceWorld)) {
          const mode2 = has(G.getMode) ? G.getMode() : null;
          if (mode2 && mode2 !== "world") {
            G.forceWorld();
            await sleep(120);
          }
        }
      } catch (_) {}
    }
  }

  window.SmokeTest.Scenarios.quest_board_gm_markers = { run };
})();
