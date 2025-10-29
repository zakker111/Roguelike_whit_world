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
 *
 * Standalone helpers (can be used without a service instance):
 *   parseHHMM("08:30") -> 510
 *   minutesOfDay(8, 30, 1440) -> 510
 *   hhmmFromMinutes(510) -> "08:30"
 */

/**
 * Parse an "HH:MM" string to minutes after midnight (0..1439). Returns null if invalid.
 */
export function parseHHMM(s) {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Math.max(0, Math.min(23, parseInt(m[1], 10) || 0));
  const min = Math.max(0, Math.min(59, parseInt(m[2], 10) || 0));
  return ((h | 0) * 60 + (min | 0)) % (24 * 60);
}

/**
 * Convenience: convert hours/minutes to minutes of day with a custom day length if desired.
 */
export function minutesOfDay(h, m = 0, dayMinutes = 24 * 60) {
  const DAY = (typeof dayMinutes === "number" && isFinite(dayMinutes)) ? dayMinutes : 24 * 60;
  let v = ((h | 0) * 60 + (m | 0)) % DAY;
  if (v < 0) v += DAY;
  return v;
}

/**
 * Format minutes after midnight (0..1439) as "HH:MM".
 */
export function hhmmFromMinutes(mins) {
  const m = Math.max(0, (mins | 0)) % (24 * 60);
  const h = ((m / 60) | 0) % 24;
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

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

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("TimeService", { create, parseHHMM, minutesOfDay, hhmmFromMinutes });*
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

// Helpers for HH:MM parsing/formatting shared by services and generators
export function parseHHMM(s) {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Math.max(0, Math.min(23, parseInt(m[1], 10) || 0));
  const min = Math.max(0, Math.min(59, parseInt(m[2], 10) || 0));
  return { hours: h | 0, minutes: min | 0 };
}

export function hhmmToMinutes(s, dayMinutes = 24 * 60) {
  const p = parseHHMM(String(s || ""));
  if (!p) return null;
  return ((p.hours * 60 + p.minutes) % (dayMinutes | 0));
}

export function minutesToHHMM(mins, dayMinutes = 24 * 60) {
  const v = ((mins | 0) % (dayMinutes | 0) + (dayMinutes | 0)) % (dayMinutes | 0);
  const h = Math.floor(v / 60);
  const m = v % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("TimeService", { create, hhmmToMinutes, minutesToHHMM, parseHHMM });