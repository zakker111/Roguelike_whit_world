(function () {
  // SmokeTest Scenario: GMBridge faction travel events
  // Validates:
  // - GMRuntime.forceFactionTravelEvent can schedule a guard fine.
  // - Travel events are delivered through the real integration path (GameAPI.moveStep -> Movement.tryMove -> GMBridge.maybeHandleWorldStep).
  //   NOTE: core/world/move.js calls the imported GMBridge module directly, so patching window.GMBridge won't intercept.
  //   This scenario detects delivery by wrapping UIOrchestration.showConfirm (which GMBridge calls at runtime).
  // - Pressing Escape cancels the confirm without crashing.
  // - GM encounter travel intents enter encounter mode (gm_bandit_bounty, gm_troll_hunt).
  // - Encounter can exit deterministically via GameAPI.completeEncounter("withdraw").
  // - Phase-2 strengthening: ctx-first + sync-boundary closure is enforced with instrumentation.

  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  async function run(ctx) {
    const record = (ctx && ctx.record) || function () {};
    const recordSkip = (ctx && ctx.recordSkip) || function () {};
    const sleep = (ctx && ctx.sleep) || (ms => new Promise(r => setTimeout(r, ms | 0)));

    const G = window.GameAPI || null;
    if (!G || !has(G.getCtx) || !has(G.getMode) || !has(G.moveStep)) {
      recordSkip("GM bridge faction travel skipped (GameAPI not available)");
      return true;
    }

    const GM = window.GMRuntime || null;
    const GMB = window.GMBridge || null;
    const UIO = window.UIOrchestration || null;
    const CM = window.ConfirmModal || null;

    record(!!GM, "GMRuntime is available");
    record(!!GMB, "GMBridge is available");
    if (!GM || !has(GM.forceFactionTravelEvent) || !UIO || !has(UIO.showConfirm)) {
      recordSkip("GM bridge faction travel skipped (GMRuntime.forceFactionTravelEvent or UIOrchestration.showConfirm missing)");
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

    const acceptConfirmOk = async () => {
      const opened = await waitUntil(() => isConfirmOpen(), 2000, 80);
      if (!opened) return false;
      try {
        const ev = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true });
        window.dispatchEvent(ev);
        document.dispatchEvent(ev);
      } catch (_) {}
      await sleep(120);
      await waitUntil(() => !isConfirmOpen(), 2000, 80);
      return !isConfirmOpen();
    };

    const ensureWorld = async () => {
      const mode = has(G.getMode) ? G.getMode() : "";
      if (mode === "world") return true;
      if (mode === "encounter") {
        try {
          if (has(G.completeEncounter)) G.completeEncounter("withdraw");
        } catch (_) {}
        await waitUntilMode("world", 5000);
      }
      const mode2 = has(G.getMode) ? G.getMode() : "";
      if (mode2 === "world") return true;
      try {
        if (has(G.forceWorld)) G.forceWorld();
      } catch (_) {}
      await waitUntilMode("world", 2000);
      return (has(G.getMode) ? G.getMode() : "") === "world";
    };

    const absWorldPosFromCtx = (c) => {
      try {
        const w = c && c.world ? c.world : null;
        const p = c && c.player ? c.player : null;
        const ox = (w && typeof w.originX === "number") ? (w.originX | 0) : 0;
        const oy = (w && typeof w.originY === "number") ? (w.originY | 0) : 0;
        const lx = p && typeof p.x === "number" ? (p.x | 0) : 0;
        const ly = p && typeof p.y === "number" ? (p.y | 0) : 0;
        return { x: (ox + lx) | 0, y: (oy + ly) | 0 };
      } catch (_) {
        return { x: 0, y: 0 };
      }
    };

    const absWorldPosNow = () => {
      try {
        const c = has(G.getCtx) ? G.getCtx() : null;
        return absWorldPosFromCtx(c);
      } catch (_) {
        return { x: 0, y: 0 };
      }
    };

    const absWorldPosEq = (a, b) => {
      try {
        return !!(a && b && (a.x | 0) === (b.x | 0) && (a.y | 0) === (b.y | 0));
      } catch (_) {
        return false;
      }
    };

    const pickWalkableMoveDirs = () => {
      const dirs = [
        { dx: 1, dy: 0, name: "E" },
        { dx: -1, dy: 0, name: "W" },
        { dx: 0, dy: 1, name: "S" },
        { dx: 0, dy: -1, name: "N" },
      ];
      try {
        const p = has(G.getPlayer) ? G.getPlayer() : null;
        const w = has(G.getWorld) ? G.getWorld() : null;
        if (!p || !w || !Array.isArray(w.map) || !w.map.length) return dirs;
        const rows = w.map.length | 0;
        const cols = (w.map[0] ? w.map[0].length : 0) | 0;
        const out = [];
        for (const d of dirs) {
          const nx = (p.x | 0) + (d.dx | 0);
          const ny = (p.y | 0) + (d.dy | 0);
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          let walk = true;
          try {
            if (has(G.isWalkableOverworld)) {
              walk = !!G.isWalkableOverworld(nx, ny);
            } else if (typeof window !== "undefined" && window.World && typeof window.World.isWalkable === "function") {
              const t = w.map[ny] ? w.map[ny][nx] : null;
              walk = (t != null) ? !!window.World.isWalkable(t) : true;
            }
          } catch (_) {
            walk = true;
          }
          if (walk) out.push(d);
        }
        return out.length ? out : dirs;
      } catch (_) {
        return dirs;
      }
    };

    const patchMethod = (obj, key, wrap) => {
      try {
        if (!obj || !key || typeof obj[key] !== "function") return null;
        const orig = obj[key];
        obj[key] = wrap(orig);
        return () => { obj[key] = orig; };
      } catch (_) {
        return null;
      }
    };

    const installConfirmProbe = () => {
      const probe = { calls: 0, lastCtx: null };
      const restore = patchMethod(UIO, "showConfirm", (orig) => function () {
        probe.calls++;
        try { probe.lastCtx = arguments[0] || null; } catch (_) {}
        return orig.apply(this, arguments);
      });
      return { probe, restore: restore || function () {} };
    };

    const deliverTravelEventViaMoveStep = async (label, timeoutMs, confirmProbe) => {
      const beforeConfirm = confirmProbe ? (confirmProbe.calls | 0) : 0;

      const dirs = pickWalkableMoveDirs();
      const tries = Math.min(4, dirs.length | 0);

      for (let i = 0; i < tries; i++) {
        const d = dirs[i];
        try { G.moveStep(d.dx, d.dy); } catch (_) {}
        await sleep(80);
        if (confirmProbe && (confirmProbe.calls | 0) > beforeConfirm) {
          record(true, `${label}: delivered via moveStep (${d.name})`);
          break;
        }
      }

      const delivered = confirmProbe ? ((confirmProbe.calls | 0) > beforeConfirm) : false;
      const opened = await waitUntil(() => isConfirmOpen(), Math.max(200, timeoutMs | 0), 80);
      const worldStepCtx = confirmProbe ? confirmProbe.lastCtx : null;

      return { delivered, opened: !!opened, worldStepCtx, confirmCallsDelta: (confirmProbe ? ((confirmProbe.calls | 0) - beforeConfirm) : 0) };
    };

    const inWorld = await ensureWorld();
    if (!inWorld) {
      recordSkip("GM bridge faction travel skipped (not in world mode)");
      return true;
    }

    const worldCtx0 = G.getCtx();

    try {
      // Ensure player has enough gold so the guard-fine confirm can show.
      try {
        const inv = (worldCtx0.player && Array.isArray(worldCtx0.player.inventory)) ? worldCtx0.player.inventory : (worldCtx0.player.inventory = []);
        let gold = inv.find(it => it && String(it.kind || it.type || "").toLowerCase() === "gold");
        if (!gold) { gold = { kind: "gold", amount: 0, name: "gold" }; inv.push(gold); }
        if (typeof gold.amount !== "number") gold.amount = 0;
        if (gold.amount < 500) gold.amount = 500;
        if (typeof worldCtx0.updateUI === "function") worldCtx0.updateUI();
      } catch (_) {}

      // Guard fine: schedule, deliver via moveStep, then cancel with Escape.
      {
        await ensureWorld();

        // Ensure a stale confirm modal isn't already open (would invalidate the check).
        try { if (UIO && has(UIO.cancelConfirm)) UIO.cancelConfirm(G.getCtx()); } catch (_) {}
        await waitUntil(() => !isConfirmOpen(), 800, 80);

        const { probe: confirmProbe, restore } = installConfirmProbe();
        try {
          let forced = null;
          try { forced = GM.forceFactionTravelEvent(G.getCtx(), "guard_fine"); } catch (_) { forced = null; }
          record(!!forced, "GMRuntime.forceFactionTravelEvent returns an intent (guard_fine)");

          const res = await deliverTravelEventViaMoveStep("guard fine", 2000, confirmProbe);
          record(res.delivered, `Guard fine delivered via UIOrchestration.showConfirm (callsDelta=${res.confirmCallsDelta})`);

          const canCheck = !!(CM && has(CM.isOpen));
          if (!canCheck) {
            record(true, "ConfirmModal.isOpen not available; cannot assert modal open state (non-fatal)");
          } else {
            await sleep(150);
            const open1 = !!CM.isOpen();
            record(open1, "ConfirmModal opened for guard fine");
            if (open1) {
              try {
                const ev = new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true });
                window.dispatchEvent(ev);
              } catch (_) {}
              await sleep(150);
              const open2 = !!CM.isOpen();
              record(!open2, "Pressing Escape closes the confirm without crashing");
            }
          }

          record(res.opened || !canCheck, `Guard fine delivery produced confirm UI when detectable (opened=${res.opened})`);
        } finally {
          try { restore(); } catch (_) {}
          try { if (UIO && has(UIO.cancelConfirm)) UIO.cancelConfirm(G.getCtx()); } catch (_) {}
        }

        const modeAfter = has(G.getMode) ? G.getMode() : "";
        record(modeAfter === "world", `Mode remains world after cancel (mode=${modeAfter})`);
      }

      // GM encounter travel events -> encounter mode -> withdraw -> world.
      if (!has(G.completeEncounter)) {
        recordSkip("GM encounter travel skipped (GameAPI.completeEncounter missing)");
        return true;
      }

      const waitForEncounterTemplate = async (id) => {
        try {
          const GD = (typeof window !== "undefined" ? window.GameData : null);
          if (GD && GD.ready && typeof GD.ready.then === "function") {
            let settled = false;
            try { GD.ready.then(() => { settled = true; }, () => { settled = true; }); } catch (_) { settled = true; }
            await waitUntil(() => settled, 15000, 80);
          }

          const want = String(id || "").toLowerCase();
          if (!want) return false;

          return await waitUntil(() => {
            try {
              const GD2 = (typeof window !== "undefined" ? window.GameData : null);
              const reg = GD2 && GD2.encounters && Array.isArray(GD2.encounters.templates) ? GD2.encounters.templates : [];
              return !!reg.find(t => t && String(t.id || "").toLowerCase() === want);
            } catch (_) {
              return false;
            }
          }, 12000, 80);
        } catch (_) {
          return false;
        }
      };

      const encounterIntents = ["gm_bandit_bounty", "gm_troll_hunt"];
      for (const intent of encounterIntents) {
        await ensureWorld();

        const encReady = await (ctx && typeof ctx.waitForEncounterTemplate === "function" ? ctx.waitForEncounterTemplate(intent) : waitForEncounterTemplate(intent));
        record(encReady, `Encounter template '${intent}' loaded`);
        if (!encReady) {
          // Missing templates should surface as a real failure.
          return true;
        }

        // Ensure any confirm modal isn't interfering.
        try { if (UIO && has(UIO.cancelConfirm)) UIO.cancelConfirm(G.getCtx()); } catch (_) {}
        await waitUntil(() => !isConfirmOpen(), 800, 80);

        // Instrumentation: ctx-first + sync boundary closure during accept-confirm -> enter encounter.
        const { probe: confirmProbe, restore: restoreConfirmProbe } = installConfirmProbe();
        let worldStepCtx = null;
        let applySyncCalls = 0;
        let gameApiEnterCalls = 0;
        let modesEnterCalls = 0;
        let modesCtxOk = true;

        const restores = [];

        try {
          // Patch GameAPI.applyCtxSyncAndRefresh to ensure exactly 1 call on entry.
          const r1 = patchMethod(G, "applyCtxSyncAndRefresh", (orig) => function () {
            applySyncCalls++;
            return orig.apply(this, arguments);
          });
          if (r1) restores.push(r1);

          // Patch GameAPI.enterEncounter (should not be used by GMBridge travel encounters).
          if (typeof G.enterEncounter === "function") {
            const r2 = patchMethod(G, "enterEncounter", (orig) => function () {
              gameApiEnterCalls++;
              return orig.apply(this, arguments);
            });
            if (r2) restores.push(r2);
          }

          // Patch Modes.enterEncounter to assert ctx-first.
          const Modes = (typeof window !== "undefined") ? window.Modes : null;
          if (Modes && typeof Modes.enterEncounter === "function") {
            const r3 = patchMethod(Modes, "enterEncounter", (orig) => function () {
              modesEnterCalls++;
              const c0 = arguments && arguments.length ? arguments[0] : null;
              if (worldStepCtx && c0 !== worldStepCtx) {
                modesCtxOk = false;
              }
              return orig.apply(this, arguments);
            });
            if (r3) restores.push(r3);
          }

          // Force the encounter intent, then deliver it through a real world step.
          let forced2 = null;
          try { forced2 = GM.forceFactionTravelEvent(G.getCtx(), intent); } catch (_) { forced2 = null; }
          record(!!forced2, `GMRuntime.forceFactionTravelEvent returns an intent (${intent})`);

          const res = await deliverTravelEventViaMoveStep(`travel encounter ${intent}`, 2000, confirmProbe);
          worldStepCtx = res.worldStepCtx;

          record(res.delivered, `Travel event delivered via UIOrchestration.showConfirm (${intent}) (callsDelta=${res.confirmCallsDelta})`);
          record(!!worldStepCtx, `Captured world-step ctx for travel event (${intent})`);

          record(res.opened, `ConfirmModal opened for travel encounter (${intent})`);

          const absPre = absWorldPosNow();
          record(true, `Abs world pos snapshot pre-confirm (${intent}): (${absPre.x},${absPre.y})`);

          // Reset counts for the accept-confirm -> encounter transition window.
          applySyncCalls = 0;
          gameApiEnterCalls = 0;
          modesEnterCalls = 0;
          modesCtxOk = true;

          if (res.opened) {
            await acceptConfirmOk();
          }

          const entered = await waitUntilMode("encounter", 3500);
          const modeNow = has(G.getMode) ? G.getMode() : "";
          record(entered && modeNow === "encounter", `Mode enters encounter (${intent}) (mode=${modeNow})`);

          record(applySyncCalls === 1, `GameAPI.applyCtxSyncAndRefresh called exactly once during encounter entry (${intent}) (calls=${applySyncCalls})`);
          record(gameApiEnterCalls === 0, `GameAPI.enterEncounter not called during travel encounter entry (${intent}) (calls=${gameApiEnterCalls})`);
          record(modesEnterCalls > 0, `Modes.enterEncounter called during travel encounter entry (${intent}) (calls=${modesEnterCalls})`);
          record(modesEnterCalls > 0 && modesCtxOk, `Modes.enterEncounter called with the exact world-step ctx (${intent})`);

          let withdrew = false;
          try { withdrew = !!G.completeEncounter("withdraw"); } catch (_) { withdrew = false; }
          record(withdrew, `CompleteEncounter(withdraw) exits encounter (${intent})`);

          const returned = await waitUntilMode("world", 5000);
          const modeAfterWithdraw = has(G.getMode) ? G.getMode() : "";
          record(returned && modeAfterWithdraw === "world", `Returned to world after withdraw (${intent}) (mode=${modeAfterWithdraw})`);

          const absPost = absWorldPosNow();
          record(absWorldPosEq(absPre, absPost), `Abs world pos unchanged after withdraw (${intent}) (before=(${absPre.x},${absPre.y}) after=(${absPost.x},${absPost.y}))`);
        } finally {
          try { restoreConfirmProbe(); } catch (_) {}
          for (const r of restores) {
            try { r(); } catch (_) {}
          }
          try { if (UIO && has(UIO.cancelConfirm)) UIO.cancelConfirm(G.getCtx()); } catch (_) {}
          await ensureWorld();
        }
      }

      return true;
    } finally {
      // Best-effort cleanup so subsequent scenarios start from world mode.
      await ensureWorld();
      try { if (UIO && has(UIO.cancelConfirm)) UIO.cancelConfirm(G.getCtx()); } catch (_) {}
    }
  }

  window.SmokeTest.Scenarios.gm_bridge_faction_travel = { run };
})();
