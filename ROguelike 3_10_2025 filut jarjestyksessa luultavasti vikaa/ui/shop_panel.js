/**
 * ShopUI: shop panel controls (step 3).
 * Centralizes shop rendering and buying logic, used by core/game.js.
 *
 * Exports (ESM + window.ShopUI):
 * - ensurePanel(), hide(), isOpen()
 * - openForNPC(ctx, npc), buyIndex(ctx, idx)
 */
let _stock = null;

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
    el.style.maxWidth = "520px";
    el.style.maxHeight = "60vh";
    el.style.overflow = "auto";
    el.style.padding = "12px";
    el.style.background = "rgba(14, 18, 28, 0.95)";
    el.style.color = "#e5e7eb";
    el.style.border = "1px solid #334155";
    el.style.borderRadius = "8px";
    el.style.boxShadow = "0 10px 24px rgba(0,0,0,0.6)";
    el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><strong id="shop-title">Shop</strong><button id="shop-close-btn" style="padding:4px 8px;background:#1f2937;color:#e5e7eb;border:1px solid #334155;border-radius:4px;cursor:pointer;">Close</button></div><div id="shop-gold" style="margin-bottom:8px;color:#93c5fd;"></div><div id="shop-list"></div>';
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

function priceFor(item) {
  try {
    if (!item) return 10;
    if (item.kind === "potion") {
      const h = item.heal != null ? item.heal : 5;
      return Math.max(5, Math.min(50, Math.round(h * 2)));
    }
    const base = (item.atk || 0) * 10 + (item.def || 0) * 10;
    const tier = (item.tier || 1);
    return Math.max(15, Math.round(base + tier * 15));
  } catch (_) { return 10; }
}

function cloneItem(it) {
  try { return JSON.parse(JSON.stringify(it)); } catch (_) {}
  try { return Object.assign({}, it); } catch (_) {}
  return it;
}

function render(ctx) {
  const el = ensurePanel();
  if (!el) return;
  el.hidden = false;
  const goldDiv = el.querySelector("#shop-gold");
  const listDiv = el.querySelector("#shop-list");

  try {
    let gold = 0;
    const inv = ctx.player && ctx.player.inventory ? ctx.player.inventory : [];
    for (let i = 0; i < inv.length; i++) {
      const it = inv[i];
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
      const name = (ctx.describeItem ? ctx.describeItem(row.item) : (row.item && row.item.name) || "item");
      const p = row.price | 0;
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #1f2937;">' +
             '<div>' + name + ' — <span style="color:#93c5fd;">' + p + 'g</span></div>' +
             '<button data-idx="' + idx + '" style="padding:4px 8px;background:#243244;color:#e5e7eb;border:1px solid #334155;border-radius:4px;cursor:pointer;">Buy</button>' +
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

export function openForNPC(ctx, npc) {
  try {
    const stock = [];
    const name = (npc && (npc.name || npc.title)) ? (npc.name || npc.title) : "Shopkeeper";
    const vendor = (npc && npc.vendor) ? String(npc.vendor).toLowerCase() : "";

    // Special vendor: Seppo — rare wandering merchant with premium stock
    const isSeppo = (vendor === "seppo") || (/seppo/i.test(name));

    if (isSeppo) {
      // Premium potions
      stock.push({ item: { kind: "potion", heal: 10, count: 1, name: "potion (+10 HP)" }, price: 20 });
      stock.push({ item: { kind: "potion", heal: 15, count: 1, name: "elixir (+15 HP)" }, price: 36 });

      // Premium equipment (favor tier 3)
      try {
        if (ctx.Items && typeof ctx.Items.createEquipment === "function") {
          const picks = [];
          const p1 = ctx.Items.createEquipment(3, ctx.rng);
          const p2 = ctx.Items.createEquipment(3, ctx.rng);
          const p3 = ctx.Items.createEquipment(2, ctx.rng);
          if (p1) picks.push(p1);
          if (p2) picks.push(p2);
          if (p3) picks.push(p3);
          // Signature two-hander
          try {
            if (ctx.Items && typeof ctx.Items.createNamed === "function") {
              const gs = ctx.Items.createNamed({ slot: "hand", twoHanded: true, tier: 3, name: "steel greatsword", atk: 3.6, decay: 0 }, ctx.rng);
              if (gs) picks.unshift(gs);
            }
          } catch (_) {}
          const mult = 1.35;
          for (const it of picks) {
            const base = priceFor(it);
            stock.push({ item: it, price: Math.max(1, Math.round(base * mult)) });
          }
        } else {
          const s = { kind: "equip", slot: "hand", name: "steel greatsword", atk: 3.6, tier: 3, twoHanded: true, decay: (ctx.initialDecay ? ctx.initialDecay(3) : 0) };
          const a = { kind: "equip", slot: "torso", name: "steel plate armor", def: 3.2, tier: 3, decay: (ctx.initialDecay ? ctx.initialDecay(3) : 0) };
          const g = { kind: "equip", slot: "hands", name: "steel gauntlets", def: 2.0, atk: 0.6, tier: 3, decay: (ctx.initialDecay ? ctx.initialDecay(3) : 0) };
          const mult = 1.35;
          stock.push({ item: s, price: Math.max(1, Math.round(priceFor(s) * mult)) });
          stock.push({ item: a, price: Math.max(1, Math.round(priceFor(a) * mult)) });
          stock.push({ item: g, price: Math.max(1, Math.round(priceFor(g) * mult)) });
        }
      } catch (_) {}

      try { ctx.log && ctx.log(`${name}: Fine goods, fair prices.`, "notice"); } catch (_) {}
    } else {
      // Generic shopkeeper stock
      // Potions
      stock.push({ item: { kind: "potion", heal: 5, count: 1, name: "potion (+5 HP)" }, price: 10 });
      stock.push({ item: { kind: "potion", heal: 10, count: 1, name: "potion (+10 HP)" }, price: 18 });

      // Equipment via Items registry when available
      try {
        if (ctx.Items && typeof ctx.Items.createEquipment === "function") {
          const t1 = ctx.Items.createEquipment(1, ctx.rng);
          const t2 = ctx.Items.createEquipment(2, ctx.rng);
          if (t1) stock.push({ item: t1, price: priceFor(t1) });
          if (t2) stock.push({ item: t2, price: priceFor(t2) });
        } else {
          const s = { kind: "equip", slot: "left", name: "simple sword", atk: 1.5, tier: 1, decay: (ctx.initialDecay ? ctx.initialDecay(1) : 0) };
          const a = { kind: "equip", slot: "torso", name: "leather armor", def: 1.0, tier: 1, decay: (ctx.initialDecay ? ctx.initialDecay(1) : 0) };
          stock.push({ item: s, price: priceFor(s) });
          stock.push({ item: a, price: priceFor(a) });
        }
      } catch (_) {}
    }

    _stock = stock;
    render(ctx);
    // Shop panel is DOM-only; no canvas redraw needed
  } catch (_) {}
};
          const g = { kind: "equip", slot: "hands", name: "steel gauntlets", atk: 0.4, def: 0.6, tier: 3, decay: (ctx.initialDecay ? ctx.initialDecay(3) : 0) };
          [s, a, g].forEach(it => stock.push({ item: it, price: Math.round(priceFor(it) * 1.2) }));
        }
      } catch (_) {}
    } else {
      // Standard stock
      stock.push({ item: { kind: "potion", heal: 5, count: 1, name: "potion (+5 HP)" }, price: 10 });
      stock.push({ item: { kind: "potion", heal: 10, count: 1, name: "potion (+10 HP)" }, price: 18 });

      try {
        if (ctx.Items && typeof ctx.Items.createEquipment === "function") {
          const t1 = ctx.Items.createEquipment(1, ctx.rng);
          const t2 = ctx.Items.createEquipment(2, ctx.rng);
          if (t1) stock.push({ item: t1, price: priceFor(t1) });
          if (t2) stock.push({ item: t2, price: priceFor(t2) });
        } else {
          const s = { kind: "equip", slot: "left", name: "simple sword", atk: 1.5, tier: 1, decay: (ctx.initialDecay ? ctx.initialDecay(1) : 0) };
          const a = { kind: "equip", slot: "torso", name: "leather armor", def: 1.0, tier: 1, decay: (ctx.initialDecay ? ctx.initialDecay(1) : 0) };
          stock.push({ item: s, price: priceFor(s) });
          stock.push({ item: a, price: priceFor(a) });
        }
      } catch (_) {}
    }

    _stock = stock;
    render(ctx);
    // Shop panel is DOM-only; no canvas redraw needed
  } catch (_) {}
}

export function buyIndex(ctx, idx) {
  try {
    if (!_stock || idx < 0 || idx >= _stock.length) return;
    const row = _stock[idx];
    const cost = row.price | 0;
    const inv = ctx.player && ctx.player.inventory ? ctx.player.inventory : [];
    let goldObj = null;
    let cur = 0;
    for (let i = 0; i < inv.length; i++) {
      const it = inv[i];
      if (it && it.kind === "gold") { goldObj = it; cur = (typeof it.amount === "number") ? it.amount : 0; break; }
    }
    if (cur < cost) {
      try { ctx.log("You don't have enough gold.", "warn"); } catch (_) {}
      render(ctx);
      return;
    }

    const copy = cloneItem(row.item);
    if (!goldObj) { goldObj = { kind: "gold", amount: 0, name: "gold" }; inv.push(goldObj); }
    goldObj.amount = (goldObj.amount | 0) - cost;

    if (copy.kind === "potion") {
      // Merge same potions
      let same = null;
      for (let j = 0; j < inv.length; j++) {
        const it2 = inv[j];
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
      const name = ctx.describeItem ? ctx.describeItem(copy) : (copy && copy.name) || "item";
      ctx.log("You bought " + name + " for " + cost + " gold.", "good");
    } catch (_) {}
    render(ctx);
    // Shop panel is DOM-only; no canvas redraw needed
  } catch (_) {}
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.ShopUI = {
    ensurePanel,
    hide,
    isOpen,
    openForNPC,
    buyIndex
  };
}