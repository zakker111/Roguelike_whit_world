/**
 * PlayerUtils: small shared helpers for player-related math.
 *
 * Exports (window.PlayerUtils):
 * - round1(n): rounds to 1 decimal place
 * - clamp(v, min, max): clamps v into [min,max]
 * - capitalize(s): Uppercases first character (minimal utility shared across modules)
 */
(function () {
  function round1(n) {
    return Math.round(n * 10) / 10;
  }
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }
  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }
  window.PlayerUtils = { round1, clamp, capitalize };
})();