/**
 * HealthCheck: startup diagnostics for core modules and GameData.
 *
 * Exports (ESM + window.HealthCheck):
 * - runHealthCheck(getCtxFn?): run checks immediately and log results
 * - scheduleHealthCheck(getCtxFn): wait for GameData.ready (when available) then run
 *
 * The checks are designed to be informative but non-fatal in normal builds:
 * - Required modules/data missing -> severity "error" (red)
 * - Optional modules/data missing -> severity "warn" (amber), engine may use fallbacks
 * - Healthy modules/data -> severity "ok" (green)
 */

import { safeGet, has, getModuleHealthSpecs, getDataHealthSpecs } from "../capabilities.js";
import { run as validationRun, summary as validationSummary } from "../validation_runner.js";
import { attachGlobal } from "../../utils/global.js";

function logLine(type, message, details) {
  try {
    const LG = (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function")
      ? window.Logger
      : null;
    const payload = Object.assign({ category: "health" }, details || {});
    if (LG) {
      LG.log(String(message || ""), type || "info", payload);
    } else if (typeof console !== "undefined" && typeof console.log === "function") {
      const tag = type === "bad" || type === "error" ? "[ERROR]"
        : type === "warn" ? "[WARN]"
        : type === "good" ? "[OK]"
        : "[INFO]";
      console.log(`${tag} ${String(message || "")}`, payload);
    }
  } catch (_) {}
}

function evaluateModules(ctx) {
  const specs = [];
  try {
    const list = getModuleHealthSpecs();
    if (Array.isArray(list)) specs.push(...list);
  } catch (_) {}

  const problems = [];
  for (const spec of specs) {
    if (!spec || !spec.id) continue;
    const label = spec.label || spec.id;
    const modName = spec.modName || spec.id;
    const required = !!spec.required;
    const requiredFns = Array.isArray(spec.requiredFns) ? spec.requiredFns : [];

    let severity = "ok";
    let message = "OK";
    let code = spec.id;

    try {
      const present = has(ctx, modName);
      if (!present) {
        severity = required ? "error" : "warn";
        message = required
          ? "FAILED (module not found)"
          : "FALLBACK (module not found; engine will use degraded behavior if available)";
      } else if (requiredFns.length) {
        const missing = [];
        for (const fnName of requiredFns) {
          if (!fnName) continue;
          if (!has(ctx, modName, fnName)) missing.push(fnName);
        }
        if (missing.length) {
          severity = required ? "error" : "warn";
          message = required
            ? `FAILED (missing functions: ${missing.join(", ")})`
            : `FALLBACK (missing functions: ${missing.join(", ")})`;
        }
      }
    } catch (_) {
      severity = required ? "error" : "warn";
      message = "FAILED (exception while checking module)";
    }

    problems.push({ severity, code, label, message });
  }
  return problems;
}

function evaluateData() {
  let GD = null;
  try {
    GD = (typeof window !== "undefined") ? window.GameData : null;
  } catch (_) {
    GD = null;
  }

  const specs = [];
  try {
    const list = getDataHealthSpecs();
    if (Array.isArray(list)) specs.push(...list);
  } catch (_) {}

  const problems = [];
  for (const spec of specs) {
    if (!spec || !spec.id) continue;
    const label = spec.label || spec.id;
    const path = spec.path || spec.id;
    const required = !!spec.required;
    let severity = "ok";
    let message = "OK";
    const code = `data:${spec.id}`;

    try {
      const v = GD && Object.prototype.hasOwnProperty.call(GD, path) ? GD[path] : null;
      let present = false;
      if (Array.isArray(v)) {
        present = v.length > 0;
      } else if (v && typeof v === "object") {
        // Treat non-null objects as present; deeper validation is handled elsewhere.
        present = true;
      } else if (v != null) {
        present = true;
      }

      if (!present) {
        severity = required ? "error" : "warn";
        message = required
          ? "FAILED (missing or empty)"
          : "FALLBACK (missing or empty; engine will use internal defaults where possible)";
      }
    } catch (_) {
      severity = required ? "error" : "warn";
      message = "FAILED (exception while checking GameData domain)";
    }

    problems.push({ severity, code, label, message });
  }

  return problems;
}

/**
 * Run validation runner (schema checks on items/enemies/shops/etc.) and return
 * a synthetic problem entry summarizing warnings/notices, if any.
 */
function evaluateValidation(ctx) {
  try {
    validationRun(ctx || undefined);
  } catch (_) {
    // If validation itself fails, record as a warning but do not crash.
    return {
      severity: "warn",
      code: "validation:error",
      label: "Data validation",
      message: "FALLBACK (validation runner threw; see console for details)",
    };
  }

  let sum = null;
  try {
    sum = validationSummary();
  } catch (_) {
    sum = null;
  }
  if (!sum) return null;

  const w = Number(sum.totalWarnings || 0) | 0;
  const n = Number(sum.totalNotices || 0) | 0;
  const message = `Validation: ${w} warnings, ${n} notices.`;
  const severity = w > 0 ? "warn" : "ok";
  return { severity, code: "validation", label: "Data validation", message };
}

/**
 * Run the health check immediately and log results.
 * getCtxFn: function that returns the current ctx when invoked.
 */
export function runHealthCheck(getCtxFn) {
  let ctx = null;
  try {
    if (typeof getCtxFn === "function") {
      ctx = getCtxFn() || null;
    }
  } catch (_) {
    ctx = null;
  }

  const problems = [];
  try {
    problems.push(...evaluateModules(ctx));
  } catch (_) {}

  try {
    problems.push(...evaluateData());
  } catch (_) {}

  let validationProblem = null;
  try {
    validationProblem = evaluateValidation(ctx);
    if (validationProblem) problems.push(validationProblem);
  } catch (_) {}

  // Self-test: always inject a visible failing entry so that the health check
  // UI can be verified even when all real modules/data are OK. This does not
  // affect gameplay; it is only a diagnostic log entry.
  problems.push({
    severity: "error",
    code: "health:selftest",
    label: "Health self-test",
    message: "FAILED (intentional entry; remove after verifying health check UI).",
  });

  const errors = problems.filter(p => p && p.severity === "error").length;
  const warns = problems.filter(p => p && p.severity === "warn").length;
  const summaryType = errors ? "bad" : (warns ? "warn" : "good");

  logLine(summaryType, `Health: ${errors} errors, ${warns} warnings.`);

  for (const p of problems) {
    if (!p) continue;
    const type = p.severity === "ok" ? "good" : (p.severity === "warn" ? "warn" : "bad");
    const msg = `Health: ${p.label} -> ${p.message}`;
    logLine(type, msg, { code: p.code || p.label || undefined });
  }

  return { errors, warns, problems };
}

/**
 * Schedule the health check to run once GameData.ready has settled.
 * Does not throw; failures are logged only.
 */
export function scheduleHealthCheck(getCtxFn) {
  try {
    const GD = (typeof window !== "undefined") ? window.GameData : null;
    if (GD && GD.ready && typeof GD.ready.then === "function") {
      GD.ready.then(() => {
        try { runHealthCheck(getCtxFn); } catch (_) {}
      }).catch(() => {
        try { runHealthCheck(getCtxFn); } catch (_) {}
      });
    } else {
      runHealthCheck(getCtxFn);
    }
  } catch (_) {}
}

// Back-compat: attach to window via helper
attachGlobal("HealthCheck", { runHealthCheck, scheduleHealthCheck });