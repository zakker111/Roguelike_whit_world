/**
 * ShopUI: shop panel controls.
 * Centralizes shop rendering and buying/selling logic, used by core/game.js.
 *
 * Exports (ESM + window.ShopUI):
 * - ensurePanel(), hide(), isOpen()
 * - openForNPC(ctx, npc), buyIndex(ctx, idx), sellIndex(ctx, idx)
 */
let _stock = null;
let _shopRef = null;

function ensurePanel() {
  try {
    let el = document.getElementById("shop-panel");
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
    el.style.maxWidth = "640px";
    el.style.maxHeight = "70vh";
    el.style.overflow = "auto";
    el.style.padding = "12px";
    el.style.background = "rgba(14, 18, 28, 0.95)";
    el.style.color = "#e5e7eb";
    el.style.border = "1px solid #334155";
    el.style.borderRadius = "8px";
    el.style.boxShadow = "0 10px 24px rgba(0,0,0,0.6)";
    el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><strong id="shop-title">Shop</strong><button id="shop-close-btn" style="padding:4px 8px;background:#1f2937;color:#e5e7eb;border:1px solid #334155;border-radius:4px;cursor:pointer;">Close</button></div><div id="shop-gold" style="margin-bottom:8px;color:#93c5fd;"></div><div id="shop-list"></div><hr style="border-color:#1f2937;"><div id="sell-list"></div>';
    document.body.appendChild(el);
    try {
      const btn = el.querySelector("#shop-close-btn");
      if (btn) btn.onclick = function () {
        try { hide(); } catch (_) {}
      };
    } catch (_) {}
    return el;
  } catch (_) {
    return null;
  }
}

export function hide() {
  try {
    let el = document.getElementById("shop-panel");
    if (!el) el = ensurePanel();
    if (el) el.hidden = true;
  } catch (_) {}
}

export function isOpen() {
  try {
    const el = document.getElementById("shop-panel");
    return !!(el && el.hidden === false);
  } catch (_) { return false; }
}

function playerGold(ctx) {
  let goldObj = null;
  let cur = 0;
  try {
    const inv = ctx.player && ctx.player.inventory ? ctx.player.inventory : [];
    for (let i = 0; i < inv.length; i++) {
      const it = inv[i];
      if (it && it.kind === "gold") { goldObj = it; cur = (typeof it.amount === "number") ? it.amount : 0; break; }
    }
  } catch (_) {}
  return { goldObj, cur };
}

function listSellables(ctx) {
  const out = [];
  try {
    const inv = ctx.player && ctx.player.inventory ? ctx.player.inventory : [];
    for (let i = 0; i < inv.length; i++) {
      const it = inv[i];
      if (!it || it.kind === "gold") continue;
      // Show estimated sell price using rules
      let est = 5;
      try {
        const phase = (window.ShopService && typeof window.ShopService.getPhase === "function") ? window.ShopService.getPhase(ctx) : "morning";
        const base = (window.ShopService && typeof window.ShopService.calculatePrice === "function") ? window.ShopService.calculatePrice((_shopRef && _shopRef.type) || "trader", it, phase, null) : 10;
        const rules = (window.GameData && window.GameData.shopRules && _shopRef && window.GameData.shopRules[_shopRef.type]) ? window.GameData.shopRules[_shopRef.type] : { buyMultiplier: 0.5 };
        est = Math.max(1, Math.round(base * (rules.buyMultiplier || 0.5)));
      } catch (_) {}
      out.push({ idx: i, item: it, price: est });
    }
  } catch (_) {}
  return out;
}

function render(ctx) {
  const el = ensurePanel();
  if (!el) return;
  el.hidden = false;
  const goldDiv = el.querySelector("#shop-gold");
  const listDiv = el.querySelector("#shop-list");
  const sellDiv = el.querySelector("#sell-list");

  try {
    const g = playerGold(ctx);
    if (goldDiv) goldDiv.textContent = "Gold: " + g.cur;
  } catch (_) {}

  if (listDiv) {
    if (!_stock || !_stock.length) {
      listDiv.innerHTML = '<div style="color:#94a3b8;">No items for sale.</div>';
    } else {
      try {
        listDiv.innerHTML = '<div style="margin:4px 0 6px 0;color:#e2e8f0;">Items for sale</div>' + _stock.map(function (row, idx) {
          const name = (ctx.describeItem ? ctx.describeItem(row.item) : (row.item && row.item.name) || "item");
          const p = row.price | 0;
          const q = row.qty | 0;
          const disabled = q <= 0 ? 'disabled style="padding:4px 8px;background:#3b4557;color:#9aa3af;border:1px solid #4b5563;border-radius:4px;cursor:not-allowed;"' : 'style="padding:4px 8px;background:#243244;color:#e5e7eb;border:1px solid #334155;border-radius:4px;cursor:pointer;"';
          return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #1f2937;">' +
                 '<div>' + name + ' — <span style="color:#93c5fd;">' + p + 'g</span> <span style="color:#94a3b8;">(qty ' + q + ')</span></div>' +
                 '<button data-idx="' + idx + '" ' + disabled + '>Buy</button>' +
                 '</div>';
        }).join("");
        const buttons = listDiv.querySelectorAll("button[data-idx]");
        for (let j = 0; j < buttons.length; j++) {
          (function (btn) {
            btn.onclick = function () {
              try {
                const i = Number(btn.getAttribute("data-idx") || -1);
                buyIndex(ctx, i);
              } catch (_) {}
            };
          })(buttons[j]);
        }
      } catch (_) {}
    }
  }

  if (sellDiv) {
    const sellables = listSellables(ctx);
    if (!sellables.length) {
      sellDiv.innerHTML = '<div style="color:#94a3b8;">No items to sell.</div>';
    } else {
      try {
        sellDiv.innerHTML = '<div style="margin:8px 0 6px 0;color:#e2e8f0;">Sell from your inventory</div>' + sellables.map(function (row) {
          const name = (ctx.describeItem ? ctx.describeItem(row.item) : (row.item && row.item.name) || "item");
          const p = row.price | 0;
          return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #1f2937;">' +
                 '<div>' + name + ' — <span style="color:#93c5fd;">' + p + 'g</span></div>' +
                 '<button data-sidx="' + row.idx + '" style="padding:4px 8px;background:#243244;color:#e5e7eb;border:1px solid #334155;border-radius:4px;cursor:pointer;">Sell</button>' +
                 '</div>';
        }).join("");
        const buttons = sellDiv.querySelectorAll("button[data-sidx]");
        for (let j = 0; j < buttons.length; j++) {
          (function (btn) {
            btn.onclick = function () {
              try {
                const i = Number(btn.getAttribute("data-sidx") || -1);
                sellIndex(ctx, i);
              } catch (_) {}
            };
          })(buttons[j]);
        }
      } catch (_) {}
    }
  }
}

export function openForNPC(ctx, npc) {
  try {
    const name = (npc && (npc.name || npc.title)) ? (npc.name || npc.title) : "Shopkeeper";
    const shop = (npc && npc._shopRef) ? npc._shopRef : null;

    // Title
    try {
      const el = ensurePanel();
      const ttl = el ? el.querySelector("#shop-title") : null;
      if (ttl) ttl.textContent = name;
    } catch (_) {}

    _shopRef = shop;
    // Inventory from ShopService (JSON-driven)
    if (window.ShopService && typeof window.ShopService.getInventoryForShop === "function" && shop) {
      _stock = window.ShopService.getInventoryForShop(ctx, shop);
    } else {
      _stock = [];
    }

    render(ctx);
    // Shop panel is DOM-only; no canvas redraw needed
  } catch (_) {}
}

export function buyIndex(ctx, idx) {
  try {
    if (!_stock || idx < 0 || idx >= _stock.length) return;
    if (!_shopRef || !window.ShopService || typeof window.ShopService.buyItem !== "function") return;
    const ok = window.ShopService.buyItem(ctx, _shopRef, idx);
    if (ok) {
      // refresh current stock view after quantity change
      _stock = window.ShopService.getInventoryForShop(ctx, _shopRef);
    }
    render(ctx);
  } catch (_) {}
}

export function sellIndex(ctx, idx) {
  try {
    if (!_shopRef || !window.ShopService || typeof window.ShopService.sellItem !== "function") return;
    const ok = window.ShopService.sellItem(ctx, _shopRef, idx);
    if (ok) {
      render(ctx);
    }
  } catch (_) {}
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.ShopUI = {
    ensurePanel,
    hide,
    isOpen,
    openForNPC,
    buyIndex,
    sellIndex
  };
}