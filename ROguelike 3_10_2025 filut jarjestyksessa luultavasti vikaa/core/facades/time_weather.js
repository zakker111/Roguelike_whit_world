/**
 * Time + Weather facade: centralizes global turn counter, clock, and visual weather.
 *
 * Exports (ESM + optional window.TimeWeatherFacade):
 * - initTimeWeather(cfg)
 * - getClock()
 * - getWeatherSnapshot(time?)
 * - minutesUntil(hour, minute?)
 * - advanceTimeMinutes(mins, logFn?, rngFn?)
 * - tickTimeAndWeather(logFn?, rngFn?)
 * - getMinutesPerTurn()
 * - getTurnCounter()
 *
 * Notes:
 * - Uses core/facades/time.js for time-of-day math (which prefers window.TimeService).
 * - Uses window.WeatherService when available; fails gracefully when missing.
 * - Does NOT advance any gameplay state (AI, movement); callers still run turn() for that.
 */

import { createTimeFacade } from "./time.js";

let TS = null;
let DAY_MINUTES = 24 * 60;
let CYCLE_TURNS = 360;
let MINUTES_PER_TURN = DAY_MINUTES / CYCLE_TURNS;

let turnCounter = 0; // total turns elapsed since start

// Visual weather (non-gameplay), driven by services/weather_service.js
let weatherState = { type: "clear", turnsLeft: 0 };
let WeatherSvc = null;
let lastWeatherType = null;

function ensureWeatherService() {
  try {
    if (!WeatherSvc && typeof window !== "undefined" && window.WeatherService && typeof window.WeatherService.create === "function") {
      WeatherSvc = window.WeatherService.create({});
    }
  } catch (_) {}
}

/**
 * Initialize global time + weather runtime from config.
 * Call once at boot from core/game.js.
 */
export function initTimeWeather(cfg) {
  const cfgTime = cfg && cfg.time;
  const dayMinutes = (cfgTime && typeof cfgTime.dayMinutes === "number") ? cfgTime.dayMinutes : (24 * 60);
  const cycleTurns = (cfgTime && typeof cfgTime.cycleTurns === "number") ? cfgTime.cycleTurns : 360;

  TS = createTimeFacade({ dayMinutes, cycleTurns });
  DAY_MINUTES = TS.DAY_MINUTES;
  CYCLE_TURNS = TS.CYCLE_TURNS;
  MINUTES_PER_TURN = TS.MINUTES_PER_TURN;

  turnCounter = 0;
  weatherState = { type: "clear", turnsLeft: 0 };
  WeatherSvc = null;
  lastWeatherType = null;

  // Initialize once at boot if available; will be re-attempted lazily later if needed.
  ensureWeatherService();
}

/**
 * Compute in-game clock and phase from the internal turnCounter.
 */
export function getClock() {
  if (TS && typeof TS.getClock === "function") {
    return TS.getClock(turnCounter);
  }
  // Minimal fallback if called before init
  const minutesPerTurn = MINUTES_PER_TURN || ((DAY_MINUTES || 1440) / (CYCLE_TURNS || 360));
  const totalMinutes = Math.floor((turnCounter | 0) * minutesPerTurn) % (DAY_MINUTES || 1440);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const phase = (h >= 20 || h < 6) ? "night" : (h < 8 ? "dawn" : (h < 18 ? "day" : "dusk"));
  return {
    hours: h,
    minutes: m,
    hhmm: `${hh}:${mm}`,
    phase,
    totalMinutes,
    minutesPerTurn,
    cycleTurns: CYCLE_TURNS || 360,
    turnCounter: (turnCounter | 0),
  };
}

/**
 * Snapshot of current visual weather given optional explicit time.
 */
export function getWeatherSnapshot(time) {
  try {
    ensureWeatherService();
    if (!WeatherSvc) return null;
    const t = time || getClock();
    return WeatherSvc.describe(weatherState, t);
  } catch (_) {
    return null;
  }
}

/**
 * Minutes until the next occurrence of the given clock time.
 */
export function minutesUntil(hourTarget, minuteTarget = 0) {
  if (!TS || typeof TS.minutesUntil !== "function") return 0;
  return TS.minutesUntil(turnCounter, hourTarget, minuteTarget);
}

/**
 * Advance only global time and visual weather by one turn.
 * Does not run AI or mode-specific turn logic.
 */
export function tickTimeAndWeather(logFn, rngFn) {
  if (!TS || typeof TS.tick !== "function") return;

  // Advance global time
  turnCounter = TS.tick(turnCounter);

  // Advance visual weather state (non-gameplay)
  try {
    ensureWeatherService();
    if (WeatherSvc) {
      const timeNow = getClock();
      const rfn = typeof rngFn === "function"
        ? rngFn
        : (() => {
            try { return Math.random(); } catch (_) { return 0.5; }
          });
      weatherState = WeatherSvc.tick(weatherState, timeNow, rfn);
      const snap = WeatherSvc.describe(weatherState, timeNow);
      const curType = snap && snap.type ? String(snap.type) : null;
      if (curType && curType !== lastWeatherType) {
        lastWeatherType = curType;
        if (typeof logFn === "function") {
          logFn(`Weather now: ${snap.label || curType}.`, "notice");
        }
      }
    }
  } catch (_) {}
}

/**
 * Advance time by N minutes, updating turnCounter and visual weather.
 * Does not run any gameplay turns; callers that want NPC/AI activity
 * should still loop turn().
 */
export function advanceTimeMinutes(mins, logFn, rngFn) {
  const total = Math.max(0, (Number(mins) || 0) | 0);
  if (total <= 0) return;
  const mpt = getMinutesPerTurn();
  const turns = Math.max(1, Math.ceil(total / (mpt || 1)));
  for (let i = 0; i < turns; i++) {
    tickTimeAndWeather(logFn, rngFn);
  }
}

/**
 * Expose minutes-per-turn so callers can map minutes to turn counts.
 */
export function getMinutesPerTurn() {
  if (typeof MINUTES_PER_TURN === "number" && MINUTES_PER_TURN > 0) return MINUTES_PER_TURN;
  const day = DAY_MINUTES || 1440;
  const cyc = CYCLE_TURNS || 360;
  return day / cyc;
}

/**
 * Read the current global turn counter.
 */
export function getTurnCounter() {
  return turnCounter | 0;
}

// Optional back-compat: attach to window for diagnostics
if (typeof window !== "undefined") {
  window.TimeWeatherFacade = {
    initTimeWeather,
    getClock,
    getWeatherSnapshot,
    minutesUntil,
    advanceTimeMinutes,
    tickTimeAndWeather,
    getMinutesPerTurn,
    getTurnCounter,
  };
}