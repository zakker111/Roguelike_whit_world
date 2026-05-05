/**
 * Hud: Top bar HUD updater for HP/floor/time/perf.
 *
 * Exports (ESM + window.Hud):
 * - init()
 * - update(player, floor, time, perf, perfOn)
 */
import { getTownStatusSummary } from "/services/town_flavor_service.js";

let _hpEl = null;
let _floorEl = null;
let _townEl = null;
let _lastHpText = "";
let _lastFloorText = "";
let _lastHudWeatherLabel = "";
let _lastTownText = "";
let _lastTownRumorLogKey = "";

function byId(id) {
  try { return document.getElementById(id); } catch (_) { return null; }
}

export function init() {
  _hpEl = byId("health");
  _floorEl = byId("floor");
  _townEl = byId("town-status");
}

function logTownRumor(ctx, summary) {
  try {
    const rumor = summary && summary.primaryRumor ? summary.primaryRumor : null;
    const text = rumor && rumor.text ? String(rumor.text).trim() : "";
    if (!text || String(rumor.source || "") === "district") return;

    const townKey = ctx && ctx.worldReturnPos
      ? `${ctx.worldReturnPos.x | 0},${ctx.worldReturnPos.y | 0}`
      : String((summary && summary.name) || "");
    const key = `${townKey}:${String(rumor.source || "")}:${String(rumor.stage || rumor.status || "")}:${text}`;
    if (key === _lastTownRumorLogKey) return;
    _lastTownRumorLogKey = key;

    if (ctx && typeof ctx.log === "function") {
      ctx.log(`Rumor: ${text}`, "flavor", { category: "Town", source: String(rumor.source || ""), stage: String(rumor.stage || rumor.status || "") });
    } else if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") {
      window.Logger.log(`Rumor: ${text}`, "flavor", { category: "Town", source: String(rumor.source || ""), stage: String(rumor.stage || rumor.status || "") });
    }
  } catch (_) {}
}

export function update(player, floor, time, perf, perfOn, weather, ctx) {
  const hpEl = _hpEl || byId("health");
  const floorEl = _floorEl || byId("floor");
  const townEl = _townEl || byId("town-status");

  // HP + statuses
  if (hpEl && player) {
    const parts = [`HP: ${Number(player.hp || 0).toFixed(1)}/${Number(player.maxHp || 0).toFixed(1)}`];
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

  if (townEl) {
    let townText = "";
    let visible = false;
    try {
      const mode = String((ctx && ctx.mode) || "");
      if (mode === "town") {
        const summary = getTownStatusSummary(ctx);
        if (summary) {
          const districts = Array.isArray(summary.districts) ? summary.districts.join(" • ") : "";
          logTownRumor(ctx, summary);
          townText = `${summary.title || "Town"}${districts ? ` | Districts: ${districts}` : ""}`;
          visible = !!townText;
        }
      }
    } catch (_) {}
    townEl.hidden = !visible;
    if (visible && townText !== _lastTownText) {
      townEl.textContent = townText;
      _lastTownText = townText;
    } else if (!visible && _lastTownText) {
      townEl.textContent = "";
      _lastTownText = "";
    }
  }
}

import { attachGlobal } from "/utils/global.js";
attachGlobal("Hud", { init, update });
