(function () {
  // SmokeTest Runner Banner helpers: status and banner text, runner-oriented
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Runner = window.SmokeTest.Runner || {};

  function getLogging() {
    try {
      return (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Logging) || null;
    } catch (_) { return null; }
  }

  const Banner = {
    ensureBanner() {
      const L = getLogging();
      if (L && typeof L.ensureBanner === "function") return L.ensureBanner();
      // Minimal fallback: reuse existing element if present; avoid styling duplication
      try { return document.getElementById("smoke-banner") || null; } catch (_) { return null; }
    },

    ensureStatusEl() {
      const L = getLogging();
      if (L && typeof L.ensureStatusEl === "function") return L.ensureStatusEl();
      try {
        var host = document.getElementById("god-check-output");
        if (!host) return null;
        var el = document.getElementById("smoke-status");
        if (!el) {
          el = document.createElement("div");
          el.id = "smoke-status";
          host.prepend(el);
        }
        return el;
      } catch (_) { return null; }
    },

    currentMode() {
      const L = getLogging();
      if (L && typeof L.currentMode === "function") return L.currentMode();
      try {
        if (window.GameAPI && typeof window.GameAPI.getMode === "function") {
          return String(window.GameAPI.getMode() || "").toLowerCase();
        }
      } catch (_) {}
      return "";
    },

    setStatus(msg) {
      const L = getLogging();
      if (L && typeof L.setStatus === "function") return L.setStatus(msg);
      const m = Banner.currentMode();
      const el = Banner.ensureStatusEl();
      if (el) el.textContent = "[" + (m || "unknown") + "] " + msg;
    },

    setBannerText(text) {
      const el = Banner.ensureBanner();
      if (el) { try { el.textContent = text; } catch (_) {} }
    },

    log(msg, type) {
      const L = getLogging();
      if (L && typeof L.log === "function") return L.log(msg, type);
      const el = Banner.ensureBanner();
      const m = Banner.currentMode();
      const line = "[SMOKE]" + (m ? " [" + m + "]" : "") + " " + msg;
      if (el) el.textContent = line;
      Banner.setStatus(msg);
      try {
        if (window.GameAPI && typeof window.GameAPI.log === "function") {
          window.GameAPI.log(line, type || "info");
        } else if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") {
          window.Logger.log(line, type || "info");
        }
      } catch (_) {}
      try { console.log(line); } catch (_) {}
    },

    panelReport(html) {
      const L = getLogging();
      if (L && typeof L.panelReport === "function") return L.panelReport(html);
      try {
        var el = document.getElementById("god-check-output");
        if (el) el.innerHTML = html;
        Banner.ensureStatusEl();
      } catch (_) {}
    },

    appendToPanel(html) {
      const L = getLogging();
      if (L && typeof L.appendToPanel === "function") return L.appendToPanel(html);
      try {
        var el = document.getElementById("god-check-output");
        if (el) el.innerHTML += html;
      } catch (_) {}
    }
  };

  window.SmokeTest.Runner.Banner = Banner;
})();