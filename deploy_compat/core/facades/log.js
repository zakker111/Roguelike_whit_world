/**
 * Log facade: centralize logging with ctx-first preference.
 */
import { getMod } from "../../utils/access.js";

export function log(ctx, msg, type = "info", details = null) {
  try { if (typeof window !== "undefined" && window.DEV) console.debug(`[${type}] ${msg}`); } catch (_) {}
  try {
    const LG = getMod(ctx, "Logger");
    if (LG && typeof LG.log === "function") {
      LG.log(msg, type, details);
      return true;
    }
  } catch (_) {}
  try { console.log(`[${type}] ${msg}`); } catch (_) {}
  return false;
}

// Optional back-compat
if (typeof window !== "undefined") {
  window.LogFacade = { log };
}