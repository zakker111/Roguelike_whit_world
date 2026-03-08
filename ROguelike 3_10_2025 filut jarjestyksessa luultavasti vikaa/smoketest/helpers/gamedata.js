(function () {  // SmokeTest GameData helpers
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Helpers = window.SmokeTest.Helpers || {};

  function sleep(ms) {
    try {
      const D = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Dom;
      if (D && typeof D.sleep === "function") return D.sleep(ms);
    } catch (_) {}
    return new Promise(r => setTimeout(r, Math.max(0, ms | 0)));
  }

  async function waitUntilTrue(fn, timeoutMs, intervalMs) {
    try {
      const D = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Dom;
      if (D && typeof D.waitUntilTrue === "function") {
        return await D.waitUntilTrue(fn, timeoutMs, intervalMs);
      }
    } catch (_) {}

    const deadline = Date.now() + Math.max(0, timeoutMs | 0);
    const step = Math.max(20, intervalMs | 0);
    while (Date.now() < deadline) {
      try { if (fn()) return true; } catch (_) {}
      await sleep(step);
    }
    try { return !!fn(); } catch (_) { return false; }
  }

  async function waitForGameDataReady(timeoutMs = 15000) {
    try {
      const GD = (typeof window !== "undefined") ? window.GameData : null;
      if (!GD || !GD.ready || typeof GD.ready.then !== "function") return true;

      let settled = false;
      try {
        GD.ready.then(
          () => { settled = true; },
          () => { settled = true; }
        );
      } catch (_) {
        settled = true;
      }

      return await waitUntilTrue(() => settled, Math.max(250, timeoutMs | 0), 80);
    } catch (_) {
      return true;
    }
  }

  function getEncounterTemplates() {
    try {
      const GD = (typeof window !== "undefined") ? window.GameData : null;
      return (GD && GD.encounters && Array.isArray(GD.encounters.templates)) ? GD.encounters.templates : [];
    } catch (_) {
      return [];
    }
  }

  function hasEncounterTemplate(id) {
    try {
      const want = String(id || "").trim().toLowerCase();
      if (!want) return false;
      const reg = getEncounterTemplates();
      return !!reg.find(t => t && String(t.id || "").toLowerCase() === want);
    } catch (_) {
      return false;
    }
  }

  async function waitForEncounterTemplatesReady(opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    const settleTimeoutMs = (o.settleTimeoutMs != null) ? (o.settleTimeoutMs | 0) : 15000;
    const timeoutMs = (o.timeoutMs != null) ? (o.timeoutMs | 0) : 12000;
    const intervalMs = (o.intervalMs != null) ? (o.intervalMs | 0) : 80;

    await waitForGameDataReady(settleTimeoutMs);
    return await waitUntilTrue(() => getEncounterTemplates().length > 0, timeoutMs, intervalMs);
  }

  async function waitForEncounterTemplate(id, opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    const settleTimeoutMs = (o.settleTimeoutMs != null) ? (o.settleTimeoutMs | 0) : 15000;
    const timeoutMs = (o.timeoutMs != null) ? (o.timeoutMs | 0) : 12000;
    const intervalMs = (o.intervalMs != null) ? (o.intervalMs | 0) : 80;

    await waitForGameDataReady(settleTimeoutMs);
    return await waitUntilTrue(() => hasEncounterTemplate(id), timeoutMs, intervalMs);
  }

  window.SmokeTest.Helpers.GameData = {
    waitForGameDataReady,
    getEncounterTemplates,
    hasEncounterTemplate,
    waitForEncounterTemplatesReady,
    waitForEncounterTemplate
  };
})();
