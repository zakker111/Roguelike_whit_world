/**
 * Fallback logger
 * Centralized logging whenever a fallback path is taken so developers/testers can see it.
 *
 * API (ESM + window.Fallback):
 * - log(tag, message, data?)
 *
 * Notes:
 * - Uses window.Logger.log when available; otherwise console.warn.
 * - tag should identify the module/area ("rng", "dungeon", "world", "encounter", "shop", etc.)
 */
import { attachGlobal } from "./global.js";

export function log(tag, message, data) {
  try {
    const text = "[Fallback:" + String(tag) + "] " + String(message || "");
    if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") {
      // tone "warn" to make it visible during dev; include optional data payload
      window.Logger.log(text, "warn", data);
    } else if (typeof console !== "undefined" && typeof console.warn === "function") {
      if (data !== undefined) console.warn(text, data);
      else console.warn(text);
    }
  } catch (_) {}
}

// Back-compat: attach to window via helper
attachGlobal("Fallback", { log });