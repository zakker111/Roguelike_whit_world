// Generic utilities for smoketest
// Exposes window.SmokeUtil with: sleep, makeBudget, waitUntilTrue, safe helpers and input helpers

(function () {
  if (window.SmokeUtil) return;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function makeBudget(ms) {
    const start = Date.now();
    const deadline = start + Math.max(0, ms | 0);
    return {
      exceeded: () => Date.now() > deadline,
      remain: () => Math.max(0, deadline - Date.now())
    };
  }

  async function waitUntilTrue(fn, timeoutMs = 400, intervalMs = 40) {
    const deadline = Date.now() + Math.max(0, timeoutMs | 0);
    while (Date.now() < deadline) {
      try { if (fn()) return true; } catch (_) {}
      await sleep(intervalMs);
    }
    return fn();
  }

  function hasEl(id) { return !!document.getElementById(id); }
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

  function key(code) {
    try {
      const ev = new KeyboardEvent("keydown", { key: code, code, bubbles: true });
      window.dispatchEvent(ev);
      document.dispatchEvent(ev);
    } catch (_) {}
  }

  function isPanelOpen(id) {
    try {
      const el = document.getElementById(id);
      return !!(el && el.hidden === false);
    } catch (_) { return false; }
  }
  function isInvOpen() { try { if (window.UI?.isInventoryOpen) return !!UI.isInventoryOpen(); } catch (_) {} return isPanelOpen("inv-panel"); }
  function isGodOpen() { try { if (window.UI?.isGodOpen) return !!UI.isGodOpen(); } catch (_) {} return isPanelOpen("god-panel"); }

  async function ensureAllModalsClosed(maxTries = 6) {
    const isOpenById = (id) => {
      try { const el = document.getElementById(id); return !!(el && el.hidden === false); } catch (_) { return false; }
    };
    const anyOpen = () => isOpenById("god-panel") || isOpenById("inv-panel") || isOpenById("shop-panel") || isOpenById("loot-panel");

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
      try { const btn = document.getElementById("god-close-btn"); if (btn) { btn.click(); await sleep(120); } } catch (_) {}
    }
    return !anyOpen();
  }

  window.SmokeUtil = {
    sleep, makeBudget, waitUntilTrue,
    hasEl, safeClick, safeSetInput, key,
    isInvOpen, isGodOpen, ensureAllModalsClosed
  };
})();