/**
 * smoketest/helpers/dom.js
 * DOM and input helpers used by the smoketest runner.
 */
(function () {
  const NS = (window.SmokeTest = window.SmokeTest || {});
  NS.Helpers = NS.Helpers || {};

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitUntilTrue(fn, timeoutMs = 400, intervalMs = 40) {
    const deadline = Date.now() + Math.max(0, timeoutMs | 0);
    while (Date.now() < deadline) {
      try {
        if (fn()) return true;
      } catch (_) {}
      await sleep(intervalMs);
    }
    return fn();
  }

  function hasEl(id) {
    return !!document.getElementById(id);
  }

  function safeClick(id) {
    const el = document.getElementById(id);
    if (!el) return false;
    try {
      el.click();
      return true;
    } catch (_) {
      return false;
    }
  }

  function safeSetInput(id, v) {
    const el = document.getElementById(id);
    if (!el) return false;
    try {
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    } catch (_) {
      return false;
    }
  }

  function key(code) {
    try {
      const ev = new KeyboardEvent("keydown", { key: code, code, bubbles: true });
      window.dispatchEvent(ev);
      document.dispatchEvent(ev);
    } catch (_) {}
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
      } catch (_) {
        return false;
      }
    };
    const anyOpen = () => {
      return (
        isOpenById("god-panel") ||
        isOpenById("inv-panel") ||
        isOpenById("shop-panel") ||
        isOpenById("loot-panel")
      );
    };
    // Try explicit UI API if available
    try {
      if (window.UI) {
        try {
          typeof UI.hideGod === "function" && UI.hideGod();
        } catch (_) {}
        try {
          typeof UI.hideInventory === "function" && UI.hideInventory();
        } catch (_) {}
        try {
          typeof UI.hideShop === "function" && UI.hideShop();
        } catch (_) {}
        try {
          typeof UI.hideLoot === "function" && UI.hideLoot();
        } catch (_) {}
      }
    } catch (_) {}
    // Fallback: ESC multiple times with waits
    let tries = 0;
    while (anyOpen() && tries++ < maxTries) {
      try {
        document.activeElement &&
          typeof document.activeElement.blur === "function" &&
          document.activeElement.blur();
      } catch (_) {}
      key("Escape");
      await sleep(160);
      if (anyOpen()) {
        key("Escape");
        await sleep(140);
      }
      try {
        const btn = document.getElementById("god-close-btn");
        if (btn) {
          btn.click();
          await sleep(120);
        }
      } catch (_) {}
    }
    return !anyOpen();
  }

  NS.Helpers.sleep = sleep;
  NS.Helpers.waitUntilTrue = waitUntilTrue;
  NS.Helpers.hasEl = hasEl;
  NS.Helpers.safeClick = safeClick;
  NS.Helpers.safeSetInput = safeSetInput;
  NS.Helpers.key = key;
  NS.Helpers.clickById = clickById;
  NS.Helpers.setInputValue = setInputValue;
  NS.Helpers.ensureAllModalsClosed = ensureAllModalsClosed;
})();