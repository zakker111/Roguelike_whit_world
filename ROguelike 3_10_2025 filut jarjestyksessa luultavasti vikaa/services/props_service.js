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
      _log(ctx, final, isOpen ? "good" : "warn");
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

export function interact(ctx, prop) {
  if (!ctx || ctx.mode !== "town" || !prop) return false;
  const map = _propsMap();
  if (!map) return false;
  const key = String(prop.type || "").toLowerCase();
  const def = map[key];
  if (!def || !Array.isArray(def.variants) || !def.variants.length) return false;

  const ph = _phase(ctx);
  const insideInn = _isInsideInn(ctx, prop.x, prop.y);
  // Helper: does player have current night rented?
  const hasInnStay = (function () {
    const dayIdx = _dayIndex(ctx);
    return !!(ctx.player && ctx.player._innStayDay === dayIdx);
  })();

  // Pick first matching variant by conditions
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

  // Execute effect if any
  const eff = variant.effect || null;
  if (eff && eff.type === "restUntil") {
    const delta = _restUntil(ctx, eff.hhmm || "06:00");
    const res = _healByPercent(ctx, eff.healPercent || 0);
    const msg = _renderTemplate(eff.logTemplate || "You rest until morning (${time}). HP ${prev} -> ${hp}.", { time: _timeHHMM(ctx), prev: (res.prev.toFixed ? res.prev.toFixed(1) : res.prev), hp: (res.hp.toFixed ? res.hp.toFixed(1) : res.hp) });
    _log(ctx, msg, variant.style || "info");
    // Ensure HUD/time reflect changes immediately
    try {
      const SS = ctx.StateSync || (typeof window !== "undefined" ? window.StateSync : null);
      if (SS && typeof SS.applyAndRefresh === "function") {
        SS.applyAndRefresh(ctx, {});
      }
    } catch (_) {}
    return true;
  }
  if (eff && eff.type === "restTurn") {
    // Simple one-turn rest with a log; consistent with Wait semantics.
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
    // Open Quest Board panel (placeholder UI) via UIOrchestration where available
    try {
      const UIO = (typeof window !== "undefined" ? window.UIOrchestration : (ctx.UIOrchestration || null));
      const wasOpen = UIO && typeof UIO.isQuestBoardOpen === "function" ? !!UIO.isQuestBoardOpen(ctx) : false;
      if (UIO && typeof UIO.showQuestBoard === "function") UIO.showQuestBoard(ctx);
      // Request draw only if open-state changed
      try { if (!wasOpen && typeof ctx.requestDraw === "function") ctx.requestDraw(); } catch (_) {}
    } catch (_) {}
    _log(ctx, variant.message || "Quest Board", variant.style || "info");
    return true;
  }

  // Default: just log the message
  _log(ctx, _renderTemplate(variant.message || "", { title: prop.name || "" }), variant.style || "info");
  return true;
}

import { parseHHMM } from "./time_service.js";
// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.PropsService = { interact };
}