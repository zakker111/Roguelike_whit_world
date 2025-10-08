// SmokeTest DOM helpers (banner, status, panel updates)
(function () {
  function ensureBanner() {
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
    el.style.background = "rgba(21,22,27,0.9)";
    el.style.color = "#d6deeb";
    el.style.border = "1px solid rgba(122,162,247,0.35)";
    el.style.borderRadius = "8px";
    el.style.boxShadow = "0 10px 24px rgba(0,0,0,0.5)";
    el.textContent = "[SMOKE] Runner ready…";
    document.body.appendChild(el);
    return el;
  }
  function ensureStatusEl() {
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
  }
  function panelReport(html) {
    try {
      const el = document.getElementById("god-check-output");
      if (el) el.innerHTML = html;
      ensureStatusEl();
    } catch (_) {}
  }
  function appendToPanel(html) {
    try {
      const el = document.getElementById("god-check-output");
      if (el) el.innerHTML += html;
    } catch (_) {}
  }
  window.SmokeDOM = { ensureBanner, ensureStatusEl, panelReport, appendToPanel };
})();