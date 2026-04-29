/**
 * BootMonitor: lightweight global tracker for startup data/health status.
 *
 * Exposed via window.BootMonitor and ES module exports:
 *  - markData(status, info?)
 *  - markHealthSummary(result)
 *  - markValidation(status, summary?)
 *  - snapshot()
 */

import { attachGlobal } from "../../utils/global.js";

const state = {
  data: {
    status: "pending", // "pending" | "ok" | "warn" | "error"
    finishedAt: 0,
    info: null,
  },
  health: {
    status: "pending", // "pending" | "ok" | "warn" | "error"
    errors: 0,
    warns: 0,
    finishedAt: 0,
  },
  validation: {
    status: "idle", // "idle" | "running" | "done" | "error"
    summary: null,
    finishedAt: 0,
  },
};

function markData(status, info) {
  try {
    const now = Date.now();
    const s = status || "ok";
    state.data.status = s;
    state.data.finishedAt = now;
    if (info && typeof info === "object") {
      state.data.info = Object.assign({}, info);
    }
  } catch (_) {}
}

function markHealthSummary(result) {
  try {
    const now = Date.now();
    const errors = result && typeof result.errors === "number" ? (result.errors | 0) : 0;
    const warns = result && typeof result.warns === "number" ? (result.warns | 0) : 0;
    let status = "ok";
    if (errors > 0) status = "error";
    else if (warns > 0) status = "warn";

    state.health.status = status;
    state.health.errors = errors;
    state.health.warns = warns;
    state.health.finishedAt = now;
  } catch (_) {}
}

function markValidation(status, summary) {
  try {
    const now = Date.now();
    state.validation.status = status || "done";
    if (summary && typeof summary === "object") {
      state.validation.summary = Object.assign({}, summary);
    }
    state.validation.finishedAt = now;
  } catch (_) {}
}

function snapshot() {
  try {
    return {
      data: Object.assign({}, state.data),
      health: Object.assign({}, state.health),
      validation: Object.assign({}, state.validation),
    };
  } catch (_) {
    return {
      data: { status: "pending", finishedAt: 0, info: null },
      health: { status: "pending", errors: 0, warns: 0, finishedAt: 0 },
      validation: { status: "idle", summary: null, finishedAt: 0 },
    };
  }
}

attachGlobal("BootMonitor", { markData, markHealthSummary, markValidation, snapshot });

export { markData, markHealthSummary, markValidation, snapshot };