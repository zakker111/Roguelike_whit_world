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
  const r = (ctx && typeof ctx.rng === "function")
    ? ctx.rng
    : (typeof window !== "undefined" && window.RNG && typeof window.RNG.rng === "function"
      ? window.RNG.rng
      : (typeof window !== "undefined" && window.RNGFallback && typeof window.RNGFallback.getRng === "function"
          ? window.RNGFallback.getRng()
          : Math.random));
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

export function logHit(ctx, opts) {
  if (!ctx || typeof ctx.log !== "function" || typeof ctx.rng !== "function") return;
  const loc = (opts && opts.loc) || {};
  const crit = !!(opts && opts.crit);
  const P = pools(); if (!P) return;

  if (crit && loc.part === "head") {
    const line = pickFrom(P.headCrit, ctx);
    if (line && ctx.rng() < 0.6) ctx.log(line, "flavor");
    return;
  }
  if (loc.part === "torso") {
    const line = pickFrom(P.torsoStingPlayer, ctx);
    if (line && ctx.rng() < 0.5) ctx.log(line, "info");
    return;
  }
}

export function logPlayerHit(ctx, opts) {
  if (!ctx || typeof ctx.log !== "function" || typeof ctx.rng !== "function") return;
  const target = (opts && opts.target) || {};
  const loc = (opts && opts.loc) || {};
  const crit = !!(opts && opts.crit);
  const dmg = (opts && typeof opts.dmg === "number") ? opts.dmg : null;
  const P = pools(); if (!P) return;

  // Blood spill flavor
  if (dmg != null && dmg > 0) {
    const line = pickFrom(P.bloodSpill, ctx);
    const p = crit ? 0.5 : 0.25;
    if (line && ctx.rng() < p) ctx.log(line, "flavor");
  }

  // Crit head variants
  if (crit && loc.part === "head") {
    const name = (target && target.type) ? target.type : "enemy";
    const tmplStr = pickFrom(P.playerCritHeadVariants, ctx);
    if (tmplStr && ctx.rng() < 0.6) ctx.log(tmpl(tmplStr, { name }), "notice");
    return;
  }

  // Good damage variants
  if (!crit && dmg != null && dmg >= 2.0) {
    const name = (target && target.type) ? target.type : "enemy";
    const part = (loc && loc.part) ? loc.part : "body";
    const tmplStr = pickFrom(P.playerGoodHitVariants, ctx);
    if (tmplStr && ctx.rng() < 0.8) ctx.log(tmpl(tmplStr, { name, part }), "good");
  }

  if (loc.part === "torso") {
    const line = pickFrom(P.enemyTorsoSting, ctx);
    if (line && ctx.rng() < 0.5) ctx.log(line, "info");
    return;
  }
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
import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("Flavor", { logHit, logPlayerHit, announceFloorEnemyCount }););