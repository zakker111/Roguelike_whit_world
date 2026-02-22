/**
 * Persistence helpers: clearing stored game state across modules.
 */
export function clearPersistentGameStorage(ctx) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("DUNGEON_STATES_V1");
      localStorage.removeItem("TOWN_STATES_V1");
      localStorage.removeItem("REGION_CUTS_V1");
      localStorage.removeItem("REGION_ANIMALS_V1");
      localStorage.removeItem("REGION_ANIMALS_V2");
      localStorage.removeItem("REGION_STATE_V1");
      localStorage.removeItem("GM_STATE_V1");
    }
  } catch (_) {}
  try {
    if (typeof window !== "undefined") {
      window._DUNGEON_STATES_MEM = Object.create(null);
      window._TOWN_STATES_MEM = Object.create(null);
    }
  } catch (_) {}
  try {
    const c = ctx || (typeof window !== "undefined" ? (window.Ctx && typeof window.Ctx.create === "function" ? window.Ctx.create({}) : null) : null);
    if (c) {
      if (c._dungeonStates) c._dungeonStates = Object.create(null);
      if (c._townStates) c._townStates = Object.create(null);
    }
  } catch (_) {}
}

// Optional back-compat
if (typeof window !== "undefined") {
  window.Persistence = window.Persistence || {};
  window.Persistence.clearPersistentGameStorage = (ctx) => clearPersistentGameStorage(ctx);
}