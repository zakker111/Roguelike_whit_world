// SmokeTest status/log helpers
(function () {
  function currentMode() {
    try {
      if (window.GameAPI && typeof window.GameAPI.getMode === "function") {
        return String(window.GameAPI.getMode() || "").toLowerCase();
      }
    } catch (_) {}
    return "";
  }
  function setStatus(msg) {
    try {
      const el = document.getElementById("smoke-status");
      const m = currentMode();
      if (el) el.textContent = `[${m || "unknown"}] ${msg}`;
    } catch (_) {}
  }
  function log(msg, type) {
    try {
      const banner = document.getElementById("smoke-banner") || (window.SmokeDOM && window.SmokeDOM.ensureBanner && window.SmokeDOM.ensureBanner());
      const m = currentMode();
      const line = "[SMOKE]" + (m ? ` [${m}]` : "") + " " + msg;
      if (banner) banner.textContent = line;
      if (window.SmokeDOM && typeof window.SmokeDOM.ensureStatusEl === "function") window.SmokeDOM.ensureStatusEl();
      setStatus(msg);
      if (window.Logger && typeof Logger.log === "function") Logger.log(line, type || "info");
      console.log(line);
    } catch (_) {
      try { console.log("[SMOKE] " + msg); } catch (_) {}
    }
  }
  window.SmokeStatus = { currentMode, setStatus, log };
})();