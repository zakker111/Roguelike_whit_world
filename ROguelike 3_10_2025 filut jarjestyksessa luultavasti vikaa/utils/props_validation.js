/**
 * PropsValidation: records props seen during rendering for smoketest coverage analysis.
 * Exports (ESM + window.PropsValidation):
 * - recordProp({ mode, type, x, y })
 * - getRecorded()
 */
const _rec = [];
export function recordProp(entry) {
  try {
    const mode = String(entry?.mode || "");
    const type = String(entry?.type || "").toLowerCase();
    const x = entry?.x | 0;
    const y = entry?.y | 0;
    if (!mode || !type) return;
    _rec.push({ mode, type, x, y });
    if (_rec.length > 100) _rec.shift();
  } catch (_) {}
}
export function getRecorded() {
  return _rec.slice();
}

import { attachGlobal } from "./global.js";
attachGlobal("PropsValidation", { recordProp, getRecorded });