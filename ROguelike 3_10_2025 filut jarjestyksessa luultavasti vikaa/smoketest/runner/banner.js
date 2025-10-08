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
      // fallback: minimal banner
      try {
        var el = document.getElementById("smoke-banner");
        if (el) return el;
        el = document.createElement("div");
        el.id = "smoke-banner";
        el.style.position = "fixed";
        el.style.right = "12px";
        el.style.bottom = "12px";
        el.style.zIndex = "9999";
        el.style.padding = "8px 10px";
        el.style.fontFamily = "JetBrains Mono, monospace";
        el.style.fontSize = "12px";
        el.style.background = "rgba(21,22,27,0.9)";
        el.style.color = "#d6deeb";
        el.style.border = "1px solid rgba(122,162,247,0.35)";
        el.style.borderRadius = "8px";
        el.style.boxShadow = "0 10px 24px rgba(0,0,0,0.5)";
        el.textContent = "[SMOKE] Runner ready…";
        document.body.appendChild(el);
        return el;
      } catch (_) { return null; }
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
          el.style.margin = "6px 0";
          el.style.color = "#93c5fd";
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
      const banner = Banner.ensureBanner();
      const m = Banner.currentMode();
      const line = "[SMOKE]" + (m ? " [" + m + "]" : "") + " " + msg;
      if (banner) banner.textContent = line;
      Banner.setStatus(msg);
      try {
        if (window.Logger && typeof Logger.log === "function") Logger.log(line, type || "info");
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