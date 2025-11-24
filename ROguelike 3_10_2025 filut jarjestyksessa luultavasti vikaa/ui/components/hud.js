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

function byId(id) {
  try { return document.getElementById(id); } catch (_) { return null; }
}

export function init() {
  _hpEl = byId("health");
  _floorEl = byId("floor");
}

export function update(player, floor, time, perf, perfOn) {
  const hpEl = _hpEl || byId("health");
  const floorEl = _floorEl || byId("floor");

  // HP + statuses
  if (hpEl && player) {
    const parts = [`HP: ${Number(player.hp || 0).toFixed(1)}/${Number(player.maxHp || 0).toFixed(1)}`];
    const statuses = [];
    try {
      if (player.bleedTurns && player.bleedTurns > 0) statuses.push(`Bleeding (${player.bleedTurns})`);
      if (player.dazedTurns && player.dazedTurns > 0) statuses.push(`Dazed (${player.dazedTurns})`);
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
    const t = time || {};
    const hhmm = t.hhmm || "";
    const phase = t.phase ? t.phase : "";

    let phaseWeatherPart = "";
    try {
      const GAPI = (typeof window !== "undefined" && window.GameAPI) ? window.GameAPI : null;
      const w = GAPI && typeof GAPI.getWeather === "function" ? GAPI.getWeather() : null;
      let label = w && w.label ? String(w.label) : "";
      if (!label) label = "clear";
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
      if (perf && typeof perf.lastTurnMs === "number") {
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
}

import { attachGlobal } from "/utils/global.js";
attachGlobal("Hud", { init, update });