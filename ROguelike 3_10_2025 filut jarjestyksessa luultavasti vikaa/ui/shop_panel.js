/**
 * ShopUI: shop panel controls (step 3).
 * Centralizes shop rendering and buying logic, used by core/game.js.
 */
(function () {
  var _stock = null;

  function ensurePanel() {
    try {
      var el = document.getElementById("shop-panel");
      if (el) return el;
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

  function isOpen() {
    try {
      var el = document.getElementById("shop-panel");
      return !!(el && el.hidden === false);
    } catch (_) { return false; }
  }

  function priceFor(item) {
    try {
      if (!item) return 10;
      if (item.kind === "potion") {
        var h = item.heal != null ? item.heal : 5;
        return Math.max(5, Math.min(50, Math.round(h * 2)));
      }
      var base = (item.atk || 0) * 10 + (item.def || 0) * 10;
      var tier = (item.tier || 1);
      return Math.max(15, Math.round(base + tier * 15));
    } catch (_) { return 10; }
  }

  function cloneItem(it) {
    try { return JSON.parse(JSON.stringify(it)); } catch (_) {}
    try { return Object.assign({}, it); } catch (_) {}
    return it;
  }

  function render(ctx) {
    var el = ensurePanel();
    if (!el) return;
    el.hidden = false;
    var goldDiv = el.querySelector("#shop-gold");
    var listDiv = el.querySelector("#shop-list");

    try {
      var gold = 0;
      var inv = ctx.player && ctx.player.inventory ? ctx.player.inventory : [];
      for (var i = 0; i < inv.length; i++) {
        var it = inv[i];
        if (it && it.kind === "gold" && typeof it.amount === "number") { gold = it.amount; break; }
      }
      if (goldDiv) goldDiv.textContent = "Gold: " + gold;
    } catch (_) {}

    if (!listDiv) return;
    if (!_stock || !_stock.length) {
      listDiv.innerHTML = '<div style="color:#94a3b8;">No items for sale.</div>';
      return;
    }

    try {
      listDiv.innerHTML = _stock.map(function (row, idx) {
        var name = (ctx.describeItem ? ctx.describeItem(row.item) : (row.item && row.item.name) || "item");
        var p = row.price | 0;
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #1f2937;">' +
               '<div>' + name + ' — <span style="color:#93c5fd;">' + p + 'g</span></div>' +
               '<button data-idx="' + idx + '" style="padding:4px 8px;background:#243244;color:#e5e7eb;border:1px solid #334155;border-radius:4px;cursor:pointer;">Buy</button>' +
               '</div>';
      }).join("");
      var buttons = listDiv.querySelectorAll("button[data-idx]");
      for (var j = 0; j < buttons.length; j++) {
        (function (btn) {
          btn.onclick = function () {
            try {
              var i = Number(btn.getAttribute("data-idx") || -1);
              ShopUI.buyIndex(ctx, i);
            } catch (_) {}
          };
        })(buttons[j]);
      }
    } catch (_) {}
  }

  function openForNPC(ctx, npc) {
    try {
      var stock = [];
      // Potions
      stock.push({ item: { kind: "potion", heal: 5, count: 1, name: "potion (+5 HP)" }, price: 10 });
      stock.push({ item: { kind: "potion", heal: 10, count: 1, name: "potion (+10 HP)" }, price: 18 });

      // Equipment via Items registry when available
      try {
        if (ctx.Items && typeof ctx.Items.createEquipment === "function") {
          var t1 = ctx.Items.createEquipment(1, ctx.rng);
          var t2 = ctx.Items.createEquipment(2, ctx.rng);
          if (t1) stock.push({ item: t1, price: priceFor(t1) });
          if (t2) stock.push({ item: t2, price: priceFor(t2) });
        } else {
          var s = { kind: "equip", slot: "left", name: "simple sword", atk: 1.5, tier: 1, decay: (ctx.initialDecay ? ctx.initialDecay(1) : 0) };
          var a = { kind: "equip", slot: "torso", name: "leather armor", def: 1.0, tier: 1, decay: (ctx.initialDecay ? ctx.initialDecay(1) : 0) };
          stock.push({ item: s, price: priceFor(s) });
          stock.push({ item: a, price: priceFor(a) });
        }
      } catch (_) {}

      _stock = stock;
      render(ctx);
      try { ctx.requestDraw(); } catch (_) {}
    } catch (_) {}
  }

  function buyIndex(ctx, idx) {
    try {
      if (!_stock || idx < 0 || idx >= _stock.length) return;
      var row = _stock[idx];
      var cost = row.price | 0;
      var inv = ctx.player && ctx.player.inventory ? ctx.player.inventory : [];
      var goldObj = null;
      var cur = 0;
      for (var i = 0; i < inv.length; i++) {
        var it = inv[i];
        if (it && it.kind === "gold") { goldObj = it; cur = (typeof it.amount === "number") ? it.amount : 0; break; }
      }
      if (cur < cost) {
        try { ctx.log("You don't have enough gold.", "warn"); } catch (_) {}
        render(ctx);
        return;
      }

      var copy = cloneItem(row.item);
      if (!goldObj) { goldObj = { kind: "gold", amount: 0, name: "gold" }; inv.push(goldObj); }
      goldObj.amount = (goldObj.amount | 0) - cost;

      if (copy.kind === "potion") {
        // Merge same potions
        var same = null;
        for (var j = 0; j < inv.length; j++) {
          var it2 = inv[j];
          if (it2 && it2.kind === "potion" && ((it2.heal || 0) === (copy.heal || 0))) { same = it2; break; }
        }
        if (same) same.count = (same.count || 1) + (copy.count || 1);
        else inv.push(copy);
      } else {
        inv.push(copy);
      }

      try { ctx.updateUI(); } catch (_) {}
      try { if (ctx.renderInventory) ctx.renderInventory(); } catch (_) {}
      try {
        var name = ctx.describeItem ? ctx.describeItem(copy) : (copy && copy.name) || "item";
        ctx.log("You bought " + name + " for " + cost + " gold.", "good");
      } catch (_) {}
      render(ctx);
      try { ctx.requestDraw(); } catch (_) {}
    } catch (_) {}
  }

  window.ShopUI = {
    ensurePanel: ensurePanel,
    hide: hide,
    isOpen: isOpen,
    openForNPC: openForNPC,
    buyIndex: buyIndex
  };
})();