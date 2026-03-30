(function () {
  // SmokeTest Scenario: GM panel smoke
  // Validates:
  // - GMPanel can open/close.
  // - Panel DOM exists and contains core snapshot fields.

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
      recordSkip("GM panel smoke skipped (GameAPI not available)");
      return true;
    }

    const GMP = (typeof window !== "undefined") ? window.GMPanel : null;
    if (!GMP || !has(GMP.show) || !has(GMP.hide)) {
      recordSkip("GM panel smoke skipped (GMPanel not available)");
      return true;
    }

    let opened = false;

    try {
      // Close blocking modals first (best-effort)
      try { if (window.UIOrchestration && has(window.UIOrchestration.cancelConfirm)) window.UIOrchestration.cancelConfirm({}); } catch (_) {}
      try { if (window.UIOrchestration && has(window.UIOrchestration.hideGod)) window.UIOrchestration.hideGod({}); } catch (_) {}
      try { if (window.UIOrchestration && has(window.UIOrchestration.hideInventory)) window.UIOrchestration.hideInventory({}); } catch (_) {}
      try { if (window.UIOrchestration && has(window.UIOrchestration.hideShop)) window.UIOrchestration.hideShop({}); } catch (_) {}
      try { if (window.UIOrchestration && has(window.UIOrchestration.hideLoot)) window.UIOrchestration.hideLoot({}); } catch (_) {}
      try { if (window.UIOrchestration && has(window.UIOrchestration.hideSmoke)) window.UIOrchestration.hideSmoke({}); } catch (_) {}
      try { if (window.UIOrchestration && has(window.UIOrchestration.hideConfirm)) window.UIOrchestration.hideConfirm({}); } catch (_) {}

      // Open
      try { GMP.show(); opened = true; } catch (_) { opened = false; }

      const panelVisible = await waitUntil(() => {
        try {
          const el = document.getElementById("gm-panel");
          return !!(el && el.hidden === false);
        } catch (_) {
          return false;
        }
      }, 2500, 80);

      record(opened && panelVisible, "GM panel smoke: GMPanel.show opens #gm-panel");

      // Snapshot content check (lightweight, no strict formatting assumptions)
      const hasRngLine = await waitUntil(() => {
        try {
          const el = document.querySelector("#gm-panel .gm-panel-profile");
          const txt = el ? String(el.textContent || "") : "";
          return txt.includes("gm.rng:");
        } catch (_) {
          return false;
        }
      }, 2500, 80);

      record(hasRngLine, "GM panel smoke: profile contains gm.rng line");

      return true;
    } catch (e) {
      record(false, "GM panel smoke scenario failed: " + (e && e.message ? e.message : String(e)));
      return true;
    } finally {
      try { if (opened) GMP.hide(); } catch (_) {}
    }
  }

  window.SmokeTest.Scenarios.gm_panel_smoke = { run };
})();
