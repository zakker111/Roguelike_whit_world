export function createWorldOps({
  getCtx,
  applyCtxSyncAndRefresh,
  modHandle,
  MAP_COLS,
  MAP_ROWS,
}) {
  const ctx = () => (typeof getCtx === "function" ? getCtx() : null);
  const apply = typeof applyCtxSyncAndRefresh === "function" ? applyCtxSyncAndRefresh : (() => {});
  const mh = typeof modHandle === "function" ? modHandle : (() => null);

  function initWorld() {
    // WorldRuntime is required for overworld generation; fail fast if missing
    const WR = mh("WorldRuntime");
    if (!WR || typeof WR.generate !== "function") {
      throw new Error("WorldRuntime.generate missing; overworld generation cannot proceed");
    }
    const c = ctx();
    const ok = WR.generate(c, { width: MAP_COLS, height: MAP_ROWS });
    if (!ok) {
      throw new Error("WorldRuntime.generate returned falsy; overworld generation failed");
    }
    // Sync back mutated state and refresh camera/FOV/UI/draw via centralized helper
    apply(c);
  }

  /**
   * Auto-escort travel: thin wrapper; actual timed loop lives in WorldRuntime.
   */
  function startEscortAutoTravel() {
    try {
      const c = ctx();
      if (!c || !c.world) return;
      const WR = mh("WorldRuntime");
      if (WR && typeof WR.startEscortAutoTravel === "function") {
        WR.startEscortAutoTravel(c);
      }
    } catch (_) {}
  }

  return { initWorld, startEscortAutoTravel };
}

export const createGameWorldOps = createWorldOps;
