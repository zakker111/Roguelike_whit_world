import { getFollowerArchetypes } from "./followers_runtime.js";
import { getRNGUtils } from "../utils/access.js";
import { getFollowerDef } from "../entities/followers.js";

function pick(arr, ctx) {
  if (!Array.isArray(arr) || !arr.length) return null;
  let rfn = null;
  try {
    const RU = getRNGUtils(ctx);
    if (RU && typeof RU.getRng === "function") {
      rfn = RU.getRng(typeof ctx.rng === "function" ? ctx.rng : undefined);
    }
  } catch (_) {}
  if (typeof rfn !== "function") {
    if (typeof ctx.rng === "function") rfn = ctx.rng;
    else rfn = Math.random;
  }
  const idx = arr.length === 1 ? 0 : Math.floor(rfn() * arr.length) % arr.length;
  return arr[idx] || null;
}

function chance(ctx, p) {
  if (!(p > 0)) return false;
  if (p >= 1) return true;
  try {
    const RU = getRNGUtils(ctx);
    if (RU && typeof RU.getRng === "function" && typeof RU.chance === "function") {
      const rfn = RU.getRng(typeof ctx.rng === "function" ? ctx.rng : undefined);
      return RU.chance(p, rfn);
    }
  } catch (_) {}
  const r = (typeof ctx.rng === "function") ? ctx.rng() : Math.random();
  return r < p;
}

function followerRecordForActor(ctx, actor) {
  if (!ctx || !ctx.player || !Array.isArray(ctx.player.followers) || !actor) return null;
  const followers = ctx.player.followers;
  const fid = actor._followerId != null
    ? String(actor._followerId)
    : String(actor.type || actor.id || "");
  if (!fid) return null;
  for (let i = 0; i < followers.length; i++) {
    const f = followers[i];
    if (!f) continue;
    if (String(f.id || "") === fid) return f;
  }
  return null;
}

function followerDefForRecord(ctx, rec) {
  if (!rec) return null;
  try {
    if (rec.archetypeId) {
      return getFollowerDef(ctx, rec.archetypeId);
    }
  } catch (_) {}
  try {
    return getFollowerDef(ctx, rec.id);
  } catch (_) {}
  return null;
}

function resolveFlavorPools(ctx, rec, kind) {
  const def = followerDefForRecord(ctx, rec);
  let pool = null;
  try {
    if (def && def.flavor && Array.isArray(def.flavor[kind])) {
      pool = def.flavor[kind];
    }
  } catch (_) {}
  if (!pool || !pool.length) return [];
  return pool;
}

function formatLine(template, rec, actor) {
  if (typeof template !== "string") return "";
  const name = (rec && rec.name) || (actor && actor.name) || "Your follower";
  return template.replace(/\{name\}/g, String(name));
}

function canEmitFlavor(actor) {
  if (!actor) return false;
  const now = (actor._flavorCd | 0);
  return now <= 0;
}

function touchFlavorCooldown(actor, base = 5) {
  if (!actor) return;
  try {
    const cd = base | 0;
    actor._flavorCd = cd > 0 ? cd : 0;
  } catch (_) {}
}

export function tickFollowerFlavorCooldown(ctx) {
  try {
    if (!ctx || !Array.isArray(ctx.enemies)) return;
    for (const e of ctx.enemies) {
      if (!e || !e._isFollower) continue;
      if (typeof e._flavorCd === "number" && e._flavorCd > 0) {
        e._flavorCd -= 1;
      }
    }
  } catch (_) {}
}

export function logFollowerCritTaken(ctx, actor, loc, dmg) {
  try {
    if (!ctx || !actor || !actor._isFollower) return;
    const rec = followerRecordForActor(ctx, actor);
    if (!rec) return;
    const lines = resolveFlavorPools(ctx, rec, "critTaken");
    if (!lines.length) return;
    if (!canEmitFlavor(actor)) return;
    if (!chance(ctx, 0.8)) return; // high during testing
    const tmpl = pick(lines, ctx);
    if (!tmpl) return;
    const msg = formatLine(tmpl, rec, actor);
    if (!msg) return;
    if (ctx.log) ctx.log(msg, "info");
    touchFlavorCooldown(actor, 3);
  } catch (_) {}
}

export function logFollowerCritDealt(ctx, actor, loc, dmg) {
  try {
    if (!ctx || !actor || !actor._isFollower) return;
    const rec = followerRecordForActor(ctx, actor);
    if (!rec) return;
    const lines = resolveFlavorPools(ctx, rec, "critDealt");
    if (!lines.length) return;
    if (!canEmitFlavor(actor)) return;
    if (!chance(ctx, 0.9)) return; // very likely during testing
    const tmpl = pick(lines, ctx);
    if (!tmpl) return;
    const msg = formatLine(tmpl, rec, actor);
    if (!msg) return;
    if (ctx.log) ctx.log(msg, "info");
    touchFlavorCooldown(actor, 2);
  } catch (_) {}
}

export function logFollowerFlee(ctx, actor) {
  try {
    if (!ctx || !actor || !actor._isFollower) return;
    const rec = followerRecordForActor(ctx, actor);
    if (!rec) return;
    const lines = resolveFlavorPools(ctx, rec, "flee");
    if (!lines.length) return;
    if (!canEmitFlavor(actor)) return;
    if (!chance(ctx, 0.8)) return; // high during testing
    const tmpl = pick(lines, ctx);
    if (!tmpl) return;
    const msg = formatLine(tmpl, rec, actor);
    if (!msg) return;
    if (ctx.log) ctx.log(msg, "info");
    touchFlavorCooldown(actor, 4);
  } catch (_) {}
}
}