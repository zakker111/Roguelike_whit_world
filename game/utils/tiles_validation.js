/**
 * TilesValidation: records maps per mode for smoketest coverage analysis.
 * Exports (ESM + window.TilesValidation):
 * - recordMap({ mode, map })
 * - getRecorded()
 */
const _rec = [];
export function recordMap(entry) {
  try {
    const mode = String(entry?.mode || "");
    const map = Array.isArray(entry?.map) ? entry.map : null;
    if (!mode || !map) return;
    // store a shallow copy reference; maps are immutable in our renderers
    _rec.push({ mode, map });
    // cap entries to prevent unbounded growth
    if (_rec.length > 8) _rec.shift();
  } catch (_) {}
}
export function getRecorded() {
  return _rec.slice();
}

import { attachGlobal } from "./global.js";
attachGlobal("TilesValidation", { recordMap, getRecorded });