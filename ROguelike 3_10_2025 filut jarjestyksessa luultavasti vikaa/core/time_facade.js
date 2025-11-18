/**
 * Time Facade: centralizes time-of-day and turn-to-minutes mapping.
 * Uses window.TimeService when available, otherwise provides a lightweight fallback.
 */
export function createTimeFacade(opts = {}) {
  const dayMinutes = (typeof opts.dayMinutes === "number") ? opts.dayMinutes : (24 * 60);
  const cycleTurns = (typeof opts.cycleTurns === "number") ? opts.cycleTurns : 360;

  // Prefer external TimeService
  try {
    const TSVC = (typeof window !== "undefined" ? window.TimeService : null);
    if (TSVC && typeof TSVC.create === "function") {
      return TSVC.create({ dayMinutes, cycleTurns });
    }
  } catch (_) {}

  // Fallback: minimal facade
  const DAY_MINUTES = dayMinutes;
  const CYCLE_TURNS = cycleTurns;
  const MINUTES_PER_TURN = DAY_MINUTES / CYCLE_TURNS;

  function getClock(tc) {
    const totalMinutes = Math.floor((tc | 0) * MINUTES_PER_TURN) % DAY_MINUTES;
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    const hh = String(h).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    const phase = (h >= 20 || h < 6) ? "night" : (h < 8 ? "dawn" : (h < 18 ? "day" : "dusk"));
    return { hours: h, minutes: m, hhmm: `${hh}:${mm}`, phase, totalMinutes, minutesPerTurn: MINUTES_PER_TURN, cycleTurns: CYCLE_TURNS, turnCounter: (tc | 0) };
  }
  function minutesUntil(tc, hourTarget, minuteTarget = 0) {
    const clock = getClock(tc);
    const cur = clock.hours * 60 + clock.minutes;
    const goal = ((hourTarget | 0) * 60 + (minuteTarget | 0) + DAY_MINUTES) % DAY_MINUTES;
    let delta = goal - cur;
    if (delta <= 0) delta += DAY_MINUTES;
    return delta;
  }
  function advanceMinutes(tc, mins) {
    const turns = Math.ceil((mins | 0) / MINUTES_PER_TURN);
    return (tc | 0) + turns;
  }
  function tick(tc) { return (tc | 0) + 1; }

  return {
    DAY_MINUTES,
    CYCLE_TURNS,
    MINUTES_PER_TURN,
    getClock,
    minutesUntil,
    advanceMinutes,
    tick,
  };
}

// Back-compat
if (typeof window !== "undefined") {
  window.TimeFacade = { create: createTimeFacade };
}