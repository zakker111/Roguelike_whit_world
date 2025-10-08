(function () {  // SmokeTest DOM/interaction helpers
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Helpers = window.SmokeTest.Helpers || {};

  const Dom = {
    sleep(ms) {
      try { return new Promise(resolve => setTimeout(resolve, Math.max(0, ms | 0))); }
      catch (_) { return Promise.resolve(); }
    },

    async waitUntilTrue(fn, timeoutMs = 400, intervalMs = 40) {
      const deadline = Date.now() + Math.max(0, timeoutMs | 0);
      while (Date.now() < deadline) {
        try { if (fn()) return true; } catch (_) {}
        await Dom.sleep(intervalMs);
      }
      try { return !!fn(); } catch (_) { return false; }
    },

    hasEl(id) {
      try { return !!document.getElementById(id); }
      catch (_) { return false; }
    },

    safeClick(id) {
      try {
        const el = document.getElementById(id);
        if (!el) return false;
        try { el.click(); return true; } catch (_) { return false; }
      } catch (_) { return false; }
    },

    safeSetInput(id, v) {
      try {
        const el = document.getElementById(id);
        if (!el) return false;
        el.value = String(v);
        try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch (_) {}
        try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch (_) {}
        return true;
      } catch (_) { return false; }
    },

    key(code) {
      try {
        const ev = new KeyboardEvent("keydown", { key: code, code, bubbles: true });
        try { window.dispatchEvent(ev); } catch (_) {}
        try { document.dispatchEvent(ev); } catch (_) {}
        return true;
      } catch (_) { return false; }
    }
  };

  window.SmokeTest.Helpers.Dom = Dom;
})();
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