/**
 * MessagesService: logs user-facing messages from GameData.messages with fallbacks.
 *
 * API (ESM + window.Messages):
 *   get(key, vars?, fallback?) -> string
 *   log(ctx, key, vars?, fallbackTypeOrString?) -> logs using ctx.log with appropriate tone
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

export function get(key, vars = null, fallback = "") {
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const msg = GD && GD.messages ? pick(GD.messages, key) : null;
    const str = (typeof msg === "string") ? msg : fallback;
    return tmpl(str, vars);
  } catch (_) {
    return tmpl(typeof fallback === "string" ? fallback : "", vars);
  }
}

/**
 * Log message by key:
 * - fallbackTypeOrString: if string -> used as fallback text; if not provided -> default fallback based on key
 *   otherwise if equal to one of tones ("info","notice","warn","good","bad") -> use that tone and default fallback string
 */
export function log(ctx, key, vars = null, fallbackTypeOrString = null) {
  if (!ctx || typeof ctx.log !== "function") return;
  let tone = "info";
  let defaultFallback = "";
  switch (key) {
    case "world.arrive":
      tone = "notice";
      defaultFallback = "You arrive in the overworld. Towns: small (t), big (T), cities (C). Dungeons (D). Press G on a town/dungeon tile to enter/exit.";
      break;
    case "dungeon.explore":
      tone = "info";
      defaultFallback = "You explore the dungeon.";
      break;
    case "dungeon.noDeeper":
      tone = "info";
      defaultFallback = "This dungeon has no deeper levels. Return to the entrance (the hole '>') and press G to leave.";
      break;
    case "dungeon.needStairs":
      tone = "info";
      defaultFallback = "You need to stand on the staircase (brown tile marked with '>').";
      break;
    case "dungeon.noDescendHere":
      tone = "info";
      defaultFallback = "There is nowhere to go down from here.";
      break;
    case "town.exitHint":
      tone = "info";
      defaultFallback = "Return to the town gate to exit to the overworld.";
      break;
    case "encounter.exitHint":
      tone = "info";
      defaultFallback = "Return to the exit (>) to leave this encounter.";
      break;
    default:
      tone = "info";
      defaultFallback = "";
  }
  let fallbackStr = defaultFallback;
  if (typeof fallbackTypeOrString === "string") {
    fallbackStr = fallbackTypeOrString;
  } else if (typeof fallbackTypeOrString === "string") {
    tone = fallbackTypeOrString;
  }
  const text = get(key, vars, fallbackStr);
  if (text) ctx.log(text, tone);
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.Messages = { get, log };
}