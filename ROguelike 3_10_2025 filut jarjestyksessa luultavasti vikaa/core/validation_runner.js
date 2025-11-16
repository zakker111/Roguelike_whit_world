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

  // Reset category counters from any previous run
  V.categories = {};

  // Helper to push warnings
  function pushWarn(msg) { try { V.warnings.push(String(msg || "")); } catch (_) {} }
  function isNum(n) { return typeof n === "number" && Number.isFinite(n); }
  function in01(n) { return isNum(n) && n >= 0 && n <= 1; }
  const VALID_SLOTS = new Set(["hand","head","torso","legs","hands"]);

  // Deep schema checks for Items
  function validateItems(arr) {
    if (!Array.isArray(arr) || arr.length === 0) {
      pushWarn("[Items] Items JSON missing or empty.");
      return;
    }
    const seen = new Set();
    for (const row of arr) {
      const key = (row && (row.id || row.key || row.name)) ? String(row.id || row.key || row.name) : "";
      if (!key) { pushWarn("[Items] Missing id/key for item entry; skipped."); continue; }
      if (seen.has(key)) pushWarn(`[Items] Duplicate id/key '${key}'.`);
      seen.add(key);

      const slot = String(row?.slot || "");
      if (!VALID_SLOTS.has(slot)) pushWarn(`[Items] '${key}' has invalid/missing slot: '${slot}'.`);

      if (row.twoHanded && slot !== "hand") pushWarn(`[Items] twoHanded true for '${key}' but slot='${slot}' (only 'hand' supported).`);

      // weights: either flat weight or per-tier weights object
      if (row.weights && typeof row.weights === "object") {
        const w1 = row.weights["1"], w2 = row.weights["2"], w3 = row.weights["3"];
        ["1","2","3"].forEach((t) => {
          const w = row.weights[t];
          if (w != null && !isNum(w)) pushWarn(`[Items] '${key}' weights['${t}'] should be a number.`);
          if (isNum(w) && w < 0) pushWarn(`[Items] '${key}' weights['${t}'] negative.`);
        });
      } else if (row.weight != null && !isNum(row.weight)) {
        pushWarn(`[Items] '${key}' weight should be a number.`);
      }

      // atk/def ranges per tier: expect [min,max]
      function checkRangeMap(map, label) {
        ["1","2","3"].forEach((t) => {
          const r = map && (map[t] ?? map[Number(t)]);
          if (r != null) {
            if (!Array.isArray(r) || r.length !== 2 || !isNum(r[0]) || !isNum(r[1])) {
              pushWarn(`[Items] '${key}' ${label}[${t}] invalid; expected [min,max] numbers.`);
            } else if (r[0] > r[1]) {
              pushWarn(`[Items] '${key}' ${label}[${t}] min > max.`);
            }
          }
        });
      }
      if (row.atk) checkRangeMap(row.atk, "atk");
      if (row.def) checkRangeMap(row.def, "def");

      // handAtkBonus shape and chance
      if (row.handAtkBonus && typeof row.handAtkBonus === "object") {
        ["2","3"].forEach((t) => {
          const val = row.handAtkBonus[t];
          if (val != null) {
            if (!Array.isArray(val) || val.length !== 2 || !isNum(val[0]) || !isNum(val[1])) {
              pushWarn(`[Items] '${key}' handAtkBonus[${t}] invalid; expected [min,max] numbers.`);
            } else if (val[0] > val[1]) {
              pushWarn(`[Items] '${key}' handAtkBonus[${t}] min > max.`);
            }
          }
        });
      }
      if (row.handAtkChance != null && !in01(row.handAtkChance)) {
        pushWarn(`[Items] '${key}' handAtkChance should be in [0,1].`);
      }
    }
  }

  // Deep schema checks for Enemies
  function validateEnemies(arr) {
    if (!Array.isArray(arr) || arr.length === 0) {
      pushWarn("[Enemies] Enemies JSON missing or empty.");
      return;
    }
    const seen = new Set();
    for (const row of arr) {
      const key = (row && (row.id || row.key)) ? String(row.id || row.key) : "";
      if (!key) { pushWarn("[Enemies] Missing id/key for enemy entry; skipped."); continue; }
      if (seen.has(key)) pushWarn(`[Enemies] Duplicate id/key '${key}'.`);
      seen.add(key);

      const glyph = row?.glyph;
      if (typeof glyph !== "string" || glyph.length === 0) pushWarn(`[Enemies] '${key}' missing glyph.`);

      const tier = Number(row?.tier);
      if (!isNum(tier) || tier < 1 || tier > 3) pushWarn(`[Enemies] '${key}' tier should be 1..3.`);

      const eqc = row?.equipChance;
      if (eqc != null && !in01(eqc)) pushWarn(`[Enemies] '${key}' equipChance should be in [0,1].`);

      // weightByDepth: array of [minDepth, weight]
      if (!Array.isArray(row?.weightByDepth) || row.weightByDepth.length === 0) {
        pushWarn(`[Enemies] '${key}' missing/empty weightByDepth; it may never spawn.`);
      } else {
        for (const e of row.weightByDepth) {
          if (!Array.isArray(e) || e.length < 2 || !isNum(e[0]) || !isNum(e[1])) {
            pushWarn(`[Enemies] '${key}' weightByDepth entry invalid; expected [minDepth, weight].`);
          } else if (e[1] < 0) {
            pushWarn(`[Enemies] '${key}' weightByDepth weight negative (${e[1]}).`);
          }
        }
      }

      // hp/atk/xp arrays: [minDepth, base, slope]
      function checkLinearMap(name, map) {
        if (!Array.isArray(map) || map.length === 0) {
          pushWarn(`[Enemies] '${key}' missing ${name} array; using fallbacks.`);
          return;
        }
        for (const e of map) {
          if (!Array.isArray(e) || e.length < 3 || !isNum(e[0]) || !isNum(e[1]) || !isNum(e[2])) {
            pushWarn(`[Enemies] '${key}' ${name} entry invalid; expected [minDepth, base, slope].`);
          }
        }
      }
      checkLinearMap("hp", row.hp);
      checkLinearMap("atk", row.atk);
      checkLinearMap("xp", row.xp);

      // Optional lootPools shape (keys present but not validated against Items here; step 3 handles cross-checks)
      if (row.lootPools && typeof row.lootPools !== "object") {
        pushWarn(`[Enemies] '${key}' lootPools should be an object.`);
      }
    }
  }

  // Perform deep validations
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    if (!GD) {
      pushWarn("[General] GameData not present.");
    } else {
      validateItems(GD.items);
      validateEnemies(GD.enemies);

      // Palette overlays (basic presence)
      const pal = GD.palette;
      const ov = pal && pal.overlays ? pal.overlays : null;
      if (!ov || typeof ov !== "object") {
        pushWarn("[Palette] overlays missing; expected dim, night, dusk, dawn.");
      } else {
        const expectBasic = ["dim", "night", "dusk", "dawn"];
        const missingBasic = [];
        for (const k of expectBasic) {
          const v = ov[k];
          if (typeof v !== "string" || !v.trim().length) missingBasic.push(k);
        }
        if (missingBasic.length) pushWarn("[Palette] overlays missing keys: " + missingBasic.join(", ") + ".");
      }

      // Tiles/props presence
      if (!GD.tiles || !GD.tiles.tiles || !Array.isArray(GD.tiles.tiles)) {
        pushWarn("[Tiles] Combined assets tiles missing or invalid (data/world/world_assets.json).");
      }
      if (!GD.props || !GD.props.props || !Array.isArray(GD.props.props)) {
        try { V.notices.push("[Props] Props registry missing; decor glyphs may use fallbacks."); } catch (_) {}
      }
    }
  } catch (_) {}

  // Rebuild categories after validations
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