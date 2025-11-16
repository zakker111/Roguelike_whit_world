/**
 * ValidationRunner: lightweight data validation and summary counts.
 * - Reads window.ValidationLog (warnings/notices) and builds per-category counts.
 * - Provides a button-triggered summary in the GOD panel and a DEV boot summary.
 *
 * Exports (ESM + window.ValidationRunner):
 * - run(ctx?): builds/refreshes category counts based on current GameData + ValidationLog
 * - summary(): returns { totalWarnings, totalNotices, perCategory: { [name]: { warnings, notices } } }
 * - logSummary(ctx?): writes summary to Logger and GOD output element if present
 */

function ensureValidationLog() {
  try {
    const V = (typeof window !== "undefined" ? window.ValidationLog : null);
    if (!V || typeof V !== "object") {
      if (typeof window !== "undefined") window.ValidationLog = { warnings: [], notices: [], categories: {} };
      return window.ValidationLog;
    }
    if (!Array.isArray(V.warnings)) V.warnings = [];
    if (!Array.isArray(V.notices)) V.notices = [];
    if (!V.categories || typeof V.categories !== "object") V.categories = {};
    return V;
  } catch (_) {
    return { warnings: [], notices: [], categories: {} };
  }
}

function categorize(msg) {
  // Messages often start with "[Items]" or "[Enemies]" etc; fallback to heuristics
  try {
    const s = String(msg || "");
    const m = s.match(/^\s*\[([A-Za-z0-9_]+)\]\s*/);
    if (m && m[1]) return m[1];
    if (/palette/i.test(s)) return "Palette";
    if (/tiles\.json/i.test(s) || /tiles/i.test(s)) return "Tiles";
    if (/shops?/i.test(s)) return "Shops";
    if (/props/i.test(s)) return "Props";
    if (/animals/i.test(s)) return "Animals";
    return "General";
  } catch (_) { return "General"; }
}

export function run(ctx = null) {
  const V = ensureValidationLog();

  // Reset category counters
  V.categories = {};

  // Build counters from existing warnings/notices
  try {
    for (const w of V.warnings) {
      const cat = categorize(w);
      const rec = V.categories[cat] || (V.categories[cat] = { warnings: 0, notices: 0 });
      rec.warnings += 1;
    }
    for (const n of V.notices) {
      const cat = categorize(n);
      const rec = V.categories[cat] || (V.categories[cat] = { warnings: 0, notices: 0 });
      rec.notices += 1;
    }
  } catch (_) {}

  // Minimal lightweight checks to seed categories if none were recorded yet
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    if (GD) {
      if (!Array.isArray(GD.items) || GD.items.length === 0) {
        V.warnings.push("[Items] Items JSON missing or empty.");
      } else {
        let bad = 0;
        for (const row of GD.items) {
          if (!row || !row.id || !row.slot) bad++;
        }
        if (bad > 0) V.warnings.push(`[Items] ${bad} entries missing id/slot.`);
      }
      if (!Array.isArray(GD.enemies) || GD.enemies.length === 0) {
        V.warnings.push("[Enemies] Enemies JSON missing or empty.");
      } else {
        let badE = 0;
        for (const e of GD.enemies) {
          if (!e || !e.id || ((!e.hp || e.hp.length === 0) && (!e.atk || e.atk.length === 0))) badE++;
        }
        if (badE > 0) V.warnings.push(`[Enemies] ${badE} entries missing id or stats.`);
      }
      const pal = GD.palette;
      const ov = pal && pal.overlays ? pal.overlays : null;
      if (!ov || typeof ov !== "object") {
        V.warnings.push("[Palette] overlays missing; expected dim, night, dusk, dawn.");
      } else {
        const expectBasic = ["dim", "night", "dusk", "dawn"];
        const missingBasic = [];
        for (const k of expectBasic) {
          const v = ov[k];
          if (typeof v !== "string" || !v.trim().length) missingBasic.push(k);
        }
        if (missingBasic.length) V.warnings.push("[Palette] overlays missing keys: " + missingBasic.join(", ") + ".");
      }
      if (!GD.tiles || !GD.tiles.tiles || !Array.isArray(GD.tiles.tiles)) {
        V.warnings.push("[Tiles] Combined assets tiles missing or invalid (data/world/world_assets.json).");
      }
      if (!GD.props || !GD.props.props || !Array.isArray(GD.props.props)) {
        V.notices.push("[Props] Props registry missing; decor glyphs may use fallbacks.");
      }
    } else {
      V.warnings.push("[General] GameData not present.");
    }
  } catch (_) {}

  // Rebuild categories after seeding
  V.categories = {};
  try {
    for (const w of V.warnings) {
      const cat = categorize(w);
      const rec = V.categories[cat] || (V.categories[cat] = { warnings: 0, notices: 0 });
      rec.warnings += 1;
    }
    for (const n of V.notices) {
      const cat = categorize(n);
      const rec = V.categories[cat] || (V.categories[cat] = { warnings: 0, notices: 0 });
      rec.notices += 1;
    }
  } catch (_) {}

  return summary();
}

export function summary() {
  const V = ensureValidationLog();
  let totalWarnings = 0, totalNotices = 0;
  try {
    totalWarnings = Array.isArray(V.warnings) ? V.warnings.length : 0;
    totalNotices = Array.isArray(V.notices) ? V.notices.length : 0;
  } catch (_) {}
  const perCategory = {};
  try {
    const cats = V.categories || {};
    for (const k of Object.keys(cats)) {
      const rec = cats[k] || { warnings: 0, notices: 0 };
      perCategory[k] = { warnings: rec.warnings | 0, notices: rec.notices | 0 };
    }
  } catch (_) {}
  return { totalWarnings, totalNotices, perCategory };
}

export function logSummary(ctx = null) {
  const sum = summary();
  const line = `Validation: ${sum.totalWarnings} warnings, ${sum.totalNotices} notices.`;
  try {
    // Logger
    if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") {
      window.Logger.log(line, sum.totalWarnings ? "warn" : "notice");
      const cats = sum.perCategory || {};
      Object.keys(cats).forEach((k) => {
        const c = cats[k];
        window.Logger.log(`- ${k}: ${c.warnings} warnings, ${c.notices} notices`, "info");
      });
    } else if (typeof console !== "undefined") {
      console.debug("[Validation]", line);
    }
  } catch (_) {}
  try {
    const el = typeof document !== "undefined" ? document.getElementById("god-check-output") : null;
    if (el) {
      const cats = sum.perCategory || {};
      const html = [line].concat(Object.keys(cats).map((k) => {
        const c = cats[k];
        return `<div>- ${k}: ${c.warnings} warnings, ${c.notices} notices</div>`;
      })).join("");
      el.innerHTML = html;
    }
  } catch (_) {}
  try {
    const UIO = (typeof window !== "undefined" ? window.UIOrchestration : null);
    if (UIO && typeof UIO.requestDraw === "function" && ctx) {
      UIO.requestDraw(ctx);
    }
  } catch (_) {}
}

import { attachGlobal } from "../utils/global.js";
attachGlobal("ValidationRunner", { run, summary, logSummary });