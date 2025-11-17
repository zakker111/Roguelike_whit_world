/**
 * PlayerUtils: small shared helpers for player-related math.
 *
 * Exports (ESM + window.PlayerUtils):
 * - round1(n): rounds to 1 decimal place
 * - clamp(v, min, max): clamps v into [min,max]
 * - capitalize(s): Uppercases first character (minimal utility shared across modules)
 */

export function round1(n) {
  return Math.round(n * 10) / 10;
}
import { clamp as boundsClamp } from "../utils/bounds.js";
export const clamp = boundsClamp;
export function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.PlayerUtils = { round1, clamp, capitalize };
}