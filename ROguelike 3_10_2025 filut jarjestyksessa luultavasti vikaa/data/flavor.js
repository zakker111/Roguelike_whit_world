/**
 * Flavor: lightweight combat flavor messages loaded from JSON (GameData.flavor).
 *
 * Exports (ESM + window.Flavor):
 * - logHit(ctx, { attacker, loc, crit })
 * - logPlayerHit(ctx, { target, loc, crit, dmg })
 * - announceFloorEnemyCount(ctx)
 *
 * Behavior:
 * - Logs flavor lines based on hit location and crits using pools from GameData.flavor.
 * - Deterministic via ctx.rng; if JSON is missing or a pool is absent, it skips logging (no hardcoded duplicates).
 */

function pickFrom(arr, ctx) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  if (ctx && ctx.utils && typeof ctx.utils.pick === "function") {
    return ctx.utils.pick(arr, ctx.rng);
  }
  // Prefer centralized RNGUtils when available
  try {
    if (typeof window !== "undefined" && window.RNGUtils) {
      const rngFn = (typeof window.RNGUtils.getRng === "function")
        ? window.RNGUtils.getRng((ctx && typeof ctx.rng === "function") ? ctx.rng : undefined)
        : ((ctx && typeof ctx.rng === "function") ? ctx.rng : undefined);
      if (typeof window.RNGUtils.int === "function" && typeof rngFn === "function") {
        const idx = window.RNGUtils.int(0, arr.length - 1, rngFn);
        return arr[idx];
      }
    }
  } catch (_) {}
  const r = (function () {
    try {
      if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function") {
        return window.RNGUtils.getRng((ctx && typeof ctx.rng === "function") ? ctx.rng : undefined);
      }
    } catch (_) {}
    return (ctx && typeof ctx.rng === "function") ? ctx.rng : null;
  })();
  if (typeof r !== "function") return arr[0];
  return arr[Math.floor(r() * arr.length)];
}

function tmpl(str, vars) {
  if (typeof str !== "string") return "";
  return str.replace(/\{(\w+)\}/g, (_, k) => (vars && k in vars) ? String(vars[k]) : "");
}

function pools() {
  try {
    if (typeof window !== "undefined" && window.GameData && window.GameData.flavor && typeof window.GameData.flavor === "object") {
      return window.GameData.flavor;
    }
  } catch (_) {}
  return null;
}

// Death-specific pools from flavor.json (schema: { death: { category: { part: { normal, crit } } } })
function deathPools() {
  try {
    if (typeof window !== "undefined" && window.GameData && window.GameData.flavor && typeof window.GameData.flavor === "object") {
      const f = window.GameData.flavor;
      return (f && typeof f.death === "object") ? f.death : null;
    }
  } catch (_) {}
  return null;
}

// Infer flavor category from enemy type and player weapon (blunt/sharp/animal/undead/giant/default)
function flavorCategory(ctx, target) {
  const t = String((target && target.type) || "").toLowerCase();
  if (/deer|boar|fox|animal/.test(t)) return "animal";
  if (/ghost|spirit|wraith|skeleton|undead|zombie/.test(t)) return "undead";
  if (/ogre|troll|giant/.test(t)) return "giant";
  // Weapon-based (blunt vs sharp) heuristic
  try {
    const eq = (ctx && ctx.player && ctx.player.equipment) ? ctx.player.equipment : {};
    const name = (eq.right && eq.right.name) || (eq.left && eq.left.name) || "";
    if (/mace|club|hammer|stick/i.test(name)) return "blunt";
    if (/sword|axe|dagger|blade|sabre|saber/i.test(name)) return "sharp";
  } catch (_) {}
  return "default";
}

// Normalize a flavor entry into an array of strings.
// Accepts string | string[] | { [key:string]: string }
function normalizeLines(v) {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.filter(s => typeof s === "string");
  if (v && typeof v === "object") {
    try {
      return Object.keys(v).sort().map(k => v[k]).filter(s => typeof s === "string");
    } catch (_) { return []; }
  }
  return [];
}

// Pick death flavor lines (array) for a given category/part/crit flag.
// Fallback chain: category->part->crit/normal, else default category, else [].
function pickDeathLine(P, category, part, isCrit) {
  if (!P || typeof P !== "object") return [];
  const cat = P[category] || P.default || null;
  if (!cat || typeof cat !== "object") return [];
  const seg = cat[part] || cat.torso || null;
  if (!seg || typeof seg !== "object") return [];
  const v = isCrit ? (seg.crit || null) : (seg.normal || null);
  return normalizeLines(v);
}

// Log a death flavor line using flavor.json death section
export function logDeath(ctx, opts) {
  if (!ctx || typeof ctx.log !== "function") return;
  const target = (opts && opts.target) || {};
  const loc = (opts && opts.loc) || { part: "torso" };
  const isCrit = !!(opts && opts.crit);
  const P = deathPools(); if (!P) return;
  const cat = flavorCategory(ctx, target);
  const lines = pickDeathLine(P, cat, String(loc.part || "torso"), isCrit);
  if (!Array.isArray(lines) || lines.length === 0) return;
  const line = pickFrom(lines, ctx);
  // Chance gating: log death flavor often; deterministic when RNGUtils is present
  let ok = true;
  try {
    const RU = (typeof window !== "undefined") ? window.RNGUtils : null;
    if (RU && typeof RU.getRng === "function" && typeof RU.chance === "function") {
      const rng = RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined);
      ok = RU.chance(isCrit ? 0.9 : 0.75, rng);
    }
  } catch (_) {}
  if (ok && typeof line === "string" && line) ctx.log(line, "flavor");
}

export function logHit(ctx, opts) {
  if (!ctx || typeof ctx.log !== "function") return;
  const attacker = (opts && opts.attacker) || {};
  const loc = (opts && opts.loc) || { part: "torso" };
  const crit = !!(opts && opts.crit);

  // Use flavor.json death pools as general combat flavor source
  const P = deathPools(); if (!P) return;
  const cat = flavorCategory(ctx, attacker);
  const part = String(loc.part || "torso");
  const lines = pickDeathLine(P, cat, part, crit);
  if (!Array.isArray(lines) || lines.length === 0) return;

  // Chance gating via RNGUtils when available
  let ok = true;
  try {
    const RU = (typeof window !== "undefined") ? window.RNGUtils : null;
    if (RU && typeof RU.getRng === "function" && typeof RU.chance === "function") {
      const rng = RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined);
      ok = RU.chance(crit ? 0.6 : 0.4, rng);
    }
  } catch (_) {}
  if (!ok) return;

  const line = pickFrom(lines, ctx);
  if (typeof line === "string" && line) ctx.log(line, crit ? "flavor" : "info");
}

export function logPlayerHit(ctx, opts) {
  if (!ctx || typeof ctx.log !== "function") return;
  const target = (opts && opts.target) || {};
  const loc = (opts && opts.loc) || {};
  const crit = !!(opts && opts.crit);
  const dmg = (opts && typeof opts.dmg === "number") ? opts.dmg : null;
  const P = deathPools(); if (!P) return;

  // Choose line from death pools based on category/part/crit (reuse for hit flavor)
  const cat = flavorCategory(ctx, target);
  const part = String(loc.part || "torso");
  const lines = pickDeathLine(P, cat, part, crit);
  if (!Array.isArray(lines) || lines.length === 0) return;

  // Chance gating with RNGUtils when available
  let p = crit ? 0.85 : (dmg != null && dmg >= 2.0 ? 0.7 : 0.4);
  let ok = true;
  try {
    const RU = (typeof window !== "undefined") ? window.RNGUtils : null;
    if (RU && typeof RU.getRng === "function" && typeof RU.chance === "function") {
      const rng = RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined);
      ok = RU.chance(p, rng);
    }
  } catch (_) {}
  if (!ok) return;

  const line = pickFrom(lines, ctx);
  if (typeof line === "string" && line) ctx.log(line, crit ? "flavor" : "info");
}

export function announceFloorEnemyCount(ctx) {
  if (!ctx || typeof ctx.log !== "function" || !Array.isArray(ctx.enemies)) return;
  const n = ctx.enemies.length | 0;
  try {
    const M = (typeof window !== "undefined" ? window.Messages : null);
    if (M && typeof M.get === "function") {
      if (n <= 0) {
        const text = M.get("dungeon.floorEnemyCount0");
        if (text) ctx.log(text, "notice");
      } else if (n === 1) {
        const text = M.get("dungeon.floorEnemyCount1");
        if (text) ctx.log(text, "notice");
      } else {
        const text = M.get("dungeon.floorEnemyCountMany", { n });
        if (text) ctx.log(text, "notice");
      }
      return;
    }
  } catch (_) {}
}

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("Flavor", { logHit, logPlayerHit, logDeath, announceFloorEnemyCount });