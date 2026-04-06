(function () {
  // SmokeTest logging, banner, and panel helpers
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Helpers = window.SmokeTest.Helpers || {};

  const Logging = {
    ensureBanner() {
      let el = document.getElementById("smoke-banner");
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
      // Palette-driven banner styling (fallback to neutral)
      (function () {
        try {
          const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
          el.style.background = pal && pal.panelBg ? pal.panelBg : "rgba(21,22,27,0.9)";
          el.style.border = pal && pal.panelBorder ? pal.panelBorder : "1px solid rgba(122,162,247,0.35)";
          el.style.boxShadow = pal && pal.panelShadow ? pal.panelShadow : "0 10px 24px rgba(0,0,0,0.5)";
        } catch (_) {
          el.style.background = "rgba(21,22,27,0.9)";
          el.style.border = "1px solid rgba(122,162,247,0.35)";
          el.style.boxShadow = "0 10px 24px rgba(0,0,0,0.5)";
        }
      })();
      el.style.color = "#d6deeb";
      el.style.borderRadius = "8px";
      el.textContent = "[SMOKE] Runner ready…";
      document.body.appendChild(el);
      return el;
    },

    ensureStatusEl() {
      try {
        let host = document.getElementById("god-check-output");
        if (!host) return null;
        let el = document.getElementById("smoke-status");
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
      try {
        if (window.GameAPI && typeof window.GameAPI.getMode === "function") {
          return String(window.GameAPI.getMode() || "").toLowerCase();
        }
      } catch (_) {}
      return "";
    },

    setStatus(msg) {
      const m = Logging.currentMode();
      const el = Logging.ensureStatusEl();
      if (el) el.textContent = `[${m || "unknown"}] ${msg}`;
    },

    log(msg, type) {
      const banner = Logging.ensureBanner();
      const m = Logging.currentMode();
      const line = "[SMOKE]" + (m ? ` [${m}]` : "") + " " + msg;
      if (banner) banner.textContent = line;
      Logging.setStatus(msg);
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
      try {
        const el = document.getElementById("god-check-output");
        if (el) el.innerHTML = html;
        Logging.ensureStatusEl();
      } catch (_) {}
    },

    appendToPanel(html) {
      try {
        const el = document.getElementById("god-check-output");
        if (el) el.innerHTML += html;
      } catch (_) {}
    }
  };

  window.SmokeTest.Helpers.Logging = Logging;
})();