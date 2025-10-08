(function () {  // SmokeTest DOM/interaction helpers
  window.SmokeTest = window.SmokeTest || {};  window.SmokeTest.Helpers = window.SmokeTest.Helpers || {};
  const Dom = {
    sleep(ms) {      try { return new Promise(resolve => setTimeout(resolve, Math.max(0, ms | 0))); } catch (_) { return Promise.resolve(); }
    },
    async waitUntilTrue(fn, timeoutMs = 400, intervalMs = 40) {      const deadline = Date.now() + Math.max(0, timeoutMs | 0);
      while (Date.now( < deadline) {
        try { if (fn()) return true; } catch (_) {}        await Dom.sleep(intervalMs);
      }      try { return !!fn(); } catch (_) { return false; }
    },
    hasEl(id) {      try { return !!document.getElementById(id); } catch (_) { return false; }
    },
    safeClick(id) {      const el = document.getElementById(id);
      if (!el) return false;      try { el.click(); return true; } catch (_) { return false; }
    },
    safeSetInput(id, v) {      const el = document.getElementById(id);
      if (!el) return