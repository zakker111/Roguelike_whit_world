/**
 * TownAI
 * Thin façade over the modular town AI implementation.
 *
 * Exports (ESM + window.TownAI):
 *  - populateTown(ctx): spawn shopkeepers, residents, pets, greeters
 *  - townNPCsAct(ctx): per-turn movement and routines
 *  - checkHomeRoutes(ctx): diagnostics for reachability to homes (and late-night shelter)
 */

import { checkHomeRoutes } from "./town_diagnostics.js";
import { populateTown } from "./town_population.js";
import { townNPCsAct as townNPCsActRuntime } from "./town_runtime.js";

/**
 * Back-compat wrapper so existing callers use TownAI.townNPCsAct(ctx)
 * while the implementation lives in ai/town_runtime.js.
 */
function townNPCsAct(ctx) {
  return townNPCsActRuntime(ctx);
}

// Back-compat: attach to window and export for ESM
export { populateTown, townNPCsAct, checkHomeRoutes };

if (typeof window !== "undefined") {
  window.TownAI = {
    populateTown,
    townNPCsAct,
    checkHomeRoutes,
  };
}