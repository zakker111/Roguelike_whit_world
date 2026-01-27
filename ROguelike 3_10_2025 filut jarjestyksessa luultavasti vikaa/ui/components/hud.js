/**
 * Hud: Top bar HUD updater for HP/floor/time/perf.
 *
 * Exports (ESM + window.Hud):
 * - init()
 * - update(player, floor, time, perf, perfOn)
 */
let _hpEl = null;
let _floorEl = null;
let _lastHpText = "";
let _lastFloorText = "";
let _lastHudWeatherLabel = "";

function byId(id) {
  try { return document.getElementById(id); } catch (_) { return null; }
}

export function init() {
  _hpEl = byId("health");
  _floorEl = byId("floor");
}

export function update(player, floor, time, perf, perfOn, weather) {
  const hpEl = _hpEl || byId("health");
  const floorEl = _floorEl || byId("floor");

  // HP + statuses
  if (hpEl && player) {
    const parts = [`HP: ${Number(player.hp || 0).toFixed(1)}/${Number(player.maxHp || 0).toFixed(1)}`];
    try {
      const GA = (typeof window !== "undefined" && window.GameAPI) ? window.GameAPI : null;
      const inv = GA && typeof GA.getInvincibleState === "function" ? !!GA.getInvincibleState() : false;
      const sb = GA && typeof GA.getCtx === "function" ? GA.getCtx() : null;
      const sandboxLabel = sb && sb.isSandbox ? " [SANDBOX]" : "";
      const invLabel = inv ? " [INVINCIBLE]" : "";
      if (sandboxLabel || invLabel) {
        parts[0] += `${sandboxLabel}${invLabel}`;
      }
    } catch (_) {}
    const statuses = [];
    try {
      if (player.bleedTurns && player.bleedTurns > 0) statuses.push(`Bleeding (${player.bleedTurns})`);
      if (player.dazedTurns && player.dazedTurns > 0) statuses.push(`Dazed (${player.dazedTurns})`);
      if (player.inFlamesTurns && player.inFlamesTurns > 0) statuses.push(`In Flames (${player.inFlamesTurns})`);
    } catch (_) {}
    const statusText = `Status Effect: ${statuses.length ? statuses.join(", ") : "None"}`;
    const hpStr = `${parts[0]}  ${statusText}`;
    if (hpStr !== _lastHpText) {
      hpEl.textContent = hpStr;
      _lastHpText = hpStr;
    }
  }

  // Floor + level + XP + time + perf (+ weather in time parentheses)
  if (floorEl && player) {
    // Always recompute time from GameAPI so HUD reflects the latest turn,
    // even if the passed-in time object is stale.
    let hhmm = "";
    let phase = "";
    try {
      const GAPI = (typeof window !== "undefined" && window.GameAPI) ? window.GameAPI : null;
      if (GAPI && typeof GAPI.getClock === "function") {
        const t2 = GAPI.getClock();
        if (t2 && typeof t2 === "object") {
          hhmm = t2.hhmm || "";
          phase = t2.phase ? String(t2.phase) : "";
        }
      }
    } catch (_) {}

    // Fallback to provided time if GameAPI clock is unavailable
    if (!hhmm || !phase) {
      const t = time || {};
      if (!hhmm) hhmm = t.hhmm || "";
      if (!phase && t.phase) phase = t.phase;
    }

    let phaseWeatherPart = "";
    try {
      // Prefer explicit weather passed from ctx; fall back to GameAPI when unavailable.
      let label = "";
      if (weather && typeof weather === "object") {
        label = weather.label ? String(weather.label) : "";
        if (!label && weather.type) label = String(weather.type);
      }
      if (!label) {
        const GAPI = (typeof window !== "undefined" && window.GameAPI) ? window.GameAPI : null;
        const w = GAPI && typeof GAPI.getWeather === "function" ? GAPI.getWeather() : null;
        label = w && w.label ? String(w.label) : "";
      }
      if (!label) label = "clear";

      if (label !== _lastHudWeatherLabel) {
        _lastHudWeatherLabel = label;
        try {
          if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") {
            window.Logger.log(`[HUD] Weather label now: ${label}`, "notice");
          }
        } catch (_) {}
      }

      if (phase && label) {
        phaseWeatherPart = ` (${phase}: ${label})`;
      } else if (phase) {
        phaseWeatherPart = ` (${phase})`;
      } else if (label) {
        phaseWeatherPart = ` (${label})`;
      }
    } catch (_) {
      if (phase) {
        phaseWeatherPart = ` (${phase}: clear)`;
      } else {
        phaseWeatherPart = ` (clear)`;
      }
    }

    const timeStr = hhmm ? `  Time: ${hhmm}${phaseWeatherPart}` : "";
    let turnStr = "";
    try {
      if (perfOn && perf && typeof perf.lastTurnMs === "number") {
        turnStr = `  Turn: ${perf.lastTurnMs.toFixed(1)}ms`;
      }
    } catch (_) {}
    let drawStr = "";
    try {
      if (perfOn && perf && typeof perf.lastDrawMs === "number") {
        drawStr = `  Draw: ${perf.lastDrawMs.toFixed(1)}ms`;
      }
    } catch (_) {}
    const floorStr = `F: ${floor}  Lv: ${player.level}  XP: ${player.xp}/${player.xpNext}${timeStr}${turnStr}${drawStr}`;
    if (floorStr !== _lastFloorText) {
      floorEl.textContent = floorStr;
      _lastFloorText = floorStr;
    }
  }
}

import { attachGlobal } from "/utils/global.js";
attachGlobal("Hud", { init, update });