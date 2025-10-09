/**
 * ShopUI: minimal shop panel controls (step 1).
 * Provides hide() and ensurePanel() so core/game.js can delegate panel closing to UI.
 *
 * Future steps will add render(), show(), openForNPC(), buyIndex(), priceFor(), etc.
 */
(function () {
  function ensurePanel() {
    try {
      var el = document.getElementById("shop-panel");
      if (el) return el;
      // Create a minimal container so hide() has a target even before full UI is implemented
      el = document.createElement("div");
      el.id = "shop-panel";
      el.hidden = true;
      el.style.position = "fixed";
      el.style.left = "50%";
      el.style.top = "50%";
      el.style.transform = "translate(-50%,-50%)";
      el.style.zIndex = "9998";
      el.style.minWidth = "300px";
      el.style.maxWidth = "520px";
      el.style.maxHeight = "60vh";
      el.style.overflow = "auto";
      el.style.padding = "12px";
      el.style.background = "rgba(14, 18, 28, 0.95)";
      el.style.color = "#e5e7eb";
      el.style.border = "1px solid #334155";
      el.style.borderRadius = "8px";
      el.style.boxShadow = "0 10px 24px rgba(0,0,0,0.6)";
      // Minimal inner content; future steps will replace this
      el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><strong>Shop</strong><button id="shop-close-btn" style="padding:4px 8px;background:#1f2937;color:#e5e7eb;border:1px solid #334155;border-radius:4px;cursor:pointer;">Close</button></div><div id="shop-gold" style="margin-bottom:8px;color:#93c5fd;"></div><div id="shop-list"></div>';
      document.body.appendChild(el);
      try {
        var btn = el.querySelector("#shop-close-btn");
        if (btn) btn.onclick = function () {
          try { window.ShopUI && ShopUI.hide && ShopUI.hide(); } catch (_) {}
        };
      } catch (_) {}
      return el;
    } catch (_) {
      return null;
    }
  }

  function hide() {
    try {
      var el = document.getElementById("shop-panel");
      if (!el) el = ensurePanel();
      if (el) el.hidden = true;
    } catch (_) {}
  }

  window.ShopUI = {
    ensurePanel: ensurePanel,
    hide: hide
  };
})();