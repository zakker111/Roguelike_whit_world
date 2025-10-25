/**
 * Capabilities helpers: ctx-first module access and safe calls.
 *
 * Exports (ESM + window.Capabilities):
 * - safeGet(ctx, name): returns ctx[name] or window[name] or null
 * - safeCall(ctx, modName, fnName, ...args): calls ctx-first then window, returns { ok, result }
 * - has(ctx, modName, fnName?): boolean presence check
 */
export function safeGet(ctx, name) {
  try {
    if (ctx && typeof ctx === "object" && Object.prototype.hasOwnProperty.call(ctx, name)) {
      const v = ctx[name];
      if (v != null) return v;
    }
  } catch (_) {}
  try {
    if (typeof window !== "undefined" && Object.prototype.hasOwnProperty.call(window, name)) {
      const v = window[name];
      if (v != null) return v;
    }
  } catch (_) {}
  return null;
}

export function has(ctx, modName, fnName) {
  try {
    const mod = safeGet(ctx, modName);
    if (!mod) return false;
    if (typeof fnName === "string" && fnName) return typeof mod[fnName] === "function";
    return true;
  } catch (_) {
    return false;
  }
}

export function safeCall(ctx, modName, fnName, ...args) {
  // Try ctx-first
  try {
    const mod = safeGet(ctx, modName);
    if (mod && typeof mod[fnName] === "function") {
      const result = mod[fnName](...(args || []));
      return { ok: true, result };
    }
  } catch (_) {}
  // Then window
  try {
    const w = (typeof window !== "undefined") ? window : {};
    const mod = w[modName] || null;
    if (mod && typeof mod[fnName] === "function") {
      const result = mod[fnName](...(args || []));
      return { ok: true, result };
    }
  } catch (_) {}
  return { ok: false, result: undefined };
}

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("Capabilities", { safeGet, safeCall, has });