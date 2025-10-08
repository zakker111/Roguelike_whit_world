// SmokeTest DOM and interaction helpers: banners, logging, inputs, keys, waits.

(function () {
  function currentMode() {
    try {
      if (window.GameAPI && typeof window.GameAPI.getMode === "function") {
        return String(window.GameAPI.getMode() || "").toLowerCase();
      }
    } catch (_) {}
    return "";
  }

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

  function setStatus(msg) {
    const m = currentMode();
    const el = ensureStatusEl();
    if (el) el.textContent = `[${m || "unknown"}] ${msg}`;
  }

  function log(msg, type) {
    const banner = ensureBanner();
    const m = currentMode();
    const line = "[SMOKE]" + (m ? ` [${m}]` : "") + " " + msg;
    banner.textContent = line;
    setStatus(msg);
    try {
      if (window.Logger && typeof Logger.log === "function") {
        Logger.log(line, type || "info");
      }
    } catch (_) {}
    try { console.log(line); } catch (_) {}
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

  function key(code) {
    try {
      const ev = new KeyboardEvent("keydown", { key: code, code, bubbles: true });
      window.dispatchEvent(ev);
      document.dispatchEvent(ev);
    } catch (_) {}
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function waitUntilTrue(fn, timeoutMs = 400, intervalMs = 40) {
    const deadline = Date.now() + Math.max(0, timeoutMs | 0);
    while (Date.now() < deadline) {
      try { if (fn()) return true; } catch (_) {}
      await sleep(intervalMs);
    }
    return fn();
  }

  function safeClick(id) {
    const el = document.getElementById(id);
    if (!el) return false;
    try { el.click(); return true; } catch (_) { return false; }
  }

  function safeSetInput(id, v) {
    const el = document.getElementById(id);
    if (!el) return false;
    try {
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    } catch (_) { return false; }
  }

  function clickById(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error("Missing element #" + id);
    el.click();
  }

  function setInputValue(id, v) {
    const el = document.getElementById(id);
    if (!el) throw new Error("Missing input #" + id);
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function ensureAllModalsClosed(maxTries = 6) {
    const isOpenById = (id) => {
      try {
        const el = document.getElementById(id);
        return !!(el && el.hidden === false);
      } catch (_) { return false; }
    };
    const anyOpen = () => {
      return isOpenById("god-panel") || isOpenById("inv-panel") || isOpenById("shop-panel") || isOpenById("loot-panel");
    };
    try {
      if (window.UI) {
        try { typeof UI.hideGod === "function" && UI.hideGod(); } catch (_) {}
        try { typeof UI.hideInventory === "function" && UI.hideInventory(); } catch (_) {}
        try { typeof UI.hideShop === "function" && UI.hideShop(); } catch (_) {}
        try { typeof UI.hideLoot === "function" && UI.hideLoot(); } catch (_) {}
      }
    } catch (_) {}
    let tries = 0;
    while (anyOpen() && tries++ < maxTries) {
      try { document.activeElement && typeof document.activeElement.blur === "function" && document.activeElement.blur(); } catch (_) {}
      key("Escape");
      await sleep(160);
      if (anyOpen()) { key("Escape"); await sleep(140); }
      try {
        const btn = document.getElementById("god-close-btn");
        if (btn) { btn.click(); await sleep(120); }
      } catch (_) {}
    }
    return !anyOpen();
  }

  window.SmokeCore = window.SmokeCore || {};
  window.SmokeCore.Dom = {
    ensureBanner, ensureStatusEl, setStatus, log, panelReport, appendToPanel,
    key, sleep, waitUntilTrue, safeClick, safeSetInput, clickById, setInputValue, ensureAllModalsClosed
  };
})();