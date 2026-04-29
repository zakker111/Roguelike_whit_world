/**
 * GameTurn: centralized per-turn orchestration.
 *
 * This module wraps the per-turn flow that was previously embedded in core/game.js:
 * - Advances global time and visual weather (tickTimeAndWeather)
 * - Delegates gameplay progression to TurnLoop.tick(ctx)
 * - Applies orchestrator re-sync when mode changes
 * - Emits lightweight overworld hints
 * - Measures per-turn perf via perfMeasureTurn
 *
 * It is ctx-first: callers provide getCtx() and small callbacks instead of relying
 * on core/game.js globals.
 */

import { attachGlobal } from "../../utils/global.js";

/**
 * Run a single turn.
 *
 * opts:
 * - getCtx(): ctx object
 * - getMode(): current mode string ("world", "town", "dungeon", "encounter", "region", ...)
 * - tickTimeAndWeather(logFn, rngFn): advances time/weather
 * - log(msg, type): logging function
 * - rng(): RNG function returning a float in [0,1)
 * - applyCtxSyncAndRefresh(ctx): orchestrator sync when mode/map changes
 * - maybeEmitOverworldAnimalHint(): optional callback for overworld hints
 * - perfMeasureTurn(ms): perf sink
 */
export function runTurn(opts) {
  if (!opts || typeof opts.getCtx !== "function") return;

  const {
    getCtx,
    getMode,
    tickTimeAndWeather,
    log,
    rng,
    applyCtxSyncAndRefresh,
    maybeEmitOverworldAnimalHint,
    perfMeasureTurn,
  } = opts;

  const t0 =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();

  // Advance global time and visual weather state (non-gameplay)
  try {
    if (typeof tickTimeAndWeather === "function") {
      const rngFn = () => {
        try {
          if (typeof rng === "function") return rng();
        } catch (_) {}
        return Math.random();
      };
      const logFn = (msg, type) => {
        if (typeof log !== "function") return;
        try {
          log(msg, type);
        } catch (_) {}
      };
      tickTimeAndWeather(logFn, rngFn);
    }
  } catch (_) {}

  // Prefer centralized TurnLoop when available
  try {
    const ctxMod = getCtx();
    if (!ctxMod) return;
    const TL =
      (ctxMod && ctxMod.TurnLoop) ||
      (typeof window !== "undefined" ? window.TurnLoop : null);
    if (TL && typeof TL.tick === "function") {
      const prevMode =
        typeof getMode === "function" ? getMode() : ctxMod.mode;

      TL.tick(ctxMod);

      // If external modules mutated ctx.mode/map (e.g., EncounterRuntime.complete),
      // orchestrator can re-sync via applyCtxSyncAndRefresh.
      try {
        if (typeof applyCtxSyncAndRefresh === "function") {
          const cPost = getCtx();
          if (cPost && prevMode != null && cPost.mode !== prevMode) {
            applyCtxSyncAndRefresh(cPost);
          }
        }
      } catch (_) {}

      // Overworld wildlife hint even when TurnLoop is active
      try {
        if (
          typeof maybeEmitOverworldAnimalHint === "function" &&
          typeof getMode === "function" &&
          getMode() === "world"
        ) {
          maybeEmitOverworldAnimalHint();
        }
      } catch (_) {}

      const t1 =
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now();
      try {
        if (typeof perfMeasureTurn === "function") {
          perfMeasureTurn(t1 - t0);
        }
      } catch (_) {}

      return;
    }
  } catch (_) {
    // Swallow errors to avoid breaking the game loop; logging is handled elsewhere.
  }
}

// Back-compat / debug handle
attachGlobal("GameTurn", { runTurn });