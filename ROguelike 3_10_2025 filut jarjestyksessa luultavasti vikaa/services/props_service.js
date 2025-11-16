/**
 * PropsService: data-driven interactions for town props using GameData.props.
 * Exports (ESM + window.PropsService):
 * - interact(ctx, prop) -> handled:boolean
 *
 * Notes:
 * - Variant selection uses `when` conditions: phaseIs/phaseNot, insideInn, requiresInnStay, nearShop.
 * - Supported effects: restUntil, restTurn, grantMaterial, signSchedule, sleepModal, questBoard.
 */
function _propsMap() {
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const arr = GD && GD.props && Array.isArray(GD.props.props) ? GD.props.props : null;
    if (!arr) return null;
    const map = {};
    for (let i = 0; i < arr.length; i++) {
      const id = String(arr[i].id || "").toLowerCase();
      if (id) map[id] = arr[i];
    }
    return map;
  } catch (_) { return null; }
}

function _phase(ctx) {
  try { return (ctx && ctx.time && ctx.time.phase) ? String(ctx.time.phase) : "day"; } catch (_) { return "day"; }
}

function _dayIndex(ctx) {
  try {
    const tc = (ctx.time && typeof ctx.time.turnCounter === "number") ? (ctx.time.turnCounter | 0) : 0;
    const ct = (ctx.time && typeof ctx.time.cycleTurns === "number") ? (ctx.time.cycleTurns | 0) : 360;
    return Math.floor(tc / Math.max(1, ct));
  } catch (_) { return 0; }
}

function _isInsideInn(ctx, x, y) {
  try {
    const tav = (ctx.tavern && ctx.tavern.building) ? ctx.tavern.building : null;
    return !!(tav && x > tav.x && x < tav.x + tav.w - 1 && y > tav.y && y < tav.y + tav.h - 1);
  } catch (_) { return false; }
}

function _adjacentShops(ctx, x, y) {
  const out = [];
  try {
    const near = [
      { x, y }, { x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 },
    ];
    for (const c of near) {
      let s = null;
      if (ctx && ctx.ShopService && typeof ctx.ShopService.shopAt === "function") {
        s = ctx.ShopService.shopAt(ctx, c.x, c.y);
      } else if (typeof window !== "undefined" && window.ShopService && typeof window.ShopService.shopAt === "function") {
        s = window.ShopService.shopAt(ctx, c.x, c.y);
      }
      if (s) out.push(s);
    }
  } catch (_) {}
  return out;
}

function _timeHHMM(ctx) {
  try { return (ctx.time && ctx.time.hhmm) ? ctx.time.hhmm : "06:00"; } catch (_) { return "06:00"; }
}

function _advanceTime(ctx, minutes) {
  try {
    if (typeof ctx.advanceTimeMinutes === "function") ctx.advanceTimeMinutes(minutes);
    else if (typeof ctx.fastForwardMinutes === "function") ctx.fastForwardMinutes(minutes);
  } catch (_) {}
}

function _restUntil(ctx, hhmm) {
  try {
    const t = ctx.time;
    const goal = (function safeHHMMToMinutes(s){ try { const v = parseHHMM(String(s || "")); return (v == null) ? 6*60 : v; } catch (_) { return 6*60; } })(String(hhmm||"06:00"));
    const cur = t ? (t.hours * 60 + t.minutes) : 0;
    let delta = goal - cur; if (delta <= 0) delta += 24 * 60;
    _advanceTime(ctx, delta);
    return delta;
  } catch (_) { return 0; }
}

function _healByPercent(ctx, frac) {
  try {
    const prev = ctx.player.hp;
    const amt = Math.max(1, Math.floor(ctx.player.maxHp * Math.max(0, Math.min(1, frac || 0))));
    ctx.player.hp = Math.min(ctx.player.maxHp, ctx.player.hp + amt);
    return { prev, hp: ctx.player.hp };
  } catch (_) { return { prev: 0, hp: 0 }; }
}

function _grantMaterial(ctx, material, name, amount) {
  try {
    const inv = ctx.player.inventory || (ctx.player.inventory = []);
    const existing = inv.find(it => it && it.kind === "material" && (it.type === material || it.material === material) && (String(it.name || "").toLowerCase() === String(name || "").toLowerCase()));
    if (existing) {
      if (typeof existing.amount === "number") existing.amount += (amount | 0);
      else if (typeof existing.count === "number") existing.count += (amount | 0);
      else existing.amount = (amount | 0);
    } else {
      inv.push({ kind: "material", type: material, material, name, amount: (amount | 0) });
    }
    if (typeof ctx.updateUI === "function") ctx.updateUI();
  } catch (_) {}
}

function _removeProp(ctx, x, y, type) {
  try {
    const idx = ctx.townProps.findIndex(tp => tp && tp.x === x && tp.y === y && (!type || tp.type === type));
    if (idx !== -1) ctx.townProps.splice(idx, 1);
  } catch (_) {}
}

function _renderTemplate(str, vars) {
  return String(str || "").replace(/\$\{(\w+)\}/g, function (_, k) {
    return (vars && Object.prototype.hasOwnProperty.call(vars, k)) ? String(vars[k]) : "";
  });
}

function _log(ctx, text, style) {
  try { ctx.log && ctx.log(text, style || "info"); } catch (_) {}
}

function _signSchedule(ctx, p, template, style) {
  let shop = null, sched = "", openNowStatus = "";
  try {
    const shops = _adjacentShops(ctx, p.x, p.y);
    shop = shops.length ? shops[0] : null;
    if (shop) {
      const isOpen = (window.ShopService && typeof window.ShopService.isShopOpenNow === "function") ? window.ShopService.isShopOpenNow(ctx, shop) : false;
      sched = (window.ShopService && typeof window.ShopService.shopScheduleStr === "function") ? window.ShopService.shopScheduleStr(shop) : "";
      openNowStatus = isOpen ? "Open now." : "Closed now.";
      const final = _renderTemplate(template, { title: p.name || "Sign", schedule: sched, openNowStatus });
      // Shop signs should log as neutral info (not green/warn)
      _log(ctx, final, "info");
      return true;
    }
  } catch (_) {}
  // Fallback to generic sign text with title only
  const final = _renderTemplate(template || "Sign: ${title}", { title: p.name || "Sign" });
  _log(ctx, final, style || "info");
  return true;
}

function _sleepModal(ctx, defaultMinutes, logTemplate) {
  const UIO = (typeof window !== "undefined" ? window.UIOrchestration : (ctx.UIOrchestration || null));
  const UB = (typeof window !== "undefined" ? window.UIBridge : (ctx.UIBridge || null));
  const mins = Math.max(30, defaultMinutes | 0);
  const afterTime = function (m) {
    const prev = ctx.player.hp;
    const healFrac = Math.min(0.6, Math.max(0.08, m / 600));
    const res = _healByPercent(ctx, healFrac);
    const timeStr = _timeHHMM(ctx);
    const msg = _renderTemplate(logTemplate || "You sleep for ${minutes} minutes (${time}). HP ${prev} -> ${hp}.", { minutes: m, time: timeStr, prev: prev.toFixed ? prev.toFixed(1) : prev, hp: (res.hp.toFixed ? res.hp.toFixed(1) : res.hp) });
    _log(ctx, msg, "good");
  };
  try {
    // Prefer UIOrchestration if it exposes showSleep/animateSleep
    if (UIO && typeof UIO.showSleep === "function") {
      UIO.showSleep(ctx, {
        min: 30, max: 720, step: 30, value: mins,
        onConfirm: function (m) {
          if (UIO && typeof UIO.animateSleep === "function") {
            UIO.animateSleep(ctx, m, afterTime);
          } else {
            _advanceTime(ctx, m);
            afterTime(m);
          }
        }
      });
      return;
    }
    // Fallback to UIBridge if still present
    if (UB && typeof UB.showSleep === "function") {
      UB.showSleep(ctx, {
        min: 30, max: 720, step: 30, value: mins,
        onConfirm: function (m) {
          if (UB && typeof UB.animateSleep === "function") {
            UB.animateSleep(ctx, m, afterTime);
          } else {
            _advanceTime(ctx, m);
            afterTime(m);
          }
        }
      });
      return;
    }
    // Final fallback: no UI — advance time directly
    _advanceTime(ctx, mins);
    afterTime(mins);
    try {
      const SS = ctx.StateSync || (typeof window !== "undefined" ? window.StateSync : null);
      if (SS && typeof SS.applyAndRefresh === "function") {
        SS.applyAndRefresh(ctx, {});
      }
    } catch (_) {}
  } catch (_) {}
}

/* Fireplace cooking (town) */

function _matName(ctx, id) {
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const mats = GD && GD.materials && (Array.isArray(GD.materials.materials) ? GD.materials.materials : GD.materials.list);
    const iid = String(id || "").toLowerCase();
    if (Array.isArray(mats)) {
      const entry = mats.find(m => m && (String(m.id || "").toLowerCase() === iid || String(m.name || "").toLowerCase() === iid));
      return entry && entry.name ? entry.name : String(id).replace(/_/g, " ");
    }
  } catch (_) {}
  return String(id || "").replace(/_/g, " ");
}

function _findCampfireRecipe(ctx, inputId) {
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const recipes = GD && GD.crafting && Array.isArray(GD.crafting.recipes) ? GD.crafting.recipes : [];
    const iid = String(inputId || "").toLowerCase();
    const rj = recipes.find(r =>
      r && String(r.station || "").toLowerCase() === "campfire" &&
      Array.isArray(r.inputs) &&
      r.inputs.some(inp => String(inp.id || "").toLowerCase() === iid)
    );
    if (rj) return rj;
    if (iid === "meat") return { id: "cook_meat_default", station: "campfire", inputs: [{ id: "meat", amount: 1 }], outputs: [{ id: "meat_cooked", amount: 1 }] };
    if (iid === "fish") return { id: "cook_fish_default", station: "campfire", inputs: [{ id: "fish", amount: 1 }], outputs: [{ id: "fish_cooked", amount: 1 }] };
    return null;
  } catch (_) {
    const iid = String(inputId || "").toLowerCase();
    if (iid === "meat") return { id: "cook_meat_default", station: "campfire", inputs: [{ id: "meat", amount: 1 }], outputs: [{ id: "meat_cooked", amount: 1 }] };
    if (iid === "fish") return { id: "cook_fish_default", station: "campfire", inputs: [{ id: "fish", amount: 1 }], outputs: [{ id: "fish_cooked", amount: 1 }] };
    return null;
  }
}

function _collectMaterial(ctx, inputId) {
  const inv = (ctx && ctx.player && Array.isArray(ctx.player.inventory)) ? ctx.player.inventory : [];
  const iid = String(inputId || "").toLowerCase();
  const idxs = [];
  let total = 0;
  for (let i = 0; i < inv.length; i++) {
    const it = inv[i];
    if (!it || it.kind !== "material") continue;
    const id = String(it.type || it.name || "").toLowerCase();
    if (id === iid) {
      const amt = (it.amount | 0) || (it.count | 0) || 1;
      total += amt;
      idxs.push(i);
    }
  }
  return { idxs, total };
}

function _applyCooking(ctx, inputId, bundle) {
  const rec = _findCampfireRecipe(ctx, inputId);
  if (!rec || !Array.isArray(rec.outputs) || rec.outputs.length === 0) {
    _log(ctx, "You stand by the fireplace.", "info");
    return;
  }
  const inv = ctx.player.inventory || (ctx.player.inventory = []);
  const outId = String(rec.outputs[0].id || "");
  const outName = _matName(ctx, outId);
  const inName = _matName(ctx, inputId);

  let remaining = bundle.total;
  bundle.idxs.sort((a, b) => {
    const aa = ((inv[a]?.amount | 0) || (inv[a]?.count | 0) || 1);
    const bb = ((inv[b]?.amount | 0) || (inv[b]?.count | 0) || 1);
    return bb - aa;
  });
  for (const idx of bundle.idxs) {
    if (remaining <= 0) break;
    const it = inv[idx];
    if (!it) continue;
    const amt = (it.amount | 0) || (it.count | 0) || 1;
    const take = Math.min(amt, remaining);
    const left = amt - take;
    if (typeof it.amount === "number") it.amount = left;
    else if (typeof it.count === "number") it.count = left;
    if (((it.amount | 0) || (it.count | 0) || 0) <= 0) {
      inv.splice(idx, 1);
    }
    remaining -= take;
  }
  const existing = inv.find(x => x && x.kind === "material" && String(x.type || x.name || "").toLowerCase() === outId.toLowerCase());
  if (existing) {
    if (typeof existing.amount === "number") existing.amount += bundle.total;
    else if (typeof existing.count === "number") existing.count += bundle.total;
    else existing.amount = bundle.total;
  } else {
    inv.push({ kind: "material", type: outId, name: outName, amount: bundle.total });
  }
  try { ctx.player.skills = ctx.player.skills || {}; ctx.player.skills.cooking = (ctx.player.skills.cooking || 0) + Math.max(1, bundle.total); } catch (_) {}
  _log(ctx, `You cook ${bundle.total} ${inName} into ${bundle.total} ${outName}.`, "good");
  try {
    if (typeof ctx.updateUI === "function") ctx.updateUI();
    const UIO = (typeof window !== "undefined" ? window.UIOrchestration : (ctx.UIOrchestration || null));
    if (UIO && typeof UIO.renderInventory === "function") UIO.renderInventory(ctx);
  } catch (_) {}
}

function _interactFireplace(ctx) {
  try {
    const UIO = (typeof window !== "undefined" ? window.UIOrchestration : (ctx.UIOrchestration || null));
    const meat = _collectMaterial(ctx, "meat");
    const fish = _collectMaterial(ctx, "fish");
    const canMeat = meat.total > 0 && !!_findCampfireRecipe(ctx, "meat");
    const canFish = fish.total > 0 && !!_findCampfireRecipe(ctx, "fish");

    if (!canFish && !canMeat) {
      _log(ctx, "You stand by the fireplace.", "info");
      return true;
    } else if (canFish && !canMeat) {
      const prompt = `You stand by the fireplace. Cook ${fish.total} ${_matName(ctx, "fish")}?`;
      const onOk = () => _applyCooking(ctx, "fish", fish);
      const onCancel = () => _log(ctx, "You warm your hands by the fire.", "info");
      if (UIO && typeof UIO.showConfirm === "function") UIO.showConfirm(ctx, prompt, null, onOk, onCancel);
      else onOk();
      return true;
    } else if (canMeat && !canFish) {
      const prompt = `You stand by the fireplace. Cook ${meat.total} ${_matName(ctx, "meat")}?`;
      const onOk = () => _applyCooking(ctx, "meat", meat);
      const onCancel = () => _log(ctx, "You warm your hands by the fire.", "info");
      if (UIO && typeof UIO.showConfirm === "function") UIO.showConfirm(ctx, prompt, null, onOk, onCancel);
      else onOk();
      return true;
    } else {
      const askMeat = () => {
        const promptM = `Cook ${meat.total} ${_matName(ctx, "meat")}?`;
        const onOkM = () => _applyCooking(ctx, "meat", meat);
        const onCancelM = () => _log(ctx, "You warm your hands by the fire.", "info");
        if (UIO && typeof UIO.showConfirm === "function") UIO.showConfirm(ctx, promptM, null, onOkM, onCancelM);
        else onOkM();
      };
      const promptF = `You stand by the fireplace. Cook ${fish.total} ${_matName(ctx, "fish")}? (Cancel for meat)`;
      const onOkF = () => _applyCooking(ctx, "fish", fish);
      const onCancelF = () => askMeat();
      if (UIO && typeof UIO.showConfirm === "function") UIO.showConfirm(ctx, promptF, null, onOkF, onCancelF);
      else onOkF();
      return true;
    }
  } catch (_) {
    _log(ctx, "You stand by the fireplace.", "info");
    return true;
  }
}

export function interact(ctx, prop) {
  if (!ctx || ctx.mode !== "town" || !prop) return false;
  const map = _propsMap();
  if (!map) return false;
  const key = String(prop.type || "").toLowerCase();
  const def = map[key];
  if (!def || !Array.isArray(def.variants) || !def.variants.length) return false;

  // Special-case: fireplace cooking in town
  if (key === "fireplace") {
    const handled = _interactFireplace(ctx);
    try {
      const SS = ctx.StateSync || (typeof window !== "undefined" ? window.StateSync : null);
      if (SS && typeof SS.applyAndRefresh === "function") {
        SS.applyAndRefresh(ctx, {});
      }
    } catch (_) {}
    return handled;
  }

  const ph = _phase(ctx);
  const insideInn = _isInsideInn(ctx, prop.x, prop.y);
  const hasInnStay = (function () {
    const dayIdx = _dayIndex(ctx);
    return !!(ctx.player && ctx.player._innStayDay === dayIdx);
  })();

  let variant = null;
  for (let i = 0; i < def.variants.length; i++) {
    const v = def.variants[i];
    const w = v.when || null;
    let ok = true;
    if (w && typeof w.phaseIs === "string") ok = ok && (ph === w.phaseIs);
    if (w && typeof w.phaseNot === "string") ok = ok && (ph !== w.phaseNot);
    if (w && w.insideInn === true) ok = ok && insideInn;
    if (w && w.requiresInnStay === true) ok = ok && hasInnStay;
    if (w && w.nearShop === true) ok = ok && (_adjacentShops(ctx, prop.x, prop.y).length > 0);
    if (ok) { variant = v; break; }
  }
  if (!variant) return false;

  const eff = variant.effect || null;
  if (eff && eff.type === "restUntil") {
    const delta = _restUntil(ctx, eff.hhmm || "06:00");
    const res = _healByPercent(ctx, eff.healPercent || 0);
    const msg = _renderTemplate(eff.logTemplate || "You rest until morning (${time}). HP ${prev} -> ${hp}.", { time: _timeHHMM(ctx), prev: (res.prev.toFixed ? res.prev.toFixed(1) : res.prev), hp: (res.hp.toFixed ? res.hp.toFixed(1) : res.hp) });
    _log(ctx, msg, variant.style || "info");
    try {
      const SS = ctx.StateSync || (typeof window !== "undefined" ? window.StateSync : null);
      if (SS && typeof SS.applyAndRefresh === "function") {
        SS.applyAndRefresh(ctx, {});
      }
    } catch (_) {}
    return true;
  }
  if (eff && eff.type === "restTurn") {
    _log(ctx, variant.message || "You rest a while.", variant.style || "info");
    try { if (typeof ctx.turn === "function") ctx.turn(); else if (typeof ctx.updateUI === "function") ctx.updateUI(); } catch (_) {}
    return true;
  }
  if (eff && eff.type === "grantMaterial") {
    _grantMaterial(ctx, eff.material || "wood", eff.name || "planks", eff.amount || 1);
    if (eff.removeProp) _removeProp(ctx, prop.x, prop.y, prop.type);
    _log(ctx, variant.message || "", variant.style || "notice");
    return true;
  }
  if (eff && eff.type === "signSchedule") {
    return _signSchedule(ctx, prop, variant.message || "Sign: ${title}", variant.style || "info");
  }
  if (eff && eff.type === "sleepModal") {
    _sleepModal(ctx, eff.defaultMinutes || 240, eff.logTemplate || "");
    _log(ctx, variant.message || "You lay down to sleep.", variant.style || "good");
    return true;
  }
  if (eff && eff.type === "questBoard") {
    try {
      const UIO = (typeof window !== "undefined" ? window.UIOrchestration : (ctx.UIOrchestration || null));
      const wasOpen = UIO && typeof UIO.isQuestBoardOpen === "function" ? !!UIO.isQuestBoardOpen(ctx) : false;
      if (UIO && typeof UIO.showQuestBoard === "function") UIO.showQuestBoard(ctx);
      try { if (!wasOpen && typeof ctx.requestDraw === "function") ctx.requestDraw(); } catch (_) {}
    } catch (_) {}
    _log(ctx, variant.message || "Quest Board", variant.style || "info");
    return true;
  }

  _log(ctx, _renderTemplate(variant.message || "", { title: prop.name || "" }), variant.style || "info");
  return true;
}

import { parseHHMM } from "./time_service.js";
// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.PropsService = { interact };
}