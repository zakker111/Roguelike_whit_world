/**
 * TimeService: centralizes time-of-day and turn/clock math.
 *
 * Usage:
 *   import { create } from "./time_service.js";
 *   const TS = create({ dayMinutes: 1440, cycleTurns: 360 });
 *   TS.tick(turnCounter) -> returns new turnCounter
 *   TS.getClock(turnCounter) -> { hours, minutes, hhmm, phase, totalMinutes, minutesPerTurn, cycleTurns, turnCounter }
 *   TS.minutesUntil(turnCounter, hour, minute) -> delta minutes
 *   TS.advanceMinutes(turnCounter, minutes) -> new turnCounter
 */

export function create(opts = {}) {
  const DAY_MINUTES = Number.isFinite(opts.dayMinutes) ? opts.dayMinutes : 24 * 60;
  const CYCLE_TURNS = Number.isFinite(opts.cycleTurns) ? opts.cycleTurns : 360;
  const MINUTES_PER_TURN = DAY_MINUTES / CYCLE_TURNS;

  function phaseForHour(h) {
    if (h >= 20 || h < 6) return "night";
    if (h < 8) return "dawn";
    if (h < 18) return "day";
    return "dusk";
  }

  function getClock(turnCounter) {
    const totalMinutes = Math.floor((turnCounter | 0) * MINUTES_PER_TURN) % DAY_MINUTES;
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    const hh = String(h).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    const phase = phaseForHour(h);
    return {
      hours: h, minutes: m, hhmm: `${hh}:${mm}`, phase,
      totalMinutes, minutesPerTurn: MINUTES_PER_TURN, cycleTurns: CYCLE_TURNS, turnCounter: (turnCounter | 0)
    };
  }

  function minutesUntil(turnCounter, hourTarget, minuteTarget = 0) {
    const clock = getClock(turnCounter);
    const cur = clock.hours * 60 + clock.minutes;
    const goal = ((hourTarget | 0) * 60 + (minuteTarget | 0) + DAY_MINUTES) % DAY_MINUTES;
    let delta = goal - cur;
    if (delta <= 0) delta += DAY_MINUTES;
    return delta;
  }

  function advanceMinutes(turnCounter, mins) {
    const turns = Math.ceil((mins | 0) / MINUTES_PER_TURN);
    return (turnCounter | 0) + turns;
  }

  function tick(turnCounter) {
    return (turnCounter | 0) + 1;
  }

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

// Back-compat: attach to window for classic scripts
if (typeof window !== "undefined") {
  window.TimeService = { create };
}