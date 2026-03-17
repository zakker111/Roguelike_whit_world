import {
  minutesUntil as gameTimeMinutesUntil,
  advanceTimeMinutes as gameTimeAdvanceTimeMinutes,
} from "./game_time.js";

export function createTimeOps({ getCtx, log, rng, modHandle }) {
  const ctx = () => (typeof getCtx === "function" ? getCtx() : null);
  const logFn = typeof log === "function" ? log : null;
  const rngFn = typeof rng === "function" ? rng : null;
  const mh = typeof modHandle === "function" ? modHandle : null;

  function minutesUntil(hourTarget /*0-23*/, minuteTarget = 0) {
    return gameTimeMinutesUntil(hourTarget, minuteTarget);
  }

  function advanceTimeMinutes(mins) {
    gameTimeAdvanceTimeMinutes(mins, {
      log: logFn || undefined,
      rng: rngFn || undefined,
    });
  }

  // Run a number of turns equivalent to the given minutes so NPCs/AI act during time passage.
  function fastForwardMinutes(mins) {
    // Centralized Movement.fastForwardMinutes already handles per-turn calls,
    // FOV recompute, and UI updates using ctx.
    try {
      const MV = mh ? mh("Movement") : null;
      if (MV && typeof MV.fastForwardMinutes === "function") {
        return MV.fastForwardMinutes(ctx(), mins);
      }
    } catch (_) {}
    return 0;
  }

  return { minutesUntil, advanceTimeMinutes, fastForwardMinutes };
}

export const createGameTimeOps = createTimeOps;
