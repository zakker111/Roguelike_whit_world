/**
 * ShopPanel: simple in-page shop UI (fallback) extracted from core/game.js.
 *
 * Exports (window.ShopPanel):
 * - openFor(ctx, npcOrShop)     // opens shop panel with generated stock near an NPC or a provided shop
 * - hide()                      // hides the panel
 * - isOpen()                    // returns whether the panel is currently visible
 *
 * Notes:
 * - This module depends on DOM only, and uses information supplied via ctx:
 *   ctx.player, ctx.log(msg,type), ctx.describeItem(item), ctx.updateUI(), ctx.renderInventory()
 * - Pricing logic is kept local and simple; real services can override by plugging into ctx.Items, etc.
 */
(function () {
  var currentShopStock = null; // [{item, price}]

  function ensureShopPanel() {
    var el = document.getElementById("shop-panel");
    if (el) return el;
    el = document.createElement("div");
    el.id = "shop-panel";
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
    el.innerHTML = '\n      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">\n        <strong>Shop</strong>\n        <button id="shop-close-btn" style="padding:4px 8px;background:#1f2937;color:#e5e7eb;border:1px solid #334155;border-radius:4px;cursor:pointer;">Close</button>\n      </div>\n      <div id="shop-gold" style="margin-bottom:8px;color:#93c5fd;"></div>\n      <div id="shop-list"></div>\n    ';
    document.body.appendChild(el);
    var btn = el.querySelector("#shop-close-btn");
    if (btn) btn.onclick = function () { hide(); };
    return el;
  }

  function isOpen() {
    var el = document.getElementById("shop-panel");
    return !!(el && el.hidden === false);
  }

  function hide() {
    var el = document.getElementById("shop-panel");
    if (el) el.hidden = true;
  }

  function priceFor(item) {
    if (!item) return 10;
    if (item.kind === "potion") {
      var h = item.heal != null ? item.heal : 5;
      return Math.max(5, Math.min(50, Math.round(h * 2)));
    }
    var base = (item.atk || 0) * 10 + (item.def || 0) * 10;
    var tier = (item.tier || 1);
    return Math.max(15, Math.round(base + tier * 15));
  }

  function cloneItem(it) {
    try { return JSON.parse(JSON.stringify(it)); } catch (_) {}
    return Object.assign({}, it);
  }

  function renderShopPanel(ctx) {
    var el = ensureShopPanel();
    el.hidden = false;
    var goldDiv = el.querySelector("#shop-gold");
    var listDiv = el.querySelector("#shop-list");
    var gold = (ctx.player.inventory.find(function (i) { return i && i.kind === "gold"; })?.amount) || 0;
    if (goldDiv) goldDiv.textContent = "Gold: " + gold;
    if (!listDiv) return;
    if (!Array.isArray(currentShopStock) || currentShopStock.length === 0) {
      listDiv.innerHTML = '<div style="color:#94a3b8;">No items for sale.</div>';
      return;
    }
    listDiv.innerHTML = currentShopStock.map(function (row, idx) {
      var name = (typeof ctx.describeItem === "function") ? (ctx.describeItem(row.item) || "item") : (row.item.name || "item");
      var p = row.price | 0;
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #1f2937;">\n        <div>' + name + ' — <span style="color:#93c5fd;">' + p + 'g</span></div>\n        <button data-idx="' + idx + '" style="padding:4px 8px;background:#243244;color:#e5e7eb;border:1px solid #334155;border-radius:4px;cursor:pointer;">Buy</button>\n      </div>';
    }).join("");
    Array.from(listDiv.querySelectorAll("button[data-idx]")).forEach(function (btn) {
      btn.onclick = function () {
        var i = Number(btn.getAttribute("data-idx") || -1);
        shopBuyIndex(ctx, i);
      };
    });
  }

  function openFor(ctx, npcOrShop) {
    // Generate a small stock list each time
    var stock = [];
    // Some potions
    stock.push({ item: { kind: "potion", heal: 5, count: 1, name: "potion (+5 HP)" }, price: 10 });
    stock.push({ item: { kind: "potion", heal: 10, count: 1, name: "potion (+10 HP)" }, price: 18 });
    // Some equipment via Items if available
    try {
      if (window.Items && typeof Items.createEquipment === "function") {
        var t1 = Items.createEquipment(1, (ctx.rng || Math.random));
        var t2 = Items.createEquipment(2, (ctx.rng || Math.random));
        if (t1) stock.push({ item: t1, price: priceFor(t1) });
        if (t2) stock.push({ item: t2, price: priceFor(t2) });
      } else {
        // fallback simple gear
        var s = { kind: "equip", slot: "left", name: "simple sword", atk: 1.5, tier: 1, decay: (typeof ctx.initialDecay === "function" ? ctx.initialDecay(1) : 10) };
        var a = { kind: "equip", slot: "torso", name: "leather armor", def: 1.0, tier: 1, decay: (typeof ctx.initialDecay === "function" ? ctx.initialDecay(1) : 10) };
        stock.push({ item: s, price: priceFor(s) });
        stock.push({ item: a, price: priceFor(a) });
      }
    } catch (_) {}
    currentShopStock = stock;
    renderShopPanel(ctx);
  }

  function shopBuyIndex(ctx, idx) {
    if (!Array.isArray(currentShopStock) || idx < 0 || idx >= currentShopStock.length) return;
    var row = currentShopStock[idx];
    var cost = row.price | 0;
    var goldObj = ctx.player.inventory.find(function (i) { return i && i.kind === "gold"; });
    var cur = goldObj && typeof goldObj.amount === "number" ? goldObj.amount : 0;
    if (cur < cost) {
      if (typeof ctx.log === "function") ctx.log("You don't have enough gold.", "warn");
      renderShopPanel(ctx);
      return;
    }
    var copy = cloneItem(row.item);
    // Deduct gold and add item
    if (!goldObj) { goldObj = { kind: "gold", amount: 0, name: "gold" }; ctx.player.inventory.push(goldObj); }
    goldObj.amount = (goldObj.amount | 0) - cost;
    if (copy.kind === "potion") {
      var same = ctx.player.inventory.find(function (i) { return i && i.kind === "potion" && ((i.heal ?? 0) === (copy.heal ?? 0)); });
      if (same) same.count = (same.count || 1) + (copy.count || 1);
      else ctx.player.inventory.push(copy);
    } else {
      ctx.player.inventory.push(copy);
    }
    if (typeof ctx.updateUI === "function") ctx.updateUI();
    if (typeof ctx.renderInventory === "function") ctx.renderInventory();
    if (typeof ctx.log === "function") ctx.log("You bought " + (typeof ctx.describeItem === "function" ? ctx.describeItem(copy) : (copy.name || "item")) + " for " + cost + " gold.", "good");
    renderShopPanel(ctx);
  }

  window.ShopPanel = {
    openFor: openFor,
    hide: hide,
    isOpen: isOpen
  };
})();