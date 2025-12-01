/**
 * InjuryService
 * Data-driven injury definitions and gameplay effects.
 *
 * Backed by GameData.injuries (data/balance/injuries.json).
 *
 * API (ESM + window.InjuryService):
 *  - getDefById(id)
 *  - getDefByName(name)
 *  - chooseInjuryForHit(ctx, { location, isCrit, source, rand })
 *  - addPlayerInjury(ctx, idOrName, opts?)
 *  - getPlayerInjuryModifiers(ctx)
 *  - getPlayerInjuryModifiersForPlayer(player)
 */

import { getGameData } from "../utils/access.js";
import { attachGlobal } from "../utils/global.js";

let _rootRef = null;
let _byId = null;
let _byName = null;
let _hitTables = null;

function getRoot() {
  const GD = getGameData(null);
  if (GD && GD.injuries && typeof GD.injuries === "object") {
    return GD.injuries;
  }
  if (typeof window !== "undefined" && window.GameData && window.GameData.injuries && typeof window.GameData.injuries === "object") {
    return window.GameData.injuries;
  }
  throw new Error("InjuryService: GameData.injuries missing or invalid. Ensure data/balance/injuries.json is loaded and GameData.ready has resolved.");
}

function ensureIndex() {
  const root = getRoot();
  if (root === _rootRef && _byId && _byName && _hitTables) return;
  _rootRef = root;
  _byId = Object.create(null);
  _byName = Object.create(null);
  _hitTables = Array.isArray(root.hitTables) ? root.hitTables.slice(0) : [];

  const list = Array.isArray(root.injuries) ? root.injuries : [];
  for (let i = 0; i < list.length; i++) {
    const def = list[i];
    if (!def || typeof def !== "object") continue;
    const id = def.id ? String(def.id) : null;
    const name = def.name ? String(def.name) : null;
    if (id) _byId[id] = def;
    if (name) _byName[name.toLowerCase()] = def;
  }
}

function getDefById(id) {
  if (!id) return null;
  ensureIndex();
  const key = String(id);
  return _byId && Object.prototype.hasOwnProperty.call(_byId, key) ? _byId[key] : null;
}

function getDefByName(name) {
  if (!name) return null;
  ensureIndex();
  const key = String(name).toLowerCase();
  return _byName && Object.prototype.hasOwnProperty.call(_byName, key) ? _byName[key] : null;
}

function rngFrom(ctx, randOverride) {
  if (typeof randOverride === "function") return randOverride;
  try {
    if (ctx && typeof ctx.rng === "function") return ctx.rng;
  } catch (_) {}
  try {
    if (typeof window !== "undefined" && window.RNG && typeof window.RNG.rng === "function") {
      return window.RNG.rng;
    }
  } catch (_) {}
  return Math.random;
}

function chooseInjuryForHit(ctx, opts = {}) {
  ensureIndex();
  if (!_hitTables || !_hitTables.length) return null;

  const locRaw = opts.location != null ? String(opts.location) : "";
  const loc = locRaw.toLowerCase();
  const isCrit = !!opts.isCrit;
  const source = opts.source != null ? String(opts.source) : "enemy_hit_player";
  const rfn = rngFrom(ctx, opts.rand);

  const candidates = [];
  for (let i = 0; i < _hitTables.length; i++) {
    const t = _hitTables[i];
    if (!t || typeof t !== "object") continue;
    const tOn = t.on != null ? String(t.on) : "enemy_hit_player";
    const tLoc = t.location != null ? String(t.location).toLowerCase() : "";
    const tCrit = !!t.critOnly;
    if (tOn !== source) continue;
    if (tLoc && tLoc !== loc) continue;
    if (tCrit !== isCrit) continue;
    candidates.push(t);
  }
  if (!candidates.length) return null;
  const table = candidates[0];

  const baseChance = (typeof table.baseChance === "number" && table.baseChance > 0) ? table.baseChance : 0;
  if (!(baseChance > 0)) return null;
  if (rfn() >= baseChance) return null;

  const entries = Array.isArray(table.entries) ? table.entries : [];
  if (!entries.length) return null;

  let total = 0;
  for (let i = 0; i < entries.length; i++) {
    const en = entries[i];
    const w = Number(en && (en.weight != null ? en.weight : en.w)) || 0;
    if (w > 0) total += w;
  }
  if (!(total > 0)) return null;

  let roll = rfn() * total;
  for (let i = 0; i < entries.length; i++) {
    const en = entries[i];
    const w = Number(en && (en.weight != null ? en.weight : en.w)) || 0;
    if (!(w > 0)) continue;
    if (roll < w) {
      const key = en.injuryId || en.id || en.name || null;
      if (!key) return null;
      const def =
        getDefById(key) ||
        getDefByName(key) ||
        null;
      if (def) return def;
      return { id: key, name: String(key) };
    }
    roll -= w;
  }
  return null;
}

function addPlayerInjury(ctx, idOrName, opts = {}) {
  if (!ctx || !ctx.player) return false;
  const p = ctx.player;
  if (!Array.isArray(p.injuries)) p.injuries = [];
  const list = p.injuries;

  const keyRaw = idOrName != null ? idOrName : (opts && opts.name);
  if (!keyRaw) return false;

  const keyStr = String(keyRaw);
  let def = getDefById(keyStr);
  if (!def) def = getDefByName(keyStr);

  const name = def && def.name ? String(def.name) : keyStr;

  const exists = list.some((it) => {
    if (!it) return false;
    if (typeof it === "string") return String(it) === name;
    if (it.id && def && it.id === def.id) return true;
    return String(it.name || "") === name;
  });
  if (exists) return false;

  const explicitHealable = (opts && typeof opts.healable === "boolean") ? opts.healable : null;
  const explicitDuration = (opts && typeof opts.durationTurns === "number") ? opts.durationTurns : null;
  const baseHealable = def && typeof def.healable === "boolean"
    ? !!def.healable
    : true;
  const healable = explicitHealable != null ? explicitHealable : baseHealable;

  let durationTurns = 0;
  if (healable) {
    if (explicitDuration != null) {
      durationTurns = explicitDuration | 0;
    } else if (def && typeof def.defaultDurationTurns === "number") {
      durationTurns = def.defaultDurationTurns | 0;
    } else {
      durationTurns = 40;
    }
    if (durationTurns < 10) durationTurns = 10;
  }

  const entry = {
    id: def && def.id ? def.id : null,
    name,
    healable,
    durationTurns: healable ? durationTurns : 0
  };
  list.push(entry);
  if (list.length > 24) list.splice(0, list.length - 24);

  try {
    if (typeof ctx.log === "function") {
      ctx.log(`You suffer ${name}.`, "warn");
    }
  } catch (_) {}

  return true;
}

function computeModifiersForPlayer(player) {
  ensureIndex();
  const out = {
    attackMultiplier: 1,
    fovPenalty: 0,
    timeTicksPerTurnExtra: 0,
    headDazeBonus: 0
  };

  if (!player || !Array.isArray(player.injuries) || !player.injuries.length) {
    return out;
  }

  const list = player.injuries;
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (!it) continue;
    let id = null;
    let name = null;
    if (typeof it === "string") {
      name = it;
    } else if (typeof it === "object") {
      if (it.id) id = String(it.id);
      if (it.name) name = String(it.name);
    }
    let def = null;
    if (id) def = getDefById(id);
    if (!def && name) def = getDefByName(name);
    if (!def || !def.effects || typeof def.effects !== "object") continue;
    const eff = def.effects;

    if (typeof eff.attackMultiplier === "number" && eff.attackMultiplier > 0) {
      out.attackMultiplier *= eff.attackMultiplier;
    }
    if (typeof eff.fovPenalty === "number" && eff.fovPenalty !== 0) {
      out.fovPenalty += eff.fovPenalty;
    }
    if (typeof eff.timeTicksPerTurnExtra === "number" && eff.timeTicksPerTurnExtra !== 0) {
      out.timeTicksPerTurnExtra += eff.timeTicksPerTurnExtra;
    }
    if (typeof eff.dazeOnHeadHitBonus === "number" && eff.dazeOnHeadHitBonus !== 0) {
      out.headDazeBonus += eff.dazeOnHeadHitBonus;
    }
  }

  if (!(out.attackMultiplier > 0)) out.attackMultiplier = 1;
  if (out.attackMultiplier < 0.5) out.attackMultiplier = 0.5;

  if (!(out.fovPenalty > 0)) out.fovPenalty = 0;
  if (out.fovPenalty > 3) out.fovPenalty = 3;

  if (!(out.timeTicksPerTurnExtra > 0)) out.timeTicksPerTurnExtra = 0;
  if (out.timeTicksPerTurnExtra > 2) out.timeTicksPerTurnExtra = 2;
  out.timeTicksPerTurnExtra = out.timeTicksPerTurnExtra | 0;

  if (!(out.headDazeBonus > 0)) out.headDazeBonus = 0;
  if (out.headDazeBonus > 0.2) out.headDazeBonus = 0.2;

  return out;
}

function getPlayerInjuryModifiers(ctx) {
  const p = ctx && ctx.player ? ctx.player : null;
  return computeModifiersForPlayer(p);
}

function getPlayerInjuryModifiersForPlayer(player) {
  return computeModifiersForPlayer(player);
}

export {
  getDefById,
  getDefByName,
  chooseInjuryForHit,
  addPlayerInjury,
  getPlayerInjuryModifiers,
  getPlayerInjuryModifiersForPlayer
};

attachGlobal("InjuryService", {
  getDefById,
  getDefByName,
  chooseInjuryForHit,
  addPlayerInjury,
  getPlayerInjuryModifiers,
  getPlayerInjuryModifiersForPlayer
});