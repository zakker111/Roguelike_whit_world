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

      const hasOrchestratorSection = await waitUntil(() => {
        try {
          const el = document.querySelector("#gm-panel .gm-panel-orchestrator");
          const txt = el ? String(el.textContent || "") : "";
          return txt.includes("gm.rng:") && txt.includes("gm.scheduler:");
        } catch (_) {
          return false;
        }
      }, 2500, 80);

      record(hasOrchestratorSection, "GM panel smoke: orchestrator section shows GM RNG and scheduler");

      const hasQuestSection = await waitUntil(() => {
        try {
          const el = document.querySelector("#gm-panel .gm-panel-quests");
          const txt = el ? String(el.textContent || "") : "";
          return txt.includes("Bottle Map:") && (txt.includes("Survey Cache:") || txt.includes("No active quest threads."));
        } catch (_) {
          return false;
        }
      }, 2500, 80);

      record(hasQuestSection, "GM panel smoke: quest section shows Bottle Map and quest summary");

      let persistedSectionState = false;
      try {
        const toggle = document.querySelector('#gm-panel [data-gm-section-toggle="quests"]');
        const body = document.querySelector('#gm-panel [data-gm-section-body="quests"]');
        if (toggle && body) {
          toggle.click();
          const collapsed = await waitUntil(() => {
            try {
              const inner = document.querySelector('#gm-panel [data-gm-section-body="quests"]');
              return !!(inner && inner.hidden === true);
            } catch (_) {
              return false;
            }
          }, 1500, 60);

          let hasPrefs = false;
          try {
            const rawPrefs = window.localStorage ? window.localStorage.getItem("GM_PANEL_PREFS_V1") : "";
            hasPrefs = !!(rawPrefs && rawPrefs.includes('"quests":false'));
          } catch (_) {
            hasPrefs = false;
          }

          try { GMP.hide(); } catch (_) {}
          try { GMP.show(); } catch (_) {}

          const stillCollapsed = await waitUntil(() => {
            try {
              const inner = document.querySelector('#gm-panel [data-gm-section-body="quests"]');
              return !!(inner && inner.hidden === true);
            } catch (_) {
              return false;
            }
          }, 2000, 80);

          persistedSectionState = collapsed && hasPrefs && stillCollapsed;

          try {
            const reopenToggle = document.querySelector('#gm-panel [data-gm-section-toggle="quests"]');
            if (reopenToggle) reopenToggle.click();
          } catch (_) {}
        }
      } catch (_) {
        persistedSectionState = false;
      }

      record(persistedSectionState, "GM panel smoke: collapsed section persists via GM_PANEL_PREFS_V1");

      let persistedFilterState = false;
      try {
        const traitsToggle = document.querySelector('#gm-panel [data-gm-filter-toggle="traits"]');
        const mechToggle = document.querySelector('#gm-panel [data-gm-filter-toggle="mechanics"]');
        if (traitsToggle && mechToggle) {
          traitsToggle.click();
          mechToggle.click();

          const toggled = await waitUntil(() => {
            try {
              const t = document.querySelector('#gm-panel [data-gm-filter-toggle="traits"]');
              const m = document.querySelector('#gm-panel [data-gm-filter-toggle="mechanics"]');
              return !!(t && t.getAttribute("aria-pressed") === "true" && m && m.getAttribute("aria-pressed") === "true");
            } catch (_) {
              return false;
            }
          }, 1500, 60);

          let hasFilterPrefs = false;
          try {
            const rawPrefs = window.localStorage ? window.localStorage.getItem("GM_PANEL_PREFS_V1") : "";
            hasFilterPrefs = !!(rawPrefs && rawPrefs.includes('"showAllTraits":true') && rawPrefs.includes('"showAllMechanics":true'));
          } catch (_) {
            hasFilterPrefs = false;
          }

          try { GMP.hide(); } catch (_) {}
          try { GMP.show(); } catch (_) {}

          const persisted = await waitUntil(() => {
            try {
              const t = document.querySelector('#gm-panel [data-gm-filter-toggle="traits"]');
              const m = document.querySelector('#gm-panel [data-gm-filter-toggle="mechanics"]');
              return !!(t && t.getAttribute("aria-pressed") === "true" && m && m.getAttribute("aria-pressed") === "true");
            } catch (_) {
              return false;
            }
          }, 2000, 80);

          persistedFilterState = toggled && hasFilterPrefs && persisted;

          try {
            const traitsReset = document.querySelector('#gm-panel [data-gm-filter-toggle="traits"]');
            const mechReset = document.querySelector('#gm-panel [data-gm-filter-toggle="mechanics"]');
            if (traitsReset && traitsReset.getAttribute("aria-pressed") === "true") traitsReset.click();
            if (mechReset && mechReset.getAttribute("aria-pressed") === "true") mechReset.click();
          } catch (_) {}
        }
      } catch (_) {
        persistedFilterState = false;
      }

      record(persistedFilterState, "GM panel smoke: traits/mechanics filter toggles persist via GM_PANEL_PREFS_V1");

      let rawJsonBehavior = false;
      try {
        const rawToggle = document.querySelector('#gm-panel [data-gm-section-toggle="raw"]');
        const rawBody = document.querySelector('#gm-panel [data-gm-section-body="raw"]');
        if (rawToggle && rawBody) {
          const collapsedByDefault = rawBody.hidden === true;
          const emptyWhileCollapsed = String(rawBody.textContent || "").trim() === "";

          rawToggle.click();

          const expandedWithJson = await waitUntil(() => {
            try {
              const inner = document.querySelector('#gm-panel [data-gm-section-body="raw"]');
              const txt = inner ? String(inner.textContent || "").trim() : "";
              return !!(inner && inner.hidden === false && txt.startsWith("{"));
            } catch (_) {
              return false;
            }
          }, 2000, 80);

          rawJsonBehavior = collapsedByDefault && emptyWhileCollapsed && expandedWithJson;

          try {
            const rawReset = document.querySelector('#gm-panel [data-gm-section-toggle="raw"]');
            if (rawReset) rawReset.click();
          } catch (_) {}
        }
      } catch (_) {
        rawJsonBehavior = false;
      }

      record(rawJsonBehavior, "GM panel smoke: raw JSON section starts collapsed and renders on expand");

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
