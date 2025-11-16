/**
 * Color utilities shared across renderers.
 * Exports (ESM + window.ColorUtils):
 * - parseHex, toHex, shade, mix, rgba
 */

// Parse "#rrggbb" to {r,g,b}
export function parseHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

// Convert {r,g,b} to "#rrggbb"
export function toHex(rgb) {
  const clamp = (x) => Math.max(0, Math.min(255, Math.round(x)));
  const v = (clamp(rgb.r) << 16) | (clamp(rgb.g) << 8) | clamp(rgb.b);
  return "#" + v.toString(16).padStart(6, "0");
}

// Shade hex color by factor (e.g., 0.85 darker, 1.1 lighter)
export function shade(hex, factor) {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  return toHex({ r: rgb.r * factor, g: rgb.g * factor, b: rgb.b * factor });
}

// Linear blend between two hex colors: t in [0,1]
export function mix(hexA, hexB, t = 0.5) {
  const a = parseHex(hexA), b = parseHex(hexB);
  if (!a || !b) return hexA;
  const lerp = (x, y) => x + (y - x) * Math.max(0, Math.min(1, t));
  return toHex({ r: lerp(a.r, b.r), g: lerp(a.g, b.g), b: lerp(a.b, b.b) });
}

// Convert hex to rgba() string with alpha
export function rgba(hex, a) {
  const rgb = parseHex(hex);
  if (!rgb) return `rgba(0,0,0,${Math.max(0, Math.min(1, a))})`;
  const aa = Math.max(0, Math.min(1, a));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${aa})`;
}

import { attachGlobal } from "../utils/global.js";
attachGlobal("ColorUtils", { parseHex, toHex, shade, mix, rgba });