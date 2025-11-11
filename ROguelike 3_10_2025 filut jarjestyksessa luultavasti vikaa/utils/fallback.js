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
  const text = "[Fallback:" + String(tag) + "] " + String(message || "");
  throw new Error(text);
}

// Back-compat: attach to window via helper
attachGlobal("Fallback", { log });