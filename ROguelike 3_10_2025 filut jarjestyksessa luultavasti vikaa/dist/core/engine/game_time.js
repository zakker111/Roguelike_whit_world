/**
 * GameTime: centralized time-of-day and weather helpers.
 *
 * This module wraps the time_weather facade so core/game.js can stay focused
 * on orchestration logic rather than calling the facade directly.
 *
 * Exports:
 * - initGameTime(cfg): initialize global time/weather runtime
 * - getClock(): current in-game clock snapshot
 * - getWeatherSnapshot(time?): visual weather snapshot (optionally at a given time)
 * - minutesUntil(hour, minute): minutes until a given clock time
 * - advanceTimeMinutes(mins, { log, rng }): advance time and emit log messages
 */

import {
  initTimeWeather,
  getClock as timeGetClock,
  getWeatherSnapshot as timeGetWeatherSnapshot,
  minutesUntil as timeMinutesUntil,
  advanceTimeMinutes as timeAdvanceTimeMinutes,
} from "../facades/time_weather.js";
import { attachGlobal } from "../../utils/global.js";

/**
 * Initialize global time and weather runtime.
 * cfg: raw config object from core/facades/config.getRawConfig()
 */
export function initGameTime(cfg) {
  try {
    initTimeWeather(cfg);
  } catch (_) {}
}

/**
 * Return the current in-game clock.
 */
export function getClock() {
  return timeGetClock();
}

/**
 * Return a weather snapshot for the given time (or current time if omitted).
 */
export function getWeatherSnapshot(time) {
  return timeGetWeatherSnapshot(time);
}

/**
 * Minutes until a given clock time (hourTarget: 0-23, minuteTarget: 0-59).
 */
export function minutesUntil(hourTarget, minuteTarget = 0) {
  return timeMinutesUntil(hourTarget, minuteTarget);
}

/**
 * Advance game time by the given number of minutes.
 *
 * options:
 * - log(msg, type): optional logger
 * - rng(): optional RNG function; if omitted, Math.random is used as a last resort.
 */
export function advanceTimeMinutes(mins, options = {}) {
  const log = typeof options.log === "function" ? options.log : null;
  const rng = typeof options.rng === "function" ? options.rng : null;

  const rngFn = () => {
    try {
      if (rng) return rng();
    } catch (_) {}
    return Math.random();
  };

  timeAdvanceTimeMinutes(
    mins,
    (msg, type) => {
      if (!log) return;
      try {
        log(msg, type);
      } catch (_) {}
    },
    rngFn
  );
}

// Back-compat / debug handle
attachGlobal("GameTime", {
  initGameTime,
  getClock,
  getWeatherSnapshot,
  minutesUntil,
  advanceTimeMinutes,
});