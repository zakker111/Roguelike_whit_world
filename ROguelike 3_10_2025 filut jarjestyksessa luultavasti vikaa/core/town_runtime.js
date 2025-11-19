export * from "./town/runtime.js";

// Explicit occupancy rebuild helper for callers that mutate town entities outside tick cadence.
export function rebuildOccupancy(ctx) {
  try {
    const OF = ctx.OccupancyFacade || (typeof window !== "undefined" ? window.OccupancyFacade : null);
    if (OF && typeof OF.rebuild === "function") {
      OF.rebuild(ctx);
      return true;
    }
  } catch (_) {}
  return false;
}

if (typeof window !== "undefined") {
  window.TownRuntime = { generate, ensureSpawnClear, spawnGateGreeters, isFreeTownFloor, talk, tryMoveTown, tick, returnToWorldIfAtGate, applyLeaveSync, rebuildOccupancy };
}