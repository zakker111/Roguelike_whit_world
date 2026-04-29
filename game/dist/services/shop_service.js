import { minutesOfDay as tsMinutesOfDay, parseHHMM } from "./time_service.js";

/**
 * ShopService: centralized helpers for shop schedules, phases, pools, and inventory persistence.
 *
 * Exports (ESM + window.ShopService):
 * - minutesOfDay(h, m=0, dayMinutes=1440)
 * - isOpenAt(shop, minutes)
 * - isShopOpenNow(ctx, shop=null)  // uses ctx.time
 * - shopScheduleStr(shop)
 * - shopAt(ctx, x, y)
 * - getPhase(ctx) -> "morning"|"midday"|"afternoon"|"dusk"
 * - ensureShopState(ctx, shop)           // initialize state for a shop
 * - restockIfNeeded(ctx, shop)           // run restock logic per JSON rules
 * - getInventoryForShop(ctx, shop)       // rows: [{ item, price, qty }]
 * - canBuyFromShop(shopType, itemKind)   // validation for selling to player
 * - canSellToShop(shopType, itemKind)    // validation for selling from player
 * - calculatePrice(shopType, item, phase, demandState)
 * - buyItem(ctx, shop, idx)              // decrements qty and gives item to player
 * - sellItem(ctx, shop, playerInvIdx)    // validates and buys from player
 */
 // moved to TimeService.parseHHMM

export function minutesOfDay(h, m, dayMinutes) {
  // Delegate to TimeService.minutesOfDay to avoid duplication
  return tsMinutesOfDay(h, m, dayMinutes);
}

export function isOpenAt(shop, minutes) {
  if (!shop) return false;
  if (shop.alwaysOpen) return true;
  if (typeof shop.openMin !== "number" || typeof shop.closeMin !== "number") return false;
  var o = shop.openMin | 0, c = shop.closeMin | 0;
  if (o === c) return false; // treat as closed all day
  return (c > o) ? (minutes >= o && minutes < c) : (minutes >= o || minutes < c);
}

export function isShopOpenNow(ctx, shop) {
  try {
    var t = ctx && ctx.time ? ctx.time : null;
    var minutes = t ? (t.hours * 60 + t.minutes) : 12 * 60;
    if (!shop) {
      return !!(t && t.phase === "day");
    }
    return isOpenAt(shop, minutes);
  } catch (_) {
    return false;
  }
}

export function shopScheduleStr(shop) {
  if (!shop) return "";
  if (shop.alwaysOpen) return "Always open.";
  var h2 = function (min) {
    var hh = ((min / 60) | 0) % 24;
    return String(hh).padStart(2, "0");
  };
  return "Opens " + h2(shop.openMin) + ":00, closes " + h2(shop.closeMin) + ":00";
}

export function shopAt(ctx, x, y) {
  var list = Array.isArray(ctx && ctx.shops) ? ctx.shops : [];
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    if (s && s.x === x && s.y === y) return s;
  }
  return null;
}

// ----- Phases -----
export function getPhase(ctx) {
  try {
    var gd = (typeof window !== "undefined" && window.GameData) ? window.GameData : null;
    var phases = gd && gd.shopPhases && Array.isArray(gd.shopPhases.phases) ? gd.shopPhases.phases : null;
    var t = ctx && ctx.time ? ctx.time : null;
    var curMin = t ? (t.hours * 60 + t.minutes) : 12 * 60;
    if (!phases) return "morning";
    for (var i = 0; i < phases.length; i++) {
      var p = phases[i];
      var s = parseHHMM(p.start);
      var e = parseHHMM(p.end);
      if (s == null || e == null) continue;
      if (e >= s) {
        if (curMin >= s && curMin <= e) return p.id;
      } else {
        // wrap
        if (curMin >= s || curMin <= e) return p.id;
      }
    }
    return phases[0] ? phases[0].id : "morning";
  } catch (_) { return "morning"; }
}

// ----- Internal state persistence -----
var _state = {}; // key -> { rows: [{item, price, qty}], soldToday: {}, nextRestockMin: number, lastPhase: string }

function _shopKey(shop) {
  var name = (shop && shop.name) ? shop.name : (shop && shop.type) ? shop.type : "shop";
  return name + ":" + (shop && shop.x) + "," + (shop && shop.y);
}

function _rng(ctx) {
  try {
    if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function") {
      return window.RNGUtils.getRng(typeof ctx.rng === "function" ? ctx.rng : undefined);
    }
  } catch (_) {}
  return (typeof ctx.rng === "function") ? ctx.rng : null;
}

function _priceFor(item) {
  try {
    if (!item) return 10;
    // Tools: prefer data-driven pricing by id
    if (String(item.kind || "").toLowerCase() === "tool") {
      try {
        const GD = (typeof window !== "undefined" ? window.GameData : null);
        const list = GD && GD.tools && Array.isArray(GD.tools.tools) ? GD.tools.tools : null;
        const id = String(item.type || item.id || "").toLowerCase();
        if (list && id) {
          const def = list.find(t => t && String(t.id || "").toLowerCase() === id);
          if (def && def.price && typeof def.price.base === "number") {
            return (def.price.base | 0);
          }
        }
      } catch (_) {}
      // Default tool price fallback
      return 10;
    }
    if (item.kind === "potion") {
      var h = item.heal != null ? item.heal : 5;
      return Math.max(5, Math.min(50, Math.round(h * 2)));
    }
    if (item.kind === "drink") {
      var dh = item.heal != null ? item.heal : 2;
      return Math.max(2, Math.min(30, Math.round(dh * 1.5)));
    }
    if (item.kind === "food") {
      var fh = item.heal != null ? item.heal : 2;
      return Math.max(2, Math.min(40, Math.round(fh * 2)));
    }
    // weapon/armor heuristics
    var base = (item.atk || 0) * 10 + (item.def || 0) * 10;
    var tier = (item.tier || 1);
    return Math.max(15, Math.round(base + tier * 15));
  } catch (_) { return 10; }
}

// Map pool entry to actual item
function _materializeItem(ctx, entry) {
  if (!entry || typeof entry !== "object") return null;
  var kind = String(entry.kind || "").toLowerCase();
  if (kind === "potion") {
    // Prefer data-driven consumables by id when available
    try {
      const GD = (typeof window !== "undefined" ? window.GameData : null);
      const list = GD && GD.consumables && Array.isArray(GD.consumables.potions) ? GD.consumables.potions : null;
      const id = String(entry.id || "").toLowerCase();
      if (list && id) {
        const def = list.find(p => p && String(p.id || "").toLowerCase() === id);
        if (def) {
          const heal = Number(def.heal || entry.heal || 5) || 5;
          const name = def.name || ("potion (+" + heal + " HP)");
          return { kind: "potion", heal: heal, count: 1, name };
        }
      }
    } catch (_) {}
    // Fallback to entry.heal
    return { kind: "potion", heal: entry.heal || 5, count: 1, name: "potion (+" + (entry.heal || 5) + " HP)" };
  }
  if (kind === "drink") {
    var nm = entry.name || entry.id || "drink";
    return { kind: "drink", heal: entry.heal || 2, count: 1, name: nm };
  }
  if (kind === "food") {
    var nmf = entry.name || entry.id || "food";
    return { kind: "food", heal: entry.heal || 2, count: 1, name: nmf };
  }
  if (kind === "antidote") {
    return { kind: "antidote", name: "antidote" };
  }
  if (kind === "weapon" || kind === "low_tier_equip" || kind === "shield" || kind === "armor") {
    // Prefer Items registry if available
    try {
      if (ctx.Items && typeof ctx.Items.createEquipment === "function") {
        var t = entry.tier || 1;
        var e = ctx.Items.createEquipment(t, _rng(ctx));
        if (e) return e;
      }
    } catch (_) {}
    // Fallback simple objects
    try { if (typeof window !== "undefined" && window.Fallback && typeof window.Fallback.log === "function") window.Fallback.log("shop", "Materializing simple equipment (Items.createEquipment unavailable).", { kind, tier: entry.tier || 1 }); } catch (_) {}
    if (kind === "weapon" || kind === "low_tier_equip") {
      return { kind: "equip", slot: "hand", name: entry.id || "weapon", atk: entry.tier ? (entry.tier * 1.2) : 1.0, tier: entry.tier || 1, twoHanded: false, decay: (ctx.initialDecay ? ctx.initialDecay(entry.tier || 1) : 0) };
    }
    if (kind === "shield") {
      return { kind: "equip", slot: "hand", name: entry.id || "shield", def: entry.tier ? (entry.tier * 1.1) : 1.0, tier: entry.tier || 1, decay: (ctx.initialDecay ? ctx.initialDecay(entry.tier || 1) : 0) };
    }
    if (kind === "armor") {
      var slot = entry.slot || "torso";
      return { kind: "equip", slot: slot, name: entry.id || "armor", def: entry.tier ? (entry.tier * 1.2) : 1.0, tier: entry.tier || 1, decay: (ctx.initialDecay ? ctx.initialDecay(entry.tier || 1) : 0) };
    }
  }
  if (kind === "named_equip") {
    try {
      const ItemsMod = (typeof window !== "undefined" ? (window.Items || null) : null) || (ctx && ctx.Items ? ctx.Items : null);
      if (ItemsMod && typeof ItemsMod.createNamed === "function") {
        const id = String(entry.id || entry.type || "named_equip");
        const cfg = {
          slot: entry.slot || "hand",
          tier: entry.tier || 1,
          name: entry.name || id,
        };
        if (typeof entry.atk === "number") cfg.atk = entry.atk;
        if (typeof entry.def === "number") cfg.def = entry.def;
        if (entry.twoHanded) cfg.twoHanded = true;
        if (typeof entry.decay === "number") cfg.decay = entry.decay;
        const it = ItemsMod.createNamed(cfg, _rng(ctx));
        if (it) {
          try { it.id = id; } catch (_) {}
          return it;
        }
      }
    } catch (_) {}
    // Fallback simple named equip
    const id2 = String(entry.id || entry.type || "named_equip");
    return {
      kind: "equip",
      slot: entry.slot || "hand",
      name: entry.name || id2,
      atk: typeof entry.atk === "number" ? entry.atk : 3.0,
      def: typeof entry.def === "number" ? entry.def : undefined,
      tier: entry.tier || 1,
      twoHanded: !!entry.twoHanded,
      decay: typeof entry.decay === "number" ? entry.decay : (ctx.initialDecay ? ctx.initialDecay(entry.tier || 1) : 0),
      id: id2
    };
  }
  if (kind === "tool") {
    const id = String(entry.id || entry.type || "tool");
    let name = id.replace(/_/g, " ");
    let startDecay = 0;
    let usable = false;
    try {
      const GD = (typeof window !== "undefined" ? window.GameData : null);
      const list = GD && GD.tools && Array.isArray(GD.tools.tools) ? GD.tools.tools : null;
      if (list) {
        const def = list.find(t => t && String(t.id || "").toLowerCase() === String(id).toLowerCase());
        if (def) {
          if (def.name) name = String(def.name);
          if (def.decay && typeof def.decay.start === "number") startDecay = Math.max(0, Math.min(100, def.decay.start | 0));
          if (def.usable === true) usable = true;
        }
      }
    } catch (_) {}

    // Special-case: torches bought from shops should be equippable hand items,
    // not inert tools. Materialize them as proper equipment so they can be
    // equipped, decay, and grant FOV/status effects like the starter torch.
    try {
      const idLower = id.toLowerCase();
      if (idLower === "torch") {
        const ItemsMod = (typeof window !== "undefined" ? (window.Items || null) : null) || (typeof ctx !== "undefined" && ctx.Items ? ctx.Items : null);
        let equipTorch = null;
        try {
          if (ItemsMod && typeof ItemsMod.createByKey === "function") {
            equipTorch = ItemsMod.createByKey("torch_weapon", 1, _rng(ctx));
          }
        } catch (_) { equipTorch = null; }
        try {
          if (!equipTorch && ItemsMod && typeof ItemsMod.createNamed === "function") {
            equipTorch = ItemsMod.createNamed({ slot: "hand", tier: 1, name: name || "torch", atk: 0.6, decay: startDecay });
          }
        } catch (_) { equipTorch = null; }
        if (!equipTorch) {
          equipTorch = { kind: "equip", slot: "hand", name: name || "torch", atk: 0.6, tier: 1, decay: startDecay };
        }
        return equipTorch;
      }
    } catch (_) {}

    return { kind: "tool", type: id, name, decay: startDecay, usable: usable === true };
  }
  if (kind === "material") {
    return { kind: "material", material: entry.material || "wood", name: entry.id || "material", amount: 1 };
  }
  if (kind === "curio") {
    return { kind: "curio", name: entry.id || "curio" };
  }
  return { kind: kind || "item", name: entry.id || "item" };
}

// ----- Rules helpers -----
function _getRules(shopType) {
  try {
    var gd = (typeof window !== "undefined" && window.GameData) ? window.GameData : null;
    var rules = gd && gd.shopRules ? gd.shopRules[shopType] : null;
    return rules || {};
  } catch (_) { return {}; }
}

function _getCharisma(ctx) {
  try {
    const p = ctx && ctx.player ? ctx.player : null;
    const attrs = p && p.attributes ? p.attributes : null;
    const cha = attrs && typeof attrs.cha === "number" ? attrs.cha : 0;
    const n = cha | 0;
    return n < 0 ? 0 : n;
  } catch (_) {
    return 0;
  }
}

function _buyPriceMultiplierForCharisma(ctx) {
  const cha = _getCharisma(ctx);
  if (cha <= 0) return 1.0;
  const perPoint = 0.02; // 2% cheaper per CHA
  const maxDiscount = 0.4; // cap at 40% off
  const discount = Math.min(maxDiscount, Math.max(0, cha) * perPoint);
  return 1.0 - discount;
}

function _sellPriceMultiplierForCharisma(ctx) {
  const cha = _getCharisma(ctx);
  if (cha <= 0) return 1.0;
  const perPoint = 0.01; // 1% more per CHA when selling
  const maxBonus = 0.3; // cap at +30%
  const bonus = Math.min(maxBonus, Math.max(0, cha) * perPoint);
  return 1.0 + bonus;
}

function _computeSellPay(ctx, shopType, item) {
  var phase = getPhase(ctx);
  var price = calculatePrice(shopType, item, phase, null);
  var rules = _getRules(shopType);
  var buyMult = (rules && typeof rules.buyMultiplier === "number") ? rules.buyMultiplier : 0.5;
  var basePay = Math.max(1, Math.round(price * buyMult));
  var mult = _sellPriceMultiplierForCharisma(ctx);
  if (!(mult > 0)) mult = 1.0;
  var pay = Math.max(1, Math.round(basePay * mult));
  return pay;
}

export function canBuyFromShop(shopType, itemKind) {
  var r = _getRules(shopType);
  var sells = Array.isArray(r.sells) ? r.sells.map(x => String(x).toLowerCase()) : [];
  var k = String(itemKind || "").toLowerCase();
  if (!sells.length) return true;
  if (k === "equip") {
    // refine: map equip to weapon/armor/shield by attributes if needed
    if (shopType === "blacksmith") return true; // weapons
    if (shopType === "armorer") return true;    // armor/shields
  }
  return sells.indexOf(k) !== -1;
}

export function canSellToShop(shopType, itemKind) {
  var r = _getRules(shopType);
  var buys = Array.isArray(r.buys) ? r.buys.map(x => String(x).toLowerCase()) : [];
  var k = String(itemKind || "").toLowerCase();
  if (!buys.length) return false;
  if (buys.indexOf("any") !== -1) return true;
  if (k === "equip") {
    if (shopType === "blacksmith") {
      // only weapons (has atk)
      return true;
    }
    if (shopType === "armorer") {
      // only armor/shield (has def)
      return true;
    }
  }
  return buys.indexOf(k) !== -1;
}

export function calculatePrice(shopType, item, phase, demandState) {
  // Tools: prefer data-driven overrides by shop id
  try {
    const isTool = String(item && item.kind || "").toLowerCase() === "tool";
    if (isTool) {
      const id = String(item && (item.type || item.id) || "").toLowerCase();
      const GD = (typeof window !== "undefined" ? window.GameData : null);
      const list = GD && GD.tools && Array.isArray(GD.tools.tools) ? GD.tools.tools : null;
      const def = list && id ? list.find(t => t && String(t.id || "").toLowerCase() === id) : null;
      if (def && def.price) {
        const st = String(shopType || "").toLowerCase();
        if (def.price.shops && def.price.shops[st] != null) {
          return Number(def.price.shops[st]) | 0;
        }
      }
    }
  } catch (_) {}

  // Special-case: Seppo's True Blade has a fixed price at Seppo's shop.
  try {
    const st2 = String(shopType || "").toLowerCase();
    const id2 = String(item && (item.id || item.name) || "").toLowerCase();
    if (st2 === "seppo" && (id2 === "seppos_true_blade" || id2.indexOf("seppo's true blade") !== -1)) {
      return 500;
    }
  } catch (_) {}

  var base = _priceFor(item);
  var r = _getRules(shopType);
  var mult = 1.0;
  try {
    if (r && r.phasePriceMods && phase && r.phasePriceMods[phase] != null) {
      mult *= Number(r.phasePriceMods[phase]) || 1.0;
    }
  } catch (_) {}
  // demandState could adjust, keep simple for now
  return Math.max(1, Math.round(base * mult));
}

// Stack identical consumables (potions by heal, drinks by name) and materials (by name/material)
// into single rows with summed qty and lowest price. Preserves relative order based on first occurrence.
function _stackRows(rows) {
  try {
    if (!Array.isArray(rows) || rows.length === 0) return rows || [];
    var groups = {};
    var order = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var it = r && r.item ? r.item : null;
      var kind = it ? String(it.kind || "") : "";
      var key = null;
      if (kind === "potion") {
        key = "potion:" + String((it.heal != null ? it.heal : 0) | 0);
      } else if (kind === "drink") {
        key = "drink:" + String(it.name || "").toLowerCase();
      } else if (kind === "food") {
        key = "food:" + String(it.name || "").toLowerCase();
      } else if (kind === "material") {
        // Prefer explicit item name (e.g., "wood_planks"); fallback to material type (e.g., "wood")
        var mk = String(it.name || it.material || "").toLowerCase();
        if (mk) key = "material:" + mk;
      }
      if (!key) {
        // non-stackable: keep as-is
        order.push({ key: null, row: r });
      } else {
        if (!groups[key]) {
          groups[key] = { base: r, qty: 0, price: (r.price | 0) };
          order.push({ key: key, row: null });
        }
        groups[key].qty += (r.qty | 0);
        if ((r.price | 0) < groups[key].price) groups[key].price = (r.price | 0);
      }
    }
    var out = [];
    for (var j = 0; j < order.length; j++) {
      var ent = order[j];
      if (!ent.key) {
        out.push(ent.row);
      } else {
        var g = groups[ent.key];
        if (g) {
          var qsum = Math.max(1, g.qty | 0);
          out.push({ item: g.base.item, price: g.price, qty: qsum });
          groups[ent.key] = null;
        }
      }
    }
    return out;
  } catch (_) { return rows || []; }
}

// ----- Inventory generation / restock -----
function _weightedPick(rng, entries, phase) {
  if (!Array.isArray(entries) || !entries.length) return null;
  var acc = 0;
  var weights = entries.map(function (e) {
    var w = e.phaseWeights && e.phaseWeights[phase] != null ? Number(e.phaseWeights[phase]) : 0;
    if (!isFinite(w) || w < 0) w = 0;
    acc += w;
    return w;
  });
  if (acc <= 0) return null;
  var roll = rng() * acc;
  var cur = 0;
  for (var i = 0; i < entries.length; i++) {
    cur += weights[i];
    if (roll <= cur) return entries[i];
  }
  return entries[entries.length - 1];
}

function _getPools(shopType) {
  try {
    var gd = (typeof window !== "undefined" && window.GameData) ? window.GameData : null;
    var pools = gd && gd.shopPools ? gd.shopPools[shopType] : null;
    return pools || null;
  } catch (_) { return null; }
}

export function ensureShopState(ctx, shop) {
  var key = _shopKey(shop);
  if (!_state[key]) {
    _state[key] = { rows: [], soldToday: {}, nextRestockMin: null, lastPhase: null };
  }
  return _state[key];
}

export function restockIfNeeded(ctx, shop) {
  var key = _shopKey(shop);
  var st = ensureShopState(ctx, shop);
  var phase = getPhase(ctx);
  var gd = (typeof window !== "undefined" && window.GameData) ? window.GameData : null;
  var rest = gd && gd.shopRestock ? gd.shopRestock[shop.type] : null;
  var t = ctx && ctx.time ? ctx.time : null;
  var nowMin = t ? (t.hours * 60 + t.minutes) : 12 * 60;

  // Primary restock on opening or phase change
  var shouldPrimary = false;
  if (rest && String(rest.primaryRestockAt || "open") === "open") {
    shouldPrimary = isShopOpenNow(ctx, shop) && st.rows.length === 0;
  }
  if (st.lastPhase !== phase) {
    const prev = st.lastPhase;
    shouldPrimary = true;
    st.lastPhase = phase;
    try {
      if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") {
        window.Logger.log("[Shop] Phase change", "notice", { category: "Shop", type: String(shop && shop.type || "shop"), from: prev || null, to: phase });
      }
    } catch (_) {}
  }

  if (shouldPrimary) {
    // generate inventory from pools (strict JSON; no fallback)
    var pools = _getPools(shop.type);
    var rng = _rng(ctx);
    var rows = [];
    if (pools && pools.categories) {
      Object.keys(pools.categories).forEach(function (cat) {
        var cfg = pools.categories[cat];
        var cap = (cfg.capPerDay | 0) || 0;
        var used = 0;
        var tries = 0;
        while (tries++ < 20 && used < cap) {
          var pick = _weightedPick(rng, cfg.entries, phase);
          if (!pick) break;
          var item = _materializeItem(ctx, pick);
          if (!item) break;
          var qty = Math.max(1, Math.min(3, (pick.stack && pick.stack.max) ? pick.stack.max : 1));
          var price = calculatePrice(shop.type, item, phase, null);
          rows.push({ item: item, price: price, qty: qty });
          used += 1;
          // avoid duplicates exploding: remove weight temporarily
          // simple approach: break to limit per category to a few rows
          if (rows.length > 6) break;
        }
      });
    }

    // Simple fallback inventory for travelling caravans if no JSON pools are defined.
    if ((!pools || !pools.categories) && String(shop.type || "").toLowerCase() === "caravan") {
      try {
        var basicEntries = [
          { kind: "potion", id: "healing_minor", heal: 10 },
          { kind: "potion", id: "healing", heal: 20 },
          { kind: "food", id: "trail_rations", name: "trail rations", heal: 4 },
          { kind: "drink", id: "water_skin", name: "water skin", heal: 3 },
          { kind: "material", id: "wood_planks", material: "wood", name: "planks" }
        ];
        for (var bi = 0; bi < basicEntries.length; bi++) {
          var ent = basicEntries[bi];
          var it = _materializeItem(ctx, ent);
          if (!it) continue;
          var q = (it.kind === "potion" || it.kind === "drink" || it.kind === "food") ? 3 : 5;
          var p = calculatePrice(shop.type, it, phase, null);
          rows.push({ item: it, price: p, qty: q });
        }
      } catch (_) {}
    }

    // Stack identical consumables across all shops for cleaner lists (potions by heal, drinks by name)
    try { rows = _stackRows(rows); } catch (_) {}

    st.rows = rows;
    try {
      if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") {
        window.Logger.log("[Shop] Restock", "notice", { category: "Shop", type: String(shop && shop.type || "shop"), phase, rows: Array.isArray(st.rows) ? st.rows.length : 0 });
        // Optional per-row trace
        const _trace = (() => { try { if (typeof window !== "undefined" && window.DEV) return true; const v = localStorage.getItem("LOG_TRACE_SHOPS"); return String(v).toLowerCase() === "1"; } catch (_) { return false; } })();
        if (_trace && Array.isArray(st.rows)) {
          for (let i = 0; i < st.rows.length; i++) {
            const r0 = st.rows[i];
            const it0 = r0 && r0.item;
            const kind0 = it0 ? String(it0.kind || "") : "";
            const name0 = it0 ? (it0.name || it0.id || "") : "";
            window.Logger.log("[Shop] Row", "info", { category: "Shop", idx: i, kind: kind0, name: name0, price: r0 && r0.price, qty: r0 && r0.qty });
          }
        }
      }
    } catch (_) {}
    // If no inventory was generated, log a warning (crash-free policy)
    try {
      if (!Array.isArray(st.rows) || st.rows.length === 0) {
        const msg = `[Shops] ${String(shop && shop.type || 'shop')} has no saleable inventory for phase ${phase}.`;
        if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") {
          window.Logger.log(msg, "warn");
        } else if (ctx && typeof ctx.log === "function") {
          ctx.log(msg, "warn");
        } else if (typeof console !== "undefined") {
          console.warn(msg);
        }
      }
    } catch (_) {}
  }

  // Inject inn service: "Rent room (one night)"
  try {
    if (shop && String(shop.type || "").toLowerCase() === "inn") {
      // Compute current day index to disable if already bought
      var tc = (t && typeof t.turnCounter === "number") ? (t.turnCounter | 0) : 0;
      var ct = (t && typeof t.cycleTurns === "number") ? (t.cycleTurns | 0) : 360;
      var dayIdx = Math.floor(tc / Math.max(1, ct));
      var already = !!(ctx.player && (ctx.player._innStayDay === dayIdx));
      // Determine price from rules if available, else default to 8g
      var rulesInn = gd && gd.shopRules && gd.shopRules.inn ? gd.shopRules.inn : null;
      var priceRent = (rulesInn && typeof rulesInn.roomPrice === "number") ? (rulesInn.roomPrice | 0) : 8;
      // Ensure only one service row exists; place at top
      var svcIdx = -1;
      for (var si = 0; si < st.rows.length; si++) {
        var it0 = st.rows[si] && st.rows[si].item;
        if (it0 && it0.kind === "service" && (String(it0.id || "").toLowerCase() === "rent_room")) { svcIdx = si; break; }
      }
      var svcRow = { item: { kind: "service", id: "rent_room", name: "Rent room (one night)" }, price: priceRent, qty: already ? 0 : 1 };
      if (svcIdx === -1) {
        st.rows.unshift(svcRow);
      } else {
        st.rows[svcIdx] = svcRow;
      }
    }
  } catch (_) {}

  // Mini restock at configured time: replace one consumable-like slot
  if (rest && typeof rest.miniRestockAt === "string") {
    var miniMin = parseHHMM(rest.miniRestockAt);
    if (miniMin != null && st.nextRestockMin !== miniMin) {
      st.nextRestockMin = miniMin;
    }
    if (miniMin != null && nowMin === miniMin) {
      var pools2 = _getPools(shop.type);
      var rng2 = _rng(ctx);
      // replace one row favoring consumables/tools
      var idx = -1;
      for (var i = 0; i < st.rows.length; i++) {
        var it = st.rows[i] && st.rows[i].item;
        if (it && (it.kind === "potion" || it.kind === "drink" || it.kind === "antidote" || it.kind === "tool")) { idx = i; break; }
      }
      if (idx !== -1 && pools2 && pools2.categories) {
        var catKeys = Object.keys(pools2.categories);
        var cat = catKeys[0];
        var cfg2 = pools2.categories[cat];
        var pick2 = _weightedPick(rng2, cfg2.entries, phase);
        var item2 = _materializeItem(ctx, pick2);
        if (item2) {
          var price2 = calculatePrice(shop.type, item2, phase, null);
          var qty2 = Math.max(1, (pick2 && pick2.stack && pick2.stack.max) ? pick2.stack.max : 1);
          st.rows[idx] = { item: item2, price: price2, qty: qty2 };
          // Optional trace
          try {
            const _trace = (() => { try { if (typeof window !== "undefined" && window.DEV) return true; const v = localStorage.getItem("LOG_TRACE_SHOPS"); return String(v).toLowerCase() === "1"; } catch (_) { return false; } })();
            if (_trace && typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") {
              const kind2 = String(item2.kind || "");
              const name2 = item2.name || item2.id || "";
              window.Logger.log("[Shop] Mini restock row replaced", "info", { category: "Shop", idx, kind: kind2, name: name2, price: price2, qty: qty2 });
            }
          } catch (_) {}
        }
      }
      // Re-stack after mini restock to keep duplicate consumables merged
      try { st.rows = _stackRows(st.rows); } catch (_) {}
    }
  }
  return st;
}

export function getInventoryForShop(ctx, shop) {
  var st = restockIfNeeded(ctx, shop);
  var rows = Array.isArray(st.rows) ? st.rows : [];
  var mult = _buyPriceMultiplierForCharisma(ctx);
  if (!(mult > 0)) mult = 1.0;
  // Return a mapped copy so UI sees CHA-adjusted prices but does not mutate internal state
  return rows.map(function (r) {
    var basePrice = (r && typeof r.price === "number") ? r.price : 0;
    var item = r && r.item;
    var kind = item && String(item.kind || "").toLowerCase();
    var effective = basePrice;
    // Do not apply charisma to inn services (e.g., room rentals)
    if (kind !== "service") {
      effective = Math.max(1, Math.round(basePrice * mult));
    }
    return { item: item, price: effective, qty: r.qty };
  });
}

function _giveItemToPlayer(ctx, item) {
  try {
    var inv = ctx.player && ctx.player.inventory ? ctx.player.inventory : (ctx.player.inventory = []);
    var k = String(item.kind || "").toLowerCase();

    // Ensure a count field for stackables
    if (k === "potion" || k === "drink" || k === "food") {
      item.count = (item.count | 0) || 1;
    }

    if (k === "potion") {
      var same = null;
      for (var j = 0; j < inv.length; j++) {
        var it2 = inv[j];
        if (it2 && it2.kind === "potion" && ((it2.heal || 0) === (item.heal || 0))) { same = it2; break; }
      }
      if (same) {
        same.count = (same.count | 0) + (item.count | 0);
      } else {
        inv.push(item);
      }
    } else if (k === "drink") {
      var nmNew = String(item.name || "").toLowerCase();
      var sameD = null;
      for (var i = 0; i < inv.length; i++) {
        var it3 = inv[i];
        if (it3 && it3.kind === "drink" && String(it3.name || "").toLowerCase() === nmNew) { sameD = it3; break; }
      }
      if (sameD) {
        sameD.count = (sameD.count | 0) + (item.count | 0);
      } else {
        inv.push(item);
      }
    } else if (k === "food") {
      var nmFood = String(item.name || "").toLowerCase();
      var sameF = null;
      for (var ii = 0; ii < inv.length; ii++) {
        var itF = inv[ii];
        if (itF && itF.kind === "food" && String(itF.name || "").toLowerCase() === nmFood) { sameF = itF; break; }
      }
      if (sameF) {
        sameF.count = (sameF.count | 0) + (item.count | 0);
      } else {
        inv.push(item);
      }
    } else {
      inv.push(item);
    }

    if (typeof ctx.updateUI === "function") ctx.updateUI();
    if (ctx.renderInventory) ctx.renderInventory();
  } catch (_) {}
}

function _playerGold(ctx) {
  var inv = ctx.player && ctx.player.inventory ? ctx.player.inventory : [];
  var g = { goldObj: null, cur: 0 };
  for (var i = 0; i < inv.length; i++) {
    var it = inv[i];
    if (it && it.kind === "gold") { g.goldObj = it; g.cur = (typeof it.amount === "number") ? it.amount : 0; break; }
  }
  return g;
}

export function buyItem(ctx, shop, idx) {
  var st = ensureShopState(ctx, shop);
  if (!st.rows || idx < 0 || idx >= st.rows.length) return false;
  var row = st.rows[idx];
  if (!row || (row.qty | 0) <= 0) { try { ctx.log && ctx.log("Sold out.", "warn"); } catch (_) {} return false; }

  // Special-case: inn service purchase (rent room for one night)
  try {
    var it = row.item || null;
    if (it && it.kind === "service" && String(it.id || "").toLowerCase() === "rent_room") {
      // Determine current day index
      var tc = (ctx.time && typeof ctx.time.turnCounter === "number") ? (ctx.time.turnCounter | 0) : 0;
      var ct = (ctx.time && typeof ctx.time.cycleTurns === "number") ? (ctx.time.cycleTurns | 0) : 360;
      var dayIdx = Math.floor(tc / Math.max(1, ct));
      if (ctx.player && ctx.player._innStayDay === dayIdx) {
        try { ctx.log && ctx.log("You've already rented a room for tonight.", "warn"); } catch (_) {}
        return false;
      }
      // Pay with gold item
      var gsvc = _playerGold(ctx);
      if ((gsvc.cur | 0) < (row.price | 0)) { try { ctx.log && ctx.log("You don't have enough gold.", "warn"); } catch (_) {} return false; }
      if (!gsvc.goldObj) { gsvc.goldObj = { kind: "gold", amount: 0, name: "gold" }; (ctx.player.inventory || (ctx.player.inventory = [])).push(gsvc.goldObj); }
      gsvc.goldObj.amount = (gsvc.goldObj.amount | 0) - (row.price | 0);
      // Mark rental for current day
      ctx.player._innStayDay = dayIdx;
      // Decrement/disable purchase for this phase/day
      row.qty = 0;
      try { ctx.updateUI && ctx.updateUI(); } catch (_) {}
      try { ctx.log && ctx.log("You rent a room for the night. Find a bed inside the inn to sleep.", "good"); } catch (_) {}
      return true;
    }
  } catch (_) {}

  var g = _playerGold(ctx);
  var basePrice = (row.price | 0);
  var mult = _buyPriceMultiplierForCharisma(ctx);
  if (!(mult > 0)) mult = 1.0;
  var finalPrice = Math.max(1, Math.round(basePrice * mult));
  if ((g.cur | 0) < finalPrice) { try { ctx.log && ctx.log("You don't have enough gold.", "warn"); } catch (_) {} return false; }
  if (!g.goldObj) { g.goldObj = { kind: "gold", amount: 0, name: "gold" }; (ctx.player.inventory || (ctx.player.inventory = [])).push(g.goldObj); }
  g.goldObj.amount = (g.goldObj.amount | 0) - finalPrice;
  var copy;
  try { copy = JSON.parse(JSON.stringify(row.item)); } catch (_) { copy = Object.assign({}, row.item); }
  _giveItemToPlayer(ctx, copy);
  row.qty = (row.qty | 0) - 1;
  try { ctx.log && ctx.log("You bought " + (ctx.describeItem ? ctx.describeItem(row.item) : (row.item && row.item.name) || "item") + " for " + finalPrice + " gold.", "good"); } catch (_) {}
  return true;
}

export function sellItem(ctx, shop, playerInvIdx) {
  var inv = ctx.player && ctx.player.inventory ? ctx.player.inventory : [];
  if (playerInvIdx < 0 || playerInvIdx >= inv.length) return false;
  var it = inv[playerInvIdx];
  if (!it || it.kind === "gold") return false;

  // validate against shop rules
  var ok = canSellToShop(shop.type, it.kind);
  if (!ok) { try { ctx.log && ctx.log("This shop won't buy that.", "warn"); } catch (_) {} return false; }

  // price
  var pay = _computeSellPay(ctx, shop.type, it);

  // pay gold
  var goldObj = null;
  for (var i = 0; i < inv.length; i++) { if (inv[i] && inv[i].kind === "gold") { goldObj = inv[i]; break; } }
  if (!goldObj) { goldObj = { kind: "gold", amount: 0, name: "gold" }; inv.push(goldObj); }
  goldObj.amount = (goldObj.amount | 0) + pay;

  // decrement/remove stack
  if ((it.kind === "potion" || it.kind === "drink") && (it.count || 1) > 1) {
    it.count = (it.count | 0) - 1;
  } else {
    inv.splice(playerInvIdx, 1);
  }

  try { ctx.updateUI && ctx.updateUI(); if (ctx.renderInventory) ctx.renderInventory(); } catch (_) {}
  try { ctx.log && ctx.log("You sold " + (ctx.describeItem ? ctx.describeItem(it) : (it && it.name) || "item") + " for " + pay + " gold.", "good"); } catch (_) {}
  return true;
}

export function getSellPrice(ctx, shop, item) {
  try {
    if (!ctx || !shop || !item) return 0;
    return _computeSellPay(ctx, shop.type, item);
  } catch (_) {
    return 0;
  }
}

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("ShopService", {
  minutesOfDay,
  isOpenAt,
  isShopOpenNow,
  shopScheduleStr,
  shopAt,
  getPhase,
  ensureShopState,
  restockIfNeeded,
  getInventoryForShop,
  canBuyFromShop,
  canSellToShop,
  calculatePrice,
  getSellPrice,
  buyItem,
  sellItem
});