/**
 * MessagesService: strict JSON-backed messages from GameData.messages.
 *
 * API (ESM + window.Messages):
 *   get(key, vars?) -> string | ""
 *   log(ctx, key, vars?, toneOrString?) -> logs using ctx.log; no built-in text fallbacks
 *
 * Keys use dot-notation, e.g. "dungeon.explore", "world.arrive".
 */

function tmpl(str, vars) {
  if (typeof str !== "string") return "";
  return str.replace(/\{(\w+)\}/g, (_, k) => (vars && k in vars) ? String(vars[k]) : "");
}

function pick(obj, path) {
  if (!obj || !path) return null;
  const parts = String(path).split(".");
  let cur = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object" || !(p in cur)) return null;
    cur = cur[p];
  }
  return cur;
}

export function get(key, vars = null) {
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const msg = GD && GD.messages ? pick(GD.messages, key) : null;
    const str = (typeof msg === "string") ? msg : "";
    return tmpl(str, vars);
  } catch (_) {
    return "";
  }
}

/**
 * Log message by key (no text fallbacks):
 * - toneOrString: if equals one of tones ("info","notice","warn","good","bad","flavor") -> use that tone
 *                 otherwise ignored
 */
export function log(ctx, key, vars = null, toneOrString = null) {
  if (!ctx || typeof ctx.log !== "function") return;
  const text = get(key, vars);
  if (!text) return;
  const TONES = { info: 1, notice: 1, warn: 1, good: 1, bad: 1, flavor: 1 };
  const tone = (typeof toneOrString === "string" && TONES[toneOrString]) ? toneOrString : "info";
  ctx.log(text, tone);
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.Messages = { get, log };
}